// ============================================================
// FRONTEND: src/pages/TdsReport.jsx — NEW FILE
// ------------------------------------------------------------
// "TDS" tab of the Reports page (PrimaryReports.jsx), after Vendor
// analysis. Self-contained like VendorReport.jsx: own filters, own data
// (GET /api/reports/tds), own Excel exports.
//
// Views
//   Vendor-wise   one row per deductee (PAN), branches and rates used
//   Branch-wise   TDS per branch
//   Month-wise    per month with indicative deposit due date, and per
//                 quarter with the indicative 26Q return due date
//   Rate-wise     1% / 2% / 10% …
//   Checks        things to fix before filing (no PAN, mixed rates,
//                 amount ≠ rate × taxable, nil TDS on standard vendors)
//   Register      every invoice line behind the figures
// Clicking a vendor or a branch narrows every view to it.
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import api from "../api/axios";
import { downloadExcel, filterMeta } from "../utils/exportExcel";
import BranchMultiSelect, {
  branchNamesOf,
} from "../components/BranchMultiSelect.jsx";

const C = {
  primary: "#1a3c6e",
  ok: "#16a34a",
  warn: "#d97706",
  bad: "#dc2626",
  muted: "#64748b",
  line: "#e2e8f0",
};

const fmt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const num = (n) => (Number(n) || 0).toLocaleString("en-IN");
const dt = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "—");
const pct = (n) => `${(Number(n) || 0).toFixed(2)}%`;
const rateTxt = (r) => (r === null || r === undefined ? "—" : `${r}%`);
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const monthLabel = (ym) => {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
// Due dates come as YYYY-MM-DD; overdue only matters while it's in the past.
const isPast = (ymdStr) => ymdStr && ymdStr < ymd(new Date());

// Local YYYY-MM-DD (toISOString is UTC and can be a day off).
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fyStartYear = (d = new Date()) =>
  d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
// Indian FY quarters: Q1 Apr–Jun … Q4 Jan–Mar
const quarterRange = (offset = 0) => {
  const n = new Date();
  const qStartMonth = Math.floor(((n.getMonth() + 9) % 12) / 3) * 3; // months since April
  const start = new Date(fyStartYear(n), 3 + qStartMonth + offset * 3, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
  return [ymd(start), ymd(offset === 0 ? n : end)];
};
const QUICK = [
  [
    "This month",
    () => {
      const n = new Date();
      return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(n)];
    },
  ],
  [
    "Last month",
    () => {
      const n = new Date();
      return [
        ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
        ymd(new Date(n.getFullYear(), n.getMonth(), 0)),
      ];
    },
  ],
  ["This quarter", () => quarterRange(0)],
  ["Last quarter", () => quarterRange(-1)],
  ["This FY", () => [`${fyStartYear()}-04-01`, ymd(new Date())]],
  ["Last FY", () => [`${fyStartYear() - 1}-04-01`, `${fyStartYear()}-03-31`]],
];

// TDS is filed by financial year, so that is the default period.
const BLANK = () => ({
  from: `${fyStartYear()}-04-01`,
  to: ymd(new Date()),
  dateBasis: "invoiceDate",
  branch: "",
  search: "",
  vendorKey: "",
  rate: "",
  tds: "",
  stage: "",
  expenseType: "",
  category: "",
});

const VIEWS = [
  ["vendor", "Vendor-wise"],
  ["branch", "Branch-wise"],
  ["month", "Month & quarter"],
  ["rate", "Rate-wise"],
  ["checks", "Checks"],
  ["register", "Invoice register"],
];

const toQuery = (f) =>
  new URLSearchParams(
    Object.fromEntries(
      Object.entries(f).filter(([, v]) => v !== "" && v != null),
    ),
  ).toString();

const XlsBtn = ({ onClick, label = "Excel" }) => (
  <button style={S.xlsBtn} onClick={onClick}>
    ⬇ {label}
  </button>
);

// ── Excel column sets (shared by the per-view buttons and the workbook) ──
const COLS = {
  vendor: [
    { header: "Deductee (vendor)", key: "name", width: 32 },
    { header: "Company", key: "company", width: 26 },
    { header: "PAN", key: "pan", width: 13 },
    {
      header: "PAN valid",
      value: (r) => (r.panValid ? "Yes" : "No"),
      width: 9,
    },
    { header: "Vendor type", key: "vendorType", width: 11 },
    { header: "Branches", value: (r) => r.branches.join(", "), width: 30 },
    {
      header: "Rates used",
      value: (r) => r.rates.map((x) => `${x}%`).join(", "),
      width: 12,
    },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "With TDS", key: "withTds", width: 9, fmt: "int" },
    { header: "Nil TDS", key: "nilInvoices", width: 9, fmt: "int" },
    { header: "Taxable value", key: "taxable", width: 15, fmt: "money" },
    { header: "TDS", key: "tds", width: 13, fmt: "money" },
    { header: "Effective rate %", key: "effectiveRate", width: 10, fmt: "pct" },
    { header: "Share of TDS %", key: "share", width: 10, fmt: "pct" },
    { header: "Last invoice", key: "lastDate", width: 12, fmt: "date" },
  ],
  branch: [
    { header: "Branch", key: "name", width: 26 },
    { header: "Code", key: "code", width: 9 },
    { header: "Deductees", key: "vendors", width: 10, fmt: "int" },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "With TDS", key: "withTds", width: 9, fmt: "int" },
    { header: "Nil TDS", key: "nilInvoices", width: 9, fmt: "int" },
    { header: "Taxable value", key: "taxable", width: 15, fmt: "money" },
    { header: "TDS", key: "tds", width: 13, fmt: "money" },
    { header: "Effective rate %", key: "effectiveRate", width: 10, fmt: "pct" },
    { header: "Share of TDS %", key: "share", width: 10, fmt: "pct" },
  ],
  month: [
    { header: "Month", value: (r) => monthLabel(r.month), width: 11 },
    { header: "FY", key: "fy", width: 11 },
    { header: "Quarter", key: "quarter", width: 8 },
    { header: "Deductees", key: "deductees", width: 10, fmt: "int" },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "Taxable value", key: "taxable", width: 15, fmt: "money" },
    { header: "TDS", key: "tds", width: 13, fmt: "money" },
    {
      header: "Deposit due (indicative)",
      key: "depositDue",
      width: 14,
      fmt: "date",
    },
  ],
  quarter: [
    { header: "FY", key: "fy", width: 11 },
    { header: "Quarter", key: "quarter", width: 8 },
    { header: "Return", key: "form", width: 8 },
    { header: "Deductees", key: "deductees", width: 10, fmt: "int" },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "Taxable value", key: "taxable", width: 15, fmt: "money" },
    { header: "TDS", key: "tds", width: 13, fmt: "money" },
    {
      header: "Return due (indicative)",
      key: "returnDue",
      width: 14,
      fmt: "date",
    },
  ],
  rate: [
    { header: "TDS rate", value: (r) => rateTxt(r.rate), width: 9 },
    { header: "Deductees", key: "vendors", width: 10, fmt: "int" },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "Taxable value", key: "taxable", width: 15, fmt: "money" },
    { header: "TDS", key: "tds", width: 13, fmt: "money" },
  ],
  register: [
    { header: "Request ID", key: "requestId", width: 12 },
    { header: "Invoice no.", key: "invoiceNumber", width: 16 },
    { header: "Invoice date", key: "invoiceDate", width: 12, fmt: "date" },
    { header: "TDS applied on", key: "tdsDate", width: 12, fmt: "date" },
    { header: "Month", value: (r) => monthLabel(r.month), width: 10 },
    { header: "FY", key: "fy", width: 11 },
    { header: "Quarter", key: "quarter", width: 8 },
    { header: "Branch", key: "branchName", width: 20 },
    { header: "Deductee (vendor)", key: "vendorName", width: 28 },
    { header: "Account holder", key: "accountHolder", width: 26 },
    { header: "PAN", key: "pan", width: 13 },
    {
      header: "PAN valid",
      value: (r) => (r.panValid ? "Yes" : "No"),
      width: 9,
    },
    { header: "GSTIN", key: "vendorGst", width: 17 },
    { header: "Vendor type", key: "vendorType", width: 11 },
    { header: "Subtype", key: "category", width: 20 },
    { header: "Expense type", key: "categoryType", width: 10 },
    { header: "Taxable value", key: "taxable", width: 14, fmt: "money" },
    { header: "GST", key: "gst", width: 12, fmt: "money" },
    { header: "Invoice value", key: "gross", width: 14, fmt: "money" },
    { header: "TDS %", key: "rate", width: 7, fmt: "pct" },
    { header: "TDS", key: "tds", width: 12, fmt: "money" },
    { header: "Net payable", key: "net", width: 14, fmt: "money" },
    {
      header: "Deposit due (indicative)",
      key: "depositDue",
      width: 13,
      fmt: "date",
    },
    { header: "Invoice status", key: "status", width: 18 },
    { header: "Payment status", key: "paymentStatus", width: 16 },
    { header: "Paid to vendor", key: "paid", width: 14, fmt: "money" },
    { header: "UTR", key: "lastUtr", width: 18 },
    { header: "Paid on", key: "lastPaidOn", width: 12, fmt: "date" },
  ],
  checkLine: [
    { header: "Request ID", key: "requestId", width: 12 },
    { header: "Invoice no.", key: "invoiceNumber", width: 16 },
    { header: "Invoice date", key: "invoiceDate", width: 12, fmt: "date" },
    { header: "Branch", key: "branchName", width: 20 },
    { header: "Vendor", key: "vendorName", width: 28 },
    { header: "PAN on record", key: "pan", width: 13 },
    { header: "Taxable value", key: "taxable", width: 14, fmt: "money" },
    { header: "TDS %", key: "rate", width: 7, fmt: "pct" },
    { header: "TDS", key: "tds", width: 12, fmt: "money" },
    { header: "Rate × taxable", key: "expectedTds", width: 13, fmt: "money" },
  ],
  multiRate: [
    { header: "Vendor", key: "name", width: 28 },
    { header: "PAN", key: "pan", width: 13 },
    {
      header: "Rates used",
      value: (r) => r.rates.map((x) => `${x}%`).join(", "),
      width: 14,
    },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "TDS", key: "tds", width: 13, fmt: "money" },
  ],
};

const CHECKS = [
  [
    "tdsWithoutPan",
    "TDS deducted, vendor has no valid PAN",
    "A valid PAN is needed for every deductee in the TDS return; without one the higher s.206AA rate may apply. Update the PAN on the vendor.",
    "line",
    C.bad,
  ],
  [
    "multiRateVendors",
    "Same vendor at more than one rate",
    "Often a section mix-up (e.g. 194C vs 194J). Confirm each rate is intended.",
    "multi",
    C.warn,
  ],
  [
    "amountMismatch",
    "TDS amount ≠ rate × taxable value",
    "Differs by more than ₹1 — usually the amount was edited after Accounts approval, or old data.",
    "line",
    C.warn,
  ],
  [
    "nilOnStandard",
    "Nil TDS on a standard vendor",
    "Approved at 0% for a vendor not marked statutory/utility. Fine if below threshold or exempt — worth a look.",
    "line",
    C.muted,
  ],
];

export default function TdsReport({
  branches = [],
  categories = [],
  filterSlot,
}) {
  // Inside the Reports page the filter section is rendered into a slot
  // above the tab bar (same place as the Invoice / Payment / Expense
  // filters). filterSlot: undefined = standalone, render inline;
  // null = slot not mounted yet; element = render there.
  const renderFilters = (node) =>
    filterSlot === undefined
      ? node
      : filterSlot
        ? createPortal(node, filterSlot)
        : null;
  const navigate = useNavigate();
  const [view, setView] = useState("vendor");
  const [draft, setDraft] = useState(BLANK);
  const [filters, setFilters] = useState(BLANK);
  const [data, setData] = useState(null);
  const [rateOptions, setRateOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const [workingBusy, setWorkingBusy] = useState(false);

  const load = useCallback(async () => {
    const mine = ++seq.current; // only the latest request may update the screen
    setLoading(true);
    setError("");
    try {
      const { data: res } = await api.get(`/reports/tds?${toQuery(filters)}`);
      if (mine !== seq.current) return;
      setData(res);
      // Keep every rate seen so the dropdown doesn't shrink to the one picked
      setRateOptions((prev) =>
        [...new Set([...prev, ...(res.rateOptions || [])])].sort(
          (a, b) => a - b,
        ),
      );
    } catch (err) {
      if (mine !== seq.current) return;
      setData(null);
      setError(
        err.response?.data?.message || "The TDS report could not be loaded.",
      );
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = () => setFilters(draft);
  const reset = () => {
    const b = BLANK();
    setDraft(b);
    setFilters(b);
  };
  const applyNow = (patch) => {
    const next = { ...filters, ...draft, ...patch };
    setDraft(next);
    setFilters(next);
  };
  const quick = (fn) => {
    const [from, to] = fn();
    applyNow({ from, to });
  };

  const badRange = draft.from && draft.to && draft.from > draft.to;
  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);

  const subtypeOptions = categories.filter(
    (c) => !draft.expenseType || c.type === draft.expenseType,
  );
  // Branch filter is multi-select: filters.branch = "id1,id2" ("" = all)
  const branchOpts = branches.map((b) => ({ value: b._id, label: b.name }));
  const branchName = branchNamesOf(branchOpts, filters.branch);
  const categoryName =
    categories.find((c) => String(c._id) === filters.category)?.name || null;
  const vendorName =
    filters.vendorKey &&
    (data?.byVendor || []).find((v) => v.key === filters.vendorKey)?.name;

  const meta = (extra = []) =>
    filterMeta({ ...filters, branchName }, [
      [
        "Period based on",
        filters.dateBasis === "tdsDate"
          ? "TDS applied date (Accounts approval)"
          : "Invoice date",
      ],
      [
        "Invoices",
        filters.stage === "final"
          ? "Fully approved only"
          : "Past Accounts approval (TDS decided)",
      ],
      ...(filters.tds
        ? [["TDS", filters.tds === "with" ? "Deducted only" : "Nil only"]]
        : []),
      ...(filters.rate !== "" ? [["Rate", `${filters.rate}%`]] : []),
      ...(categoryName ? [["Subtype", categoryName]] : []),
      ...(vendorName ? [["Vendor", vendorName]] : []),
      ...(filters.search ? [["Vendor search", filters.search]] : []),
      ...extra,
    ]);

  const t = data?.totals || {};
  const ex = data?.exceptions || {};
  const checkCount = CHECKS.reduce((s, [k]) => s + (ex[k]?.length || 0), 0);
  const urgentChecks =
    (ex.tdsWithoutPan?.length || 0) + (ex.amountMismatch?.length || 0);

  // Customised "TDS WORKING" sheet in the Accounts team's own format. Built
  // server-side (styled headers, formulas, Nature dropdown) with the filters
  // currently applied on screen.
  const downloadWorking = async () => {
    setWorkingBusy(true);
    try {
      const res = await api.get(
        `/reports/tds/working-excel?${toQuery(filters)}`,
        { responseType: "blob" },
      );
      const cd = res.headers?.["content-disposition"] || "";
      const name =
        /filename="?([^";]+)"?/i.exec(cd)?.[1] ||
        `TDS_Working_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = window.URL.createObjectURL(
        new Blob([res.data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // Errors arrive as a Blob because of responseType — read the message out of it.
      let msg = "The TDS working sheet could not be generated.";
      try {
        const text = await err.response?.data?.text?.();
        msg = JSON.parse(text).message || msg;
      } catch {}
      setError(msg);
    } finally {
      setWorkingBusy(false);
    }
  };

  // One workbook with every view — what Accounts hand to whoever files the return.
  const exportAll = () => {
    if (!data) return;
    const m = meta();
    downloadExcel({
      filename: "TDS_Report",
      sheets: [
        {
          name: "Summary",
          title: "TDS summary",
          meta: m,
          columns: [
            { header: "Measure", key: "k", width: 36 },
            { header: "Value", key: "v", width: 18 },
          ],
          rows: [
            { k: "TDS deducted (₹)", v: t.tds },
            { k: "Taxable value (₹)", v: t.taxable },
            {
              k: "Effective rate on TDS-bearing value (%)",
              v: t.effectiveRate,
            },
            { k: "Deductees with TDS", v: t.deducteesWithTds },
            { k: "Invoices with TDS", v: t.withTds },
            { k: "Invoices at nil TDS", v: t.nilInvoices },
            { k: "Taxable value at nil TDS (₹)", v: t.nilTaxable },
            { k: "TDS where vendor has no valid PAN (₹)", v: t.tdsWithoutPan },
            { k: "Branches", v: t.branches },
          ],
        },
        {
          name: "Vendor-wise",
          title: "Deductee-wise TDS",
          meta: m,
          columns: COLS.vendor,
          rows: data.byVendor,
          totals: totalsRow(t),
        },
        {
          name: "Branch-wise",
          title: "Branch-wise TDS",
          meta: m,
          columns: COLS.branch,
          rows: data.byBranch,
          totals: totalsRow(t),
        },
        {
          name: "Month-wise",
          title: "Month-wise TDS",
          meta: m,
          columns: COLS.month,
          rows: data.byMonth,
          totals: totalsRow(t),
        },
        {
          name: "Quarter-wise",
          title: "Quarter-wise TDS (26Q)",
          meta: m,
          columns: COLS.quarter,
          rows: data.byQuarter,
          totals: totalsRow(t),
        },
        {
          name: "Rate-wise",
          title: "Rate-wise TDS",
          meta: m,
          columns: COLS.rate,
          rows: data.byRate,
          totals: totalsRow(t),
        },
        {
          name: "Check - no PAN",
          title: CHECKS[0][1],
          meta: m,
          columns: COLS.checkLine,
          rows: ex.tdsWithoutPan || [],
        },
        {
          name: "Check - mixed rates",
          title: CHECKS[1][1],
          meta: m,
          columns: COLS.multiRate,
          rows: ex.multiRateVendors || [],
        },
        {
          name: "Check - amount",
          title: CHECKS[2][1],
          meta: m,
          columns: COLS.checkLine,
          rows: ex.amountMismatch || [],
        },
        {
          name: "Check - nil TDS",
          title: CHECKS[3][1],
          meta: m,
          columns: COLS.checkLine,
          rows: ex.nilOnStandard || [],
        },
        {
          name: "Invoice register",
          title: "TDS invoice register",
          meta: data.registerTruncated
            ? meta([
                [
                  "Note",
                  `First ${num(data.register.length)} of ${num(data.registerTotal)} lines — narrow the period for the rest`,
                ],
              ])
            : m,
          columns: COLS.register,
          rows: data.register,
          totals: totalsRow(t),
        },
      ],
    });
  };

  return (
    <div style={S.wrap}>
      {renderFilters(
        <>
          {/* ── Filters ──────────────────────────────────────── */}
          <div style={S.bar}>
            <Field label="From">
              <input
                type="date"
                style={S.input}
                value={draft.from}
                onChange={set("from")}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                style={S.input}
                value={draft.to}
                onChange={set("to")}
              />
            </Field>
            <Field label="Period based on">
              <select
                style={S.input}
                value={draft.dateBasis}
                onChange={set("dateBasis")}
              >
                <option value="invoiceDate">Invoice date</option>
                <option value="tdsDate">
                  TDS applied date (Accounts approval)
                </option>
              </select>
            </Field>
            <Field label="Branch">
              <BranchMultiSelect
                style={S.input}
                options={branchOpts}
                value={draft.branch}
                onChange={(v) => setDraft((d) => ({ ...d, branch: v }))}
              />
            </Field>
            <Field label="Vendor">
              <input
                style={S.input}
                placeholder="Name, company or PAN"
                value={draft.search}
                onChange={set("search")}
                onKeyDown={(e) => e.key === "Enter" && !badRange && apply()}
              />
            </Field>
            <Field label="TDS rate">
              <select style={S.input} value={draft.rate} onChange={set("rate")}>
                <option value="">All rates</option>
                {rateOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </select>
            </Field>
            <Field label="TDS">
              <select style={S.input} value={draft.tds} onChange={set("tds")}>
                <option value="">Deducted + nil</option>
                <option value="with">Deducted only</option>
                <option value="nil">Nil TDS only</option>
              </select>
            </Field>
            <Field label="Invoices">
              <select
                style={S.input}
                value={draft.stage}
                onChange={set("stage")}
              >
                <option value="">Past Accounts approval</option>
                <option value="final">Fully approved only</option>
              </select>
            </Field>
            <Field label="Type">
              <select
                style={S.input}
                value={draft.expenseType}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    expenseType: e.target.value,
                    category: "",
                  }))
                }
              >
                <option value="">Revenue + Capital</option>
                <option value="Revenue">Revenue</option>
                <option value="Capital">Capital</option>
              </select>
            </Field>
            <Field label="Subtype">
              <select
                style={S.input}
                value={draft.category}
                onChange={set("category")}
              >
                <option value="">All subtypes</option>
                {subtypeOptions.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.code ? `${c.code} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div style={S.actions}>
              <button
                style={{
                  ...S.applyBtn,
                  opacity: badRange ? 0.5 : 1,
                  cursor: badRange ? "not-allowed" : "pointer",
                }}
                onClick={apply}
                disabled={badRange}
              >
                {dirty ? "Apply changes" : "Apply"}
              </button>
              <button style={S.resetBtn} onClick={reset}>
                Reset
              </button>
            </div>
          </div>

          <div style={S.quickRow}>
            <span style={{ fontSize: 12, color: C.muted }}>Quick period:</span>
            {QUICK.map(([label, fn]) => (
              <button key={label} style={S.chip} onClick={() => quick(fn)}>
                {label}
              </button>
            ))}
            {badRange && (
              <span style={S.hint}>The end date is before the start date.</span>
            )}
            {dirty && !badRange && <span style={S.hint}>Not applied yet</span>}
          </div>

          {/* Drill-down chips */}
          {(filters.vendorKey || filters.branch) && (
            <div style={S.quickRow}>
              <span style={{ fontSize: 12, color: C.muted }}>
                Showing only:
              </span>
              {filters.vendorKey && (
                <button
                  style={S.activeChip}
                  onClick={() => applyNow({ vendorKey: "" })}
                  title="Remove"
                >
                  Vendor: {vendorName || filters.vendorKey} ✕
                </button>
              )}
              {filters.branch && (
                <button
                  style={S.activeChip}
                  onClick={() => applyNow({ branch: "" })}
                  title="Remove"
                >
                  {filters.branch.includes(",") ? "Branches" : "Branch"}:{" "}
                  {branchName || "selected"} ✕
                </button>
              )}
            </div>
          )}
        </>,
      )}

      {error && <div style={S.error}>{error}</div>}

      {/* ── Headline figures ─────────────────────────────── */}
      {data && (
        <div style={S.statRow}>
          <Stat label="TDS deducted" value={fmt(t.tds)} />
          <Stat label="Taxable value" value={fmt(t.taxable)} tone={C.muted} />
          <Stat
            label="Effective rate (on TDS-bearing value)"
            value={pct(t.effectiveRate)}
            tone={C.muted}
          />
          <Stat
            label="Deductees with TDS"
            value={num(t.deducteesWithTds)}
            tone={C.muted}
          />
          <Stat
            label="Invoices with TDS"
            value={num(t.withTds)}
            tone={C.muted}
          />
          <Stat
            label="Invoices at nil TDS"
            value={`${num(t.nilInvoices)} · ${fmt(t.nilTaxable)}`}
            tone={C.muted}
          />
          <Stat
            label="TDS with no valid vendor PAN"
            value={fmt(t.tdsWithoutPan)}
            tone={t.tdsWithoutPan > 0 ? C.bad : C.ok}
          />
        </div>
      )}

      {data && checkCount > 0 && (
        <div style={urgentChecks ? S.alert : S.insight}>
          <strong>{num(checkCount)} item(s) to review before filing</strong>
          {urgentChecks
            ? ` — including ${num(urgentChecks)} that need fixing (missing PAN / amount mismatch).`
            : "."}{" "}
          <button style={S.inlineLink} onClick={() => setView("checks")}>
            Open checks →
          </button>
        </div>
      )}

      <div style={S.viewRow}>
        {VIEWS.map(([k, l]) => (
          <button
            key={k}
            style={{ ...S.toggle, ...(view === k ? S.toggleActive : {}) }}
            onClick={() => setView(k)}
          >
            {l}
            {k === "checks" && checkCount > 0 && (
              <span style={S.countBadge}>{checkCount}</span>
            )}
          </button>
        ))}
        <span style={{ marginLeft: "auto" }} />
        {data && (
          <button
            style={{
              ...S.xlsBtn,
              marginRight: 8,
              opacity: workingBusy ? 0.6 : 1,
            }}
            disabled={workingBusy}
            title="TDS WORKING sheet in the Accounts format — one row per invoice with TDS deducted, for the period and branch selected"
            onClick={downloadWorking}
          >
            {workingBusy ? "⏳ Preparing…" : "⬇ Customized TDS Report"}
          </button>
        )}
        {data && <XlsBtn onClick={exportAll} label="Full TDS workbook" />}
      </div>

      {loading && !data ? (
        <div style={S.loading}>Loading…</div>
      ) : !data ? null : !data.registerTotal ? (
        <div style={S.empty}>
          <div style={{ fontWeight: 600, color: "#475569" }}>
            No invoices with a TDS decision match these filters
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
            TDS is set at Accounts approval, so invoices still with the partner
            (or rejected) don't appear. Widen the period or clear a filter.
          </div>
        </div>
      ) : (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity .15s" }}>
          {view === "vendor" && (
            <VendorView
              data={data}
              meta={meta}
              onVendor={(key) => applyNow({ vendorKey: key, search: "" })}
            />
          )}
          {view === "branch" && (
            <BranchView
              data={data}
              meta={meta}
              onBranch={(id) => applyNow({ branch: id })}
            />
          )}
          {view === "month" && <MonthView data={data} meta={meta} />}
          {view === "rate" && (
            <RateView
              data={data}
              meta={meta}
              onRate={(r) => applyNow({ rate: r == null ? "" : String(r) })}
            />
          )}
          {view === "checks" && (
            <ChecksView
              ex={ex}
              meta={meta}
              onOpen={(id) => navigate(`/invoices/${id}`)}
              onVendor={(key) => applyNow({ vendorKey: key, search: "" })}
            />
          )}
          {view === "register" && (
            <RegisterView
              data={data}
              meta={meta}
              onOpen={(id) => navigate(`/invoices/${id}`)}
            />
          )}
        </div>
      )}

      <div style={S.footNote}>
        TDS appears once Accounts approve an invoice (that is where the rate is
        set) and is calculated on the taxable value before GST. Deposit and
        return due dates are indicative — 7th of the next month (30 April for
        March) and 26Q dates of 31 Jul / 31 Oct / 31 Jan / 31 May — and assume
        the deduction falls in the month shown.
      </div>
    </div>
  );
}

const totalsRow = (t) => ({
  __label: "Total",
  invoices: t.invoices,
  withTds: t.withTds,
  nilInvoices: t.nilInvoices,
  taxable: t.taxable,
  gst: t.gst,
  tds: t.tds,
  net: t.net,
});

// ── Sortable table helper ──────────────────────────────────
function useSort(initial) {
  const [sort, setSort] = useState({ key: initial, dir: -1 });
  const head = (key, label, right = true) => (
    <th
      key={key}
      style={{ ...(right ? S.thR : S.th), cursor: "pointer" }}
      onClick={() =>
        setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
      }
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );
  const apply = (rows) =>
    [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null || av === "") return 1;
      if (bv == null || bv === "") return -1;
      if (typeof av === "number" && typeof bv === "number")
        return sort.dir * (av - bv);
      return (
        sort.dir * String(av).localeCompare(String(bv), "en", { numeric: true })
      );
    });
  return { head, apply };
}

const Card = ({ title, sub, onExcel, children }) => (
  <div style={S.card}>
    <div style={S.headRow}>
      <div>
        <div style={S.cardTitle}>{title}</div>
        {sub && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
            {sub}
          </div>
        )}
      </div>
      {onExcel && <XlsBtn onClick={onExcel} />}
    </div>
    {children}
  </div>
);

const PanCell = ({ pan, valid }) =>
  valid ? (
    <span style={S.mono}>{pan}</span>
  ) : (
    <span style={S.badTag} title="No valid PAN on the vendor record">
      {pan ? `${pan} · invalid` : "No PAN"}
    </span>
  );

// ── Vendor-wise ────────────────────────────────────────────
function VendorView({ data, meta, onVendor }) {
  const { head, apply } = useSort("tds");
  const [limit, setLimit] = useState(100);
  const rows = apply(data.byVendor);
  const t = data.totals;
  return (
    <Card
      title="Deductee-wise TDS"
      sub="One row per vendor PAN, across branches. Click a vendor to narrow every view to it."
      onExcel={() =>
        downloadExcel({
          filename: "TDS_Vendor_wise",
          sheets: [
            {
              name: "Vendor-wise",
              title: "Deductee-wise TDS",
              meta: meta(),
              columns: COLS.vendor,
              rows,
              totals: totalsRow(t),
            },
          ],
        })
      }
    >
      <div style={S.scroll}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              {head("name", "Vendor", false)}
              {head("pan", "PAN", false)}
              <th style={S.th}>Branches</th>
              <th style={S.th}>Rates</th>
              {head("invoices", "Invoices")}
              {head("nilInvoices", "Nil TDS")}
              {head("taxable", "Taxable value")}
              {head("tds", "TDS")}
              {head("effectiveRate", "Eff. rate")}
              {head("share", "Share")}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.key} style={S.tr}>
                <td style={S.td}>
                  <button
                    style={S.linkBtn}
                    onClick={() => onVendor(r.key)}
                    title="Show only this vendor"
                  >
                    {r.name}
                  </button>
                  {r.company && r.company !== r.name && (
                    <div style={S.subTxt}>{r.company}</div>
                  )}
                  {r.vendorType === "statutory" && (
                    <span style={S.tag}>statutory</span>
                  )}
                </td>
                <td style={S.td}>
                  <PanCell pan={r.pan} valid={r.panValid} />
                </td>
                <td
                  style={{ ...S.td, fontSize: 12 }}
                  title={r.branches.join(", ")}
                >
                  {r.branchCount > 2
                    ? `${r.branches.slice(0, 2).join(", ")} +${r.branchCount - 2}`
                    : r.branches.join(", ")}
                </td>
                <td style={S.td}>
                  {r.rates.map((x) => (
                    <span
                      key={x}
                      style={{
                        ...S.rateTag,
                        ...(r.rates.length > 1 ? S.rateTagWarn : {}),
                      }}
                    >
                      {x}%
                    </span>
                  ))}
                </td>
                <td style={S.tdR}>{num(r.invoices)}</td>
                <td style={S.tdR}>
                  {r.nilInvoices ? num(r.nilInvoices) : "—"}
                </td>
                <td style={S.tdR}>{fmt(r.taxable)}</td>
                <td style={S.tdRB}>{fmt(r.tds)}</td>
                <td style={S.tdR}>{pct(r.effectiveRate)}</td>
                <td style={S.tdR}>{pct(r.share)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={S.totalRow}>
              <td style={{ ...S.td, fontWeight: 700 }} colSpan={4}>
                Total · {num(rows.length)} vendors
              </td>
              <td style={S.tdRB}>{num(t.invoices)}</td>
              <td style={S.tdRB}>{num(t.nilInvoices)}</td>
              <td style={S.tdRB}>{fmt(t.taxable)}</td>
              <td style={S.tdRB}>{fmt(t.tds)}</td>
              <td style={S.tdRB}>{pct(t.effectiveRate)}</td>
              <td style={S.tdRB}>100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length > limit && (
        <div style={S.moreRow}>
          Showing {num(limit)} of {num(rows.length)} ·{" "}
          <button style={S.inlineLink} onClick={() => setLimit((l) => l + 200)}>
            show more
          </button>{" "}
          (the Excel has all)
        </div>
      )}
    </Card>
  );
}

// ── Branch-wise ────────────────────────────────────────────
function BranchView({ data, meta, onBranch }) {
  const { head, apply } = useSort("tds");
  const rows = apply(data.byBranch);
  const t = data.totals;
  const max = Math.max(...rows.map((r) => r.tds), 1);
  return (
    <Card
      title="Branch-wise TDS"
      sub="Click a branch to narrow every view to it."
      onExcel={() =>
        downloadExcel({
          filename: "TDS_Branch_wise",
          sheets: [
            {
              name: "Branch-wise",
              title: "Branch-wise TDS",
              meta: meta(),
              columns: COLS.branch,
              rows,
              totals: totalsRow(t),
            },
          ],
        })
      }
    >
      <div style={S.scroll}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              {head("name", "Branch", false)}
              {head("vendors", "Deductees")}
              {head("invoices", "Invoices")}
              {head("nilInvoices", "Nil TDS")}
              {head("taxable", "Taxable value")}
              {head("tds", "TDS")}
              {head("effectiveRate", "Eff. rate")}
              <th style={{ ...S.th, minWidth: 140 }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.branchId} style={S.tr}>
                <td style={S.td}>
                  <button
                    style={S.linkBtn}
                    onClick={() => onBranch(r.branchId)}
                  >
                    {r.name}
                  </button>
                  {r.code && <span style={S.subTxt}> {r.code}</span>}
                </td>
                <td style={S.tdR}>{num(r.vendors)}</td>
                <td style={S.tdR}>{num(r.invoices)}</td>
                <td style={S.tdR}>
                  {r.nilInvoices ? num(r.nilInvoices) : "—"}
                </td>
                <td style={S.tdR}>{fmt(r.taxable)}</td>
                <td style={S.tdRB}>{fmt(r.tds)}</td>
                <td style={S.tdR}>{pct(r.effectiveRate)}</td>
                <td style={S.td}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <div style={S.barTrack}>
                      <div
                        style={{
                          ...S.barFill,
                          width: `${(r.tds / max) * 100}%`,
                        }}
                      />
                    </div>
                    <span
                      style={{ fontSize: 12, color: C.muted, minWidth: 42 }}
                    >
                      {pct(r.share)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={S.totalRow}>
              <td style={{ ...S.td, fontWeight: 700 }}>Total</td>
              <td style={S.tdRB}>{num(t.deducteesWithTds)}*</td>
              <td style={S.tdRB}>{num(t.invoices)}</td>
              <td style={S.tdRB}>{num(t.nilInvoices)}</td>
              <td style={S.tdRB}>{fmt(t.taxable)}</td>
              <td style={S.tdRB}>{fmt(t.tds)}</td>
              <td style={S.tdRB}>{pct(t.effectiveRate)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={S.moreRow}>
        * Deductees with TDS, counted once across branches.
      </div>
    </Card>
  );
}

// ── Month & quarter ────────────────────────────────────────
function MonthView({ data, meta }) {
  const t = data.totals;
  const max = Math.max(...data.byMonth.map((r) => r.tds), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        title="Month-wise TDS & deposit due"
        sub="Due = 7th of the following month (30 April for March). Indicative."
        onExcel={() =>
          downloadExcel({
            filename: "TDS_Month_wise",
            sheets: [
              {
                name: "Month-wise",
                title: "Month-wise TDS",
                meta: meta(),
                columns: COLS.month,
                rows: data.byMonth,
                totals: totalsRow(t),
              },
            ],
          })
        }
      >
        <div style={S.scroll}>
          <table style={S.table}>
            <thead>
              <tr style={S.thead}>
                <th style={S.th}>Month</th>
                <th style={S.th}>FY · Qtr</th>
                <th style={S.thR}>Deductees</th>
                <th style={S.thR}>Invoices</th>
                <th style={S.thR}>Taxable value</th>
                <th style={S.thR}>TDS</th>
                <th style={{ ...S.th, minWidth: 120 }} />
                <th style={S.thR}>Deposit due</th>
              </tr>
            </thead>
            <tbody>
              {data.byMonth.map((r) => (
                <tr key={r.month} style={S.tr}>
                  <td style={{ ...S.td, fontWeight: 600 }}>
                    {monthLabel(r.month)}
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: C.muted }}>
                    {r.fy} · {r.quarter}
                  </td>
                  <td style={S.tdR}>{num(r.deductees)}</td>
                  <td style={S.tdR}>{num(r.invoices)}</td>
                  <td style={S.tdR}>{fmt(r.taxable)}</td>
                  <td style={S.tdRB}>{fmt(r.tds)}</td>
                  <td style={S.td}>
                    <div style={S.barTrack}>
                      <div
                        style={{
                          ...S.barFill,
                          width: `${(r.tds / max) * 100}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td
                    style={{
                      ...S.tdR,
                      color: isPast(r.depositDue) ? C.muted : C.primary,
                      fontWeight: 600,
                    }}
                  >
                    {r.depositDue ? dt(r.depositDue) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Quarter-wise TDS (26Q)"
        sub="Return due 31 Jul, 31 Oct, 31 Jan and 31 May. Indicative."
        onExcel={() =>
          downloadExcel({
            filename: "TDS_Quarter_wise",
            sheets: [
              {
                name: "Quarter-wise",
                title: "Quarter-wise TDS (26Q)",
                meta: meta(),
                columns: COLS.quarter,
                rows: data.byQuarter,
                totals: totalsRow(t),
              },
            ],
          })
        }
      >
        <SimpleTable
          rows={data.byQuarter}
          cols={[
            ["FY", (r) => r.fy],
            ["Quarter", (r) => <strong>{r.quarter}</strong>],
            ["Deductees", (r) => num(r.deductees), true],
            ["Invoices", (r) => num(r.invoices), true],
            ["Taxable value", (r) => fmt(r.taxable), true],
            ["TDS", (r) => <strong>{fmt(r.tds)}</strong>, true],
            ["Return due", (r) => dt(r.returnDue), true],
          ]}
        />
      </Card>
    </div>
  );
}

// ── Rate-wise ──────────────────────────────────────────────
function RateView({ data, meta, onRate }) {
  const t = data.totals;
  return (
    <Card
      title="Rate-wise TDS"
      sub="Click a rate to filter by it. Sections aren't recorded on invoices, so rates are shown as entered."
      onExcel={() =>
        downloadExcel({
          filename: "TDS_Rate_wise",
          sheets: [
            {
              name: "Rate-wise",
              title: "Rate-wise TDS",
              meta: meta(),
              columns: COLS.rate,
              rows: data.byRate,
              totals: totalsRow(t),
            },
          ],
        })
      }
    >
      <SimpleTable
        rows={data.byRate}
        cols={[
          [
            "Rate",
            (r) => (
              <button style={S.linkBtn} onClick={() => onRate(r.rate)}>
                {rateTxt(r.rate)}
              </button>
            ),
          ],
          ["Deductees", (r) => num(r.vendors), true],
          ["Invoices", (r) => num(r.invoices), true],
          ["Taxable value", (r) => fmt(r.taxable), true],
          ["TDS", (r) => <strong>{fmt(r.tds)}</strong>, true],
          ["Share of TDS", (r) => pct(t.tds ? (r.tds / t.tds) * 100 : 0), true],
        ]}
      />
    </Card>
  );
}

// ── Checks ─────────────────────────────────────────────────
function ChecksView({ ex, meta, onOpen, onVendor }) {
  const [open, setOpen] = useState(
    () => CHECKS.find(([k]) => ex[k]?.length)?.[0] || null,
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {CHECKS.map(([key, title, help, kind, tone]) => {
        const rows = ex[key] || [];
        const isOpen = open === key;
        return (
          <div
            key={key}
            style={{
              ...S.card,
              borderLeft: `4px solid ${rows.length ? tone : C.ok}`,
            }}
          >
            <div
              style={{
                ...S.headRow,
                marginBottom: isOpen && rows.length ? 14 : 0,
              }}
            >
              <button
                style={S.checkHead}
                onClick={() => setOpen(isOpen ? null : key)}
              >
                <span
                  style={{
                    ...S.countPill,
                    background: rows.length ? tone : C.ok,
                  }}
                >
                  {rows.length || "✓"}
                </span>
                <span>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                    {help}
                  </div>
                </span>
              </button>
              {rows.length > 0 && (
                <XlsBtn
                  onClick={() =>
                    downloadExcel({
                      filename: `TDS_Check_${key}`,
                      sheets: [
                        {
                          name: title,
                          title,
                          meta: meta(),
                          columns:
                            kind === "multi" ? COLS.multiRate : COLS.checkLine,
                          rows,
                        },
                      ],
                    })
                  }
                />
              )}
            </div>
            {isOpen &&
              rows.length > 0 &&
              (kind === "multi" ? (
                <SimpleTable
                  rows={rows}
                  cols={[
                    [
                      "Vendor",
                      (r) => (
                        <button
                          style={S.linkBtn}
                          onClick={() => onVendor(r.key)}
                        >
                          {r.name}
                        </button>
                      ),
                    ],
                    ["PAN", (r) => <span style={S.mono}>{r.pan || "—"}</span>],
                    [
                      "Rates used",
                      (r) =>
                        r.rates.map((x) => (
                          <span
                            key={x}
                            style={{ ...S.rateTag, ...S.rateTagWarn }}
                          >
                            {x}%
                          </span>
                        )),
                    ],
                    ["Invoices", (r) => num(r.invoices), true],
                    ["TDS", (r) => fmt(r.tds), true],
                  ]}
                />
              ) : (
                <SimpleTable
                  rows={rows.slice(0, 300)}
                  cols={[
                    [
                      "Invoice",
                      (r) => (
                        <button style={S.linkBtn} onClick={() => onOpen(r.id)}>
                          {r.requestId}
                        </button>
                      ),
                    ],
                    [
                      "Inv. no. · date",
                      (r) => (
                        <span style={{ fontSize: 12 }}>
                          {r.invoiceNumber} · {dt(r.invoiceDate)}
                        </span>
                      ),
                    ],
                    ["Branch", (r) => r.branchName || "—"],
                    ["Vendor", (r) => r.vendorName],
                    ["PAN", (r) => <span style={S.mono}>{r.pan || "—"}</span>],
                    ["Taxable", (r) => fmt(r.taxable), true],
                    ["Rate", (r) => rateTxt(r.rate), true],
                    ["TDS", (r) => <strong>{fmt(r.tds)}</strong>, true],
                    ...(key === "amountMismatch"
                      ? [["Rate × taxable", (r) => fmt(r.expectedTds), true]]
                      : []),
                  ]}
                />
              ))}
            {isOpen && rows.length > 300 && (
              <div style={S.moreRow}>
                First 300 shown — the Excel has all {num(rows.length)}.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Register ───────────────────────────────────────────────
function RegisterView({ data, meta, onOpen }) {
  const [limit, setLimit] = useState(200);
  const rows = data.register;
  return (
    <Card
      title="TDS invoice register"
      sub={`${num(data.registerTotal)} invoice line(s), oldest first. Click an invoice to open it.`}
      onExcel={() =>
        downloadExcel({
          filename: "TDS_Invoice_Register",
          sheets: [
            {
              name: "Invoice register",
              title: "TDS invoice register",
              meta: data.registerTruncated
                ? meta([
                    [
                      "Note",
                      `First ${num(rows.length)} of ${num(data.registerTotal)} lines — narrow the period for the rest`,
                    ],
                  ])
                : meta(),
              columns: COLS.register,
              rows,
              totals: totalsRow(data.totals),
            },
          ],
        })
      }
    >
      {data.registerTruncated && (
        <div style={S.note}>
          Showing the first {num(rows.length)} of {num(data.registerTotal)}{" "}
          lines. Totals above include all of them; narrow the period to list the
          rest.
        </div>
      )}
      <div style={S.scroll}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={S.th}>Invoice</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Branch</th>
              <th style={S.th}>Vendor · PAN</th>
              <th style={S.thR}>Taxable</th>
              <th style={S.thR}>Rate</th>
              <th style={S.thR}>TDS</th>
              <th style={S.thR}>Net payable</th>
              <th style={S.th}>Payment</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.id} style={S.tr}>
                <td style={S.td}>
                  <button style={S.linkBtn} onClick={() => onOpen(r.id)}>
                    {r.requestId}
                  </button>
                  <div style={S.subTxt}>{r.invoiceNumber}</div>
                </td>
                <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                  {dt(r.invoiceDate)}
                  {r.tdsDate && <div style={S.subTxt}>TDS {dt(r.tdsDate)}</div>}
                </td>
                <td style={S.td}>{r.branchName || "—"}</td>
                <td style={S.td}>
                  {r.vendorName}
                  <div>
                    <PanCell pan={r.pan} valid={r.panValid} />
                  </div>
                </td>
                <td style={S.tdR}>{fmt(r.taxable)}</td>
                <td style={S.tdR}>{rateTxt(r.rate)}</td>
                <td style={S.tdRB}>{fmt(r.tds)}</td>
                <td style={S.tdR}>{fmt(r.net)}</td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {r.paymentStatus}
                  {r.lastUtr && <div style={S.subTxt}>UTR {r.lastUtr}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div style={S.moreRow}>
          Showing {num(limit)} of {num(rows.length)} ·{" "}
          <button style={S.inlineLink} onClick={() => setLimit((l) => l + 500)}>
            show more
          </button>{" "}
          (the Excel has all)
        </div>
      )}
    </Card>
  );
}

function SimpleTable({ rows, cols }) {
  if (!rows?.length)
    return <div style={S.emptySmall}>Nothing here for these filters.</div>;
  return (
    <div style={S.scroll}>
      <table style={S.table}>
        <thead>
          <tr style={S.thead}>
            {cols.map(([h, , right]) => (
              <th key={h} style={right ? S.thR : S.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={S.tr}>
              {cols.map(([h, render, right]) => (
                <td key={h} style={right ? S.tdR : S.td}>
                  {render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Field = ({ label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
      {label}
    </span>
    {children}
  </label>
);

const Stat = ({ label, value, tone = C.primary }) => (
  <div style={S.stat}>
    <div
      style={{ fontSize: 19, fontWeight: 700, color: tone, marginBottom: 3 }}
    >
      {value}
    </div>
    <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
  </div>
);

// ── Styles (same look as VendorReport.jsx) ─────────────────
const S = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 },
  bar: {
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    flexWrap: "wrap",
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "14px 16px",
  },
  input: {
    padding: "8px 10px",
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    fontSize: 13,
    minWidth: 140,
    background: "#fff",
  },
  actions: {
    display: "flex",
    gap: 8,
    marginLeft: "auto",
    alignItems: "flex-end",
  },
  applyBtn: {
    padding: "9px 16px",
    background: C.primary,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
  },
  resetBtn: {
    padding: "9px 14px",
    background: "none",
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    color: C.muted,
    fontSize: 13,
    cursor: "pointer",
  },
  quickRow: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: -6,
  },
  chip: {
    padding: "4px 10px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 999,
    fontSize: 12,
    color: "#475569",
    cursor: "pointer",
  },
  activeChip: {
    padding: "4px 10px",
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    borderRadius: 999,
    fontSize: 12,
    color: "#1d4ed8",
    cursor: "pointer",
    fontWeight: 600,
  },
  hint: { fontSize: 12, color: C.warn, marginLeft: 8 },
  statRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 12,
  },
  stat: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "15px 17px",
  },
  insight: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
  },
  alert: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
  },
  inlineLink: {
    background: "none",
    border: "none",
    padding: 0,
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  viewRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  toggle: {
    padding: "7px 14px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 8,
    fontSize: 12,
    color: C.muted,
    cursor: "pointer",
    fontWeight: 600,
  },
  toggleActive: {
    background: "#eff6ff",
    color: "#2563eb",
    borderColor: "#bfdbfe",
  },
  countBadge: {
    marginLeft: 6,
    background: C.warn,
    color: "#fff",
    borderRadius: 999,
    padding: "0 6px",
    fontSize: 11,
  },
  card: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "18px 20px",
  },
  cardTitle: { fontSize: 14, fontWeight: 700, color: C.primary },
  headRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  checkHead: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
    flex: 1,
  },
  countPill: {
    minWidth: 30,
    height: 30,
    borderRadius: 999,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
    padding: "0 8px",
  },
  scroll: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  thead: { borderBottom: `2px solid ${C.line}` },
  th: {
    padding: "9px 10px",
    textAlign: "left",
    fontSize: 12,
    color: C.muted,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  thR: {
    padding: "9px 10px",
    textAlign: "right",
    fontSize: 12,
    color: C.muted,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  totalRow: { borderTop: `2px solid ${C.line}`, background: "#f8fafc" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "10px", color: "#334155", verticalAlign: "top" },
  tdR: {
    padding: "10px",
    color: "#334155",
    textAlign: "right",
    whiteSpace: "nowrap",
    verticalAlign: "top",
  },
  tdRB: {
    padding: "10px",
    color: "#0f172a",
    textAlign: "right",
    whiteSpace: "nowrap",
    fontWeight: 700,
    verticalAlign: "top",
  },
  linkBtn: {
    background: "none",
    border: "none",
    padding: 0,
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "left",
  },
  subTxt: { fontSize: 11, color: C.muted, marginTop: 2 },
  tag: {
    display: "inline-block",
    marginTop: 3,
    fontSize: 10,
    fontWeight: 700,
    background: "#f1f5f9",
    color: C.muted,
    borderRadius: 4,
    padding: "1px 6px",
  },
  badTag: {
    fontSize: 11,
    fontWeight: 700,
    background: "#fef2f2",
    color: C.bad,
    borderRadius: 4,
    padding: "1px 6px",
  },
  rateTag: {
    display: "inline-block",
    marginRight: 4,
    fontSize: 11,
    fontWeight: 700,
    background: "#f1f5f9",
    color: "#334155",
    borderRadius: 4,
    padding: "1px 6px",
  },
  rateTagWarn: { background: "#fffbeb", color: "#b45309" },
  mono: { fontFamily: "monospace", fontSize: 12 },
  barTrack: {
    flex: 1,
    height: 8,
    background: "#f1f5f9",
    borderRadius: 999,
    overflow: "hidden",
    minWidth: 80,
  },
  barFill: { height: "100%", background: "#3b82f6", borderRadius: 999 },
  moreRow: { fontSize: 12, color: C.muted, marginTop: 12, textAlign: "center" },
  note: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    marginBottom: 12,
  },
  footNote: { fontSize: 12, color: C.muted, lineHeight: 1.5 },
  error: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
  },
  loading: { padding: 50, textAlign: "center", color: "#94a3b8" },
  empty: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: 48,
    textAlign: "center",
  },
  emptySmall: {
    padding: 30,
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 13,
  },
  xlsBtn: {
    padding: "6px 12px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#15803d",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
