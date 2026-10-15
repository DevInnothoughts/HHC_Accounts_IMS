// ============================================================
// FRONTEND: src/pages/AuditLogs.jsx — REPLACE WHOLE FILE
// ------------------------------------------------------------
// Two modes:
//   Activity  — chronological feed, grouped by day, each row a sentence
//   Trail     — everything that happened to one invoice or payment
// ============================================================
import { useState, useEffect, useCallback } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { roleLabel } from "../utils/roleLabel.js";

const C = {
  primary: "#1a3c6e",
  ok: "#16a34a",
  warn: "#d97706",
  bad: "#dc2626",
  muted: "#64748b",
  line: "#e2e8f0",
};

const TONE = {
  positive: { dot: C.ok, bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" },
  negative: { dot: C.bad, bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" },
  warning: { dot: C.warn, bg: "#fffbeb", border: "#fde68a", text: "#b45309" },
  neutral: { dot: "#64748b", bg: "#f8fafc", border: C.line, text: "#475569" },
};


const fmt = (n) =>
  n === null || n === undefined
    ? null
    : `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;

const time = (d) =>
  new Date(d).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

const dayKey = (d) => new Date(d).toDateString();

const dayLabel = (d) => {
  const date = new Date(d);
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 864e5).toDateString();
  if (date.toDateString() === today) return "Today";
  if (date.toDateString() === yest) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const initials = (name) =>
  String(name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export default function AuditLogs() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("activity");

  const BLANK = {
    module: "",
    action: "",
    user: "",
    branch: "",
    from: "",
    to: "",
    q: "",
  };
  const [draft, setDraft] = useState(BLANK);
  const [filters, setFilters] = useState(BLANK);
  const [page, setPage] = useState(1);

  const [data, setData] = useState({
    logs: [],
    total: 0,
    pages: 1,
    moduleStats: [],
  });
  const [options, setOptions] = useState({
    modules: [],
    actions: [],
    users: [],
    branches: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);

  const [ref, setRef] = useState("");
  const [trail, setTrail] = useState(null);
  const [trailLoading, setTrailLoading] = useState(false);

  const qs = useCallback(
    (extra = {}) =>
      new URLSearchParams(
        Object.fromEntries(
          Object.entries({ ...filters, ...extra }).filter(([, v]) => v),
        ),
      ).toString(),
    [filters],
  );

  useEffect(() => {
    api
      .get("/reports/audit-logs/filters")
      .then(({ data }) => setOptions(data))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(
        `/reports/audit-logs?${qs({ page, limit: 40 })}`,
      );
      setData(data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [qs, page]);

  useEffect(() => {
    if (mode === "activity") load();
  }, [load, mode]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = () => {
    setPage(1);
    setFilters(draft);
  };
  const reset = () => {
    setDraft(BLANK);
    setFilters(BLANK);
    setPage(1);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);

  const exportExcel = async () => {
    try {
      const res = await api.get(`/reports/audit-logs/export-excel?${qs()}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Audit_Trail_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("The workbook could not be generated.");
    }
  };

  const loadTrail = async (type = "Invoice") => {
    if (!ref.trim()) return;
    setTrailLoading(true);
    setError("");
    setTrail(null);
    try {
      const { data } = await api.get(
        `/reports/audit-logs/trail?type=${type}&ref=${encodeURIComponent(ref.trim())}`,
      );
      setTrail(data);
    } catch (err) {
      setError(
        err.response?.data?.message || "Nothing found for that reference.",
      );
    } finally {
      setTrailLoading(false);
    }
  };

  // Group the feed by day.
  const days = [];
  (data.logs || []).forEach((l) => {
    const k = dayKey(l.at);
    const last = days[days.length - 1];
    if (last && last.key === k) last.items.push(l);
    else days.push({ key: k, label: dayLabel(l.at), items: [l] });
  });

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>Audit trail</h1>
            <p style={S.sub}>
              Who did what, to which record, and when.{" "}
              {data.total.toLocaleString("en-IN")} entries.
            </p>
          </div>
          <button style={S.exportBtn} onClick={exportExcel}>
            ⬇ Export to Excel
          </button>
        </div>

        <div style={S.modeRow}>
          {[
            ["activity", "Activity feed"],
            ["trail", "Follow one record"],
          ].map(([k, l]) => (
            <button
              key={k}
              style={{ ...S.mode, ...(mode === k ? S.modeActive : {}) }}
              onClick={() => setMode(k)}
            >
              {l}
            </button>
          ))}
        </div>

        {error && <div style={S.error}>{error}</div>}

        {mode === "trail" ? (
          <TrailView
            ref_={ref}
            setRef={setRef}
            onSearch={loadTrail}
            loading={trailLoading}
            trail={trail}
            navigate={navigate}
          />
        ) : (
          <>
            {/* Filters */}
            <div style={S.filterBar}>
              <F label="Reference">
                <input
                  style={S.input}
                  placeholder="INV-000444"
                  value={draft.q}
                  onChange={set("q")}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                />
              </F>
              <F label="Module">
                <select
                  style={S.input}
                  value={draft.module}
                  onChange={set("module")}
                >
                  <option value="">All modules</option>
                  {options.modules.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Action">
                <select
                  style={S.input}
                  value={draft.action}
                  onChange={set("action")}
                >
                  <option value="">All actions</option>
                  {options.actions.map((a) => (
                    <option key={a} value={a}>
                      {a.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </F>
              <F label="User">
                <select
                  style={S.input}
                  value={draft.user}
                  onChange={set("user")}
                >
                  <option value="">Anyone</option>
                  {options.users.map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name} — {roleLabel(u)}
                    </option>
                  ))}
                </select>
              </F>
              <F label="From">
                <input
                  type="date"
                  style={S.input}
                  value={draft.from}
                  onChange={set("from")}
                />
              </F>
              <F label="To">
                <input
                  type="date"
                  style={S.input}
                  value={draft.to}
                  onChange={set("to")}
                />
              </F>
              <button style={S.applyBtn} onClick={apply}>
                {dirty ? "Apply changes" : "Apply"}
              </button>
              <button style={S.clearBtn} onClick={reset}>
                Clear
              </button>
            </div>

            {/* Module chips */}
            {data.moduleStats?.length > 0 && (
              <div style={S.chipRow}>
                <button
                  style={{
                    ...S.chip,
                    ...(!filters.module ? S.chipActive : {}),
                  }}
                  onClick={() => {
                    setDraft((d) => ({ ...d, module: "" }));
                    setFilters((f) => ({ ...f, module: "" }));
                    setPage(1);
                  }}
                >
                  All <span style={S.chipCount}>{data.total}</span>
                </button>
                {data.moduleStats
                  .filter((m) => m._id)
                  .map((m) => (
                    <button
                      key={m._id}
                      style={{
                        ...S.chip,
                        ...(filters.module === m._id ? S.chipActive : {}),
                      }}
                      onClick={() => {
                        setDraft((d) => ({ ...d, module: m._id }));
                        setFilters((f) => ({ ...f, module: m._id }));
                        setPage(1);
                      }}
                    >
                      {m._id} <span style={S.chipCount}>{m.count}</span>
                    </button>
                  ))}
              </div>
            )}

            {loading && !data.logs.length ? (
              <div style={S.loading}>Loading…</div>
            ) : !data.logs.length ? (
              <div style={S.empty}>
                <div style={{ fontWeight: 600, color: "#475569" }}>
                  Nothing matches these filters
                </div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
                  Entries older than the retention window are removed
                  automatically.
                </div>
              </div>
            ) : (
              <div style={{ opacity: loading ? 0.5 : 1 }}>
                {days.map((d) => (
                  <div key={d.key} style={S.dayBlock}>
                    <div style={S.dayHead}>
                      <span style={S.dayLabel}>{d.label}</span>
                      <span style={S.dayCount}>{d.items.length} entries</span>
                    </div>
                    <div style={S.card}>
                      {d.items.map((l, i) => (
                        <EventRow
                          key={l._id}
                          log={l}
                          last={i === d.items.length - 1}
                          expanded={open === l._id}
                          onToggle={() =>
                            setOpen(open === l._id ? null : l._id)
                          }
                          navigate={navigate}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {data.pages > 1 && (
                  <div style={S.pager}>
                    <button
                      style={S.pageBtn}
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <span style={{ fontSize: 13, color: C.muted }}>
                      Page {data.page} of {data.pages}
                    </span>
                    <button
                      style={S.pageBtn}
                      disabled={page >= data.pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── One event ───────────────────────────────────────────────
function EventRow({ log, last, expanded, onToggle, navigate }) {
  const tone = TONE[log.tone] || TONE.neutral;
  const amount = fmt(log.amount);

  return (
    <div
      style={{ ...S.row, borderBottom: last ? "none" : `1px solid #f1f5f9` }}
    >
      <div style={S.rowTime}>{time(log.at)}</div>
      <div
        style={{
          ...S.avatar,
          background: tone.bg,
          color: tone.text,
          borderColor: tone.border,
        }}
      >
        {initials(log.actor.name)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.rowMain}>
          <span style={{ fontWeight: 600, color: "#0f172a" }}>
            {log.actor.name}
          </span>
          {log.actor.role && (
            <span style={S.roleTag}>
              {roleLabel(log.actor)}
            </span>
          )}
          <span style={{ color: tone.text, fontWeight: 600 }}>
            {log.summary.replace(`${log.actor.name} `, "")}
          </span>
          {log.target?.link && (
            <button
              style={S.refBtn}
              onClick={(e) => {
                e.stopPropagation();
                navigate(log.target.link);
              }}
            >
              Open ↗
            </button>
          )}
          {log.target && !log.target.exists && (
            <span style={S.deletedTag}>record deleted</span>
          )}
        </div>

        <div style={S.rowMeta}>
          {log.branch && <span>{log.branch}</span>}
          {log.vendor && <span>{log.vendor}</span>}
          {amount && (
            <span style={{ fontWeight: 600, color: "#334155" }}>{amount}</span>
          )}
          {log.stage && <span>at {log.stage}</span>}
          {(log.statusFrom || log.statusTo) && (
            <span>
              {log.statusFrom || "?"} → <strong>{log.statusTo || "?"}</strong>
            </span>
          )}
        </div>

        {log.reason && (
          <div
            style={{
              ...S.reason,
              background: tone.bg,
              borderColor: tone.border,
            }}
          >
            <strong style={{ color: tone.text }}>
              {log.tone === "negative" ? "Reason" : "Remarks"}:
            </strong>{" "}
            {log.reason}
          </div>
        )}

        {expanded && (
          <div style={S.details}>
            {log.changes && (
              <div style={{ marginBottom: 10 }}>
                <div style={S.detailLabel}>Field changes</div>
                <pre style={S.pre}>
                  {JSON.stringify(
                    { before: log.changes.old, after: log.changes.new },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
            <div style={S.detailGrid}>
              <div>
                <span style={S.detailLabel}>Action</span>
                {log.action}
              </div>
              <div>
                <span style={S.detailLabel}>Module</span>
                {log.module}
              </div>
              <div>
                <span style={S.detailLabel}>Email</span>
                {log.actor.email || "—"}
              </div>
              <div>
                <span style={S.detailLabel}>IP</span>
                {log.ipAddress || "—"}
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={S.detailLabel}>Device</span>
                <span style={{ fontSize: 11, color: C.muted }}>
                  {log.deviceInfo || "—"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <button style={S.chevron} onClick={onToggle} title="Technical detail">
        {expanded ? "▴" : "▾"}
      </button>
    </div>
  );
}

// ── Trail ───────────────────────────────────────────────────
function TrailView({ ref_, setRef, onSearch, loading, trail, navigate }) {
  const [type, setType] = useState("Invoice");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={S.filterBar}>
        <F label="Record type">
          <select
            style={S.input}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="Invoice">Invoice</option>
            <option value="Payment">Payment</option>
          </select>
        </F>
        <F label={type === "Invoice" ? "Request ID" : "Payment ID"}>
          <input
            style={{ ...S.input, minWidth: 220 }}
            placeholder={type === "Invoice" ? "INV-000444" : "PAY-000231"}
            value={ref_}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch(type)}
          />
        </F>
        <button style={S.applyBtn} onClick={() => onSearch(type)}>
          Show trail
        </button>
      </div>

      {loading ? (
        <div style={S.loading}>Loading…</div>
      ) : !trail ? (
        <div style={S.empty}>
          <div style={{ fontWeight: 600, color: "#475569" }}>
            Enter a reference to see its full history
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
            Audit entries and workflow approvals are merged into one timeline.
          </div>
        </div>
      ) : (
        <>
          <div style={S.card}>
            <div style={S.entityHead}>
              <div>
                <div
                  style={{ fontSize: 18, fontWeight: 700, color: C.primary }}
                >
                  {trail.entity.label}
                </div>
                <div style={S.rowMeta}>
                  {trail.entity.branch && <span>{trail.entity.branch}</span>}
                  {trail.entity.vendor && <span>{trail.entity.vendor}</span>}
                  {trail.entity.amount != null && (
                    <span style={{ fontWeight: 600, color: "#334155" }}>
                      {fmt(trail.entity.amount)}
                    </span>
                  )}
                  {trail.entity.createdBy && (
                    <span>raised by {trail.entity.createdBy}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={S.statusPill}>{trail.entity.status}</span>
                <button
                  style={S.refBtn}
                  onClick={() => navigate(trail.entity.link)}
                >
                  Open record ↗
                </button>
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>{trail.events.length} events</div>
            {trail.events.map((e, i) => {
              const tone = TONE[e.tone] || TONE.neutral;
              return (
                <div key={e._id} style={S.timelineRow}>
                  <div style={S.timelineRail}>
                    <div style={{ ...S.timelineDot, background: tone.dot }} />
                    {i < trail.events.length - 1 && (
                      <div style={S.timelineLine} />
                    )}
                  </div>
                  <div style={{ paddingBottom: 20, flex: 1 }}>
                    <div
                      style={{ fontSize: 12, color: C.muted, marginBottom: 3 }}
                    >
                      {new Date(e.at).toLocaleString("en-GB")}
                      {e.source === "workflow" && (
                        <span style={S.sourceTag}>from workflow history</span>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>
                      {e.actor.name}
                      {e.actor.role && (
                        <span style={S.roleTag}>
                          {roleLabel(e.actor)}
                        </span>
                      )}
                      <span style={{ color: tone.text, marginLeft: 6 }}>
                        {e.summary.replace(`${e.actor.name} `, "")}
                      </span>
                    </div>
                    {e.stage && (
                      <div
                        style={{ fontSize: 12, color: C.muted, marginTop: 2 }}
                      >
                        {e.stage}
                      </div>
                    )}
                    {e.reason && (
                      <div
                        style={{
                          ...S.reason,
                          background: tone.bg,
                          borderColor: tone.border,
                        }}
                      >
                        {e.reason}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const F = ({ label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
      {label}
    </span>
    {children}
  </label>
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
    marginBottom: 16,
    flexWrap: "wrap",
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: C.muted, margin: "4px 0 0" },
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
  modeRow: { display: "flex", gap: 6, marginBottom: 16 },
  mode: {
    padding: "9px 16px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 8,
    fontSize: 13,
    color: C.muted,
    cursor: "pointer",
    fontWeight: 600,
  },
  modeActive: { background: C.primary, color: "#fff", borderColor: C.primary },
  filterBar: {
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    flexWrap: "wrap",
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "14px 16px",
    marginBottom: 14,
  },
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
    cursor: "pointer",
  },
  clearBtn: {
    padding: "9px 14px",
    background: "none",
    border: "none",
    color: C.muted,
    fontSize: 13,
    cursor: "pointer",
  },
  chipRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 },
  chip: {
    padding: "6px 12px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 20,
    fontSize: 12,
    color: C.muted,
    cursor: "pointer",
    fontWeight: 600,
  },
  chipActive: {
    background: "#eff6ff",
    color: "#2563eb",
    borderColor: "#bfdbfe",
  },
  chipCount: { marginLeft: 6, color: "#94a3b8", fontWeight: 500 },
  dayBlock: { marginBottom: 20 },
  dayHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
    padding: "0 4px",
  },
  dayLabel: { fontSize: 13, fontWeight: 700, color: C.primary },
  dayCount: { fontSize: 12, color: "#94a3b8" },
  card: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    overflow: "hidden",
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: C.primary,
    padding: "16px 20px 6px",
  },
  row: {
    display: "flex",
    gap: 12,
    padding: "13px 18px",
    alignItems: "flex-start",
  },
  rowTime: {
    fontSize: 12,
    color: "#94a3b8",
    width: 42,
    paddingTop: 7,
    flexShrink: 0,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "1px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  rowMain: {
    display: "flex",
    gap: 7,
    alignItems: "center",
    flexWrap: "wrap",
    fontSize: 13.5,
    lineHeight: 1.5,
  },
  rowMeta: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    fontSize: 12,
    color: C.muted,
    marginTop: 4,
  },
  roleTag: {
    fontSize: 10.5,
    background: "#f1f5f9",
    color: "#64748b",
    borderRadius: 4,
    padding: "2px 6px",
    fontWeight: 600,
    marginLeft: 4,
  },
  refBtn: {
    background: "none",
    border: "none",
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
  },
  deletedTag: {
    fontSize: 10.5,
    background: "#fef2f2",
    color: "#b91c1c",
    borderRadius: 4,
    padding: "2px 6px",
    fontWeight: 600,
  },
  reason: {
    marginTop: 7,
    padding: "8px 11px",
    border: "1px solid",
    borderRadius: 7,
    fontSize: 12.5,
    color: "#334155",
    maxWidth: "80ch",
  },
  details: {
    marginTop: 10,
    padding: "12px 14px",
    background: "#f8fafc",
    borderRadius: 8,
    border: `1px solid ${C.line}`,
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 10,
    fontSize: 12,
    color: "#334155",
  },
  detailLabel: {
    display: "block",
    fontSize: 10.5,
    color: "#94a3b8",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  pre: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 6,
    padding: 10,
    fontSize: 11,
    overflowX: "auto",
    margin: 0,
    color: "#334155",
  },
  chevron: {
    background: "none",
    border: "none",
    color: "#cbd5e1",
    cursor: "pointer",
    fontSize: 13,
    padding: "4px 6px",
    flexShrink: 0,
  },
  entityHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    padding: "18px 20px",
    flexWrap: "wrap",
  },
  statusPill: {
    fontSize: 12,
    fontWeight: 600,
    background: "#eff6ff",
    color: "#2563eb",
    borderRadius: 6,
    padding: "4px 10px",
  },
  timelineRow: { display: "flex", gap: 14, padding: "0 20px" },
  timelineRail: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: 12,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    marginTop: 5,
    flexShrink: 0,
  },
  timelineLine: { width: 2, flex: 1, background: C.line, marginTop: 3 },
  sourceTag: {
    marginLeft: 8,
    fontSize: 10.5,
    color: "#94a3b8",
    fontStyle: "italic",
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
  pager: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    padding: "14px 0",
  },
  pageBtn: {
    padding: "7px 14px",
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
  },
};
