// ============================================================
// FRONTEND: src/pages/PrimaryReports.jsx
// REPLACE THE WHOLE FILE.
// Every patch from this conversation is already applied, once:
//   · branch x stage matrix
//   · branch-by-branch dropdowns
//   · draft/filters split so only Apply fires a request
//   · per-section Excel export
//   · subtype register tab
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import SubtypeReport from "./SubtypeReport.jsx";
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

// Hours read badly past a day or two; the client thinks in days.
const dur = (h) => {
  const v = Number(h);
  if (!v && v !== 0) return "—";
  if (v < 1) return `${Math.round(v * 60)}m`;
  if (v < 48) return `${Math.round(v)}h`;
  return `${(v / 24).toFixed(1)}d`;
};

const pctColor = (p) =>
  p === null || p === undefined
    ? C.muted
    : p >= 90
      ? C.ok
      : p >= 70
        ? C.warn
        : C.bad;

const TABS = [
  ["invoice", "Invoice approvals"],
  ["payment", "Payment processing"],
  ["expense", "Expense categories"],
  ["subtype", "Subtype register"],
];

const BLANK = {
  from: "",
  to: "",
  branch: "",
  expenseType: "",
  expenseCategory: "",
};

export default function PrimaryReports() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("invoice");

  // `draft` is what the inputs show; `filters` is what the request uses.
  // Nothing reloads until Apply copies one into the other — otherwise a
  // date picker fires a request for every year you scroll past.
  const [draft, setDraft] = useState(BLANK);
  const [filters, setFilters] = useState(BLANK);

  const [options, setOptions] = useState({ categories: [], branches: [] });
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const qs = useCallback(
    () =>
      new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      ).toString(),
    [filters],
  );

  useEffect(() => {
    api
      .get("/reports/filters")
      .then(({ data }) => setOptions(data))
      .catch(() => setOptions({ categories: [], branches: [] }));
  }, []);

  const load = useCallback(
    async (which) => {
      const endpoint = {
        invoice: "invoice-delays",
        payment: "payment-delays",
        expense: "expense-analysis",
      }[which];

      // The subtype tab loads its own data from a different endpoint
      // with its own filters, so there is nothing to fetch here.
      if (!endpoint) return;

      setLoading(true);
      setError("");
      try {
        const { data: res } = await api.get(`/reports/${endpoint}?${qs()}`);
        setData((d) => ({ ...d, [which]: res }));
      } catch (err) {
        setError(
          err.response?.data?.message ||
            "That report could not be loaded. Try a narrower date range.",
        );
      } finally {
        setLoading(false);
      }
    },
    [qs],
  );

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = () => setFilters(draft);
  const clear = () => {
    setDraft(BLANK);
    setFilters(BLANK);
  };

  const badRange = draft.from && draft.to && draft.from > draft.to;
  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);

  const current = data[tab];
  const branchName =
    options.branches.find((b) => String(b._id) === filters.branch)?.name ||
    null;
  const metaFilters = { ...filters, branchName };

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>Reports</h1>
            <p style={S.sub}>
              Where invoices and payments are getting held up, and what the
              money is being spent on.
            </p>
          </div>
          <button style={S.linkBtn} onClick={() => navigate("/reports")}>
            Volume &amp; value reports
          </button>
        </div>

        {/* Filters — the subtype tab carries its own, so hide these there */}
        {tab !== "subtype" && (
          <div style={S.filterBar}>
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
            <Field label="Branch">
              <select
                style={S.input}
                value={draft.branch}
                onChange={set("branch")}
              >
                <option value="">All branches</option>
                {options.branches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expense type">
              <select
                style={S.input}
                value={draft.expenseType}
                onChange={set("expenseType")}
              >
                <option value="">Revenue and Capital</option>
                <option value="Revenue">Revenue</option>
                <option value="Capital">Capital</option>
              </select>
            </Field>
            <Field label="Category">
              <select
                style={S.input}
                value={draft.expenseCategory}
                onChange={set("expenseCategory")}
              >
                <option value="">All categories</option>
                {options.categories
                  .filter(
                    (c) => !draft.expenseType || c.type === draft.expenseType,
                  )
                  .map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name} ({c.code})
                      {c.status === "inactive" ? " — retired" : ""}
                    </option>
                  ))}
              </select>
            </Field>
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
            <button style={S.clearBtn} onClick={clear}>
              Clear
            </button>
            {badRange && (
              <span style={S.filterHint}>
                The end date is before the start date.
              </span>
            )}
            {dirty && !badRange && (
              <span style={S.filterHint}>Not applied yet</span>
            )}
          </div>
        )}

        <div style={S.tabs}>
          {TABS.map(([k, l]) => (
            <button
              key={k}
              style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}
              onClick={() => setTab(k)}
            >
              {l}
            </button>
          ))}
        </div>

        {error && <div style={S.error}>{error}</div>}

        {tab === "subtype" ? (
          <SubtypeReport
            branches={options.branches.map((b) => ({
              branchId: b._id,
              branchName: b.name,
            }))}
          />
        ) : loading && !current ? (
          <div style={S.loading}>Loading…</div>
        ) : (
          <div
            style={{ opacity: loading ? 0.5 : 1, transition: "opacity .15s" }}
          >
            {tab === "invoice" && (
              <DelayReport
                report={current}
                kind="invoice"
                filters={metaFilters}
              />
            )}
            {tab === "payment" && (
              <DelayReport
                report={current}
                kind="payment"
                filters={metaFilters}
              />
            )}
            {tab === "expense" && (
              <ExpenseReport report={current} filters={metaFilters} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Shared delay view (invoice and payment share a response shape) ──
function DelayReport({ report, kind, filters = {} }) {
  const [openStage, setOpenStage] = useState(null);
  // Lets the tab-level "Download all" reach the matrix sheet with
  // whichever metric is currently selected inside it.
  const sheets = useRef({});

  if (!report) return null;

  const stages = report.stages || [];
  const buckets = report.meta?.bucketLabels || [];
  const totalPending = stages.reduce((s, x) => s + x.pending.count, 0);
  const totalBreached = stages.reduce((s, x) => s + x.pending.breached, 0);
  const stuckValue = stages.reduce(
    (s, x) => s + (x.pending.breachedAmount || 0),
    0,
  );

  const label =
    kind === "invoice" ? "Invoice approval delay" : "Payment processing delay";
  const fileBase = kind === "invoice" ? "Invoice_Delays" : "Payment_Delays";

  // Hours export as numbers, not the "2.1d" on screen — a text cell
  // can't be sorted or summed in Excel.
  const stageSheet = () => ({
    name: "Delay by stage",
    title: `${label} — by stage`,
    meta: filterMeta(filters),
    columns: [
      { header: "Stage", key: "stageLabel", width: 26 },
      { header: "SLA (hours)", key: "slaHours", width: 12, fmt: "int" },
      {
        header: "Waiting now",
        width: 12,
        fmt: "int",
        value: (s) => s.pending.count,
      },
      {
        header: "Overdue now",
        width: 12,
        fmt: "int",
        value: (s) => s.pending.breached,
      },
      {
        header: "Avg wait (hours)",
        width: 15,
        fmt: "hours",
        value: (s) => s.pending.avgHoursWaiting,
      },
      {
        header: "Longest wait (hours)",
        width: 18,
        fmt: "hours",
        value: (s) => s.pending.maxHoursWaiting,
      },
      {
        header: "Value waiting",
        width: 16,
        fmt: "money",
        value: (s) => s.pending.amount,
      },
      {
        header: "Completed",
        width: 11,
        fmt: "int",
        value: (s) => s.completed.count,
      },
      {
        header: "Cleared late",
        width: 12,
        fmt: "int",
        value: (s) => s.completed.breached,
      },
      {
        header: "On time %",
        width: 11,
        fmt: "pct",
        value: (s) => s.completed.onTimePct,
      },
      {
        header: "Avg to clear (hours)",
        width: 18,
        fmt: "hours",
        value: (s) => s.completed.avgHoursTaken,
      },
      ...buckets.map((b) => ({
        header: b.label,
        width: 15,
        fmt: "int",
        value: (s) => s.overdueBuckets?.[b.key] || 0,
      })),
    ],
    rows: stages,
  });

  const offendersSheet = () => ({
    name: "Stuck the longest",
    title: `${label} — currently overdue`,
    meta: filterMeta(filters),
    columns: [
      {
        header: kind === "invoice" ? "Request ID" : "Payment ID",
        width: 15,
        value: (w) => w.requestId || w.paymentId,
      },
      { header: "Branch", key: "branch", width: 20 },
      { header: "Vendor", key: "vendor", width: 26 },
      {
        header: "Stage",
        width: 24,
        value: (w) =>
          stages.find((s) => s.stage === w.stage)?.stageLabel || w.stage,
      },
      {
        header: "Waiting since",
        key: "stageEnteredAt",
        width: 13,
        fmt: "date",
      },
      { header: "SLA (hours)", key: "slaHours", width: 12, fmt: "int" },
      {
        header: "Overdue by (hours)",
        key: "overdueHours",
        width: 17,
        fmt: "hours",
      },
      {
        header: "Amount",
        width: 16,
        fmt: "money",
        value: (w) => w.netPayable ?? w.amount,
      },
      { header: "Status", key: "status", width: 22 },
    ],
    rows: report.worstOffenders || [],
  });

  if (!totalPending && !stages.some((s) => s.completed.count)) {
    return (
      <div style={S.empty}>
        <div style={{ fontWeight: 600, color: "#475569" }}>
          Nothing to report for this period
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
          Widen the date range or clear the branch filter.
        </div>
      </div>
    );
  }

  return (
    <div style={S.section}>
      <div style={S.statRow}>
        <Stat label="Waiting for approval" value={num(totalPending)} />
        <Stat
          label="Past their SLA"
          value={num(totalBreached)}
          tone={totalBreached ? C.bad : C.ok}
        />
        <Stat label="Value held up" value={fmt(stuckValue)} tone={C.warn} />
        {kind === "invoice" && report.meta?.reworkedInvoices > 0 && (
          <Stat
            label="Sent back at least once"
            value={num(report.meta.reworkedInvoices)}
            tone={C.warn}
          />
        )}
        {kind === "payment" && report.dueDatePerformance && (
          <Stat
            label="Paid after vendor due date"
            value={num(report.dueDatePerformance.paidAfterDueDate)}
            tone={C.bad}
          />
        )}
      </div>

      {kind === "payment" && report.dueDatePerformance?.coveragePct < 80 && (
        <div style={S.note}>
          Only {report.dueDatePerformance.coveragePct}% of these invoices have a
          due date recorded, so the due-date figures cover part of the picture.
        </div>
      )}
      {kind === "payment" && report.meta?.legacyRecords > 0 && (
        <div style={S.note}>
          {num(report.meta.legacyRecords)} older payments predate installment
          tracking. Their raise time is estimated from the approval date.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <XlsBtn
          label="Download all sections"
          onClick={() =>
            downloadExcel({
              filename: fileBase,
              sheets: [
                stageSheet(),
                sheets.current.matrix?.(),
                offendersSheet(),
              ].filter(Boolean),
            })
          }
        />
      </div>

      {/* ── Section 1: delay by stage ── */}
      <div style={S.card}>
        <CardHead title="Delay by stage">
          <XlsBtn
            onClick={() =>
              downloadExcel({
                filename: `${fileBase}_By_Stage`,
                sheets: [stageSheet()],
              })
            }
          />
        </CardHead>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={S.th}>Stage</th>
              <th style={S.th}>SLA</th>
              <th style={S.thR}>Waiting now</th>
              <th style={S.thR}>Overdue now</th>
              <th style={S.thR}>Avg wait</th>
              <th style={S.thR}>Longest wait</th>
              <th style={S.thR}>Completed</th>
              <th style={S.thR}>Cleared on time</th>
              <th style={S.thR}>Avg to clear</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <React.Fragment key={s.stage}>
                <tr
                  style={{ ...S.tr, cursor: "pointer" }}
                  onClick={() =>
                    setOpenStage(openStage === s.stage ? null : s.stage)
                  }
                >
                  <td style={{ ...S.td, fontWeight: 600 }}>
                    {s.stageLabel}
                    {s.configured === false && (
                      <span style={S.defaultTag}>default target</span>
                    )}
                  </td>
                  <td style={S.td}>{s.slaHours ? `${s.slaHours}h` : "—"}</td>
                  <td style={S.tdR}>{num(s.pending.count)}</td>
                  <td
                    style={{
                      ...S.tdR,
                      color: s.pending.breached ? C.bad : C.muted,
                      fontWeight: 700,
                    }}
                  >
                    {num(s.pending.breached)}
                  </td>
                  <td style={S.tdR}>{dur(s.pending.avgHoursWaiting)}</td>
                  <td style={S.tdR}>{dur(s.pending.maxHoursWaiting)}</td>
                  <td style={S.tdR}>{num(s.completed.count)}</td>
                  <td
                    style={{
                      ...S.tdR,
                      color: pctColor(s.completed.onTimePct),
                      fontWeight: 700,
                    }}
                  >
                    {s.completed.onTimePct === null
                      ? "—"
                      : `${s.completed.onTimePct}%`}
                  </td>
                  <td style={S.tdR}>{dur(s.completed.avgHoursTaken)}</td>
                </tr>
                {openStage === s.stage && (
                  <tr>
                    <td colSpan={9} style={S.drawer}>
                      <div
                        style={{
                          fontSize: 12,
                          color: C.muted,
                          marginBottom: 8,
                        }}
                      >
                        {s.help || "How far past the SLA the overdue items are"}
                      </div>
                      <div
                        style={{ display: "flex", gap: 20, flexWrap: "wrap" }}
                      >
                        {buckets.map((b) => (
                          <div key={b.key}>
                            <div
                              style={{
                                fontSize: 20,
                                fontWeight: 700,
                                color: C.primary,
                              }}
                            >
                              {num(s.overdueBuckets?.[b.key])}
                            </div>
                            <div style={{ fontSize: 12, color: C.muted }}>
                              {b.label}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Section 2: branch x stage matrix ── */}
      <BranchStageMatrix report={report} filters={filters} register={sheets} />

      {/* ── Section 3: worst offenders ── */}
      <div style={S.card}>
        <CardHead title="Stuck the longest">
          <XlsBtn
            onClick={() =>
              downloadExcel({
                filename: `${fileBase}_Overdue`,
                sheets: [offendersSheet()],
              })
            }
          />
        </CardHead>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={S.th}>{kind === "invoice" ? "Invoice" : "Payment"}</th>
              <th style={S.th}>Branch</th>
              <th style={S.th}>Vendor</th>
              <th style={S.th}>Stage</th>
              <th style={S.th}>Waiting since</th>
              <th style={S.thR}>Overdue by</th>
              <th style={S.thR}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(report.worstOffenders || []).map((w, i) => (
              <tr key={i} style={S.tr}>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                  {w.requestId || w.paymentId}
                </td>
                <td style={S.td}>{w.branch || "—"}</td>
                <td style={S.td}>{w.vendor || "—"}</td>
                <td style={S.td}>
                  {stages.find((s) => s.stage === w.stage)?.stageLabel ||
                    w.stage}
                </td>
                <td style={{ ...S.td, color: C.muted, fontSize: 12 }}>
                  {new Date(w.stageEnteredAt).toLocaleDateString("en-GB")}
                </td>
                <td style={{ ...S.tdR, color: C.bad, fontWeight: 700 }}>
                  {dur(w.overdueHours)}
                </td>
                <td style={S.tdR}>{fmt(w.netPayable ?? w.amount)}</td>
              </tr>
            ))}
            {!report.worstOffenders?.length && (
              <EmptyRow cols={7} text="Nothing is currently past its SLA" />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Branch (rows) x Stage (columns) ─────────────────────────
// One metric at a time: six numbers per cell is unreadable, and the
// question people actually ask is "which branch is worst at X".
const MATRIX_METRICS = [
  {
    key: "pending",
    label: "Waiting now",
    render: (v) => num(v),
    tone: () => C.primary,
    total: (rows) => rows.reduce((s, r) => s + (r.pending || 0), 0),
  },
  {
    key: "breached",
    label: "Past SLA",
    render: (v) => num(v),
    tone: (v) => (v ? C.bad : "#cbd5e1"),
    total: (rows) => rows.reduce((s, r) => s + (r.breached || 0), 0),
  },
  {
    key: "onTimePct",
    label: "Cleared on time",
    render: (v) => (v === null || v === undefined ? "—" : `${v}%`),
    tone: pctColor,
    // Recomputed from the counts, never averaged — averaging percentages
    // across stages of different sizes gives a wrong answer.
    total: (rows) => {
      const c = rows.reduce((s, r) => s + (r.count || 0), 0);
      const b = rows.reduce((s, r) => s + (r.breached || 0), 0);
      return c ? Math.round(((c - b) / c) * 1000) / 10 : null;
    },
  },
  {
    key: "avgHours",
    label: "Avg time in stage",
    render: (v) => dur(v),
    tone: () => "#334155",
    // Weighted by row count, so a stage with 200 items counts more than
    // one with 3.
    total: (rows) => {
      const c = rows.reduce((s, r) => s + (r.count || 0), 0);
      if (!c) return null;
      return (
        rows.reduce((s, r) => s + (r.avgHours || 0) * (r.count || 0), 0) / c
      );
    },
  },
  {
    key: "count",
    label: "Total items",
    render: (v) => num(v),
    tone: () => "#334155",
    total: (rows) => rows.reduce((s, r) => s + (r.count || 0), 0),
  },
  {
    key: "amount",
    label: "Value",
    render: (v) => fmt(v),
    tone: () => "#334155",
    total: (rows) => rows.reduce((s, r) => s + (r.amount || 0), 0),
  },
];

function BranchStageMatrix({ report, filters = {}, register }) {
  const [metricKey, setMetricKey] = useState("breached");
  const metric = MATRIX_METRICS.find((m) => m.key === metricKey);
  const rows = report.byBranch || [];
  const stages = report.stages || [];

  // branchId -> { name, byStage: { stageKey: row } }
  const branches = new Map();
  rows.forEach((r) => {
    const id = String(r.branchId);
    if (!branches.has(id))
      branches.set(id, { name: r.branchName, byStage: {} });
    branches.get(id).byStage[r.stage] = r;
  });

  // Worst first on the selected metric, so the branch needing attention
  // is the top row rather than buried alphabetically.
  const branchList = [...branches.entries()].sort(([, a], [, b]) => {
    const av = metric.total(Object.values(a.byStage));
    const bv = metric.total(Object.values(b.byStage));
    if (metricKey === "onTimePct" || metricKey === "avgHours") {
      if (av === null) return 1;
      if (bv === null) return -1;
      // Low on-time % is bad; high average time is bad.
      return metricKey === "onTimePct" ? av - bv : bv - av;
    }
    return (bv || 0) - (av || 0);
  });

  const columnTotal = (stageKey) =>
    metric.total(
      [...branches.values()].map((b) => b.byStage[stageKey]).filter(Boolean),
    );

  const colFmt =
    metric.key === "amount"
      ? "money"
      : metric.key === "avgHours"
        ? "hours"
        : metric.key === "onTimePct"
          ? "pct"
          : "int";

  const matrixSheet = () => ({
    name: "Branch x stage",
    title: `Branch performance by stage — ${metric.label}`,
    meta: filterMeta(filters, [["Metric", metric.label]]),
    columns: [
      { header: "Branch", width: 24, value: (r) => r.name },
      ...stages.map((s) => ({
        header: s.stageLabel,
        width: 18,
        fmt: colFmt,
        value: (r) =>
          r.byStage[s.stage] ? r.byStage[s.stage][metric.key] : "",
      })),
      {
        header: "All stages",
        width: 18,
        fmt: colFmt,
        value: (r) => metric.total(Object.values(r.byStage)),
      },
    ],
    rows: branchList.map(([, b]) => b),
  });

  // Hand the current sheet up so the tab-level download can include it
  // with whichever metric is on screen.
  useEffect(() => {
    if (register) register.current.matrix = matrixSheet;
  });

  if (!rows.length) {
    return (
      <div style={S.card}>
        <div style={S.cardTitle}>Branch performance by stage</div>
        <div style={{ padding: 28, textAlign: "center", color: "#94a3b8" }}>
          No branch activity in this period
        </div>
      </div>
    );
  }

  return (
    <div style={S.card}>
      <div style={S.matrixHead}>
        <div style={S.cardTitle}>Branch performance by stage</div>
        <div style={{ ...S.toggleRow, alignItems: "center" }}>
          {MATRIX_METRICS.map((m) => (
            <button
              key={m.key}
              style={{
                ...S.toggle,
                ...(metricKey === m.key ? S.toggleActive : {}),
              }}
              onClick={() => setMetricKey(m.key)}
            >
              {m.label}
            </button>
          ))}
          <XlsBtn
            onClick={() =>
              downloadExcel({
                filename: "Branch_Stage_Matrix",
                sheets: [matrixSheet()],
              })
            }
          />
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={{ ...S.th, ...S.stickyHead }}>Branch</th>
              {stages.map((s) => (
                <th key={s.stage} style={S.thR}>
                  {s.stageLabel}
                  {s.slaHours ? (
                    <div style={S.slaHint}>{s.slaHours}h target</div>
                  ) : null}
                </th>
              ))}
              <th style={{ ...S.thR, ...S.totalCol }}>All stages</th>
            </tr>
          </thead>
          <tbody>
            {branchList.map(([id, b]) => {
              const rowTotal = metric.total(Object.values(b.byStage));
              return (
                <tr key={id} style={S.tr}>
                  <td style={{ ...S.td, ...S.stickyCell }}>{b.name}</td>
                  {stages.map((s) => {
                    const cell = b.byStage[s.stage];
                    const value = cell ? cell[metric.key] : null;
                    return (
                      <td
                        key={s.stage}
                        style={{
                          ...S.tdR,
                          color: cell ? metric.tone(value) : "#cbd5e1",
                          fontWeight:
                            cell && metric.key === "breached" && value
                              ? 700
                              : 500,
                        }}
                        title={
                          cell
                            ? `${b.name} — ${s.stageLabel}\n${num(cell.pending)} waiting, ${num(cell.breached)} past SLA, ${num(cell.count)} total`
                            : "No activity"
                        }
                      >
                        {cell ? metric.render(value) : "—"}
                      </td>
                    );
                  })}
                  <td style={{ ...S.tdR, ...S.totalCol, fontWeight: 700 }}>
                    {metric.render(
                      metric.key === "avgHours" && rowTotal !== null
                        ? Math.round(rowTotal * 10) / 10
                        : rowTotal,
                    )}
                  </td>
                </tr>
              );
            })}
            <tr style={S.totalRow}>
              <td
                style={{
                  ...S.td,
                  ...S.stickyCell,
                  fontWeight: 700,
                  background: "#f8fafc",
                }}
              >
                All branches
              </td>
              {stages.map((s) => {
                const v = columnTotal(s.stage);
                return (
                  <td key={s.stage} style={{ ...S.tdR, fontWeight: 700 }}>
                    {metric.render(
                      metric.key === "avgHours" && v !== null
                        ? Math.round(v * 10) / 10
                        : v,
                    )}
                  </td>
                );
              })}
              <td style={{ ...S.tdR, ...S.totalCol, fontWeight: 700 }}>
                {metric.render(
                  metric.key === "avgHours" && metric.total(rows) !== null
                    ? Math.round(metric.total(rows) * 10) / 10
                    : metric.total(rows),
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Expense categories ──────────────────────────────────────
function ExpenseReport({ report, filters = {} }) {
  const [branchView, setBranchView] = useState(false);

  if (!report) return null;

  const {
    summary = {},
    byCategory = [],
    byBranchCategory = [],
    dataQuality,
  } = report;
  const maxNet = Math.max(1, ...byCategory.map((c) => c.netPayable || 0));

  const grouped = ["Revenue", "Capital"].map((type) => ({
    type,
    rows: byCategory.filter((c) => c.expenseType === type),
    total: summary[type],
  }));

  const moneyCols = [
    { header: "Code", key: "categoryCode", width: 10 },
    { header: "Category", key: "categoryName", width: 34 },
    { header: "Invoices", key: "count", width: 10, fmt: "int" },
    { header: "Base", key: "amount", width: 16, fmt: "money" },
    { header: "GST", key: "gstAmount", width: 14, fmt: "money" },
    { header: "TDS", key: "tdsAmount", width: 13, fmt: "money" },
    { header: "Net payable", key: "netPayable", width: 16, fmt: "money" },
    { header: "Paid", key: "paid", width: 15, fmt: "money" },
    { header: "Outstanding", key: "outstanding", width: 15, fmt: "money" },
  ];

  const categorySheets = () =>
    grouped
      .filter((g) => g.rows.length)
      .map((g) => ({
        name: g.type,
        title: `${g.type} spend by category`,
        meta: filterMeta(filters, [["Expense type", g.type]]),
        columns: moneyCols,
        rows: g.rows,
        totals: g.total
          ? { __label: `${g.type} total`, ...g.total, categoryName: "" }
          : null,
      }));

  // For "download all", the branch sheet carries every type and branch,
  // independent of whatever is selected inside the branch-by-branch view.
  const fullBranchSheet = () =>
    byBranchCategory.length
      ? {
          name: "By branch",
          title: "Category spend by branch",
          meta: filterMeta(filters),
          columns: [
            { header: "Branch", key: "branchName", width: 22 },
            { header: "Type", key: "expenseType", width: 10 },
            ...moneyCols,
          ],
          rows: byBranchCategory,
        }
      : null;

  const monthlySheet = () => {
    const keys = [
      ...new Set(report.monthly.map((r) => `${r.year}-${r.month}`)),
    ].sort();
    return {
      name: "Monthly spend",
      title: "Monthly spend by expense type",
      meta: filterMeta(filters),
      columns: [
        { header: "Month", key: "month", width: 12 },
        { header: "Revenue", key: "revenue", width: 16, fmt: "money" },
        { header: "Capital", key: "capital", width: 16, fmt: "money" },
        { header: "Total", key: "total", width: 16, fmt: "money" },
      ],
      rows: keys.map((k) => {
        const [y, m] = k.split("-").map(Number);
        const pick = (t) =>
          report.monthly.find(
            (r) => r.year === y && r.month === m && r.expenseType === t,
          )?.netPayable || 0;
        return {
          month: `${MONTHS[m - 1]} ${y}`,
          revenue: pick("Revenue"),
          capital: pick("Capital"),
          total: pick("Revenue") + pick("Capital"),
        };
      }),
    };
  };

  return (
    <div style={S.section}>
      {dataQuality?.typeMismatch > 0 && (
        <div
          style={{
            ...S.note,
            borderColor: "#fecaca",
            background: "#fef2f2",
            color: "#991b1b",
          }}
        >
          {num(dataQuality.typeMismatch)} invoices are filed under a category
          whose type differs from the type stored on the invoice. These figures
          follow the category.
        </div>
      )}

      <div style={S.statRow}>
        {["Revenue", "Capital"].map((t) => (
          <React.Fragment key={t}>
            <Stat label={`${t} spend`} value={fmt(summary[t]?.netPayable)} />
            <Stat
              label={`${t} invoices`}
              value={num(summary[t]?.count)}
              tone={C.muted}
            />
            <Stat
              label={`${t} outstanding`}
              value={fmt(summary[t]?.outstanding)}
              tone={C.warn}
            />
          </React.Fragment>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={S.toggleRow}>
          <button
            style={{ ...S.toggle, ...(!branchView ? S.toggleActive : {}) }}
            onClick={() => setBranchView(false)}
          >
            All branches
          </button>
          <button
            style={{ ...S.toggle, ...(branchView ? S.toggleActive : {}) }}
            onClick={() => setBranchView(true)}
          >
            Branch by branch
          </button>
        </div>
        <XlsBtn
          label="Download all sections"
          onClick={() =>
            downloadExcel({
              filename: "Expense_Analysis",
              sheets: [
                ...categorySheets(),
                fullBranchSheet(),
                report.monthly?.length ? monthlySheet() : null,
              ].filter(Boolean),
            })
          }
        />
      </div>

      {/* ── Either the category tables, or the branch view — never both ── */}
      {!branchView ? (
        grouped.map(({ type, rows, total }) => (
          <div key={type} style={S.card}>
            <CardHead
              title={`${type} — ${num(total?.count)} invoices, ${fmt(total?.netPayable)}`}
            >
              <XlsBtn
                onClick={() =>
                  downloadExcel({
                    filename: `Expense_${type}`,
                    sheets: [
                      categorySheets().find((s) => s.name === type),
                    ].filter(Boolean),
                  })
                }
              />
            </CardHead>
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  <th style={S.th}>Category</th>
                  <th style={S.thR}>Invoices</th>
                  <th style={S.thR}>Base</th>
                  <th style={S.thR}>GST</th>
                  <th style={S.thR}>TDS</th>
                  <th style={S.thR}>Net payable</th>
                  <th style={S.thR}>Paid</th>
                  <th style={S.thR}>Outstanding</th>
                  <th style={{ ...S.th, width: 130 }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={String(c.categoryId)} style={S.tr}>
                    <td style={S.td}>
                      <span style={{ fontWeight: 600 }}>{c.categoryName}</span>
                      <span style={S.code}>{c.categoryCode}</span>
                      {c.categoryStatus === "inactive" && (
                        <span style={S.defaultTag}>retired</span>
                      )}
                    </td>
                    <td style={S.tdR}>{num(c.count)}</td>
                    <td style={S.tdR}>{fmt(c.amount)}</td>
                    <td style={S.tdR}>{fmt(c.gstAmount)}</td>
                    <td style={S.tdR}>{fmt(c.tdsAmount)}</td>
                    <td style={{ ...S.tdR, fontWeight: 700 }}>
                      {fmt(c.netPayable)}
                    </td>
                    <td style={{ ...S.tdR, color: C.ok }}>{fmt(c.paid)}</td>
                    <td
                      style={{
                        ...S.tdR,
                        color: c.outstanding ? C.warn : C.muted,
                      }}
                    >
                      {fmt(c.outstanding)}
                    </td>
                    <td style={S.td}>
                      <div style={S.barTrack}>
                        <div
                          style={{
                            ...S.barFill,
                            width: `${Math.max(2, (c.netPayable / maxNet) * 100)}%`,
                            background:
                              type === "Revenue" ? "#2563eb" : "#7c3aed",
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <EmptyRow
                    cols={9}
                    text={`No ${type.toLowerCase()} spend in this period`}
                  />
                )}
              </tbody>
            </table>
          </div>
        ))
      ) : (
        <BranchByBranch rows={byBranchCategory} />
      )}

      {report.monthly?.length > 0 && (
        <div style={S.card}>
          <CardHead title="Monthly spend">
            <XlsBtn
              onClick={() =>
                downloadExcel({
                  filename: "Expense_Monthly",
                  sheets: [monthlySheet()],
                })
              }
            />
          </CardHead>
          <MonthlyTrend rows={report.monthly} />
        </div>
      )}
    </div>
  );
}

// ── Branch-by-branch, filtered by expense type and branch ───
// Both dropdowns are populated from the rows actually returned, so they
// can never offer a combination that has no data behind it.
function BranchByBranch({ rows = [] }) {
  const ORDER = ["Revenue", "Capital"];
  const types = [
    ...new Set(rows.map((r) => r.expenseType).filter(Boolean)),
  ].sort((a, b) => {
    const ai = ORDER.indexOf(a);
    const bi = ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const [type, setType] = useState(() => types[0] || "");
  const [branchId, setBranchId] = useState("");

  // Keep the selections valid when the page filters change the data
  // underneath — otherwise the table silently empties.
  useEffect(() => {
    if (types.length && !types.includes(type)) {
      setType(types[0]);
      setBranchId("");
    }
  }, [types.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const forType = rows.filter((r) => r.expenseType === type);

  const branches = [
    ...new Map(
      forType.map((r) => [
        String(r.branchId),
        { id: String(r.branchId), name: r.branchName },
      ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (branchId && !branches.some((b) => b.id === branchId)) setBranchId("");
  }, [branches.map((b) => b.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = branchId
    ? forType.filter((r) => String(r.branchId) === branchId)
    : forType;
  const allBranches = !branchId;

  // Branch name, then largest spend first inside each branch.
  const sorted = [...visible].sort((a, b) =>
    allBranches && a.branchName !== b.branchName
      ? a.branchName.localeCompare(b.branchName)
      : b.netPayable - a.netPayable,
  );

  const sum = (list, k) => list.reduce((s, r) => s + (r[k] || 0), 0);
  const totals = {
    count: sum(visible, "count"),
    amount: sum(visible, "amount"),
    gstAmount: sum(visible, "gstAmount"),
    tdsAmount: sum(visible, "tdsAmount"),
    netPayable: sum(visible, "netPayable"),
    paid: sum(visible, "paid"),
    outstanding: sum(visible, "outstanding"),
  };

  const selectedBranchName = branches.find((b) => b.id === branchId)?.name;

  const sheet = () => ({
    name: `${type} by branch`,
    title: `${type} spend — ${selectedBranchName || "all branches"}`,
    meta: filterMeta({}, [
      ["Expense type", type],
      ["Branch", selectedBranchName || "All branches"],
    ]),
    columns: [
      ...(allBranches
        ? [{ header: "Branch", key: "branchName", width: 22 }]
        : []),
      { header: "Code", key: "categoryCode", width: 10 },
      { header: "Category", key: "categoryName", width: 34 },
      { header: "Invoices", key: "count", width: 10, fmt: "int" },
      { header: "Base", key: "amount", width: 16, fmt: "money" },
      { header: "GST", key: "gstAmount", width: 14, fmt: "money" },
      { header: "TDS", key: "tdsAmount", width: 13, fmt: "money" },
      { header: "Net payable", key: "netPayable", width: 16, fmt: "money" },
      { header: "Paid", key: "paid", width: 15, fmt: "money" },
      { header: "Outstanding", key: "outstanding", width: 15, fmt: "money" },
    ],
    rows: sorted,
    totals: { __label: selectedBranchName || "All branches", ...totals },
  });

  return (
    <div style={S.card}>
      <div style={S.branchHead}>
        <div style={S.cardTitle}>
          {type} spend — {selectedBranchName || "all branches"}
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <Field label="Expense type">
            <select
              style={S.input}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Branch">
            <select
              style={S.input}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <XlsBtn
            onClick={() =>
              downloadExcel({
                filename: `Expense_${type}_By_Branch`,
                sheets: [sheet()],
              })
            }
          />
        </div>
      </div>

      {!sorted.length ? (
        <div style={{ padding: 34, textAlign: "center", color: "#94a3b8" }}>
          No {String(type).toLowerCase()} spend
          {selectedBranchName ? ` at ${selectedBranchName}` : ""} in this period
        </div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              {allBranches && <th style={S.th}>Branch</th>}
              <th style={S.th}>Category</th>
              <th style={S.thR}>Invoices</th>
              <th style={S.thR}>Base</th>
              <th style={S.thR}>GST</th>
              <th style={S.thR}>TDS</th>
              <th style={S.thR}>Net payable</th>
              <th style={S.thR}>Paid</th>
              <th style={S.thR}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              // With every branch shown, print the name once per group
              // and close each group with its own subtotal.
              const prev = sorted[i - 1];
              const next = sorted[i + 1];
              const firstOfBranch =
                allBranches && prev?.branchName !== r.branchName;
              const lastOfBranch =
                allBranches && next?.branchName !== r.branchName;
              const group = allBranches
                ? sorted.filter((x) => x.branchName === r.branchName)
                : [];

              return (
                <React.Fragment key={`${r.branchId}-${r.categoryId}`}>
                  <tr style={S.tr}>
                    {allBranches && (
                      <td style={{ ...S.td, fontWeight: 600 }}>
                        {firstOfBranch ? r.branchName : ""}
                      </td>
                    )}
                    <td style={S.td}>
                      {r.categoryName}
                      <span style={S.code}>{r.categoryCode}</span>
                    </td>
                    <td style={S.tdR}>{num(r.count)}</td>
                    <td style={S.tdR}>{fmt(r.amount)}</td>
                    <td style={S.tdR}>{fmt(r.gstAmount)}</td>
                    <td style={S.tdR}>{fmt(r.tdsAmount)}</td>
                    <td style={{ ...S.tdR, fontWeight: 700 }}>
                      {fmt(r.netPayable)}
                    </td>
                    <td style={{ ...S.tdR, color: C.ok }}>{fmt(r.paid)}</td>
                    <td
                      style={{
                        ...S.tdR,
                        color: r.outstanding ? C.warn : C.muted,
                      }}
                    >
                      {fmt(r.outstanding)}
                    </td>
                  </tr>
                  {lastOfBranch && group.length > 1 && (
                    <tr style={S.subtotalRow}>
                      <td style={S.td} />
                      <td
                        style={{ ...S.td, color: C.muted, fontStyle: "italic" }}
                      >
                        {r.branchName} subtotal
                      </td>
                      <td style={{ ...S.tdR, fontWeight: 600 }}>
                        {num(sum(group, "count"))}
                      </td>
                      <td style={{ ...S.tdR, fontWeight: 600 }}>
                        {fmt(sum(group, "amount"))}
                      </td>
                      <td style={{ ...S.tdR, fontWeight: 600 }}>
                        {fmt(sum(group, "gstAmount"))}
                      </td>
                      <td style={{ ...S.tdR, fontWeight: 600 }}>
                        {fmt(sum(group, "tdsAmount"))}
                      </td>
                      <td style={{ ...S.tdR, fontWeight: 700 }}>
                        {fmt(sum(group, "netPayable"))}
                      </td>
                      <td style={{ ...S.tdR, fontWeight: 600 }}>
                        {fmt(sum(group, "paid"))}
                      </td>
                      <td style={{ ...S.tdR, fontWeight: 600 }}>
                        {fmt(sum(group, "outstanding"))}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            <tr style={S.totalRow}>
              {allBranches && <td style={S.td} />}
              <td style={{ ...S.td, fontWeight: 700 }}>
                {selectedBranchName || "All branches"} total
              </td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>{num(totals.count)}</td>
              <td colSpan={3} />
              <td style={{ ...S.tdR, fontWeight: 700 }}>
                {fmt(totals.netPayable)}
              </td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>{fmt(totals.paid)}</td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>
                {fmt(totals.outstanding)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function MonthlyTrend({ rows }) {
  const keys = [...new Set(rows.map((r) => `${r.year}-${r.month}`))].sort();
  const max = Math.max(1, ...rows.map((r) => r.netPayable));

  return (
    <div style={S.trendWrap}>
      {keys.map((k) => {
        const [y, m] = k.split("-").map(Number);
        const rev = rows.find(
          (r) => r.year === y && r.month === m && r.expenseType === "Revenue",
        );
        const cap = rows.find(
          (r) => r.year === y && r.month === m && r.expenseType === "Capital",
        );
        const total = (rev?.netPayable || 0) + (cap?.netPayable || 0);
        return (
          <div
            key={k}
            style={S.trendCol}
            title={`${MONTHS[m - 1]} ${y}: ${fmt(total)}`}
          >
            <div style={S.trendAmt}>{fmt(total)}</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
              <div
                style={{
                  ...S.trendBar,
                  background: "#2563eb",
                  height: Math.max(3, ((rev?.netPayable || 0) / max) * 150),
                }}
              />
              <div
                style={{
                  ...S.trendBar,
                  background: "#7c3aed",
                  height: Math.max(3, ((cap?.netPayable || 0) / max) * 150),
                }}
              />
            </div>
            <div style={S.trendLabel}>
              {MONTHS[m - 1]} {String(y).slice(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────
const Stat = ({ label, value, tone = C.primary }) => (
  <div style={S.stat}>
    <div style={{ ...S.statValue, color: tone }}>{value}</div>
    <div style={S.statLabel}>{label}</div>
  </div>
);

const EmptyRow = ({ cols, text }) => (
  <tr>
    <td
      colSpan={cols}
      style={{ padding: 28, textAlign: "center", color: "#94a3b8" }}
    >
      {text}
    </td>
  </tr>
);

const Field = ({ label, children }) => (
  <label style={S.field}>
    <span style={S.fieldLabel}>{label}</span>
    {children}
  </label>
);

const XlsBtn = ({ onClick, label = "Excel" }) => (
  <button style={S.xlsBtn} onClick={onClick} title="Download this section">
    ⬇ {label}
  </button>
);

const CardHead = ({ title, children }) => (
  <div style={S.cardHead}>
    <div style={S.cardTitle}>{title}</div>
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  </div>
);

// ── Styles ──────────────────────────────────────────────────
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", minWidth: 0 },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: C.muted, margin: "4px 0 0", maxWidth: "60ch" },
  linkBtn: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 13,
    color: C.primary,
    fontWeight: 600,
    cursor: "pointer",
  },
  filterBar: {
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    flexWrap: "wrap",
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "14px 16px",
    marginBottom: 16,
  },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: { fontSize: 12, color: C.muted, fontWeight: 600 },
  input: {
    padding: "8px 10px",
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    fontSize: 13,
    minWidth: 150,
    background: "#fff",
  },
  applyBtn: {
    padding: "9px 18px",
    background: C.primary,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
  },
  clearBtn: {
    padding: "9px 14px",
    background: "none",
    border: "none",
    color: C.muted,
    fontSize: 13,
    cursor: "pointer",
  },
  filterHint: { fontSize: 12, color: C.warn, alignSelf: "center" },
  tabs: { display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" },
  tab: {
    padding: "9px 16px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 8,
    fontSize: 13,
    color: C.muted,
    cursor: "pointer",
    fontWeight: 600,
  },
  tabActive: { background: C.primary, color: "#fff", borderColor: C.primary },
  section: { display: "flex", flexDirection: "column", gap: 16 },
  statRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },
  stat: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "16px 18px",
  },
  statValue: { fontSize: 21, fontWeight: 700, marginBottom: 3 },
  statLabel: { fontSize: 12, color: C.muted },
  card: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "18px 20px",
    overflowX: "auto",
  },
  cardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 0,
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
    marginBottom: 14,
  },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  empty: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: 48,
    textAlign: "center",
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
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "10px", color: "#334155" },
  tdR: {
    padding: "10px",
    color: "#334155",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  drawer: { padding: "14px 16px", background: "#f8fafc" },
  code: {
    marginLeft: 8,
    fontSize: 11,
    fontFamily: "monospace",
    color: "#94a3b8",
  },
  defaultTag: {
    marginLeft: 8,
    fontSize: 11,
    color: C.muted,
    background: "#f1f5f9",
    borderRadius: 4,
    padding: "1px 6px",
  },
  barTrack: {
    height: 8,
    background: "#f1f5f9",
    borderRadius: 5,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 5 },
  toggleRow: { display: "flex", gap: 6, flexWrap: "wrap" },
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
  matrixHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  branchHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 14,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  stickyHead: {
    position: "sticky",
    left: 0,
    background: "#fff",
    zIndex: 2,
    minWidth: 170,
  },
  stickyCell: {
    position: "sticky",
    left: 0,
    background: "#fff",
    zIndex: 1,
    fontWeight: 600,
    minWidth: 170,
  },
  totalCol: { borderLeft: `2px solid ${C.line}`, background: "#fbfdff" },
  totalRow: { borderTop: `2px solid ${C.line}`, background: "#f8fafc" },
  subtotalRow: { borderBottom: `1px solid ${C.line}`, background: "#fafbfc" },
  slaHint: { fontSize: 10, fontWeight: 500, color: "#94a3b8", marginTop: 2 },
  trendWrap: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    overflowX: "auto",
    padding: "8px 0",
    minHeight: 210,
  },
  trendCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    minWidth: 66,
  },
  trendAmt: { fontSize: 10, color: C.muted, fontWeight: 600 },
  trendBar: { width: 16, borderRadius: "3px 3px 0 0" },
  trendLabel: { fontSize: 10, color: "#94a3b8" },
};
