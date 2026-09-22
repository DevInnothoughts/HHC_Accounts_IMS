// ============================================================
// FRONTEND: src/pages/VendorReport.jsx  —  NEW FILE
// ------------------------------------------------------------
// "Vendor analysis" tab of the Reports page (PrimaryReports.jsx).
// Self-contained like SubtypeReport.jsx: its own filters and styles.
//
// Views
//   Vendor summary   one row per real vendor (group-wide), sortable
//   Vendor × branch  top vendors across branches
//   Outstanding      approved-but-unpaid, aged by invoice date
//   Monthly trend    spend (or payments) per month
// Clicking a vendor opens its detail: branch-wise, month-wise,
// subtype-wise, and the invoices and payments behind the figures.
//
// Basis
//   Billed — invoices in the period (by invoice date or entry date)
//   Paid   — money actually paid in the period (UTR-recorded payments,
//            by payment date)
// ============================================================
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import React from "react";
import api from "../api/axios";
import { downloadExcel, filterMeta } from "../utils/exportExcel";

const C = {
  primary: "#1a3c6e",
  ok: "#16a34a",
  warn: "#d97706",
  bad: "#dc2626",
  muted: "#64748b",
  line: "#e2e8f0",
  bar: "#3b82f6",
  barSoft: "#bfdbfe",
};

const fmt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const num = (n) => (Number(n) || 0).toLocaleString("en-IN");
const dt = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "—");
const pct = (n) => `${(Number(n) || 0).toFixed(1)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (r) => `${MONTHS[r.m - 1]} ${String(r.y).slice(2)}`;

// Local YYYY-MM-DD (not toISOString, which is UTC and can be a day off).
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const QUICK = [
  ["This month", () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(n)]; }],
  ["Last month", () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))]; }],
  ["This FY", () => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return [`${y}-04-01`, ymd(n)]; }],
  ["Last FY", () => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return [`${y - 1}-04-01`, `${y}-03-31`]; }],
];

const BLANK = {
  basis: "invoice",
  from: "",
  to: "",
  branch: "",
  expenseType: "",
  category: "",
  status: "",
  dateField: "invoiceDate",
  search: "",
};

const VIEWS = [
  ["summary", "Vendor summary"],
  ["matrix", "Vendor × branch"],
  ["ageing", "Outstanding ageing"],
  ["trend", "Monthly trend"],
];

// Status and "period based on" apply to invoices only; on the Paid basis
// their controls are hidden, so a stale value must not be sent either.
const toQuery = (f, omit = []) => {
  const hidden = f.basis === "payment" ? ["status", "dateField"] : [];
  return new URLSearchParams(
    Object.fromEntries(
      Object.entries(f).filter(([k, v]) => v && !omit.includes(k) && !hidden.includes(k)),
    ),
  ).toString();
};

const XlsBtn = ({ onClick, label = "Excel" }) => (
  <button style={S.xlsBtn} onClick={onClick}>
    ⬇ {label}
  </button>
);

export default function VendorReport({ branches = [], categories = [] }) {
  const [view, setView] = useState("summary");
  const [draft, setDraft] = useState(BLANK);
  const [filters, setFilters] = useState(BLANK);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailKey, setDetailKey] = useState(null);
  const seq = useRef(0);

  // Layout follows the data on screen, not the filter being loaded — so
  // switching Billed ↔ Paid never draws one basis's rows in the other's table.
  const isInv = (data?.basis ?? filters.basis) === "invoice";

  const load = useCallback(async () => {
    const mine = ++seq.current; // only the latest request may update the screen
    setLoading(true);
    setError("");
    try {
      const { data: res } = await api.get(`/reports/vendors?${toQuery(filters)}`);
      if (mine === seq.current) setData(res);
    } catch (err) {
      if (mine !== seq.current) return;
      setData(null);
      setError(err.response?.data?.message || "The vendor report could not be loaded.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  // The ageing view only means something for billed invoices.
  useEffect(() => {
    if (!isInv && view === "ageing") setView("summary");
  }, [isInv, view]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = () => setFilters(draft);
  const reset = () => {
    setDraft(BLANK);
    setFilters(BLANK);
  };
  const quick = (fn) => {
    const [from, to] = fn();
    const next = { ...draft, from, to };
    setDraft(next);
    setFilters(next);
  };

  const badRange = draft.from && draft.to && draft.from > draft.to;
  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);

  const subtypeOptions = categories.filter(
    (c) => !draft.expenseType || c.type === draft.expenseType,
  );
  const branchName = branches.find((b) => String(b._id) === filters.branch)?.name || null;
  const categoryName = categories.find((c) => String(c._id) === filters.category)?.name || null;
  const meta = (extra = []) =>
    filterMeta({ ...filters, branchName }, [
      ["Basis", isInv ? `Billed (${filters.dateField === "createdAt" ? "entry date" : "invoice date"})` : "Paid (payment date)"],
      ...(categoryName ? [["Subtype", categoryName]] : []),
      ...(filters.search ? [["Vendor search", filters.search]] : []),
      ...extra,
    ]);

  const t = data?.totals || {};
  const conc = data?.concentration || {};
  const vendors = data?.vendors || [];

  return (
    <div style={S.wrap}>
      {/* ── Controls ─────────────────────────────────────── */}
      <div style={S.bar}>
        <Field label="Show">
          <select style={S.input} value={draft.basis} onChange={set("basis")}>
            <option value="invoice">Billed — invoices</option>
            <option value="payment">Paid — payments made</option>
          </select>
        </Field>
        <Field label="Branch">
          <select style={S.input} value={draft.branch} onChange={set("branch")}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" style={S.input} value={draft.from} onChange={set("from")} />
        </Field>
        <Field label="To">
          <input type="date" style={S.input} value={draft.to} onChange={set("to")} />
        </Field>
        {draft.basis === "invoice" && (
          <Field label="Period based on">
            <select style={S.input} value={draft.dateField} onChange={set("dateField")}>
              <option value="invoiceDate">Invoice date</option>
              <option value="createdAt">Entry date</option>
            </select>
          </Field>
        )}
        <Field label="Type">
          <select
            style={S.input}
            value={draft.expenseType}
            onChange={(e) => setDraft((d) => ({ ...d, expenseType: e.target.value, category: "" }))}
          >
            <option value="">Revenue + Capital</option>
            <option value="Revenue">Revenue</option>
            <option value="Capital">Capital</option>
          </select>
        </Field>
        <Field label="Subtype">
          <select style={S.input} value={draft.category} onChange={set("category")}>
            <option value="">All subtypes</option>
            {subtypeOptions.map((c) => (
              <option key={c._id} value={c._id}>
                {c.code ? `${c.code} ` : ""}
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {draft.basis === "invoice" && (
          <Field label="Include">
            <select style={S.input} value={draft.status} onChange={set("status")}>
              <option value="">Submitted & approved (no drafts / rejected)</option>
              <option value="approved">Fully approved only</option>
              <option value="inflight">Still in approval only</option>
              <option value="all">Including rejected</option>
            </select>
          </Field>
        )}
        <Field label="Vendor">
          <input
            style={S.input}
            placeholder="Name, company or PAN"
            value={draft.search}
            onChange={set("search")}
            onKeyDown={(e) => e.key === "Enter" && !badRange && apply()}
          />
        </Field>
        <div style={S.actions}>
          <button
            style={{ ...S.applyBtn, opacity: badRange ? 0.5 : 1, cursor: badRange ? "not-allowed" : "pointer" }}
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
        {badRange && <span style={S.hint}>The end date is before the start date.</span>}
        {dirty && !badRange && <span style={S.hint}>Not applied yet</span>}
      </div>

      {error && <div style={S.error}>{error}</div>}

      {/* ── Totals ───────────────────────────────────────── */}
      {data && (
        <div style={S.statRow}>
          <Stat label="Vendors" value={num(t.vendors)} />
          <Stat label="Used by 2+ branches" value={num(t.multiBranchVendors)} tone={C.muted} />
          {isInv ? (
            <>
              <Stat label="Invoices" value={num(t.invoices)} tone={C.muted} />
              <Stat label="Net payable" value={fmt(t.net)} />
              <Stat label="Paid against these" value={fmt(t.paid)} tone={C.ok} />
              <Stat label="Outstanding (approved, unpaid)" value={fmt(t.outstanding)} tone={C.warn} />
              <Stat label="Still in approval" value={fmt(t.inFlightNet)} tone={C.muted} />
            </>
          ) : (
            <>
              <Stat label="Payments (UTRs)" value={num(t.payments)} tone={C.muted} />
              <Stat label="Amount paid" value={fmt(t.paid)} tone={C.ok} />
              <Stat label="Invoices covered" value={num(t.invoices)} tone={C.muted} />
              <Stat label="Average per vendor" value={fmt(t.vendors ? t.paid / t.vendors : 0)} />
            </>
          )}
        </div>
      )}

      {data && vendors.length > 0 && (
        <div style={S.insight}>
          <strong>Concentration:</strong> the top 5 vendors account for {pct(conc.top5Share)} and
          the top 10 for {pct(conc.top10Share)} of {isInv ? "billed value" : "payments"}.{" "}
          {num(conc.paretoCount)} of {num(vendors.length)} vendors make up 80%.
        </div>
      )}

      <div style={S.viewRow}>
        {VIEWS.filter(([k]) => isInv || k !== "ageing").map(([k, l]) => (
          <button key={k} style={{ ...S.toggle, ...(view === k ? S.toggleActive : {}) }} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
        {branchName && <span style={S.scopeTag}>Showing {branchName} only</span>}
      </div>

      {loading && !data ? (
        <div style={S.loading}>Loading…</div>
      ) : !vendors.length ? (
        <div style={S.empty}>
          <div style={{ fontWeight: 600, color: "#475569" }}>
            {isInv ? "No invoices" : "No payments"} match these filters
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
            Widen the period, or clear the branch, subtype or vendor search.
          </div>
        </div>
      ) : (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity .15s" }}>
          {view === "summary" && <SummaryTable rows={vendors} totals={t} isInv={isInv} meta={meta} onOpen={setDetailKey} />}
          {view === "matrix" && <VendorBranchMatrix data={data} isInv={isInv} meta={meta} onOpen={setDetailKey} />}
          {view === "ageing" && isInv && (
            <AgeingTable rows={vendors} totals={t} meta={meta} onOpen={setDetailKey} periodSet={Boolean(filters.from || filters.to)} />
          )}
          {view === "trend" && <Trend rows={data.monthly || []} isInv={isInv} meta={meta} />}
        </div>
      )}

      {detailKey && (
        <VendorDetail
          vendorKey={detailKey}
          query={toQuery(filters, ["basis", "search"])}
          scopeLabel={branchName}
          meta={meta}
          onClose={() => setDetailKey(null)}
        />
      )}
    </div>
  );
}

// ── Sortable header helper ─────────────────────────────────
function useSort(initial) {
  const [sort, setSort] = useState({ key: initial, dir: -1 });
  const head = (key, label, right = true, style = {}) => (
    <th
      key={key}
      style={{ ...(right ? S.thR : S.th), cursor: "pointer", ...style }}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );
  // Blanks (no PAN, no payment yet, no days-to-pay) always sort last;
  // numbers compare as numbers, dates as dates, text as text.
  const val = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).getTime();
    return v;
  };
  const apply = (rows) =>
    [...rows].sort((a, b) => {
      const av = val(a[sort.key]);
      const bv = val(b[sort.key]);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sort.dir * (av - bv);
      return sort.dir * String(av).localeCompare(String(bv), "en", { numeric: true });
    });
  return { sort, head, apply };
}

const VendorCell = ({ r, onOpen }) => (
  <td style={{ ...S.td, ...S.stickyCell }}>
    <button style={S.linkBtn} onClick={() => onOpen(r.key)} title="Open vendor detail">
      {r.name}
    </button>
    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
      {r.pan || "No PAN"}
      {r.inMaster && <span style={S.masterTag}>Master</span>}
      {r.masterStatus && r.masterStatus !== "active" && (
        <span style={{ ...S.masterTag, background: "#fef2f2", color: C.bad }}>{r.masterStatus}</span>
      )}
    </div>
  </td>
);

// ── Vendor summary ─────────────────────────────────────────
function SummaryTable({ rows, totals, isInv, meta, onOpen }) {
  const { sort, head, apply } = useSort("value");
  const [limit, setLimit] = useState(50);
  const sorted = apply(rows);

  const cols = isInv
    ? [
        { header: "Vendor", key: "name", width: 34 },
        { header: "PAN", key: "pan", width: 13 },
        { header: "Company", key: "company", width: 28 },
        { header: "Category", key: "vendorCategory", width: 18 },
        { header: "In Vendor Master", value: (r) => (r.inMaster ? "Yes" : "No"), width: 10 },
        { header: "Branches", key: "branchCount", width: 9, fmt: "int" },
        { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
        { header: "Invoice value (incl. GST)", key: "gross", width: 16, fmt: "money" },
        { header: "TDS", key: "tds", width: 12, fmt: "money" },
        { header: "Net payable", key: "net", width: 15, fmt: "money" },
        { header: "Paid", key: "paid", width: 15, fmt: "money" },
        { header: "Outstanding", key: "outstanding", width: 15, fmt: "money" },
        { header: "In approval", key: "inFlightNet", width: 14, fmt: "money" },
        { header: "Avg days to pay", key: "avgDaysToPay", width: 10, fmt: "int" },
        { header: "Share %", key: "share", width: 9, fmt: "pct" },
        { header: "Last invoice", key: "lastDate", width: 12, fmt: "date" },
        { header: "Last payment", key: "lastPayment", width: 12, fmt: "date" },
      ]
    : [
        { header: "Vendor", key: "name", width: 34 },
        { header: "PAN", key: "pan", width: 13 },
        { header: "Company", key: "company", width: 28 },
        { header: "Category", key: "vendorCategory", width: 18 },
        { header: "In Vendor Master", value: (r) => (r.inMaster ? "Yes" : "No"), width: 10 },
        { header: "Branches", key: "branchCount", width: 9, fmt: "int" },
        { header: "Payments", key: "payments", width: 9, fmt: "int" },
        { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
        { header: "Amount paid", key: "paid", width: 15, fmt: "money" },
        { header: "Avg payment", key: "avgPayment", width: 14, fmt: "money" },
        { header: "Share %", key: "share", width: 9, fmt: "pct" },
        { header: "First payment", key: "firstDate", width: 12, fmt: "date" },
        { header: "Last payment", key: "lastDate", width: 12, fmt: "date" },
      ];

  const exportIt = () =>
    downloadExcel({
      filename: isInv ? "Vendor_Billing_Summary" : "Vendor_Payment_Summary",
      sheets: [
        {
          name: "Vendor summary",
          title: isInv ? "Vendor-wise billing" : "Vendor-wise payments",
          meta: meta([["Sorted by", `${sort.key} ${sort.dir === -1 ? "desc" : "asc"}`]]),
          columns: cols,
          rows: sorted,
          totals: isInv
            ? { __label: "Total", branchCount: "", invoices: totals.invoices, gross: totals.gross, tds: totals.tds, net: totals.net, paid: totals.paid, outstanding: totals.outstanding, inFlightNet: totals.inFlightNet }
            : { __label: "Total", payments: totals.payments, invoices: totals.invoices, paid: totals.paid },
        },
      ],
    });

  return (
    <div style={S.card}>
      <div style={S.headRow}>
        <div style={S.cardTitle}>
          {isInv ? "Vendor-wise billing" : "Vendor-wise payments"} — click a vendor for branch-wise detail
        </div>
        <XlsBtn onClick={exportIt} />
      </div>
      <div style={S.scroll}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              {head("name", "Vendor", false, S.sticky)}
              {head("branchCount", "Branches")}
              {isInv ? (
                <>
                  {head("invoices", "Invoices")}
                  {head("net", "Net payable")}
                  {head("paid", "Paid")}
                  {head("outstanding", "Outstanding")}
                  {head("inFlightNet", "In approval")}
                  {head("avgDaysToPay", "Avg days to pay")}
                  {head("share", "Share")}
                  {head("lastDate", "Last invoice")}
                </>
              ) : (
                <>
                  {head("payments", "Payments")}
                  {head("invoices", "Invoices")}
                  {head("paid", "Amount paid")}
                  {head("avgPayment", "Avg payment")}
                  {head("share", "Share")}
                  {head("lastDate", "Last payment")}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r) => (
              <tr key={r.key} style={S.tr}>
                <VendorCell r={r} onOpen={onOpen} />
                <td style={S.tdR}>{r.branchCount}</td>
                {isInv ? (
                  <>
                    <td style={S.tdR}>{num(r.invoices)}</td>
                    <td style={{ ...S.tdR, fontWeight: 600 }}>{fmt(r.net)}</td>
                    <td style={{ ...S.tdR, color: C.ok }}>{fmt(r.paid)}</td>
                    <td style={{ ...S.tdR, color: r.outstanding > 0 ? C.warn : C.muted }}>{fmt(r.outstanding)}</td>
                    <td style={{ ...S.tdR, color: C.muted }}>{fmt(r.inFlightNet)}</td>
                    <td style={S.tdR}>{r.avgDaysToPay == null ? "—" : `${r.avgDaysToPay}d`}</td>
                    <td style={S.tdR}><ShareBar value={r.share} /></td>
                    <td style={S.tdR}>{dt(r.lastDate)}</td>
                  </>
                ) : (
                  <>
                    <td style={S.tdR}>{num(r.payments)}</td>
                    <td style={S.tdR}>{num(r.invoices)}</td>
                    <td style={{ ...S.tdR, fontWeight: 600, color: C.ok }}>{fmt(r.paid)}</td>
                    <td style={S.tdR}>{fmt(r.avgPayment)}</td>
                    <td style={S.tdR}><ShareBar value={r.share} /></td>
                    <td style={S.tdR}>{dt(r.lastDate)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={S.totalRow}>
              <td style={{ ...S.td, ...S.stickyCell, background: "#f8fafc", fontWeight: 700 }}>
                Total · {num(rows.length)} vendors
              </td>
              <td style={S.tdR} />
              {isInv ? (
                <>
                  <td style={S.tdRB}>{num(totals.invoices)}</td>
                  <td style={S.tdRB}>{fmt(totals.net)}</td>
                  <td style={S.tdRB}>{fmt(totals.paid)}</td>
                  <td style={S.tdRB}>{fmt(totals.outstanding)}</td>
                  <td style={S.tdRB}>{fmt(totals.inFlightNet)}</td>
                  <td colSpan={3} />
                </>
              ) : (
                <>
                  <td style={S.tdRB}>{num(totals.payments)}</td>
                  <td style={S.tdRB}>{num(totals.invoices)}</td>
                  <td style={S.tdRB}>{fmt(totals.paid)}</td>
                  <td colSpan={3} />
                </>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      {sorted.length > limit && (
        <div style={S.moreRow}>
          Showing {limit} of {num(sorted.length)} vendors ·{" "}
          <button style={S.linkBtn} onClick={() => setLimit((l) => l + 100)}>
            Show 100 more
          </button>{" "}
          ·{" "}
          <button style={S.linkBtn} onClick={() => setLimit(sorted.length)}>
            Show all
          </button>
          <span style={{ marginLeft: 8 }}>(Excel always has every vendor)</span>
        </div>
      )}
    </div>
  );
}

const ShareBar = ({ value }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
    <span style={{ width: 50, height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden", display: "inline-block" }}>
      <span style={{ display: "block", height: "100%", width: `${Math.min(100, value * 2)}%`, background: C.bar }} />
    </span>
    <span style={{ minWidth: 42 }}>{pct(value)}</span>
  </span>
);

// ── Vendor × branch ────────────────────────────────────────
function VendorBranchMatrix({ data, isInv, meta, onOpen }) {
  const [top, setTop] = useState(25);
  const branches = data.matrix?.branches || [];
  const vendors = data.vendors || [];

  const cell = useMemo(() => {
    const m = new Map();
    (data.matrix?.cells || []).forEach((c) => m.set(`${c.key}|${c.branch}`, c));
    return m;
  }, [data]);

  const shown = vendors.slice(0, top);
  const rest = vendors.slice(top);
  const colTotal = (bid, list) =>
    list.reduce((s, v) => s + (cell.get(`${v.key}|${bid}`)?.value || 0), 0);
  const branchTotal = (bid) => colTotal(bid, vendors);

  const exportIt = () => {
    // Plain rows with one key per branch, so the total row lines up too.
    const bk = (b) => `b_${b._id}`;
    const rows = vendors.map((v) => ({
      name: v.name,
      pan: v.pan,
      value: v.value,
      ...Object.fromEntries(branches.map((b) => [bk(b), cell.get(`${v.key}|${b._id}`)?.value || 0])),
    }));
    const cols = [
      { header: "Vendor", key: "name", width: 34 },
      { header: "PAN", key: "pan", width: 13 },
      ...branches.map((b) => ({ header: b.name, key: bk(b), width: 14, fmt: "money" })),
      { header: "Total", key: "value", width: 16, fmt: "money" },
    ];
    downloadExcel({
      filename: isInv ? "Vendor_x_Branch_Billing" : "Vendor_x_Branch_Payments",
      sheets: [
        {
          name: "Vendor x branch",
          title: isInv ? "Net payable by vendor and branch" : "Payments by vendor and branch",
          meta: meta(),
          columns: cols,
          rows,
          totals: {
            __label: "Total",
            ...Object.fromEntries(branches.map((b) => [bk(b), branchTotal(b._id)])),
            value: vendors.reduce((s, v) => s + v.value, 0),
          },
        },
      ],
    });
  };

  return (
    <div style={S.card}>
      <div style={S.headRow}>
        <div style={S.cardTitle}>
          {isInv ? "Net payable" : "Amount paid"} by vendor and branch — top {Math.min(top, vendors.length)} vendors
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select style={{ ...S.input, minWidth: 110 }} value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
          <XlsBtn onClick={exportIt} label="Excel (all vendors)" />
        </div>
      </div>
      <div style={S.scroll}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={{ ...S.th, ...S.sticky }}>Vendor</th>
              {branches.map((b) => (
                <th key={b._id} style={S.thR} title={b.name}>
                  {b.code || b.name}
                </th>
              ))}
              <th style={{ ...S.thR, ...S.totalCol }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.key} style={S.tr}>
                <VendorCell r={v} onOpen={onOpen} />
                {branches.map((b) => {
                  const c = cell.get(`${v.key}|${b._id}`);
                  return (
                    <td key={b._id} style={{ ...S.tdR, color: c ? "#334155" : "#cbd5e1" }}>
                      {c ? fmt(c.value) : "—"}
                    </td>
                  );
                })}
                <td style={{ ...S.tdR, ...S.totalCol, fontWeight: 700 }}>{fmt(v.value)}</td>
              </tr>
            ))}
            {rest.length > 0 && (
              <tr style={S.tr}>
                <td style={{ ...S.td, ...S.stickyCell, color: C.muted }}>Other {num(rest.length)} vendors</td>
                {branches.map((b) => (
                  <td key={b._id} style={{ ...S.tdR, color: C.muted }}>
                    {fmt(colTotal(b._id, rest))}
                  </td>
                ))}
                <td style={{ ...S.tdR, ...S.totalCol, color: C.muted }}>
                  {fmt(rest.reduce((s, v) => s + v.value, 0))}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={S.totalRow}>
              <td style={{ ...S.td, ...S.stickyCell, background: "#f8fafc", fontWeight: 700 }}>Total</td>
              {branches.map((b) => (
                <td key={b._id} style={S.tdRB}>
                  {fmt(branchTotal(b._id))}
                </td>
              ))}
              <td style={{ ...S.tdRB, ...S.totalCol }}>{fmt(vendors.reduce((s, v) => s + v.value, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Outstanding ageing ─────────────────────────────────────
function AgeingTable({ rows, totals, meta, onOpen, periodSet }) {
  const { sort, head, apply } = useSort("outstanding");
  const owed = apply(rows.filter((r) => r.outstanding > 0));

  const exportIt = () =>
    downloadExcel({
      filename: "Vendor_Outstanding_Ageing",
      sheets: [
        {
          name: "Outstanding ageing",
          title: "Approved but unpaid, by age of invoice",
          meta: meta([["Age measured", "Invoice date to today"], ["Sorted by", `${sort.key} ${sort.dir === -1 ? "desc" : "asc"}`]]),
          columns: [
            { header: "Vendor", key: "name", width: 34 },
            { header: "PAN", key: "pan", width: 13 },
            { header: "Branches", key: "branchCount", width: 9, fmt: "int" },
            { header: "0-30 days", key: "age0_30", width: 14, fmt: "money" },
            { header: "31-60 days", key: "age31_60", width: 14, fmt: "money" },
            { header: "61-90 days", key: "age61_90", width: 14, fmt: "money" },
            { header: "Over 90 days", key: "age90p", width: 14, fmt: "money" },
            { header: "Outstanding", key: "outstanding", width: 15, fmt: "money" },
            { header: "Avg days to pay", key: "avgDaysToPay", width: 10, fmt: "int" },
          ],
          rows: owed,
          totals: { __label: "Total", age0_30: totals.age0_30, age31_60: totals.age31_60, age61_90: totals.age61_90, age90p: totals.age90p, outstanding: totals.outstanding },
        },
      ],
    });

  if (!owed.length)
    return (
      <div style={S.empty}>
        <div style={{ fontWeight: 600, color: "#475569" }}>Nothing outstanding</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
          Every fully approved invoice in this period has been paid.
        </div>
      </div>
    );

  return (
    <div style={S.card}>
      <div style={S.headRow}>
        <div style={S.cardTitle}>
          Approved but unpaid — {num(owed.length)} vendors, {fmt(totals.outstanding)}, aged by invoice date
        </div>
        <XlsBtn onClick={exportIt} />
      </div>
      {periodSet && (
        <div style={{ ...S.note, marginTop: 0, marginBottom: 12 }}>
          Only invoices dated in the selected period are included. Clear the From / To dates for
          everything owed as of today.
        </div>
      )}
      <div style={S.scroll}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              {head("name", "Vendor", false, S.sticky)}
              {head("branchCount", "Branches")}
              {head("age0_30", "0–30 days")}
              {head("age31_60", "31–60 days")}
              {head("age61_90", "61–90 days")}
              {head("age90p", "Over 90 days")}
              {head("outstanding", "Outstanding")}
              {head("avgDaysToPay", "Avg days to pay")}
            </tr>
          </thead>
          <tbody>
            {owed.map((r) => (
              <tr key={r.key} style={S.tr}>
                <VendorCell r={r} onOpen={onOpen} />
                <td style={S.tdR}>{r.branchCount}</td>
                <td style={S.tdR}>{r.age0_30 ? fmt(r.age0_30) : "—"}</td>
                <td style={{ ...S.tdR, color: r.age31_60 ? C.warn : "#cbd5e1" }}>{r.age31_60 ? fmt(r.age31_60) : "—"}</td>
                <td style={{ ...S.tdR, color: r.age61_90 ? C.bad : "#cbd5e1" }}>{r.age61_90 ? fmt(r.age61_90) : "—"}</td>
                <td style={{ ...S.tdR, color: r.age90p ? C.bad : "#cbd5e1", fontWeight: r.age90p ? 700 : 400 }}>
                  {r.age90p ? fmt(r.age90p) : "—"}
                </td>
                <td style={{ ...S.tdR, fontWeight: 700 }}>{fmt(r.outstanding)}</td>
                <td style={S.tdR}>{r.avgDaysToPay == null ? "—" : `${r.avgDaysToPay}d`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={S.totalRow}>
              <td style={{ ...S.td, ...S.stickyCell, background: "#f8fafc", fontWeight: 700 }}>Total</td>
              <td />
              <td style={S.tdRB}>{fmt(totals.age0_30)}</td>
              <td style={S.tdRB}>{fmt(totals.age31_60)}</td>
              <td style={S.tdRB}>{fmt(totals.age61_90)}</td>
              <td style={S.tdRB}>{fmt(totals.age90p)}</td>
              <td style={S.tdRB}>{fmt(totals.outstanding)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Monthly trend (CSS bars — no chart library in the project) ──
function Trend({ rows, isInv, meta, title }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const exportIt = () =>
    downloadExcel({
      filename: isInv ? "Vendor_Billing_Trend" : "Vendor_Payment_Trend",
      sheets: [
        {
          name: "Monthly trend",
          title: title || (isInv ? "Net payable by month" : "Payments by month"),
          meta: meta(),
          columns: [
            { header: "Month", value: monthLabel, width: 10 },
            { header: isInv ? "Invoices" : "Payments", key: "count", width: 10, fmt: "int" },
            { header: isInv ? "Net payable" : "Amount paid", key: "value", width: 16, fmt: "money" },
            ...(isInv ? [{ header: "Of which fully approved", key: "approved", width: 18, fmt: "money" }] : []),
          ],
          rows,
        },
      ],
    });
  if (!rows.length) return <div style={S.empty}>No monthly data.</div>;
  return (
    <div style={S.card}>
      <div style={S.headRow}>
        <div style={S.cardTitle}>{title || (isInv ? "Net payable by month" : "Payments by month")}</div>
        <XlsBtn onClick={exportIt} />
      </div>
      <div style={S.trend}>
        {rows.map((r) => (
          <div key={`${r.y}-${r.m}`} style={S.trendCol} title={`${monthLabel(r)}: ${fmt(r.value)}`}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, whiteSpace: "nowrap" }}>
              {r.value >= 100000 ? `${(r.value / 100000).toFixed(1)}L` : fmt(r.value)}
            </div>
            <div style={{ ...S.trendBar, height: `${Math.max(2, (r.value / max) * 160)}px`, background: isInv ? C.barSoft : C.ok }}>
              {isInv && (
                <div style={{ height: `${r.value ? (r.approved / r.value) * 100 : 0}%`, background: C.bar, borderRadius: "4px 4px 0 0", marginTop: "auto" }} />
              )}
            </div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>{monthLabel(r)}</div>
          </div>
        ))}
      </div>
      {isInv && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>
          <span style={{ ...S.legend, background: C.bar }} /> fully approved &nbsp;
          <span style={{ ...S.legend, background: C.barSoft }} /> still in approval
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Vendor detail — one vendor, branch-wise and month-wise
// ════════════════════════════════════════════════════════════
const DETAIL_TABS = [
  ["branches", "Branch-wise"],
  ["months", "Month-wise"],
  ["subtypes", "Subtypes"],
  ["invoices", "Invoices"],
  ["payments", "Payments"],
];

function VendorDetail({ vendorKey, query, scopeLabel, meta, onClose }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("branches");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setD(null);
    setError("");
    api
      .get(`/reports/vendors/detail?key=${encodeURIComponent(vendorKey)}${query ? `&${query}` : ""}`)
      .then(({ data }) => live && setD(data))
      .catch((err) => live && setError(err.response?.data?.message || "Could not load this vendor."));
    return () => {
      live = false;
    };
  }, [vendorKey, query]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const v = d?.vendor || {};
  const t = d?.totals || {};

  const branchCols = [
    { header: "Branch", key: "branchName", width: 26 },
    { header: "GSTIN used", value: (r) => r.gstins.join(", "), width: 20 },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "Net payable", key: "net", width: 15, fmt: "money" },
    { header: "Paid (these invoices)", key: "paid", width: 15, fmt: "money" },
    { header: "Outstanding", key: "outstanding", width: 15, fmt: "money" },
    { header: "In approval", key: "inFlightNet", width: 14, fmt: "money" },
    { header: "Avg days to pay", key: "avgDaysToPay", width: 10, fmt: "int" },
    { header: "Last invoice", key: "lastInvoice", width: 12, fmt: "date" },
    { header: "Payments in period", key: "payments", width: 10, fmt: "int" },
    { header: "Paid in period", key: "paidInPeriod", width: 15, fmt: "money" },
    { header: "Last payment", key: "lastPayment", width: 12, fmt: "date" },
  ];
  const monthCols = [
    { header: "Month", value: monthLabel, width: 10 },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "Net payable (billed)", key: "net", width: 16, fmt: "money" },
    { header: "Of which approved", key: "approved", width: 16, fmt: "money" },
    { header: "Payments", key: "payments", width: 9, fmt: "int" },
    { header: "Paid (payment date)", key: "paid", width: 16, fmt: "money" },
  ];
  const subtypeCols = [
    { header: "Code", key: "code", width: 10 },
    { header: "Subtype", key: "name", width: 32 },
    { header: "Invoices", key: "invoices", width: 9, fmt: "int" },
    { header: "Net payable", key: "net", width: 15, fmt: "money" },
    { header: "Paid", key: "paid", width: 15, fmt: "money" },
  ];
  const invoiceCols = [
    { header: "Request", key: "requestId", width: 14 },
    { header: "Invoice no.", key: "invoiceNumber", width: 16 },
    { header: "Invoice date", key: "invoiceDate", width: 12, fmt: "date" },
    { header: "Branch", key: "branchName", width: 22 },
    { header: "GSTIN", key: "gstin", width: 17 },
    { header: "Subtype", key: "category", width: 24 },
    { header: "Status", key: "status", width: 20 },
    { header: "Invoice value (incl. GST)", key: "gross", width: 15, fmt: "money" },
    { header: "TDS", key: "tds", width: 11, fmt: "money" },
    { header: "Net payable", key: "net", width: 14, fmt: "money" },
    { header: "Paid", key: "paid", width: 14, fmt: "money" },
    { header: "Outstanding", key: "outstanding", width: 14, fmt: "money" },
    { header: "Payment status", key: "paymentStatus", width: 16 },
    { header: "Last payment", key: "lastPayment", width: 12, fmt: "date" },
  ];
  const paymentCols = [
    { header: "Payment", key: "paymentId", width: 16 },
    { header: "Payment date", key: "paymentDate", width: 12, fmt: "date" },
    { header: "UTR", key: "utr", width: 22 },
    { header: "Branch", key: "branchName", width: 22 },
    { header: "Request", key: "requestId", width: 14 },
    { header: "Invoice no.", key: "invoiceNumber", width: 16 },
    { header: "Amount", key: "amount", width: 15, fmt: "money" },
  ];

  const exportAll = () =>
    downloadExcel({
      filename: `Vendor_${(v.name || "detail").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40)}`,
      sheets: [
        { name: "Branch-wise", title: `${v.name}${v.pan ? ` (${v.pan})` : ""} — branch-wise`, meta: meta([["Vendor", v.name], ["PAN", v.pan || "—"]]), columns: branchCols, rows: d.byBranch },
        { name: "Month-wise", title: `${v.name} — month-wise`, meta: meta([["Vendor", v.name]]), columns: monthCols, rows: d.monthly },
        { name: "Subtypes", title: `${v.name} — by subtype`, meta: meta([["Vendor", v.name]]), columns: subtypeCols, rows: d.byCategory },
        { name: "Invoices", title: `${v.name} — invoices`, meta: meta([["Vendor", v.name], ["Rows", `${d.invoices.length} of ${d.invoiceCount}`]]), columns: invoiceCols, rows: d.invoices },
        { name: "Payments", title: `${v.name} — payments made`, meta: meta([["Vendor", v.name], ["Rows", `${d.payments.length} of ${d.paymentCount}`]]), columns: paymentCols, rows: d.payments },
      ],
    });

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.primary }}>
              {v.name || "Loading…"}
              {v.masterId && <span style={S.masterTag}>Vendor Master</span>}
              {v.masterStatus && v.masterStatus !== "active" && (
                <span style={{ ...S.masterTag, background: "#fef2f2", color: C.bad }}>{v.masterStatus}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              {[v.pan ? `PAN ${v.pan}` : "No PAN", v.company, v.vendorCategory, v.msme ? `MSME ${v.msme}` : null]
                .filter(Boolean)
                .join(" · ")}
              {scopeLabel ? ` · ${scopeLabel} only` : ""}
            </div>
            {v.gstins?.length > 0 && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                GSTINs: {v.gstins.map((g) => g.gstin).join(", ")}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {d && <XlsBtn onClick={exportAll} label="Excel (all sheets)" />}
            <button style={S.closeBtn} onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div style={S.modalBody}>
          {error && <div style={S.error}>{error}</div>}
          {!d && !error && <div style={S.loading}>Loading…</div>}
          {d && (
            <>
              <div style={S.statRow}>
                <Stat label="Branches" value={num(t.branches)} tone={C.muted} />
                <Stat label="Invoices" value={num(t.invoices)} tone={C.muted} />
                <Stat label="Net payable" value={fmt(t.net)} />
                <Stat label="Paid against these" value={fmt(t.paid)} tone={C.ok} />
                <Stat label="Outstanding" value={fmt(t.outstanding)} tone={C.warn} />
                <Stat label="Paid in period (UTR)" value={fmt(t.paidInPeriod)} tone={C.ok} />
                <Stat label="Avg days to pay" value={t.avgDaysToPay == null ? "—" : `${t.avgDaysToPay} days`} tone={C.muted} />
              </div>
              {t.outstanding > 0 && (
                <div style={S.note}>
                  Outstanding by invoice age: 0–30 days {fmt(t.age0_30)} · 31–60 {fmt(t.age31_60)} · 61–90{" "}
                  {fmt(t.age61_90)} · over 90 {fmt(t.age90p)}
                </div>
              )}

              <div style={{ ...S.viewRow, marginTop: 14 }}>
                {DETAIL_TABS.map(([k, l]) => (
                  <button key={k} style={{ ...S.toggle, ...(tab === k ? S.toggleActive : {}) }} onClick={() => setTab(k)}>
                    {l}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 12 }}>
                {tab === "branches" && (
                  <SimpleTable
                    rows={d.byBranch}
                    empty="No activity in this period."
                    cols={[
                      ["Branch", (r) => <><div style={{ fontWeight: 600 }}>{r.branchName}</div><div style={{ fontSize: 11, color: C.muted }}>{r.gstins.join(", ") || "No GSTIN"}</div></>],
                      ["Invoices", (r) => num(r.invoices), true],
                      ["Net payable", (r) => fmt(r.net), true],
                      ["Paid", (r) => fmt(r.paid), true],
                      ["Outstanding", (r) => <span style={{ color: r.outstanding > 0 ? C.warn : C.muted }}>{fmt(r.outstanding)}</span>, true],
                      ["In approval", (r) => fmt(r.inFlightNet), true],
                      ["Avg days to pay", (r) => (r.avgDaysToPay == null ? "—" : `${r.avgDaysToPay}d`), true],
                      ["Paid in period", (r) => <span style={{ color: C.ok, fontWeight: 600 }}>{fmt(r.paidInPeriod)}</span>, true],
                      ["Last payment", (r) => dt(r.lastPayment), true],
                    ]}
                    foot={[
                      "Total",
                      num(t.invoices),
                      fmt(t.net),
                      fmt(t.paid),
                      fmt(t.outstanding),
                      fmt(t.inFlightNet),
                      "",
                      fmt(t.paidInPeriod),
                      "",
                    ]}
                  />
                )}
                {tab === "months" && (
                  <SimpleTable
                    rows={d.monthly}
                    empty="No activity in this period."
                    cols={[
                      ["Month", (r) => monthLabel(r)],
                      ["Invoices", (r) => num(r.invoices), true],
                      ["Billed (net payable)", (r) => fmt(r.net), true],
                      ["Of which approved", (r) => fmt(r.approved), true],
                      ["Payments", (r) => num(r.payments), true],
                      ["Paid (by payment date)", (r) => <span style={{ color: C.ok }}>{fmt(r.paid)}</span>, true],
                    ]}
                  />
                )}
                {tab === "subtypes" && (
                  <SimpleTable
                    rows={d.byCategory}
                    empty="No invoices in this period."
                    cols={[
                      ["Subtype", (r) => `${r.code ? `${r.code} ` : ""}${r.name}`],
                      ["Invoices", (r) => num(r.invoices), true],
                      ["Net payable", (r) => fmt(r.net), true],
                      ["Paid", (r) => fmt(r.paid), true],
                      ["Share", (r) => pct(t.net ? (r.net / t.net) * 100 : 0), true],
                    ]}
                  />
                )}
                {tab === "invoices" && (
                  <>
                    {d.invoiceCount > d.invoices.length && (
                      <div style={S.note}>Showing the latest {num(d.invoices.length)} of {num(d.invoiceCount)} invoices.</div>
                    )}
                    <SimpleTable
                      rows={d.invoices}
                      empty="No invoices in this period."
                      cols={[
                        ["Request", (r) => <span style={S.mono}>{r.requestId}</span>],
                        ["Invoice no.", (r) => <span style={S.mono}>{r.invoiceNumber}</span>],
                        ["Date", (r) => dt(r.invoiceDate)],
                        ["Branch", (r) => r.branchName],
                        ["Subtype", (r) => r.category || "—"],
                        ["Status", (r) => r.status],
                        ["Net payable", (r) => fmt(r.net), true],
                        ["Paid", (r) => fmt(r.paid), true],
                        ["Payment", (r) => r.paymentStatus || "—", true],
                      ]}
                    />
                  </>
                )}
                {tab === "payments" && (
                  <>
                    {d.paymentCount > d.payments.length && (
                      <div style={S.note}>Showing the latest {num(d.payments.length)} of {num(d.paymentCount)} payments.</div>
                    )}
                    <SimpleTable
                      rows={d.payments}
                      empty="No payments recorded in this period."
                      cols={[
                        ["Payment date", (r) => dt(r.paymentDate)],
                        ["Payment", (r) => <span style={S.mono}>{r.paymentId}</span>],
                        ["UTR", (r) => <span style={S.mono}>{r.utr || "—"}</span>],
                        ["Branch", (r) => r.branchName],
                        ["Request", (r) => <span style={S.mono}>{r.requestId || "—"}</span>],
                        ["Invoice no.", (r) => r.invoiceNumber || "—"],
                        ["Amount", (r) => <span style={{ fontWeight: 600, color: C.ok }}>{fmt(r.amount)}</span>, true],
                      ]}
                      foot={["Total", "", "", "", "", "", fmt(d.payments.reduce((s, p) => s + p.amount, 0))]}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// cols: [header, render(row), alignRight?]
function SimpleTable({ rows, cols, foot, empty }) {
  if (!rows?.length) return <div style={S.emptySmall}>{empty}</div>;
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
        {foot && (
          <tfoot>
            <tr style={S.totalRow}>
              {foot.map((f, i) => (
                <td key={i} style={i === 0 ? { ...S.td, fontWeight: 700 } : S.tdRB}>
                  {f}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const Field = ({ label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{label}</span>
    {children}
  </label>
);

const Stat = ({ label, value, tone = C.primary }) => (
  <div style={S.stat}>
    <div style={{ fontSize: 19, fontWeight: 700, color: tone, marginBottom: 3 }}>{value}</div>
    <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
  </div>
);

// ── Styles ──────────────────────────────────────────────────
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
    minWidth: 150,
    background: "#fff",
  },
  actions: { display: "flex", gap: 8, marginLeft: "auto", alignItems: "flex-end" },
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
  quickRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: -6 },
  chip: {
    padding: "4px 10px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 999,
    fontSize: 12,
    color: "#475569",
    cursor: "pointer",
  },
  hint: { fontSize: 12, color: C.warn, marginLeft: 8 },
  statRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 },
  stat: { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "15px 17px" },
  insight: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
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
  toggleActive: { background: "#eff6ff", color: "#2563eb", borderColor: "#bfdbfe" },
  scopeTag: { fontSize: 12, color: C.muted, marginLeft: 6 },
  card: { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "18px 20px" },
  cardTitle: { fontSize: 14, fontWeight: 700, color: C.primary },
  headRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  scroll: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  thead: { borderBottom: `2px solid ${C.line}` },
  th: { padding: "9px 10px", textAlign: "left", fontSize: 12, color: C.muted, fontWeight: 700, whiteSpace: "nowrap" },
  thR: { padding: "9px 10px", textAlign: "right", fontSize: 12, color: C.muted, fontWeight: 700, whiteSpace: "nowrap" },
  sticky: { position: "sticky", left: 0, background: "#fff", zIndex: 2, minWidth: 230, textAlign: "left" },
  stickyCell: { position: "sticky", left: 0, background: "#fff", zIndex: 1, minWidth: 230 },
  totalCol: { borderLeft: `2px solid ${C.line}`, background: "#fbfdff" },
  totalRow: { borderTop: `2px solid ${C.line}`, background: "#f8fafc" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "10px", color: "#334155" },
  tdR: { padding: "10px", color: "#334155", textAlign: "right", whiteSpace: "nowrap" },
  tdRB: { padding: "10px", color: "#0f172a", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 },
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
  masterTag: {
    marginLeft: 6,
    fontSize: 10,
    fontWeight: 700,
    background: "#eef2ff",
    color: "#4338ca",
    borderRadius: 4,
    padding: "1px 6px",
    verticalAlign: "middle",
  },
  mono: { fontFamily: "monospace", fontSize: 12 },
  moreRow: { fontSize: 12, color: C.muted, marginTop: 12, textAlign: "center" },
  trend: {
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
    overflowX: "auto",
    padding: "10px 4px 0",
    minHeight: 210,
  },
  trendCol: { display: "flex", flexDirection: "column", alignItems: "center", minWidth: 46 },
  trendBar: { width: 30, borderRadius: "4px 4px 0 0", display: "flex", flexDirection: "column" },
  legend: { display: "inline-block", width: 10, height: 10, borderRadius: 2, verticalAlign: "middle", marginRight: 4 },
  note: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    marginTop: 12,
  },
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
  emptySmall: { padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 },
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
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 100,
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    width: "min(1240px, 100%)",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  modalHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    padding: "18px 22px",
    borderBottom: `1px solid ${C.line}`,
  },
  modalBody: { padding: "16px 22px 22px", overflowY: "auto" },
  closeBtn: {
    background: "none",
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
    color: C.muted,
  },
};
