// ============================================================
// FRONTEND: src/pages/AuditLogs.jsx — Complete Audit Log Page
// ============================================================
import { useState, useEffect, useCallback } from "react";
import React from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";

const MODULES = ["", "Payment", "Vendor", "User", "Branch"];
const ACTION_COLORS = {
  LOGIN: { bg: "#eff6ff", color: "#2563eb" },
  CREATE_PAYMENT_REQUEST: { bg: "#f0fdf4", color: "#16a34a" },
  APPROVE_REQUEST: { bg: "#f0fdf4", color: "#16a34a" },
  REJECT_REQUEST: { bg: "#fef2f2", color: "#dc2626" },
  BULK_APPROVE: { bg: "#f0fdf4", color: "#15803d" },
  CREATE_VENDOR: { bg: "#f0fdf4", color: "#16a34a" },
  UPDATE_VENDOR: { bg: "#fefce8", color: "#d97706" },
  DELETE_VENDOR: { bg: "#fef2f2", color: "#dc2626" },
  VENDOR_STATUS_BLACKLISTED: { bg: "#fef2f2", color: "#dc2626" },
  CREATE_USER: { bg: "#f0fdf4", color: "#16a34a" },
  UPDATE_USER: { bg: "#fefce8", color: "#d97706" },
  USER_INACTIVE: { bg: "#fef2f2", color: "#dc2626" },
  USER_ACTIVE: { bg: "#f0fdf4", color: "#16a34a" },
  CREATE_BRANCH: { bg: "#f0fdf4", color: "#16a34a" },
  UPDATE_BRANCH: { bg: "#fefce8", color: "#d97706" },
  UPLOAD_ATTACHMENT: { bg: "#eff6ff", color: "#2563eb" },
  UPLOAD_VENDOR_DOCUMENT: { bg: "#eff6ff", color: "#2563eb" },
};

const MODULE_ICONS = {
  Auth: "🔐",
  Payment: "💳",
  Vendor: "🏢",
  User: "👥",
  Branch: "🏥",
  Upload: "📎",
};

const ROLE_COLORS = {
  branch_user: "#2563eb",
  branch_partner: "#7c3aed",
  cluster_head: "#d97706",
  accounts: "#16a34a",
  director: "#dc2626",
  super_admin: "#0f172a",
};

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [stats, setStats] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    module: "",
    action: "",
    from: "",
    to: "",
  });
  const [expandedLog, setExpandedLog] = useState(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: 25,
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      });
      const { data } = await api.get(`/reports/audit-logs?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
      setPages(data.pages);
      setStats(data.actionStats || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const handleReset = () => {
    setFilters({ module: "", action: "", from: "", to: "" });
    setPage(1);
  };

  const getActionStyle = (action) =>
    ACTION_COLORS[action] || { bg: "#f1f5f9", color: "#475569" };

  const formatDate = (date) =>
    new Date(date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        {/* Header */}
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>🔍 Audit Logs</h1>
            <p style={S.sub}>
              Complete activity trail · {total.toLocaleString()} total records
            </p>
          </div>
          <button
            style={S.exportBtn}
            onClick={() => alert("Export feature — implement CSV download")}
          >
            ⬇ Export CSV
          </button>
        </div>

        {/* Module Stats */}
        {stats.length > 0 && (
          <div style={S.statsRow}>
            {stats.map((s) => (
              <div key={s._id} style={S.statChip}>
                <span style={S.statIcon}>{MODULE_ICONS[s._id] || "📌"}</span>
                <span style={S.statModule}>{s._id || "Unknown"}</span>
                <span style={S.statCount}>{s.count}</span>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div style={S.filterCard}>
          <div style={S.filterGrid}>
            <div style={S.filterGroup}>
              <label style={S.filterLabel}>Module</label>
              <select
                style={S.select}
                value={filters.module}
                onChange={setFilter("module")}
              >
                {MODULES.map((m) => (
                  <option key={m} value={m}>
                    {m || "All Modules"}
                  </option>
                ))}
              </select>
            </div>
            <div style={S.filterGroup}>
              <label style={S.filterLabel}>Action Search</label>
              <input
                style={S.input}
                placeholder="e.g. APPROVE, LOGIN..."
                value={filters.action}
                onChange={setFilter("action")}
              />
            </div>
            <div style={S.filterGroup}>
              <label style={S.filterLabel}>From Date</label>
              <input
                type="date"
                style={S.input}
                value={filters.from}
                onChange={setFilter("from")}
              />
            </div>
            <div style={S.filterGroup}>
              <label style={S.filterLabel}>To Date</label>
              <input
                type="date"
                style={S.input}
                value={filters.to}
                onChange={setFilter("to")}
              />
            </div>
          </div>
          <div style={S.filterActions}>
            <button style={S.applyBtn} onClick={fetchLogs}>
              Apply Filters
            </button>
            <button style={S.resetBtn} onClick={handleReset}>
              Reset
            </button>
          </div>
        </div>

        {/* Logs Table */}
        <div style={S.tableCard}>
          {loading ? (
            <div style={S.loading}>
              <div style={S.loadingSpinner} />
              <span>Loading audit logs...</span>
            </div>
          ) : logs.length === 0 ? (
            <div style={S.empty}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
              <div style={{ fontWeight: 600, color: "#475569" }}>
                No audit logs found
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
                Try adjusting your filters
              </div>
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  <th style={S.th}>Timestamp</th>
                  <th style={S.th}>User</th>
                  <th style={S.th}>Role</th>
                  <th style={S.th}>Action</th>
                  <th style={S.th}>Module</th>
                  <th style={S.th}>IP Address</th>
                  <th style={S.th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const as = getActionStyle(log.action);
                  const isExpanded = expandedLog === log._id;
                  const hasData = log.oldValue || log.newValue;

                  return (
                    <>
                      <tr
                        key={log._id}
                        style={{
                          ...S.tr,
                          background: isExpanded ? "#f8faff" : "#fff",
                        }}
                        onClick={() =>
                          hasData && setExpandedLog(isExpanded ? null : log._id)
                        }
                      >
                        {/* Timestamp */}
                        <td style={S.td}>
                          <div style={S.timestamp}>
                            {formatDate(log.createdAt)}
                          </div>
                        </td>

                        {/* User */}
                        <td style={S.td}>
                          {log.user ? (
                            <div style={S.userCell}>
                              <div
                                style={{
                                  ...S.avatar,
                                  background:
                                    (ROLE_COLORS[log.user?.role] || "#94a3b8") +
                                    "20",
                                  color:
                                    ROLE_COLORS[log.user?.role] || "#94a3b8",
                                }}
                              >
                                {log.user?.name?.[0]?.toUpperCase() || "?"}
                              </div>
                              <div>
                                <div style={S.userName}>
                                  {log.user?.name || "Unknown"}
                                </div>
                                <div style={S.userEmail}>{log.user?.email}</div>
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 12 }}>
                              System
                            </span>
                          )}
                        </td>

                        {/* Role */}
                        <td style={S.td}>
                          {log.user?.role && (
                            <span
                              style={{
                                ...S.roleBadge,
                                background:
                                  (ROLE_COLORS[log.user.role] || "#94a3b8") +
                                  "18",
                                color: ROLE_COLORS[log.user.role] || "#94a3b8",
                              }}
                            >
                              {log.user.role.replace(/_/g, " ")}
                            </span>
                          )}
                        </td>

                        {/* Action */}
                        <td style={S.td}>
                          <span
                            style={{
                              ...S.actionBadge,
                              background: as.bg,
                              color: as.color,
                            }}
                          >
                            {log.action}
                          </span>
                        </td>

                        {/* Module */}
                        <td style={S.td}>
                          {log.module && (
                            <span style={S.moduleBadge}>
                              {MODULE_ICONS[log.module] || "📌"} {log.module}
                            </span>
                          )}
                        </td>

                        {/* IP */}
                        <td style={S.td}>
                          <span style={S.ipText}>{log.ipAddress || "—"}</span>
                        </td>

                        {/* Expand */}
                        <td style={S.td}>
                          {hasData ? (
                            <button
                              style={S.detailBtn}
                              onClick={() =>
                                setExpandedLog(isExpanded ? null : log._id)
                              }
                            >
                              {isExpanded ? "▲ Hide" : "▼ Show"}
                            </button>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 12 }}>
                              —
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Detail Row */}
                      {isExpanded && (
                        <tr
                          key={`${log._id}-detail`}
                          style={{ background: "#f8faff" }}
                        >
                          <td colSpan={7} style={{ padding: "0 16px 16px" }}>
                            <div style={S.expandedContent}>
                              <div style={S.expandedGrid}>
                                {log.oldValue && (
                                  <div>
                                    <div style={S.expandedLabel}>
                                      🔴 Before Change
                                    </div>
                                    <pre style={S.jsonBlock}>
                                      {JSON.stringify(log.oldValue, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.newValue && (
                                  <div>
                                    <div style={S.expandedLabel}>
                                      🟢 After Change
                                    </div>
                                    <pre style={S.jsonBlock}>
                                      {JSON.stringify(log.newValue, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                              {log.deviceInfo && (
                                <div style={S.deviceInfo}>
                                  <span style={S.expandedLabel}>
                                    🖥️ Device:
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: "#64748b",
                                      marginLeft: 8,
                                    }}
                                  >
                                    {log.deviceInfo}
                                  </span>
                                </div>
                              )}
                              {log.targetId && (
                                <div style={S.deviceInfo}>
                                  <span style={S.expandedLabel}>
                                    🎯 Target ID:
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontFamily: "monospace",
                                      color: "#64748b",
                                      marginLeft: 8,
                                    }}
                                  >
                                    {log.targetId}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!loading && logs.length > 0 && (
          <div style={S.pagination}>
            <button
              style={{ ...S.pageBtn, opacity: page === 1 ? 0.4 : 1 }}
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              «
            </button>
            <button
              style={{ ...S.pageBtn, opacity: page === 1 ? 0.4 : 1 }}
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <div style={S.pageNums}>
              {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                const p = Math.max(1, Math.min(page - 2, pages - 4)) + i;
                return (
                  <button
                    key={p}
                    style={{
                      ...S.pageNumBtn,
                      ...(p === page ? S.pageNumActive : {}),
                    }}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <button
              style={{ ...S.pageBtn, opacity: page === pages ? 0.4 : 1 }}
              disabled={page === pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
            <button
              style={{ ...S.pageBtn, opacity: page === pages ? 0.4 : 1 }}
              disabled={page === pages}
              onClick={() => setPage(pages)}
            >
              »
            </button>
            <span style={S.pageInfo}>
              Page {page} of {pages} · {total.toLocaleString()} records
            </span>
          </div>
        )}
      </main>
    </div>
  );
}

const C = { primary: "#1a3c6e", accent: "#2563eb", border: "#e2e8f0" };
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", overflowY: "auto" },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: "#888", marginTop: 4 },
  exportBtn: {
    padding: "9px 18px",
    background: "#fff",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
  },

  // Stats row
  statsRow: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  statChip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 20,
    padding: "6px 14px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  statIcon: { fontSize: 15 },
  statModule: { fontSize: 13, fontWeight: 600, color: "#475569" },
  statCount: {
    background: C.primary,
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    padding: "1px 8px",
    borderRadius: 20,
  },

  // Filter card
  filterCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "18px 20px",
    marginBottom: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
    marginBottom: 14,
  },
  filterGroup: { display: "flex", flexDirection: "column", gap: 5 },
  filterLabel: { fontSize: 12, fontWeight: 600, color: "#475569" },
  filterActions: { display: "flex", gap: 10 },
  select: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
    outline: "none",
  },
  input: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
  },
  applyBtn: {
    padding: "9px 20px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  resetBtn: {
    padding: "9px 16px",
    background: "#f1f5f9",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
    color: "#475569",
  },

  // Table
  tableCard: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
    minHeight: 200,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  thead: { background: "#f8fafc", position: "sticky", top: 0, zIndex: 1 },
  th: {
    padding: "11px 14px",
    textAlign: "left",
    fontWeight: 700,
    color: "#475569",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    borderBottom: `1.5px solid ${C.border}`,
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid #f8fafc",
    cursor: "default",
    transition: "background .1s",
  },
  td: { padding: "11px 14px", color: "#334155", verticalAlign: "middle" },

  // Cell content
  timestamp: {
    fontSize: 12,
    fontFamily: "monospace",
    color: "#64748b",
    whiteSpace: "nowrap",
  },
  userCell: { display: "flex", alignItems: "center", gap: 10 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  userName: { fontSize: 13, fontWeight: 600, color: "#334155" },
  userEmail: { fontSize: 11, color: "#94a3b8" },
  roleBadge: {
    padding: "2px 9px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "capitalize",
    whiteSpace: "nowrap",
  },
  actionBadge: {
    padding: "3px 10px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    fontFamily: "monospace",
    whiteSpace: "nowrap",
  },
  moduleBadge: { fontSize: 12, color: "#475569", fontWeight: 600 },
  ipText: { fontSize: 12, fontFamily: "monospace", color: "#94a3b8" },
  detailBtn: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    color: C.accent,
    whiteSpace: "nowrap",
  },

  // Expanded row
  expandedContent: {
    background: "#f0f4ff",
    borderRadius: 10,
    padding: 16,
    border: `1px solid #c7d7f8`,
  },
  expandedGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
    marginBottom: 10,
  },
  expandedLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    marginBottom: 6,
  },
  jsonBlock: {
    background: "#1e293b",
    color: "#94d3a2",
    padding: "12px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontFamily: "monospace",
    overflow: "auto",
    maxHeight: 200,
    margin: 0,
    lineHeight: 1.6,
  },
  deviceInfo: {
    display: "flex",
    alignItems: "flex-start",
    gap: 4,
    marginTop: 8,
  },

  // Loading
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    padding: "60px 20px",
    color: "#94a3b8",
  },
  loadingSpinner: {
    width: 36,
    height: 36,
    border: "3px solid #e2e8f0",
    borderTop: `3px solid ${C.accent}`,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  empty: { padding: "60px 20px", textAlign: "center" },

  // Pagination
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    flexWrap: "wrap",
  },
  pageBtn: {
    padding: "7px 12px",
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: C.primary,
  },
  pageNums: { display: "flex", gap: 4 },
  pageNumBtn: {
    width: 34,
    height: 34,
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
  },
  pageNumActive: {
    background: C.primary,
    color: "#fff",
    border: `1px solid ${C.primary}`,
  },
  pageInfo: { fontSize: 13, color: "#888", marginLeft: 8 },
};
