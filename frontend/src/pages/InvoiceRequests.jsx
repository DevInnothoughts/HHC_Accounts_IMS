import { useState, useEffect, useCallback } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_STYLES = {
  Draft: { bg: "#f1f5f9", color: "#475569", icon: "📝" },
  Submitted: { bg: "#eff6ff", color: "#2563eb", icon: "📤" },
  "Partner Approved": { bg: "#fefce8", color: "#d97706", icon: "⏳" },
  "Accounts Approved": { bg: "#fef3c7", color: "#b45309", icon: "⏳" },
  "Cluster Head Approved": { bg: "#f0fdf4", color: "#16a34a", icon: "✅" },
  Rejected: { bg: "#fef2f2", color: "#dc2626", icon: "❌" },
};

const PRIORITIES = ["", "Normal", "Urgent", "Critical"];
const PRIORITY_COLORS = {
  Normal: "#2563eb",
  Urgent: "#d97706",
  Critical: "#dc2626",
};

const STATUSES = [
  "",
  "Draft",
  "Submitted",
  "Partner Approved",
  "Accounts Approved",
  "Cluster Head Approved",
  "Rejected",
];

export default function InvoiceRequests() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: "", priority: "" });

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: 20,
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      });
      const { data } = await api.get(`/invoices?${params}`);
      setInvoices(data.invoices || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>📋 Invoice Processing</h1>
            <p style={S.sub}>{total} total invoices</p>
          </div>
          {user?.role === "branch_user" && (
            <button
              style={S.createBtn}
              onClick={() => navigate("/invoices/new")}
            >
              + New Invoice
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={S.filterBar}>
          <select
            style={S.select}
            value={filters.status}
            onChange={(e) => {
              setFilters((f) => ({ ...f, status: e.target.value }));
              setPage(1);
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "All Statuses"}
              </option>
            ))}
          </select>
          <select
            style={S.select}
            value={filters.priority}
            onChange={(e) => {
              setFilters((f) => ({ ...f, priority: e.target.value }));
              setPage(1);
            }}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p || "All Priorities"}
              </option>
            ))}
          </select>
          <button
            style={S.resetBtn}
            onClick={() => {
              setFilters({ status: "", priority: "" });
              setPage(1);
            }}
          >
            Reset
          </button>
        </div>

        {/* Table */}
        <div style={S.tableCard}>
          {loading ? (
            <div style={S.loading}>Loading invoices...</div>
          ) : invoices.length === 0 ? (
            <div style={S.empty}>
              No invoices found.
              {user?.role === "branch_user" && (
                <span
                  style={{ color: "#2563eb", cursor: "pointer", marginLeft: 6 }}
                  onClick={() => navigate("/invoices/new")}
                >
                  Create one now.
                </span>
              )}
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  {[
                    "Invoice ID",
                    "Branch",
                    "Vendor",
                    "Amount",
                    "Priority",
                    "Status",
                    "Date",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const ss =
                    STATUS_STYLES[inv.status] || STATUS_STYLES["Draft"];
                  return (
                    <tr
                      key={inv._id}
                      style={S.tr}
                      onClick={() => navigate(`/invoices/${inv._id}`)}
                    >
                      <td style={S.td}>
                        <span style={S.reqId}>{inv.requestId}</span>
                      </td>
                      <td style={S.td}>{inv.branch?.name || "—"}</td>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>
                          {inv.vendor?.vendorName}
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8" }}>
                          {inv.vendor?.companyName}
                        </div>
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>
                        ₹{inv.netPayable?.toLocaleString("en-IN")}
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            ...S.badge,
                            color: PRIORITY_COLORS[inv.priority],
                            background: PRIORITY_COLORS[inv.priority] + "18",
                            border: `1px solid ${PRIORITY_COLORS[inv.priority]}30`,
                          }}
                        >
                          {inv.priority}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            ...S.badge,
                            background: ss.bg,
                            color: ss.color,
                          }}
                        >
                          {ss.icon} {inv.status}
                        </span>
                      </td>
                      <td style={{ ...S.td, color: "#94a3b8", fontSize: 12 }}>
                        {new Date(inv.createdAt).toLocaleDateString("en-GB")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div style={S.pagination}>
          <button
            style={S.pageBtn}
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span style={S.pageInfo}>
            Page {page} · {total} results
          </span>
          <button
            style={S.pageBtn}
            disabled={invoices.length < 20}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
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
  createBtn: {
    padding: "10px 20px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  filterBar: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  select: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
  },
  resetBtn: {
    padding: "9px 14px",
    background: "#f1f5f9",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
    color: "#475569",
  },
  tableCard: {
    background: "#fff",
    borderRadius: 12,
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
  tr: { borderBottom: "1px solid #f8fafc", cursor: "pointer" },
  td: { padding: "12px 14px", color: "#334155", verticalAlign: "middle" },
  reqId: {
    fontFamily: "monospace",
    fontWeight: 700,
    color: C.primary,
    fontSize: 13,
  },
  badge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  loading: { padding: 50, textAlign: "center", color: "#94a3b8" },
  empty: { padding: 50, textAlign: "center", color: "#94a3b8" },
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    marginTop: 20,
  },
  pageBtn: {
    padding: "8px 16px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: C.primary,
  },
  pageInfo: { fontSize: 13, color: "#666" },
};
