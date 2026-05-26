// ============================================================
// FRONTEND: src/pages/Dashboard.jsx — Complete Rewrite
// ============================================================
import { useState, useEffect } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";

const fmt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-IN");

const ROLE_LABELS = {
  branch_user: "Branch User",
  branch_partner: "Branch Partner",
  cluster_head: "Cluster Head",
  accounts: "Accounts Team",
  director: "Director",
  super_admin: "Super Admin",
};

const ACTION_COLORS = {
  CREATE_INVOICE: "#2563eb",
  APPROVE_INVOICE: "#16a34a",
  REJECT_INVOICE: "#dc2626",
  RAISE_PAYMENT: "#7c3aed",
  APPROVE_PAYMENT: "#16a34a",
  REJECT_PAYMENT: "#dc2626",
  GENERATE_PAYMENT_EXCEL: "#16a34a",
  CREATE_VENDOR: "#d97706",
  APPROVE_VENDOR: "#16a34a",
  LOGIN: "#475569",
};

// ── Sub-components ─────────────────────────────────────────

const StatCard = ({ label, value, icon, color = "#1a3c6e", sub, onClick }) => (
  <div
    style={{
      ...SC.card,
      borderTop: `3px solid ${color}`,
      cursor: onClick ? "pointer" : "default",
    }}
    onClick={onClick}
  >
    <div style={SC.top}>
      <span style={{ fontSize: 26 }}>{icon}</span>
      <span style={{ ...SC.value, color }}>{value}</span>
    </div>
    <div style={SC.label}>{label}</div>
    {sub && <div style={SC.sub}>{sub}</div>}
  </div>
);

const SC = {
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "16px 18px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    minWidth: 0,
  },
  top: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  value: { fontSize: 24, fontWeight: 700 },
  label: { fontSize: 13, color: "#64748b", fontWeight: 500 },
  sub: { fontSize: 12, color: "#94a3b8", marginTop: 3 },
};

const SectionCard = ({ title, children, action }) => (
  <div style={SE.card}>
    <div style={SE.header}>
      <div style={SE.title}>{title}</div>
      {action}
    </div>
    {children}
  </div>
);

const SE = {
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "18px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: "1px solid #f1f5f9",
  },
  title: { fontSize: 14, fontWeight: 700, color: "#1a3c6e" },
};

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/reports/dashboard-stats")
      .then((r) => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const greet = () => {
    const h = new Date().getHours();
    if (h < 12) return "🌅 Good Morning";
    if (h < 17) return "☀️ Good Afternoon";
    return "🌙 Good Evening";
  };

  if (loading)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loadingWrap}>
            <div style={S.spinner} />
            <span style={{ color: "#64748b", marginTop: 12 }}>
              Loading dashboard...
            </span>
          </div>
        </main>
      </div>
    );

  const inv = stats?.invoice || {};
  const pay = stats?.payment || {};
  const ven = stats?.vendor;

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        {/* ── Welcome Header ───────────────────────────── */}
        <div style={S.welcomeBar}>
          <div>
            <div style={S.greet}>
              {greet()}, <strong>{user?.name}</strong> 👋
            </div>
            <div style={S.rolePill}>
              {ROLE_LABELS[user?.role] || user?.role}
              {user?.branches?.length > 0 && (
                <span style={S.branchPill}>
                  {user.branches.map((b) => b.name || b).join(", ")}
                </span>
              )}
            </div>
          </div>
          <div style={S.dateBox}>
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </div>
        </div>

        {/* ── Pending Actions ──────────────────────────── */}
        {stats?.pendingActions?.length > 0 && (
          <div style={S.pendingBar}>
            <div style={S.pendingTitle}>⚡ Action Required</div>
            <div style={S.pendingList}>
              {stats.pendingActions.map((action, i) => (
                <div
                  key={i}
                  style={{
                    ...S.pendingItem,
                    borderLeft: `3px solid ${action.color}`,
                  }}
                  onClick={() => navigate(action.path)}
                >
                  <span style={{ ...S.pendingCount, background: action.color }}>
                    {action.count}
                  </span>
                  <span style={S.pendingLabel}>{action.label}</span>
                  <span style={S.pendingArrow}>→</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Invoice Processing Stats ─────────────────── */}
        <div style={S.sectionHeader}>
          <span style={S.sectionTitle}>📋 Invoice Processing</span>
          <button style={S.viewAllBtn} onClick={() => navigate("/invoices")}>
            View All →
          </button>
        </div>
        <div style={S.statsGrid}>
          <StatCard
            label="Total Invoices"
            value={fmtNum(inv.total)}
            icon="📋"
            color="#1a3c6e"
            sub={`${fmtNum(inv.thisMonth)} this month`}
            onClick={() => navigate("/invoices")}
          />
          <StatCard
            label="Pending Approval"
            value={fmtNum(inv.pendingApproval)}
            icon="⏳"
            color="#d97706"
            sub="Awaiting action"
            onClick={() => navigate("/invoices?status=Submitted")}
          />
          <StatCard
            label="Approved"
            value={fmtNum(inv.clusterApproved)}
            icon="✅"
            color="#16a34a"
            sub="Cluster head approved"
            onClick={() => navigate("/invoices?status=Cluster+Head+Approved")}
          />
          <StatCard
            label="Rejected"
            value={fmtNum(inv.rejected)}
            icon="❌"
            color="#dc2626"
            sub="Need revision"
            onClick={() => navigate("/invoices?status=Rejected")}
          />
          <StatCard
            label="Total Invoice Value"
            value={fmt(inv.totalAmount)}
            icon="💰"
            color="#7c3aed"
            sub={`Avg ${fmt(inv.avgAmount)}`}
          />
        </div>

        {/* ── Payment Processing Stats ─────────────────── */}
        <div style={{ ...S.sectionHeader, marginTop: 24 }}>
          <span style={S.sectionTitle}>💳 Payment Processing</span>
          <button style={S.viewAllBtn} onClick={() => navigate("/payments")}>
            View All →
          </button>
        </div>
        <div style={S.statsGrid}>
          <StatCard
            label="Ready to Pay"
            value={fmtNum(pay.pending)}
            icon="⏳"
            color="#d97706"
            sub="Approved invoices"
            onClick={() => navigate("/payments")}
          />
          <StatCard
            label="Payment Raised"
            value={fmtNum(pay.raised)}
            icon="📤"
            color="#2563eb"
            sub="Awaiting accounts"
            onClick={() => navigate("/payments")}
          />
          <StatCard
            label="Excel Generated"
            value={fmtNum(pay.excel)}
            icon="📊"
            color="#16a34a"
            sub="Payment processed"
            onClick={() => navigate("/payments")}
          />
          <StatCard
            label="Rejected"
            value={fmtNum(pay.rejected)}
            icon="❌"
            color="#dc2626"
            sub="Payment rejected"
            onClick={() => navigate("/payments")}
          />
          <StatCard
            label="Total Paid"
            value={fmt(pay.totalAmount)}
            icon="💸"
            color="#16a34a"
            sub="Approved + Excel"
          />
        </div>

        {/* ── Vendor Stats (accounts/admin only) ──────── */}
        {ven && (
          <>
            <div style={{ ...S.sectionHeader, marginTop: 24 }}>
              <span style={S.sectionTitle}>🏢 Vendor Management</span>
              <button style={S.viewAllBtn} onClick={() => navigate("/vendors")}>
                View All →
              </button>
            </div>
            <div
              style={{
                ...S.statsGrid,
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              }}
            >
              <StatCard
                label="Total Vendors"
                value={fmtNum(ven.total)}
                icon="🏢"
                color="#1a3c6e"
                onClick={() => navigate("/vendors")}
              />
              <StatCard
                label="Pending Approval"
                value={fmtNum(ven.pending)}
                icon="⏳"
                color="#d97706"
                onClick={() =>
                  navigate("/vendors?approvalStatus=pending_approval")
                }
              />
              <StatCard
                label="Approved"
                value={fmtNum(ven.approved)}
                icon="✅"
                color="#16a34a"
                onClick={() => navigate("/vendors?approvalStatus=approved")}
              />
              <StatCard
                label="Rejected"
                value={fmtNum(ven.rejected)}
                icon="❌"
                color="#dc2626"
                onClick={() => navigate("/vendors?approvalStatus=rejected")}
              />
            </div>
          </>
        )}

        {/* ── Bottom Grid: Status breakdown + Activity ── */}
        <div style={S.bottomGrid}>
          {/* Invoice Status Breakdown */}
          <SectionCard title="📊 Invoice Status Breakdown">
            {[
              { label: "Draft", count: inv.draft, color: "#94a3b8" },
              { label: "Submitted", count: inv.submitted, color: "#2563eb" },
              {
                label: "Accounts Approved",
                count: inv.accountsApproved,
                color: "#d97706",
              },
              {
                label: "Partner Approved",
                count: inv.partnerApproved,
                color: "#7c3aed",
              },
              {
                label: "Cluster Approved",
                count: inv.clusterApproved,
                color: "#16a34a",
              },
              { label: "Rejected", count: inv.rejected, color: "#dc2626" },
            ].map((item) => {
              const pct =
                inv.total > 0 ? Math.round((item.count / inv.total) * 100) : 0;
              return (
                <div key={item.label} style={S.statusRow}>
                  <div style={S.statusLabel}>
                    <span style={{ ...S.statusDot, background: item.color }} />
                    {item.label}
                  </div>
                  <div style={S.statusBar}>
                    <div
                      style={{
                        ...S.statusFill,
                        width: `${pct}%`,
                        background: item.color,
                      }}
                    />
                  </div>
                  <span style={S.statusCount}>{fmtNum(item.count)}</span>
                  <span style={S.statusPct}>{pct}%</span>
                </div>
              );
            })}
          </SectionCard>

          {/* Payment Status Breakdown */}
          <SectionCard title="💳 Payment Status Breakdown">
            {[
              {
                label: "Payment Pending",
                count: pay.pending,
                color: "#94a3b8",
              },
              { label: "Payment Raised", count: pay.raised, color: "#2563eb" },
              {
                label: "Accounts Approved",
                count: pay.approved,
                color: "#16a34a",
              },
              { label: "Excel Generated", count: pay.excel, color: "#15803d" },
              { label: "Rejected", count: pay.rejected, color: "#dc2626" },
            ].map((item) => {
              const pct =
                pay.total > 0 ? Math.round((item.count / pay.total) * 100) : 0;
              return (
                <div key={item.label} style={S.statusRow}>
                  <div style={S.statusLabel}>
                    <span style={{ ...S.statusDot, background: item.color }} />
                    {item.label}
                  </div>
                  <div style={S.statusBar}>
                    <div
                      style={{
                        ...S.statusFill,
                        width: `${pct}%`,
                        background: item.color,
                      }}
                    />
                  </div>
                  <span style={S.statusCount}>{fmtNum(item.count)}</span>
                  <span style={S.statusPct}>{pct}%</span>
                </div>
              );
            })}
          </SectionCard>

          {/* Recent Activity */}
          <SectionCard
            title="🕐 Your Recent Activity"
            action={
              <button
                style={S.viewAllBtn}
                onClick={() => navigate("/audit-logs")}
              >
                View All →
              </button>
            }
          >
            {stats?.recentActivity?.length === 0 ? (
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: 13,
                  textAlign: "center",
                  padding: 20,
                }}
              >
                No recent activity
              </div>
            ) : (
              stats?.recentActivity?.map((log, i) => (
                <div key={i} style={S.activityRow}>
                  <div
                    style={{
                      ...S.activityDot,
                      background: ACTION_COLORS[log.action] || "#94a3b8",
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={S.activityAction}>
                      {log.action?.replace(/_/g, " ")}
                    </div>
                    <div style={S.activityMeta}>
                      {log.module} ·{" "}
                      {new Date(log.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </SectionCard>
        </div>

        {/* ── Quick Actions ────────────────────────────── */}
        <SectionCard title="⚡ Quick Actions" action={null}>
          <div style={S.quickGrid}>
            {user?.role === "branch_user" && (
              <>
                <QuickAction
                  icon="📋"
                  label="New Invoice"
                  color="#2563eb"
                  onClick={() => navigate("/invoices/new")}
                />
                <QuickAction
                  icon="💳"
                  label="Raise Payment"
                  color="#16a34a"
                  onClick={() => navigate("/payments")}
                />
                <QuickAction
                  icon="📄"
                  label="My Invoices"
                  color="#7c3aed"
                  onClick={() => navigate("/invoices")}
                />
                <QuickAction
                  icon="🏢"
                  label="Add Vendor"
                  color="#d97706"
                  onClick={() => navigate("/vendors/new")}
                />
              </>
            )}
            {user?.role === "accounts" && (
              <>
                <QuickAction
                  icon="✅"
                  label="Review Invoices"
                  color="#2563eb"
                  onClick={() => navigate("/invoices?status=Submitted")}
                />
                <QuickAction
                  icon="💳"
                  label="Review Payments"
                  color="#16a34a"
                  onClick={() => navigate("/payments")}
                />
                <QuickAction
                  icon="🏢"
                  label="Approve Vendors"
                  color="#d97706"
                  onClick={() =>
                    navigate("/vendors?approvalStatus=pending_approval")
                  }
                />
                <QuickAction
                  icon="📊"
                  label="Reports"
                  color="#7c3aed"
                  onClick={() => navigate("/reports")}
                />
              </>
            )}
            {user?.role === "branch_partner" && (
              <>
                <QuickAction
                  icon="✅"
                  label="Pending Approvals"
                  color="#7c3aed"
                  onClick={() => navigate("/invoices?status=Accounts+Approved")}
                />
                <QuickAction
                  icon="📋"
                  label="All Invoices"
                  color="#2563eb"
                  onClick={() => navigate("/invoices")}
                />
              </>
            )}
            {user?.role === "cluster_head" && (
              <>
                <QuickAction
                  icon="✅"
                  label="Pending Approvals"
                  color="#d97706"
                  onClick={() => navigate("/invoices?status=Partner+Approved")}
                />
                <QuickAction
                  icon="📋"
                  label="All Invoices"
                  color="#2563eb"
                  onClick={() => navigate("/invoices")}
                />
              </>
            )}
            {["super_admin"].includes(user?.role) && (
              <>
                <QuickAction
                  icon="👥"
                  label="Users"
                  color="#1a3c6e"
                  onClick={() => navigate("/users")}
                />
                <QuickAction
                  icon="🏥"
                  label="Branches"
                  color="#2563eb"
                  onClick={() => navigate("/branches")}
                />
                <QuickAction
                  icon="💰"
                  label="Budgets"
                  color="#16a34a"
                  onClick={() => navigate("/budgets")}
                />
                <QuickAction
                  icon="📊"
                  label="Reports"
                  color="#7c3aed"
                  onClick={() => navigate("/reports")}
                />
              </>
            )}
          </div>
        </SectionCard>
      </main>
    </div>
  );
}

const QuickAction = ({ icon, label, color, onClick }) => (
  <button
    style={{ ...QA.btn, borderTop: `3px solid ${color}` }}
    onClick={onClick}
  >
    <span style={{ fontSize: 28 }}>{icon}</span>
    <span style={{ ...QA.label, color }}>{label}</span>
  </button>
);
const QA = {
  btn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    padding: "16px 12px",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    cursor: "pointer",
    flex: 1,
    minWidth: 100,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    transition: "box-shadow .2s",
  },
  label: { fontSize: 13, fontWeight: 600, textAlign: "center" },
};

const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f4f6fa" },
  main: {
    flex: 1,
    padding: "24px 28px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  loadingWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: {
    width: 40,
    height: 40,
    border: "3px solid #e2e8f0",
    borderTop: "3px solid #1a3c6e",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  // Welcome
  welcomeBar: {
    background: "linear-gradient(135deg, #1a3c6e 0%, #2563eb 100%)",
    borderRadius: 14,
    padding: "20px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  greet: { fontSize: 18, color: "#fff", marginBottom: 6 },
  rolePill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#a8c4e0",
    fontWeight: 500,
  },
  branchPill: {
    background: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    padding: "2px 10px",
    fontSize: 12,
    color: "#fff",
  },
  dateBox: { fontSize: 13, color: "#a8c4e0", textAlign: "right" },

  // Pending actions
  pendingBar: {
    background: "#fff",
    borderRadius: 12,
    padding: "14px 18px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  pendingTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#1a3c6e",
    marginBottom: 10,
  },
  pendingList: { display: "flex", flexDirection: "column", gap: 8 },
  pendingItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    background: "#f8fafc",
    borderRadius: 8,
    cursor: "pointer",
    paddingLeft: 14,
  },
  pendingCount: {
    color: "#fff",
    borderRadius: 20,
    padding: "1px 10px",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  pendingLabel: { flex: 1, fontSize: 13, color: "#334155" },
  pendingArrow: { color: "#94a3b8", fontSize: 16 },

  // Section headers
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#1a3c6e" },
  viewAllBtn: {
    background: "none",
    border: "none",
    color: "#2563eb",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
  },

  // Stats grid
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: 12,
  },

  // Bottom grid
  bottomGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
  },

  // Status rows
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  statusLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "#475569",
    width: 140,
    flexShrink: 0,
  },
  statusDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  statusBar: {
    flex: 1,
    height: 8,
    background: "#f1f5f9",
    borderRadius: 4,
    overflow: "hidden",
  },
  statusFill: { height: "100%", borderRadius: 4, transition: "width 0.5s" },
  statusCount: {
    fontSize: 12,
    fontWeight: 700,
    color: "#334155",
    width: 30,
    textAlign: "right",
  },
  statusPct: { fontSize: 11, color: "#94a3b8", width: 32, textAlign: "right" },

  // Activity
  activityRow: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottom: "1px solid #f8fafc",
    marginBottom: 4,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: 5,
  },
  activityAction: {
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
    textTransform: "capitalize",
  },
  activityMeta: { fontSize: 11, color: "#94a3b8", marginTop: 2 },

  // Quick actions
  quickGrid: { display: "flex", gap: 12, flexWrap: "wrap" },
};
