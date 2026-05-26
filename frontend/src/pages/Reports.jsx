import { useState, useEffect, useCallback } from "react";
import React from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";

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
const fmt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-IN");

const STATUS_COLORS = {
  Draft: "#94a3b8",
  Submitted: "#2563eb",
  "Partner Approved": "#7c3aed",
  "Accounts Approved": "#d97706",
  "Cluster Head Approved": "#16a34a",
  Rejected: "#dc2626",
  "Payment Pending": "#94a3b8",
  "Payment Raised": "#2563eb",
  "Excel Generated": "#15803d",
  "Payment Rejected": "#dc2626",
};

export default function Reports() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  const isAccountsOrAdmin = ["accounts", "super_admin"].includes(user?.role);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(dateRange).filter(([, v]) => v)),
      );
      const calls = [api.get(`/reports/financial?${params}`)];
      if (isAccountsOrAdmin)
        calls.push(api.get(`/reports/audit-logs?limit=25&${params}`));
      const [repRes, auditRes] = await Promise.all(calls);
      setData(repRes.data);
      if (auditRes) setAuditLogs(auditRes.data.logs || []);
    } catch (err) {
      console.error("Report fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, isAccountsOrAdmin]);

  useEffect(() => {
    fetchReports();
  }, []);

  const downloadExcel = async (type) => {
    setDownloading(type);
    try {
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(dateRange).filter(([, v]) => v)),
      );
      const endpoint =
        type === "financial"
          ? `/reports/financial/export-excel?${params}`
          : `/reports/audit-logs/export-excel?${params}`;
      const res = await api.get(endpoint, { responseType: "blob" });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const date = new Date().toISOString().slice(0, 10);
      link.setAttribute(
        "download",
        type === "financial"
          ? `Financial_Report_${date}.xlsx`
          : `Audit_Logs_${date}.xlsx`,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Excel download error:", err);
    } finally {
      setDownloading("");
    }
  };

  const maxBranchAmt = Math.max(
    ...(data?.branchWiseInvoices?.map((b) => b.totalAmount) || [1]),
    1,
  );

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>📊 Reports & Analytics</h1>
            <p style={S.sub}>Financial insights across all branches</p>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "flex-end",
            }}
          >
            <div style={S.filters}>
              <input
                type="date"
                style={S.dateInput}
                value={dateRange.from}
                onChange={(e) =>
                  setDateRange((d) => ({ ...d, from: e.target.value }))
                }
              />
              <span style={{ color: "#94a3b8", fontSize: 13 }}>to</span>
              <input
                type="date"
                style={S.dateInput}
                value={dateRange.to}
                onChange={(e) =>
                  setDateRange((d) => ({ ...d, to: e.target.value }))
                }
              />
              <button style={S.applyBtn} onClick={fetchReports}>
                Apply
              </button>
              <button
                style={S.resetBtn}
                onClick={() => {
                  setDateRange({ from: "", to: "" });
                  setTimeout(fetchReports, 50);
                }}
              >
                Reset
              </button>
            </div>
            {isAccountsOrAdmin && (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={{
                    ...S.excelBtn,
                    opacity: downloading === "financial" ? 0.6 : 1,
                  }}
                  onClick={() => downloadExcel("financial")}
                  disabled={downloading === "financial"}
                >
                  {downloading === "financial"
                    ? "⏳ Downloading..."
                    : "📥 Export Financial Excel"}
                </button>
                <button
                  style={{
                    ...S.excelBtn,
                    background: "#475569",
                    opacity: downloading === "audit" ? 0.6 : 1,
                  }}
                  onClick={() => downloadExcel("audit")}
                  disabled={downloading === "audit"}
                >
                  {downloading === "audit"
                    ? "⏳ Downloading..."
                    : "📥 Export Audit Excel"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {[
            ["overview", "📊 Overview"],
            ["invoices", "📋 Invoices"],
            ["payments", "💳 Payments"],
            ["branches", "🏥 Branches"],
            ["vendors", "🏢 Top Vendors"],
            ...(isAccountsOrAdmin ? [["audit", "🔍 Audit Logs"]] : []),
          ].map(([k, l]) => (
            <button
              key={k}
              style={{ ...S.tab, ...(activeTab === k ? S.tabActive : {}) }}
              onClick={() => setActiveTab(k)}
            >
              {l}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={S.loading}>Loading reports...</div>
        ) : (
          <div style={S.content}>
            {/* ── Overview ─────────────────────────────── */}
            {activeTab === "overview" && (
              <div style={S.section}>
                {/* Summary cards */}
                <div style={S.summaryGrid}>
                  {[
                    {
                      label: "Total Invoice Value",
                      value: fmt(data?.summary?.totalInvoiceAmount),
                      icon: "📋",
                      color: "#1a3c6e",
                    },
                    {
                      label: "Total Invoices",
                      value: fmtNum(data?.summary?.totalInvoiceCount),
                      icon: "🔢",
                      color: "#2563eb",
                    },
                    {
                      label: "Total Payment Value",
                      value: fmt(data?.summary?.totalPaymentAmount),
                      icon: "💳",
                      color: "#16a34a",
                    },
                    {
                      label: "Payments Processed",
                      value: fmtNum(data?.summary?.totalPaymentCount),
                      icon: "✅",
                      color: "#15803d",
                    },
                  ].map((c) => (
                    <div
                      key={c.label}
                      style={{
                        ...S.summaryCard,
                        borderTop: `3px solid ${c.color}`,
                      }}
                    >
                      <div style={{ fontSize: 28, marginBottom: 8 }}>
                        {c.icon}
                      </div>
                      <div style={{ ...S.summaryVal, color: c.color }}>
                        {c.value}
                      </div>
                      <div style={S.summaryLabel}>{c.label}</div>
                    </div>
                  ))}
                </div>

                {/* Status + Expense type */}
                <div style={S.grid2}>
                  <div style={S.chartCard}>
                    <div style={S.chartTitle}>Invoice Status Distribution</div>
                    {data?.statusWise?.map((s) => {
                      const total = data.statusWise.reduce(
                        (a, b) => a + b.count,
                        0,
                      );
                      const pct =
                        total > 0 ? ((s.count / total) * 100).toFixed(1) : 0;
                      const color = STATUS_COLORS[s._id] || "#94a3b8";
                      return (
                        <div key={s._id} style={S.barItem}>
                          <div
                            style={{
                              ...S.barLabel,
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>{s._id}</span>
                            <span style={{ color }}>{fmtNum(s.count)}</span>
                          </div>
                          <div style={S.barTrack}>
                            <div
                              style={{
                                ...S.barFill,
                                width: `${pct}%`,
                                background: color,
                              }}
                            />
                          </div>
                          <div style={S.barMeta}>
                            {fmt(s.totalAmount)} · {pct}%
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={S.chartCard}>
                    <div style={S.chartTitle}>Expense Type Split</div>
                    {data?.expenseTypeWise?.map((e) => {
                      const total = data.expenseTypeWise.reduce(
                        (a, b) => a + b.count,
                        0,
                      );
                      const pct =
                        total > 0 ? ((e.count / total) * 100).toFixed(1) : 0;
                      const color = e._id === "Revenue" ? "#2563eb" : "#d97706";
                      return (
                        <div key={e._id} style={S.barItem}>
                          <div
                            style={{
                              ...S.barLabel,
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>{e._id}</span>
                            <span style={{ color }}>{fmtNum(e.count)}</span>
                          </div>
                          <div style={S.barTrack}>
                            <div
                              style={{
                                ...S.barFill,
                                width: `${pct}%`,
                                background: color,
                              }}
                            />
                          </div>
                          <div style={S.barMeta}>
                            {fmt(e.totalAmount)} · {pct}%
                          </div>
                        </div>
                      );
                    })}

                    <div style={{ ...S.chartTitle, marginTop: 20 }}>
                      Priority Breakdown
                    </div>
                    {data?.priorityWise?.map((p) => {
                      const total = data.priorityWise.reduce(
                        (a, b) => a + b.count,
                        0,
                      );
                      const pct =
                        total > 0 ? ((p.count / total) * 100).toFixed(1) : 0;
                      const color =
                        {
                          Normal: "#2563eb",
                          Urgent: "#d97706",
                          Critical: "#dc2626",
                        }[p._id] || "#94a3b8";
                      return (
                        <div key={p._id} style={S.barItem}>
                          <div
                            style={{
                              ...S.barLabel,
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>{p._id}</span>
                            <span style={{ color }}>{fmtNum(p.count)}</span>
                          </div>
                          <div style={S.barTrack}>
                            <div
                              style={{
                                ...S.barFill,
                                width: `${pct}%`,
                                background: color,
                              }}
                            />
                          </div>
                          <div style={S.barMeta}>{pct}%</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Invoice Monthly Trend ─────────────────── */}
            {activeTab === "invoices" && (
              <div style={S.section}>
                <div style={S.chartCard}>
                  <div style={S.chartTitle}>Monthly Invoice Trend</div>
                  {data?.invoiceMonthlyTrend?.length === 0 && (
                    <div style={S.empty}>No data</div>
                  )}
                  {data?.invoiceMonthlyTrend?.length > 0 &&
                    (() => {
                      const maxAmt = Math.max(
                        ...data.invoiceMonthlyTrend.map((m) => m.totalAmount),
                        1,
                      );
                      return (
                        <div style={S.trendWrap}>
                          {data.invoiceMonthlyTrend.map((m, i) => {
                            const h = Math.max(
                              6,
                              (m.totalAmount / maxAmt) * 160,
                            );
                            return (
                              <div key={i} style={S.trendCol}>
                                <div style={S.trendAmt}>
                                  {fmt(m.totalAmount)}
                                </div>
                                <div
                                  style={{
                                    ...S.trendBar,
                                    height: h,
                                    background:
                                      "linear-gradient(180deg,#2563eb,#1a3c6e)",
                                  }}
                                />
                                <div style={S.trendCount}>
                                  {fmtNum(m.count)}
                                </div>
                                <div style={S.trendLabel}>
                                  {MONTHS[m._id.month - 1]} {m._id.year}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                </div>
              </div>
            )}

            {/* ── Payment Trend ─────────────────────────── */}
            {activeTab === "payments" && (
              <div style={S.section}>
                <div style={S.chartCard}>
                  <div style={S.chartTitle}>Monthly Payment Trend</div>
                  {data?.paymentMonthlyTrend?.length === 0 && (
                    <div style={S.empty}>No payment data</div>
                  )}
                  {data?.paymentMonthlyTrend?.length > 0 &&
                    (() => {
                      const maxAmt = Math.max(
                        ...data.paymentMonthlyTrend.map((m) => m.totalAmount),
                        1,
                      );
                      return (
                        <div style={S.trendWrap}>
                          {data.paymentMonthlyTrend.map((m, i) => {
                            const h = Math.max(
                              6,
                              (m.totalAmount / maxAmt) * 140,
                            );
                            return (
                              <div key={i} style={S.trendCol}>
                                <div style={S.trendAmt}>
                                  {fmt(m.totalAmount)}
                                </div>
                                <div
                                  style={{
                                    ...S.trendBar,
                                    height: h,
                                    background:
                                      "linear-gradient(180deg,#16a34a,#15803d)",
                                  }}
                                />
                                <div style={S.trendCount}>
                                  {fmtNum(m.count)}
                                </div>
                                <div style={S.trendLabel}>
                                  {MONTHS[m._id.month - 1]} {m._id.year}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                </div>
              </div>
            )}

            {/* ── Branch-wise ───────────────────────────── */}
            {activeTab === "branches" && (
              <div style={S.section}>
                <div style={S.chartCard}>
                  <div style={S.chartTitle}>Branch-wise Invoice Volume</div>
                  {data?.branchWiseInvoices?.length === 0 && (
                    <div style={S.empty}>No branch data</div>
                  )}
                  {data?.branchWiseInvoices?.map((b, i) => {
                    const pct = Math.max(
                      4,
                      (b.totalAmount / maxBranchAmt) * 100,
                    );
                    return (
                      <div key={i} style={S.branchRow}>
                        <div style={S.branchName}>
                          {b.branch?.name || "Unknown"}
                        </div>
                        <div style={S.branchBarWrap}>
                          <div style={{ ...S.branchFill, width: `${pct}%` }}>
                            <span style={S.branchFillLabel}>
                              {fmt(b.totalAmount)}
                            </span>
                          </div>
                        </div>
                        <div style={S.branchCount}>{fmtNum(b.count)} req</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Top Vendors ───────────────────────────── */}
            {activeTab === "vendors" && (
              <div style={S.section}>
                <div style={S.tableCard}>
                  <div style={S.chartTitle}>
                    Top 10 Vendors by Invoice Volume
                  </div>
                  <table style={S.table}>
                    <thead>
                      <tr style={S.thead}>
                        {[
                          "#",
                          "Vendor",
                          "Category",
                          "Invoices",
                          "Total Amount",
                          "Avg Amount",
                        ].map((h) => (
                          <th key={h} style={S.th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data?.topVendors?.map((v, i) => (
                        <tr key={i} style={S.tr}>
                          <td
                            style={{
                              ...S.td,
                              fontWeight: 700,
                              color: "#94a3b8",
                            }}
                          >
                            #{i + 1}
                          </td>
                          <td style={S.td}>
                            <div style={{ fontWeight: 600, color: "#1a3c6e" }}>
                              {v.vendor?.vendorName || "Unknown"}
                            </div>
                            <div style={{ fontSize: 12, color: "#94a3b8" }}>
                              {v.vendor?.companyName}
                            </div>
                          </td>
                          <td style={S.td}>
                            <span style={S.catBadge}>
                              {v.vendor?.vendorCategory || "—"}
                            </span>
                          </td>
                          <td style={S.td}>{fmtNum(v.count)}</td>
                          <td
                            style={{
                              ...S.td,
                              fontWeight: 700,
                              color: "#16a34a",
                            }}
                          >
                            {fmt(v.totalAmount)}
                          </td>
                          <td style={S.td}>
                            {fmt(v.count > 0 ? v.totalAmount / v.count : 0)}
                          </td>
                        </tr>
                      ))}
                      {data?.topVendors?.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              padding: 30,
                              textAlign: "center",
                              color: "#94a3b8",
                            }}
                          >
                            No vendor data
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Audit Logs ────────────────────────────── */}
            {activeTab === "audit" && (
              <div style={S.section}>
                <div style={S.tableCard}>
                  <div style={S.chartTitle}>Recent Activity Logs</div>
                  <table style={S.table}>
                    <thead>
                      <tr style={S.thead}>
                        {["Timestamp", "User", "Role", "Action", "Module"].map(
                          (h) => (
                            <th key={h} style={S.th}>
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log, i) => (
                        <tr key={i} style={S.tr}>
                          <td
                            style={{
                              ...S.td,
                              fontSize: 12,
                              color: "#94a3b8",
                              fontFamily: "monospace",
                            }}
                          >
                            {new Date(log.createdAt).toLocaleDateString(
                              "en-GB",
                              {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </td>
                          <td style={S.td}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>
                              {log.user?.name || "System"}
                            </div>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>
                              {log.user?.email}
                            </div>
                          </td>
                          <td style={S.td}>
                            <span style={S.roleBadge}>
                              {log.user?.role?.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td style={S.td}>
                            <span
                              style={{
                                ...S.actionBadge,
                                background: "#eff6ff",
                                color: "#2563eb",
                              }}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td style={S.td}>{log.module || "—"}</td>
                        </tr>
                      ))}
                      {auditLogs.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            style={{
                              padding: 30,
                              textAlign: "center",
                              color: "#94a3b8",
                            }}
                          >
                            No audit logs
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
    flexWrap: "wrap",
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: "#888", marginTop: 4 },
  filters: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  dateInput: {
    padding: "8px 10px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    outline: "none",
  },
  applyBtn: {
    padding: "8px 16px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  resetBtn: {
    padding: "8px 14px",
    background: "#f1f5f9",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
    color: "#475569",
  },
  excelBtn: {
    padding: "8px 14px",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  tabs: {
    display: "flex",
    gap: 2,
    marginBottom: 20,
    background: "#fff",
    borderRadius: 10,
    padding: 4,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
    flexWrap: "wrap",
  },
  tab: {
    padding: "9px 14px",
    border: "none",
    borderRadius: 8,
    background: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    color: "#64748b",
    whiteSpace: "nowrap",
  },
  tabActive: { background: C.primary, color: "#fff", fontWeight: 700 },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  content: {},
  section: { display: "flex", flexDirection: "column", gap: 16 },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 16,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "18px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    textAlign: "center",
  },
  summaryVal: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  summaryLabel: { fontSize: 13, color: "#64748b" },
  chartCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "20px 22px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 16,
  },
  barItem: { marginBottom: 14 },
  barLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    marginBottom: 4,
  },
  barTrack: {
    height: 10,
    background: "#f1f5f9",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 3,
  },
  barFill: { height: "100%", borderRadius: 6, transition: "width 0.5s" },
  barMeta: { fontSize: 12, color: "#94a3b8" },
  trendWrap: {
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
    overflowX: "auto",
    padding: "10px 0 4px",
    minHeight: 200,
  },
  trendCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    minWidth: 65,
  },
  trendAmt: {
    fontSize: 10,
    color: "#64748b",
    textAlign: "center",
    fontWeight: 600,
  },
  trendBar: { width: 32, borderRadius: "4px 4px 0 0", cursor: "pointer" },
  trendCount: { fontSize: 11, color: "#16a34a", fontWeight: 700 },
  trendLabel: { fontSize: 10, color: "#94a3b8", textAlign: "center" },
  branchRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  branchName: {
    width: 130,
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  branchBarWrap: {
    flex: 1,
    height: 28,
    background: "#f1f5f9",
    borderRadius: 6,
    overflow: "hidden",
  },
  branchFill: {
    height: "100%",
    background: "linear-gradient(90deg,#1a3c6e,#2563eb)",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    paddingLeft: 8,
    minWidth: 60,
  },
  branchFillLabel: {
    fontSize: 12,
    color: "#fff",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  branchCount: {
    width: 60,
    fontSize: 12,
    color: "#94a3b8",
    textAlign: "right",
    flexShrink: 0,
  },
  tableCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "20px 22px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  thead: { background: "#f8fafc" },
  th: {
    padding: "10px 14px",
    textAlign: "left",
    fontWeight: 600,
    color: "#475569",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: `1px solid ${C.border}`,
  },
  tr: { borderBottom: "1px solid #f8fafc" },
  td: { padding: "11px 14px", color: "#334155", verticalAlign: "middle" },
  catBadge: {
    background: "#eff6ff",
    color: "#2563eb",
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
  },
  roleBadge: {
    background: "#f1f5f9",
    color: "#475569",
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "capitalize",
  },
  actionBadge: {
    padding: "2px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    fontFamily: "monospace",
  },
  empty: { padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 14 },
};
