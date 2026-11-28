// ============================================================
// FRONTEND: src/pages/DoctorTdsReport.jsx — NEW FILE (Nov 2026)
// ------------------------------------------------------------
// "TDS — Doctors" tab of the Reports page (PrimaryReports.jsx), next to
// the invoice TDS tab. TDS on Doctor Referral and Surgeon payments, as
// its own list: own filters, own preview (GET /api/reports/doctor-tds)
// and own downloads.
//
// Views
//   Doctor-wise   one row per PAN
//   Branch-wise   TDS per branch
//   Month-wise    per month, with the indicative deposit due date
//   Register      every record behind the figures
//
// The TDS shown is the TDS column of the payout Excel as uploaded — PMS
// does not calculate it. Records count once approved by the Cluster /
// Department Head.
//
// Filters follow the Reports convention: a draft is edited freely and
// only "Apply" sends it to the server.
// ============================================================
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import api from "../api/axios";
import { downloadExcel, filterMeta } from "../utils/exportExcel";
import BranchMultiSelect, {
  branchNamesOf,
} from "../components/BranchMultiSelect.jsx";

const C = {
  primary: "#1a3c6e",
  warn: "#d97706",
  muted: "#64748b",
  line: "#e2e8f0",
};

const fmt = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => (Number(n) || 0).toLocaleString("en-IN");
// Sheet / payment dates are stored at UTC midnight of the day, so they are
// shown in UTC; approval time is a real timestamp and shown locally.
const day = (v, utc = true) =>
  v
    ? new Date(v).toLocaleDateString("en-GB", utc ? { timeZone: "UTC" } : {})
    : "—";
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
const TYPE = { referral: "Doctor Referral", surgeon: "Surgeon Payment" };
const STATUS = {
  approved: "Approved",
  raised: "Payment raised",
  file_generated: "Bank file generated",
  paid: "Paid",
};
const BASIS = {
  sheetDate: "Sheet date",
  approvalDate: "Approval date",
  paymentDate: "Payment date",
};

const BLANK = () => ({
  from: "",
  to: "",
  dateBasis: "sheetDate",
  branch: "",
  type: "",
  stage: "",
  tds: "",
  search: "",
});

const VIEWS = [
  ["doctor", "Doctor-wise"],
  ["branch", "Branch-wise"],
  ["month", "Month-wise"],
  ["register", "Register"],
];

const toQuery = (f) =>
  new URLSearchParams(
    Object.fromEntries(
      Object.entries(f).filter(([, v]) => v !== "" && v != null),
    ),
  ).toString();

// ── Excel column sets (screen tables and the workbook share them) ──
const COLS = {
  doctor: [
    { header: "Doctor", key: "name", width: 30 },
    { header: "Doctor code", key: "doctorCode", width: 12 },
    { header: "PAN", key: "pan", width: 13 },
    { header: "Records", key: "records", fmt: "int", width: 9 },
    { header: "Referral (gross)", key: "referral", fmt: "money", width: 16 },
    { header: "Surgeon (gross)", key: "surgeon", fmt: "money", width: 16 },
    { header: "Gross", key: "gross", fmt: "money", width: 15 },
    { header: "TDS", key: "tds", fmt: "money", width: 13 },
    { header: "Net", key: "net", fmt: "money", width: 15 },
    {
      header: "TDS %",
      value: (r) => r.rates.map((x) => `${x}%`).join(", "),
      width: 12,
    },
    { header: "Branches", value: (r) => r.branches.join(", "), width: 30 },
  ],
  branch: [
    { header: "Branch", key: "name", width: 26 },
    { header: "Doctors", key: "doctors", fmt: "int", width: 9 },
    { header: "Records", key: "records", fmt: "int", width: 9 },
    { header: "Gross", key: "gross", fmt: "money", width: 15 },
    { header: "TDS", key: "tds", fmt: "money", width: 13 },
    { header: "Net", key: "net", fmt: "money", width: 15 },
  ],
  month: [
    { header: "Month", value: (r) => monthLabel(r.ym), width: 12 },
    { header: "Records", key: "records", fmt: "int", width: 9 },
    { header: "Gross", key: "gross", fmt: "money", width: 15 },
    { header: "TDS", key: "tds", fmt: "money", width: 13 },
    { header: "Net", key: "net", fmt: "money", width: 15 },
    {
      header: "Deposit due (indicative)",
      key: "depositDue",
      fmt: "date",
      width: 20,
    },
  ],
  register: [
    { header: "Date", value: (r) => day(r.date), width: 12 },
    { header: "Branch", key: "branchName", width: 22 },
    { header: "Doctor", key: "doctorName", width: 28 },
    { header: "PAN", key: "panNumber", width: 13 },
    { header: "For", value: (r) => TYPE[r.type], width: 16 },
    { header: "Patient / surgeries", key: "reference", width: 24 },
    { header: "Gross", key: "gross", fmt: "money", width: 14 },
    {
      header: "TDS %",
      value: (r) => (r.ratePct == null ? "" : `${r.ratePct}%`),
      width: 8,
    },
    { header: "TDS", key: "tds", fmt: "money", width: 12 },
    { header: "Net", key: "net", fmt: "money", width: 14 },
    { header: "Status", value: (r) => STATUS[r.status] || r.status, width: 18 },
    { header: "Sheet date", value: (r) => day(r.sheetDate), width: 12 },
    {
      header: "Approved on",
      value: (r) => day(r.approvedAt, false),
      width: 12,
    },
    {
      header: "Paid on",
      value: (r) => (r.paymentDate ? day(r.paymentDate) : ""),
      width: 12,
    },
    { header: "Payment", key: "paymentRef", width: 13 },
    { header: "UTR", key: "utrNumber", width: 22 },
    { header: "PMS ID", key: "payoutId", width: 13 },
  ],
};

export default function DoctorTdsReport({ branches = [], filterSlot }) {
  // Inside the Reports page the filters render into the slot above the tab
  // bar. filterSlot: undefined = standalone (inline); null = slot not
  // mounted yet; element = render there.
  const renderFilters = (node) =>
    filterSlot === undefined
      ? node
      : filterSlot
        ? createPortal(node, filterSlot)
        : null;

  const [view, setView] = useState("doctor");
  const [draft, setDraft] = useState(BLANK);
  const [filters, setFilters] = useState(BLANK);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workingBusy, setWorkingBusy] = useState(false);
  const [limit, setLimit] = useState(200);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: res } = await api.get(
        `/reports/doctor-tds?${toQuery(filters)}`,
      );
      setData(res);
    } catch (err) {
      setData(null);
      setError(
        err.response?.data?.message || "Could not load the doctor TDS report",
      );
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const badRange = draft.from && draft.to && draft.from > draft.to;
  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);
  const apply = () => {
    if (badRange) return;
    setFilters({ ...draft });
    setLimit(200);
  };
  const reset = () => {
    const b = BLANK();
    setDraft(b);
    setFilters(b);
  };
  // click-through from a table: narrow everything to one doctor / branch
  const narrow = (patch) => {
    const next = { ...filters, ...patch };
    setDraft(next);
    setFilters(next);
    setView("register");
  };

  const branchOpts = branches.map((b) => ({ value: b._id, label: b.name }));
  const branchName = branchNamesOf(branchOpts, filters.branch);
  const meta = (extra = []) =>
    filterMeta({ ...filters, branchName }, [
      ["Period based on", BASIS[filters.dateBasis]],
      ["Records", filters.stage === "paid" ? "Paid only" : "Approved onwards"],
      ...(filters.type ? [["For", TYPE[filters.type]]] : []),
      ...(filters.tds
        ? [["TDS", filters.tds === "with" ? "Deducted only" : "Nil only"]]
        : []),
      ...(filters.search ? [["Doctor search", filters.search]] : []),
      ...extra,
    ]);

  const t = data?.totals;
  const totalsRow = (row) => ({
    __label: "Total",
    records: row.records,
    gross: row.gross,
    tds: row.tds,
    net: row.net,
  });

  const exportAll = () => {
    if (!data) return;
    const m = meta();
    downloadExcel({
      filename: "Doctor_TDS_Report",
      sheets: [
        {
          name: "Doctor-wise",
          title: "TDS on doctor payments — doctor-wise",
          meta: m,
          columns: COLS.doctor,
          rows: data.byDoctor,
          totals: totalsRow(t),
        },
        {
          name: "Branch-wise",
          title: "TDS on doctor payments — branch-wise",
          meta: m,
          columns: COLS.branch,
          rows: data.byBranch,
          totals: totalsRow(t),
        },
        {
          name: "Month-wise",
          title: "TDS on doctor payments — month-wise",
          meta: m,
          columns: COLS.month,
          rows: data.byMonth,
          totals: totalsRow(t),
        },
        {
          name: "Register",
          title: "TDS on doctor payments — register",
          meta: data.registerTruncated
            ? meta([
                [
                  "Note",
                  `First ${num(data.register.length)} of ${num(t.records)} records — narrow the period for the rest`,
                ],
              ])
            : m,
          columns: COLS.register,
          rows: data.register,
        },
      ],
    });
  };

  // "TDS WORKING" sheet in the Accounts team's own format — built on the
  // server (formulas, Nature dropdown) with the filters applied on screen.
  const downloadWorking = async () => {
    setWorkingBusy(true);
    try {
      const res = await api.get(
        `/reports/doctor-tds/working-excel?${toQuery(filters)}`,
        { responseType: "blob" },
      );
      const cd = res.headers?.["content-disposition"] || "";
      const name =
        /filename="?([^";]+)"?/i.exec(cd)?.[1] ||
        `TDS_Working_Doctors_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
      // Errors arrive as a Blob because of responseType.
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

  return (
    <div style={S.wrap}>
      {renderFilters(
        <>
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
                <option value="sheetDate">Date in the payout sheet</option>
                <option value="approvalDate">Approval date</option>
                <option value="paymentDate">Payment date</option>
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
            <Field label="For">
              <select style={S.input} value={draft.type} onChange={set("type")}>
                <option value="">Referral + Surgeon</option>
                <option value="referral">Doctor Referral</option>
                <option value="surgeon">Surgeon Payment</option>
              </select>
            </Field>
            <Field label="Records">
              <select
                style={S.input}
                value={draft.stage}
                onChange={set("stage")}
              >
                <option value="">Approved onwards</option>
                <option value="paid">Paid only</option>
              </select>
            </Field>
            <Field label="TDS">
              <select style={S.input} value={draft.tds} onChange={set("tds")}>
                <option value="">Deducted + nil</option>
                <option value="with">Deducted only</option>
                <option value="nil">Nil TDS only</option>
              </select>
            </Field>
            <Field label="Doctor">
              <input
                style={S.input}
                placeholder="Name or PAN"
                value={draft.search}
                onChange={set("search")}
                onKeyDown={(e) => e.key === "Enter" && apply()}
              />
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
          {(badRange || dirty) && (
            <div style={S.hint}>
              {badRange
                ? "The end date is before the start date."
                : "Not applied yet"}
            </div>
          )}
        </>,
      )}

      {error && <div style={S.alert}>{error}</div>}

      {t && (
        <div style={S.statRow}>
          <Stat label="Records" value={num(t.records)} />
          <Stat label="Doctors" value={num(t.doctors)} />
          <Stat label="Gross (basic)" value={fmt(t.gross)} />
          <Stat label="TDS" value={fmt(t.tds)} />
          <Stat label="Net payable" value={fmt(t.net)} />
          <Stat
            label="Nil-TDS records"
            value={num(t.nilRecords)}
            tone={t.nilRecords ? C.warn : undefined}
          />
        </div>
      )}

      {data?.mixedRates?.length > 0 && (
        <div style={S.insight}>
          {data.mixedRates.length} doctor
          {data.mixedRates.length === 1 ? " has" : "s have"} records at more
          than one TDS %:{" "}
          {data.mixedRates
            .slice(0, 6)
            .map((d) => `${d.name} (${d.rates.map((r) => `${r}%`).join(", ")})`)
            .join("; ")}
          {data.mixedRates.length > 6 ? " …" : ""}
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
          </button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button style={S.xlsBtn} onClick={exportAll} disabled={!t?.records}>
            ⬇ Excel (all views)
          </button>
          <button
            style={{ ...S.workingBtn, opacity: workingBusy ? 0.6 : 1 }}
            onClick={downloadWorking}
            disabled={workingBusy}
            title="TDS WORKING sheet in the Accounts format, for the filters applied"
          >
            {workingBusy ? "Preparing…" : "⬇ TDS Working"}
          </button>
        </span>
      </div>

      {loading && !data ? (
        <div style={S.empty}>Loading…</div>
      ) : !t?.records ? (
        <div style={S.empty}>
          No approved doctor payments match these filters
        </div>
      ) : (
        <div style={{ ...S.card, opacity: loading ? 0.5 : 1 }}>
          {view === "doctor" && (
            <Table
              head={[
                "Doctor",
                "PAN",
                "Records",
                "Referral",
                "Surgeon",
                "Gross",
                "TDS",
                "Net",
                "TDS %",
                "Branches",
              ]}
              right={[2, 3, 4, 5, 6, 7]}
              rows={data.byDoctor.map((d) => ({
                key: d.key,
                onClick: () => narrow({ search: d.pan }),
                cells: [
                  <>
                    <strong style={{ color: "#2563eb" }}>{d.name}</strong>
                    <div style={S.small}>{d.doctorCode}</div>
                  </>,
                  <span style={S.mono}>{d.pan}</span>,
                  num(d.records),
                  d.referral ? fmt(d.referral) : "—",
                  d.surgeon ? fmt(d.surgeon) : "—",
                  fmt(d.gross),
                  <strong>{fmt(d.tds)}</strong>,
                  fmt(d.net),
                  <span
                    style={
                      d.rates.length > 1
                        ? { color: C.warn, fontWeight: 700 }
                        : {}
                    }
                  >
                    {d.rates.map((r) => `${r}%`).join(", ") || "—"}
                  </span>,
                  d.branches.join(", "),
                ],
              }))}
              foot={[
                "Total",
                "",
                num(t.records),
                "",
                "",
                fmt(t.gross),
                fmt(t.tds),
                fmt(t.net),
                "",
                "",
              ]}
            />
          )}
          {view === "branch" && (
            <Table
              head={["Branch", "Doctors", "Records", "Gross", "TDS", "Net"]}
              right={[1, 2, 3, 4, 5]}
              rows={data.byBranch.map((b) => ({
                key: b.branchId,
                onClick: () => narrow({ branch: b.branchId }),
                cells: [
                  <strong style={{ color: "#2563eb" }}>{b.name}</strong>,
                  num(b.doctors),
                  num(b.records),
                  fmt(b.gross),
                  <strong>{fmt(b.tds)}</strong>,
                  fmt(b.net),
                ],
              }))}
              foot={[
                "Total",
                num(t.doctors),
                num(t.records),
                fmt(t.gross),
                fmt(t.tds),
                fmt(t.net),
              ]}
            />
          )}
          {view === "month" && (
            <>
              <Table
                head={[
                  "Month",
                  "Records",
                  "Gross",
                  "TDS",
                  "Net",
                  "Deposit due",
                ]}
                right={[1, 2, 3, 4]}
                rows={data.byMonth.map((m) => ({
                  key: m.ym,
                  cells: [
                    <strong>{monthLabel(m.ym)}</strong>,
                    num(m.records),
                    fmt(m.gross),
                    <strong>{fmt(m.tds)}</strong>,
                    fmt(m.net),
                    day(m.depositDue),
                  ],
                }))}
                foot={[
                  "Total",
                  num(t.records),
                  fmt(t.gross),
                  fmt(t.tds),
                  fmt(t.net),
                  "",
                ]}
              />
              <div style={S.note}>
                Months follow “{BASIS[filters.dateBasis]}”. The deposit due date
                is indicative (7th of the next month; 30 April for March) — the
                statutory date follows the date of deduction in the books.
              </div>
            </>
          )}
          {view === "register" && (
            <>
              <Table
                head={[
                  "Date",
                  "Branch",
                  "Doctor",
                  "For",
                  "Gross",
                  "%",
                  "TDS",
                  "Net",
                  "Status",
                  "PMS ID",
                ]}
                right={[4, 5, 6, 7]}
                rows={data.register.slice(0, limit).map((r) => ({
                  key: r._id,
                  cells: [
                    day(r.date),
                    r.branchName,
                    <>
                      <strong>{r.doctorName}</strong>
                      <div style={{ ...S.small, ...S.mono }}>{r.panNumber}</div>
                    </>,
                    <>
                      {TYPE[r.type]}
                      <div style={S.small}>{r.reference}</div>
                    </>,
                    fmt(r.gross),
                    r.ratePct == null ? "—" : `${r.ratePct}%`,
                    <strong style={r.tds <= 0 ? { color: C.warn } : {}}>
                      {fmt(r.tds)}
                    </strong>,
                    fmt(r.net),
                    <>
                      {STATUS[r.status] || r.status}
                      {r.utrNumber && (
                        <div style={{ ...S.small, ...S.mono }}>
                          UTR {r.utrNumber}
                        </div>
                      )}
                    </>,
                    <span style={S.mono}>{r.payoutId}</span>,
                  ],
                }))}
                foot={[
                  "Total",
                  "",
                  "",
                  "",
                  fmt(t.gross),
                  "",
                  fmt(t.tds),
                  fmt(t.net),
                  "",
                  "",
                ]}
              />
              {data.register.length > limit && (
                <div style={{ textAlign: "center", padding: 10 }}>
                  <button
                    style={S.resetBtn}
                    onClick={() => setLimit((n) => n + 500)}
                  >
                    Show more ({num(data.register.length - limit)} remaining)
                  </button>
                </div>
              )}
              {data.registerTruncated && (
                <div style={S.note}>
                  Showing the first {num(data.register.length)} of{" "}
                  {num(t.records)} records — narrow the period for the rest.
                  Totals cover all of them.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const Field = ({ label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
      {label}
    </span>
    {children}
  </label>
);

const Stat = ({ label, value, tone = C.primary }) => (
  <div style={S.stat}>
    <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase" }}>
      {label}
    </div>
    <div style={{ fontSize: 20, fontWeight: 700, color: tone, marginTop: 4 }}>
      {value}
    </div>
  </div>
);

// head: titles; right: indexes of right-aligned columns;
// rows: [{ key, cells, onClick? }]; foot: totals row
const Table = ({ head, right = [], rows, foot }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={S.table}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} style={{ ...S.th, ...(right.includes(i) ? S.r : {}) }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.key}
            onClick={row.onClick}
            style={row.onClick ? { cursor: "pointer" } : undefined}
          >
            {row.cells.map((c, i) => (
              <td
                key={i}
                style={{ ...S.td, ...(right.includes(i) ? S.r : {}) }}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr>
            {foot.map((c, i) => (
              <td
                key={i}
                style={{
                  ...S.td,
                  ...(right.includes(i) ? S.r : {}),
                  fontWeight: 700,
                  background: "#f8fafc",
                }}
              >
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  </div>
);

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
  hint: { fontSize: 12, color: C.warn, marginTop: 6 },
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
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
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
    background: C.primary,
    color: "#fff",
    border: `1px solid ${C.primary}`,
  },
  xlsBtn: {
    padding: "7px 12px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    color: "#166534",
    cursor: "pointer",
  },
  workingBtn: {
    padding: "7px 12px",
    border: "none",
    background: "#166534",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    color: "#fff",
    cursor: "pointer",
  },
  card: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    overflow: "hidden",
    transition: "opacity .15s",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    background: "#f8fafc",
    color: "#475569",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    borderBottom: `1px solid ${C.line}`,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "9px 12px",
    borderBottom: "1px solid #f1f5f9",
    color: "#0f172a",
    verticalAlign: "top",
  },
  r: {
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  small: { fontSize: 11.5, color: C.muted, marginTop: 2 },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
  },
  note: { fontSize: 12, color: C.muted, padding: "10px 14px" },
  empty: {
    background: "#fff",
    border: `1px dashed #cbd5e1`,
    borderRadius: 12,
    padding: "40px 20px",
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 14,
  },
};
