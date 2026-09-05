// ============================================================
// FRONTEND: src/pages/SubtypeReport.jsx — NEW FILE
// ------------------------------------------------------------
// Subtype-wise expense report for the accounts and audit team.
// Self-contained: it carries its own styles so it can be dropped in
// without touching PrimaryReports.jsx beyond adding a tab.
// ============================================================
import { useState, useEffect, useCallback } from "react";
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
};

const fmt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const num = (n) => (Number(n) || 0).toLocaleString("en-IN");
const dt = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "—");

const VIEWS = [
  ["summary", "Subtype summary"],
  ["matrix", "Subtype × branch"],
];

const XlsBtn = ({ onClick, label = "Excel" }) => (
  <button style={S.xlsBtn} onClick={onClick}>
    ⬇ {label}
  </button>
);

export default function SubtypeReport({ branches: scopeBranches = [] }) {
  const [view, setView] = useState("summary");
  const BLANK = {
    from: "",
    to: "",
    branch: "",
    expenseType: "Revenue",
    dateField: "invoiceDate",
    status: "",
  };
  const [draft, setDraft] = useState(BLANK);
  const [filters, setFilters] = useState(BLANK);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [drill, setDrill] = useState(null);

  const qs = useCallback(
    () =>
      new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      ).toString(),
    [filters],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: res } = await api.get(`/reports/expense-subtypes?${qs()}`);
      setData(res);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "That report could not be loaded. Try a narrower date range.",
      );
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    load();
  }, [load]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await api.get(
        `/reports/expense-subtypes/export-excel?${qs()}`,
        { responseType: "blob" },
      );
      const url = window.URL.createObjectURL(
        new Blob([res.data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filters.expenseType}_Subtype_Report_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("The workbook could not be generated.");
    } finally {
      setExporting(false);
    }
  };

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = () => setFilters(draft);
  const reset = () => {
    setDraft(BLANK);
    setFilters(BLANK);
  };

  const badRange = draft.from && draft.to && draft.from > draft.to;
  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);

  const branchOptions = data?.branches?.length ? data.branches : scopeBranches;
  const rows = data?.subtypes || [];
  const t = data?.totals || {};
  const activeBranch = branchOptions.find(
    (b) => String(b.branchId) === filters.branch,
  );

  return (
    <div style={S.wrap}>
      {/* Controls */}
      <div style={S.bar}>
        <Field label="Type">
          <select
            style={S.input}
            value={draft.expenseType}
            onChange={set("expenseType")}
          >
            <option value="Revenue">Revenue</option>
            <option value="Capital">Capital</option>
          </select>
        </Field>
        <Field label="Branch">
          <select style={S.input} value={draft.branch} onChange={set("branch")}>
            <option value="">All branches</option>
            {branchOptions.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchName}
              </option>
            ))}
          </select>
        </Field>
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
            value={draft.dateField}
            onChange={set("dateField")}
          >
            <option value="invoiceDate">Invoice date</option>
            <option value="createdAt">Entry date</option>
          </select>
        </Field>
        <Field label="Include">
          <select style={S.input} value={draft.status} onChange={set("status")}>
            <option value="">Everything except drafts</option>
            <option value="approved">Fully approved only</option>
            <option value="all">Everything including drafts</option>
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
          <button
            style={S.exportBtn}
            onClick={exportExcel}
            disabled={exporting || dirty}
          >
            {exporting ? "Preparing…" : "Export to Excel"}
          </button>
          <button style={S.resetBtn} onClick={reset}>
            Reset
          </button>
        </div>
      </div>

      {filters.dateField === "createdAt" && (
        <div style={S.note}>
          Showing entry date. For books and audit, invoice date is normally the
          correct basis — an invoice dated 28 March entered on 4 April belongs
          to March.
        </div>
      )}
      {error && <div style={S.error}>{error}</div>}

      {/* Totals */}
      <div style={S.statRow}>
        <Stat label="Subtypes with activity" value={num(t.subtypeCount)} />
        <Stat label="Invoices" value={num(t.invoices)} tone={C.muted} />
        <Stat label="Taxable value" value={fmt(t.baseAmount)} />
        <Stat label="GST" value={fmt(t.gstAmount)} tone={C.muted} />
        <Stat label="TDS deducted" value={fmt(t.tdsAmount)} tone={C.warn} />
        <Stat label="Net payable" value={fmt(t.netPayable)} />
        <Stat label="Outstanding" value={fmt(t.outstanding)} tone={C.warn} />
      </div>

      {t.inFlightNet > 0 && (
        <div style={S.note}>
          {fmt(t.inFlightNet)} of this is still moving through approval and is
          not yet committed spend. {fmt(t.approvedNet)} is fully approved.
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
        {activeBranch && (
          <span style={S.scopeTag}>Showing {activeBranch.branchName} only</span>
        )}
      </div>

      {loading && !data ? (
        <div style={S.loading}>Loading…</div>
      ) : !rows.length ? (
        <div style={S.empty}>
          <div style={{ fontWeight: 600, color: "#475569" }}>
            No {filters.expenseType.toLowerCase()} spend in this period
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
            Widen the dates, or switch the type — your category master may only
            have {filters.expenseType === "Revenue" ? "Capital" : "Revenue"}{" "}
            heads.
          </div>
        </div>
      ) : view === "summary" ? (
        <SummaryTable
          rows={rows}
          totals={t}
          onDrill={(r) => setDrill(r)}
          filters={filters}
        />
      ) : (
        <BranchMatrix data={data} onDrill={setDrill} filters={filters} />
      )}

      {/* Audit flags */}
      {data?.auditFlags?.duplicateInvoiceNumbers?.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>Same invoice number used more than once</div>
          <table style={S.table}>
            <thead>
              <tr style={S.thead}>
                <th style={S.th}>Vendor</th>
                <th style={S.th}>Invoice no.</th>
                <th style={S.th}>Subtype</th>
                <th style={S.th}>Requests</th>
                <th style={S.thR}>Times</th>
                <th style={S.thR}>Combined value</th>
              </tr>
            </thead>
            <tbody>
              {data.auditFlags.duplicateInvoiceNumbers.map((d, i) => (
                <tr key={i} style={S.tr}>
                  <td style={S.td}>{d.vendor}</td>
                  <td
                    style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}
                  >
                    {d.invoiceNumber}
                  </td>
                  <td style={S.td}>{d.category}</td>
                  <td
                    style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}
                  >
                    {d.requestIds.join(", ")}
                  </td>
                  <td style={{ ...S.tdR, color: C.bad, fontWeight: 700 }}>
                    {d.count}
                  </td>
                  <td style={S.tdR}>{fmt(d.netPayable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drill && (
        <DrillDown
          subtype={drill.subtype}
          branchId={drill.branchId}
          branchName={drill.branchName}
          query={qs()}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// ── Summary table ───────────────────────────────────────────
function SummaryTable({ rows, totals, onDrill, filters = {} }) {
  const [sort, setSort] = useState({ key: "netPayable", dir: -1 });

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key] ?? "";
    const bv = b[sort.key] ?? "";
    if (typeof av === "string") return sort.dir * av.localeCompare(bv);
    return sort.dir * (av - bv);
  });

  const head = (key, label, right) => (
    <th
      style={{ ...(right ? S.thR : S.th), cursor: "pointer" }}
      onClick={() =>
        setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))
      }
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div style={S.card}>
      <div style={S.branchHeadRow}>
        <div style={S.cardTitle}>
          Subtype breakdown — click any row for the invoices behind it
        </div>
        <XlsBtn
          onClick={() =>
            downloadExcel({
              filename: "Subtype_Summary",
              sheets: [
                {
                  name: "Subtype summary",
                  title: "Subtype breakdown",
                  meta: filterMeta(filters, [
                    [
                      "Sorted by",
                      `${sort.key} ${sort.dir === -1 ? "desc" : "asc"}`,
                    ],
                    [
                      "Period basis",
                      filters.dateField === "createdAt"
                        ? "Entry date"
                        : "Invoice date",
                    ],
                  ]),
                  columns: [
                    { header: "Code", key: "code", width: 10 },
                    { header: "Subtype", key: "name", width: 36 },
                    {
                      header: "Invoices",
                      key: "invoices",
                      width: 10,
                      fmt: "int",
                    },
                    { header: "Vendors", key: "vendors", width: 9, fmt: "int" },
                    {
                      header: "Taxable value",
                      key: "baseAmount",
                      width: 16,
                      fmt: "money",
                    },
                    {
                      header: "GST",
                      key: "gstAmount",
                      width: 14,
                      fmt: "money",
                    },
                    {
                      header: "TDS",
                      key: "tdsAmount",
                      width: 13,
                      fmt: "money",
                    },
                    {
                      header: "Net payable",
                      key: "netPayable",
                      width: 16,
                      fmt: "money",
                    },
                    { header: "Paid", key: "paid", width: 15, fmt: "money" },
                    {
                      header: "Outstanding",
                      key: "outstanding",
                      width: 15,
                      fmt: "money",
                    },
                    {
                      header: "Avg invoice",
                      key: "avgValue",
                      width: 14,
                      fmt: "money",
                    },
                    {
                      header: "Largest",
                      key: "maxInvoice",
                      width: 15,
                      fmt: "money",
                    },
                    { header: "Top vendor", key: "topVendor", width: 26 },
                    {
                      header: "Top vendor %",
                      key: "topVendorShare",
                      width: 12,
                      fmt: "pct",
                    },
                    {
                      header: "No invoice doc",
                      width: 13,
                      fmt: "int",
                      value: (r) => r.flags.missingInvoiceDoc,
                    },
                    {
                      header: "Approved, nil TDS",
                      width: 15,
                      fmt: "int",
                      value: (r) => r.flags.zeroTdsApproved,
                    },
                    {
                      header: "Reworked",
                      width: 10,
                      fmt: "int",
                      value: (r) => r.flags.reworked,
                    },
                  ],
                  rows: sorted,
                  totals: { __label: "Total", ...totals, name: "" },
                },
              ],
            })
          }
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              {head("code", "Code")}
              <th style={{ ...S.th, ...S.sticky }}>Subtype</th>
              {head("invoices", "Inv.", true)}
              {head("vendors", "Vendors", true)}
              {head("baseAmount", "Taxable value", true)}
              {head("gstAmount", "GST", true)}
              {head("tdsAmount", "TDS", true)}
              {head("netPayable", "Net payable", true)}
              {head("paid", "Paid", true)}
              {head("outstanding", "Outstanding", true)}
              {head("avgValue", "Avg", true)}
              {head("maxInvoice", "Largest", true)}
              <th style={S.th}>Top vendor</th>
              <th style={S.th}>Checks</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={String(r.categoryId)}
                style={{ ...S.tr, cursor: "pointer" }}
                onClick={() => onDrill({ subtype: r })}
              >
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                  {r.code}
                </td>
                <td style={{ ...S.td, ...S.stickyCell }}>
                  {r.name}
                  {r.categoryStatus === "inactive" && (
                    <span style={S.tag}>retired</span>
                  )}
                </td>
                <td style={S.tdR}>{num(r.invoices)}</td>
                <td style={S.tdR}>{num(r.vendors)}</td>
                <td style={S.tdR}>{fmt(r.baseAmount)}</td>
                <td style={S.tdR}>{fmt(r.gstAmount)}</td>
                <td style={{ ...S.tdR, color: C.warn }}>{fmt(r.tdsAmount)}</td>
                <td style={{ ...S.tdR, fontWeight: 700 }}>
                  {fmt(r.netPayable)}
                </td>
                <td style={{ ...S.tdR, color: C.ok }}>{fmt(r.paid)}</td>
                <td
                  style={{ ...S.tdR, color: r.outstanding ? C.warn : C.muted }}
                >
                  {fmt(r.outstanding)}
                </td>
                <td style={S.tdR}>{fmt(r.avgValue)}</td>
                <td style={S.tdR}>{fmt(r.maxInvoice)}</td>
                <td style={S.td}>
                  {r.topVendor}
                  {r.topVendorShare !== null && (
                    <span
                      style={{
                        ...S.tag,
                        color: r.topVendorShare >= 75 ? C.bad : C.muted,
                      }}
                    >
                      {r.topVendorShare}%
                    </span>
                  )}
                </td>
                <td style={S.td}>
                  <Flags flags={r.flags} />
                </td>
              </tr>
            ))}
            <tr style={S.totalRow}>
              <td style={S.td} />
              <td
                style={{
                  ...S.td,
                  ...S.stickyCell,
                  fontWeight: 700,
                  background: "#f8fafc",
                }}
              >
                Total
              </td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>
                {num(totals.invoices)}
              </td>
              <td style={S.tdR} />
              <td style={{ ...S.tdR, fontWeight: 700 }}>
                {fmt(totals.baseAmount)}
              </td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>
                {fmt(totals.gstAmount)}
              </td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>
                {fmt(totals.tdsAmount)}
              </td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>
                {fmt(totals.netPayable)}
              </td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>{fmt(totals.paid)}</td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>
                {fmt(totals.outstanding)}
              </td>
              <td colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Flags = ({ flags = {} }) => {
  const items = [
    flags.missingInvoiceDoc && {
      n: flags.missingInvoiceDoc,
      t: "no invoice doc",
      c: C.bad,
    },
    flags.zeroTdsApproved && {
      n: flags.zeroTdsApproved,
      t: "nil TDS",
      c: C.warn,
    },
    flags.largeRoundOff && {
      n: flags.largeRoundOff,
      t: "round-off",
      c: C.warn,
    },
    flags.reworked && { n: flags.reworked, t: "reworked", c: C.muted },
  ].filter(Boolean);

  if (!items.length) return <span style={{ color: "#cbd5e1" }}>clear</span>;
  return (
    <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {items.map((i, k) => (
        <span key={k} style={{ ...S.flag, color: i.c, borderColor: i.c }}>
          {i.n} {i.t}
        </span>
      ))}
    </span>
  );
};

// ── Subtype × branch matrix ─────────────────────────────────
function BranchMatrix({ data, onDrill, filters = {} }) {
  const branches = data.branches || [];
  const rows = data.subtypes || [];
  const cell = {};
  (data.matrix || []).forEach((m) => {
    cell[`${m.categoryId}|${m.branchId}`] = m;
  });

  const colTotal = (bid) =>
    rows.reduce(
      (s, r) => s + (cell[`${r.categoryId}|${bid}`]?.netPayable || 0),
      0,
    );

  return (
    <div style={S.card}>
      <div style={S.branchHeadRow}>
        <div style={S.cardTitle}>
          Net payable by subtype and branch — click a cell for its invoices
        </div>
        <XlsBtn
          onClick={() =>
            downloadExcel({
              filename: "Subtype_Branch_Matrix",
              sheets: [
                {
                  name: "Subtype x branch",
                  title: "Net payable by subtype and branch",
                  meta: filterMeta(filters),
                  columns: [
                    { header: "Code", key: "code", width: 10 },
                    { header: "Subtype", key: "name", width: 36 },
                    ...branches.map((b) => ({
                      header: b.branchName,
                      width: 17,
                      fmt: "money",
                      value: (r) =>
                        cell[`${r.categoryId}|${b.branchId}`]?.netPayable || 0,
                    })),
                    {
                      header: "Total",
                      key: "netPayable",
                      width: 17,
                      fmt: "money",
                    },
                  ],
                  rows,
                },
              ],
            })
          }
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={{ ...S.th, ...S.sticky }}>Subtype</th>
              {branches.map((b) => (
                <th key={b.branchId} style={S.thR}>
                  {b.branchName}
                </th>
              ))}
              <th style={{ ...S.thR, ...S.totalCol }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.categoryId)} style={S.tr}>
                <td style={{ ...S.td, ...S.stickyCell }}>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      color: "#94a3b8",
                      marginRight: 8,
                    }}
                  >
                    {r.code}
                  </span>
                  {r.name}
                </td>
                {branches.map((b) => {
                  const c = cell[`${r.categoryId}|${b.branchId}`];
                  return (
                    <td
                      key={b.branchId}
                      style={{
                        ...S.tdR,
                        color: c ? "#334155" : "#cbd5e1",
                        cursor: c ? "pointer" : "default",
                      }}
                      title={c ? `${num(c.invoices)} invoices` : "No activity"}
                      onClick={() =>
                        c &&
                        onDrill({
                          subtype: r,
                          branchId: b.branchId,
                          branchName: b.branchName,
                        })
                      }
                    >
                      {c ? fmt(c.netPayable) : "—"}
                    </td>
                  );
                })}
                <td style={{ ...S.tdR, ...S.totalCol, fontWeight: 700 }}>
                  {fmt(r.netPayable)}
                </td>
              </tr>
            ))}
            <tr style={S.totalRow}>
              <td
                style={{
                  ...S.td,
                  ...S.stickyCell,
                  fontWeight: 700,
                  background: "#f8fafc",
                }}
              >
                All subtypes
              </td>
              {branches.map((b) => (
                <td key={b.branchId} style={{ ...S.tdR, fontWeight: 700 }}>
                  {fmt(colTotal(b.branchId))}
                </td>
              ))}
              <td style={{ ...S.tdR, ...S.totalCol, fontWeight: 700 }}>
                {fmt(data.totals?.netPayable)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Drill-down ──────────────────────────────────────────────
function DrillDown({ subtype, branchId, branchName, query, onClose }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const extra = branchId ? `&branchId=${branchId}` : "";
    api
      .get(
        `/reports/expense-subtypes/${subtype.categoryId}/invoices?${query}${extra}&page=${page}&limit=50`,
      )
      .then(({ data }) => {
        if (!live) return;
        setRows(data.invoices || []);
        setMeta({ total: data.total, page: data.page, pages: data.pages });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [subtype.categoryId, branchId, query, page]);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.primary }}>
              {subtype.code} {subtype.name}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
              {branchName ? `${branchName} · ` : ""}
              {num(meta.total)} invoices · {fmt(subtype.netPayable)} net payable
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <XlsBtn
              onClick={() =>
                downloadExcel({
                  filename: `Invoices_${subtype.code}`,
                  sheets: [
                    {
                      name: "Invoices",
                      title: `${subtype.code} ${subtype.name}${branchName ? ` — ${branchName}` : ""}`,
                      meta: [
                        ["Page", `${meta.page} of ${meta.pages}`],
                        ["Rows on this page", rows.length],
                      ],
                      columns: [
                        { header: "Request", key: "requestId", width: 14 },
                        {
                          header: "Invoice date",
                          key: "invoiceDate",
                          width: 13,
                          fmt: "date",
                        },
                        {
                          header: "Invoice no.",
                          key: "invoiceNumber",
                          width: 20,
                        },
                        {
                          header: "Branch",
                          width: 20,
                          value: (i) => i.branch?.name || "",
                        },
                        {
                          header: "Vendor",
                          width: 26,
                          value: (i) => i.vendor?.vendorName || "",
                        },
                        {
                          header: "PAN",
                          width: 13,
                          value: (i) => i.vendor?.panNumber || "",
                        },
                        {
                          header: "GSTIN",
                          width: 18,
                          value: (i) => i.vendor?.gstNumber || "",
                        },
                        {
                          header: "Taxable",
                          key: "amount",
                          width: 15,
                          fmt: "money",
                        },
                        {
                          header: "GST",
                          key: "gstAmount",
                          width: 13,
                          fmt: "money",
                        },
                        {
                          header: "TDS %",
                          key: "tdsPercentage",
                          width: 8,
                          fmt: "int",
                        },
                        {
                          header: "TDS",
                          key: "tdsAmount",
                          width: 13,
                          fmt: "money",
                        },
                        {
                          header: "Net payable",
                          key: "netPayable",
                          width: 15,
                          fmt: "money",
                        },
                        {
                          header: "Paid",
                          width: 14,
                          fmt: "money",
                          value: (i) => i.paymentRequest?.paidAmount || 0,
                        },
                        { header: "Status", key: "status", width: 22 },
                        {
                          header: "Invoice doc",
                          width: 11,
                          value: (i) => (i.hasInvoiceDoc ? "Yes" : "MISSING"),
                        },
                      ],
                      rows,
                    },
                  ],
                })
              }
            />
            <button style={S.closeBtn} onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {loading ? (
          <div style={S.loading}>Loading invoices…</div>
        ) : (
          <div style={{ overflow: "auto", flex: 1 }}>
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  <th style={S.th}>Request</th>
                  <th style={S.th}>Invoice date</th>
                  <th style={S.th}>Invoice no.</th>
                  <th style={S.th}>Branch</th>
                  <th style={S.th}>Vendor</th>
                  <th style={S.thR}>Taxable</th>
                  <th style={S.thR}>GST</th>
                  <th style={S.thR}>TDS</th>
                  <th style={S.thR}>Net</th>
                  <th style={S.thR}>Paid</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Doc</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i._id} style={S.tr}>
                    <td
                      style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}
                    >
                      {i.requestId}
                    </td>
                    <td style={S.td}>{dt(i.invoiceDate)}</td>
                    <td
                      style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}
                    >
                      {i.invoiceNumber}
                    </td>
                    <td style={S.td}>{i.branch?.name || "—"}</td>
                    <td style={S.td}>{i.vendor?.vendorName || "—"}</td>
                    <td style={S.tdR}>{fmt(i.amount)}</td>
                    <td style={S.tdR}>{fmt(i.gstAmount)}</td>
                    <td style={S.tdR}>
                      {fmt(i.tdsAmount)}
                      {i.tdsPercentage ? (
                        <span style={{ color: "#94a3b8", fontSize: 11 }}>
                          {" "}
                          ({i.tdsPercentage}%)
                        </span>
                      ) : null}
                    </td>
                    <td style={{ ...S.tdR, fontWeight: 700 }}>
                      {fmt(i.netPayable)}
                    </td>
                    <td style={{ ...S.tdR, color: C.ok }}>
                      {fmt(i.paymentRequest?.paidAmount)}
                    </td>
                    <td style={{ ...S.td, fontSize: 12 }}>{i.status}</td>
                    <td style={S.td}>
                      {i.hasInvoiceDoc ? (
                        <span style={{ color: C.ok }}>✓</span>
                      ) : (
                        <span
                          style={{
                            ...S.flag,
                            color: C.bad,
                            borderColor: C.bad,
                          }}
                        >
                          missing
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta.pages > 1 && (
          <div style={S.pager}>
            <button
              style={S.pageBtn}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span style={{ fontSize: 13, color: C.muted }}>
              Page {meta.page} of {meta.pages}
            </span>
            <button
              style={S.pageBtn}
              disabled={page >= meta.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────
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
  exportBtn: {
    padding: "9px 16px",
    background: "#15803d",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
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
  viewRow: { display: "flex", gap: 6, alignItems: "center" },
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
  scopeTag: { fontSize: 12, color: C.muted, marginLeft: 6 },
  card: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "18px 20px",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 14,
  },
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
  sticky: {
    position: "sticky",
    left: 0,
    background: "#fff",
    zIndex: 2,
    minWidth: 230,
  },
  stickyCell: {
    position: "sticky",
    left: 0,
    background: "#fff",
    zIndex: 1,
    minWidth: 230,
  },
  totalCol: { borderLeft: `2px solid ${C.line}`, background: "#fbfdff" },
  totalRow: { borderTop: `2px solid ${C.line}`, background: "#f8fafc" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "10px", color: "#334155" },
  tdR: {
    padding: "10px",
    color: "#334155",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  tag: {
    marginLeft: 8,
    fontSize: 11,
    color: C.muted,
    background: "#f1f5f9",
    borderRadius: 4,
    padding: "1px 6px",
  },
  flag: {
    fontSize: 11,
    border: "1px solid",
    borderRadius: 4,
    padding: "1px 6px",
    whiteSpace: "nowrap",
  },
  note: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
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
    width: "min(1180px, 100%)",
    maxHeight: "88vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  modalHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "18px 22px",
    borderBottom: `1px solid ${C.line}`,
  },
  closeBtn: {
    background: "none",
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
    color: C.muted,
  },
  pager: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    padding: "12px 0",
    borderTop: `1px solid ${C.line}`,
  },
  pageBtn: {
    padding: "7px 14px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
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
  branchHeadRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
};
