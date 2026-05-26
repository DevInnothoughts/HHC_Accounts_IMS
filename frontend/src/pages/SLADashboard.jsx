import { useState, useEffect, useCallback } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_STYLES = {
  on_track: {
    bg: "#f0fdf4",
    color: "#16a34a",
    label: "✓ On Track",
    icon: "🟢",
  },
  at_risk: { bg: "#fffbeb", color: "#d97706", label: "⚠ At Risk", icon: "🟡" },
  breached: {
    bg: "#fef2f2",
    color: "#dc2626",
    label: "✗ Breached",
    icon: "🔴",
  },
  completed: {
    bg: "#f8fafc",
    color: "#94a3b8",
    label: "✓ Completed",
    icon: "⚪",
  },
};

const STAGE_LABELS = {
  accounts: "Accounts Verification",
  partner: "Partner Approval",
  cluster_head: "Cluster Head Approval",
};

// What each role is responsible for
const ROLE_STAGE_MAP = {
  accounts: ["accounts"],
  branch_partner: ["partner"],
  cluster_head: ["cluster_head"],
  super_admin: ["accounts", "partner", "cluster_head"],
};

const DEFAULT_SLA = {
  accounts: {
    hoursAllowed: 24,
    reminderIntervalHours: 8,
    escalateTo: "super_admin",
  },
  partner: {
    hoursAllowed: 48,
    reminderIntervalHours: 12,
    escalateTo: "cluster_head",
  },
  cluster_head: {
    hoursAllowed: 48,
    reminderIntervalHours: 12,
    escalateTo: "super_admin",
  },
};

export default function SLADashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [filterStatus, setFilterStatus] = useState("");
  const [editingConfig, setEditingConfig] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = user?.role === "super_admin";
  const isAccounts = user?.role === "accounts";
  const canConfig = isAdmin || isAccounts;
  const myStages = ROLE_STAGE_MAP[user?.role] || [];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterStatus ? `?status=${filterStatus}` : "";
      const [dashRes, cfgRes] = await Promise.all([
        api.get(`/sla/dashboard${params}`),
        api.get("/sla/configs"),
      ]);
      setData(dashRes.data);
      setConfigs(cfgRes.data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load SLA data");
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveConfig = async (config) => {
    setSavingConfig(true);
    try {
      await api.post("/sla/configs", config);
      await fetchData();
      setEditingConfig(null);
    } catch (err) {
      setError(err.response?.data?.message || "Config save failed");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTriggerCheck = async () => {
    try {
      await api.post("/sla/trigger-check");
      alert(
        "SLA check triggered. Emails will be sent for at-risk and breached invoices.",
      );
      fetchData();
    } catch (err) {
      setError("Trigger failed");
    }
  };

  const stats = data?.stats || {};
  const trackings = data?.trackings || [];

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        {/* Header */}
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>⏱️ SLA Dashboard</h1>
            <p style={S.sub}>
              {isAdmin
                ? "Monitor all approval timelines across all stages"
                : `Monitoring invoices at your stage: ${myStages.map((s) => STAGE_LABELS[s]).join(", ")}`}
            </p>
          </div>
          {canConfig && (
            <button style={S.triggerBtn} onClick={handleTriggerCheck}>
              ▶ Run SLA Check Now
            </button>
          )}
        </div>

        {error && (
          <div style={S.errorBox}>
            {error}
            <button
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#dc2626",
                fontWeight: 700,
              }}
              onClick={() => setError("")}
            >
              ✕
            </button>
          </div>
        )}

        {/* What is SLA — info box for non-admin */}
        {!isAdmin && (
          <div style={S.infoBox}>
            <span style={{ fontSize: 20 }}>ℹ️</span>
            <div>
              <strong>What is this?</strong> This dashboard shows invoices
              assigned to your approval stage. Each invoice has a time limit (
              {myStages
                .map((s) => {
                  const cfg = configs.find((c) => c.stage === s);
                  return `${cfg?.hoursAllowed || DEFAULT_SLA[s]?.hoursAllowed || "—"}h`;
                })
                .join(", ")}{" "}
              for your stage). 🟡 At Risk means less than 25% time is left. 🔴
              Breached means the deadline has passed. You will receive email
              reminders automatically.
            </div>
          </div>
        )}

        {/* Stats */}
        <div style={S.statsRow}>
          {[
            {
              key: "on_track",
              icon: "🟢",
              label: "On Track",
              border: "#16a34a",
            },
            { key: "at_risk", icon: "🟡", label: "At Risk", border: "#d97706" },
            {
              key: "breached",
              icon: "🔴",
              label: "Breached",
              border: "#dc2626",
            },
          ].map((s) => (
            <div
              key={s.key}
              style={{
                ...S.statCard,
                borderTop: `3px solid ${s.border}`,
                cursor: "pointer",
                background: filterStatus === s.key ? "#f8fafc" : "#fff",
              }}
              onClick={() =>
                setFilterStatus(filterStatus === s.key ? "" : s.key)
              }
            >
              <div style={S.statIcon}>{s.icon}</div>
              <div style={S.statCount}>{stats[s.key] || 0}</div>
              <div style={S.statLabel}>{s.label}</div>
              {filterStatus === s.key && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  Click to clear filter
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Tabs — config only for admin/accounts */}
        <div style={S.tabs}>
          <button
            style={{
              ...S.tab,
              ...(activeTab === "dashboard" ? S.tabActive : {}),
            }}
            onClick={() => setActiveTab("dashboard")}
          >
            📊 Active SLAs
          </button>
          {canConfig && (
            <button
              style={{
                ...S.tab,
                ...(activeTab === "configs" ? S.tabActive : {}),
              }}
              onClick={() => setActiveTab("configs")}
            >
              ⚙️ SLA Configuration
            </button>
          )}
        </div>

        {loading ? (
          <div style={S.loading}>Loading SLA data...</div>
        ) : (
          <>
            {/* ── Dashboard Tab ──────────────────────────── */}
            {activeTab === "dashboard" && (
              <div>
                {trackings.length === 0 ? (
                  <div style={S.emptyCard}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                    <div
                      style={{
                        fontWeight: 600,
                        color: "#475569",
                        fontSize: 15,
                      }}
                    >
                      {filterStatus
                        ? `No ${filterStatus.replace("_", " ")} SLAs`
                        : "All invoices are on track!"}
                    </div>
                    <div
                      style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}
                    >
                      No invoices require attention at your stage right now.
                    </div>
                  </div>
                ) : (
                  <div style={S.tableCard}>
                    <table style={S.table}>
                      <thead>
                        <tr style={S.thead}>
                          {[
                            "Invoice ID",
                            "Vendor",
                            "Branch",
                            "Stage",
                            "Entered At",
                            "Deadline",
                            "Time Left",
                            "Reminders",
                            "SLA Status",
                            "Action",
                          ].map((h) => (
                            <th key={h} style={S.th}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trackings.map((t) => {
                          const invoice = t.paymentRequest;
                          const ss =
                            STATUS_STYLES[t.status] || STATUS_STYLES.on_track;
                          const isBreached =
                            new Date() > new Date(t.deadlineAt);
                          const hoursLeft = Math.max(
                            0,
                            Math.round(
                              (new Date(t.deadlineAt) - new Date()) /
                                (1000 * 60 * 60),
                            ),
                          );
                          const hoursElapsed = Math.round(
                            (new Date() - new Date(t.stageEnteredAt)) /
                              (1000 * 60 * 60),
                          );

                          return (
                            <tr key={t._id} style={S.tr}>
                              <td style={S.td}>
                                <span style={S.reqId}>
                                  {invoice?.requestId || "—"}
                                </span>
                              </td>
                              <td style={S.td}>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>
                                  {invoice?.vendor?.vendorName || "—"}
                                </div>
                              </td>
                              <td style={S.td}>
                                {invoice?.branch?.name || "—"}
                              </td>
                              <td style={S.td}>
                                <span style={S.stageBadge}>
                                  {STAGE_LABELS[t.stage] || t.stage}
                                </span>
                              </td>
                              <td
                                style={{
                                  ...S.td,
                                  fontSize: 12,
                                  color: "#94a3b8",
                                }}
                              >
                                {new Date(t.stageEnteredAt).toLocaleDateString(
                                  "en-GB",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                                <div style={{ fontSize: 11 }}>
                                  {hoursElapsed}h elapsed
                                </div>
                              </td>
                              <td style={{ ...S.td, fontSize: 12 }}>
                                {new Date(t.deadlineAt).toLocaleDateString(
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
                                <span
                                  style={{
                                    fontWeight: 700,
                                    fontSize: 13,
                                    color: isBreached
                                      ? "#dc2626"
                                      : hoursLeft < 8
                                        ? "#d97706"
                                        : "#16a34a",
                                  }}
                                >
                                  {isBreached
                                    ? "OVERDUE"
                                    : `${hoursLeft}h left`}
                                </span>
                              </td>
                              <td style={{ ...S.td, textAlign: "center" }}>
                                {t.remindersSent > 0 ? (
                                  <span style={S.reminderBadge}>
                                    {t.remindersSent} sent
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td style={S.td}>
                                <span
                                  style={{
                                    ...S.statusBadge,
                                    background: ss.bg,
                                    color: ss.color,
                                  }}
                                >
                                  {ss.icon} {ss.label}
                                </span>
                              </td>
                              <td style={S.td}>
                                {invoice?._id && (
                                  <button
                                    style={S.viewBtn}
                                    onClick={() =>
                                      navigate(`/invoices/${invoice._id}`)
                                    }
                                  >
                                    View Invoice →
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Config Tab (accounts + admin only) ──────── */}
            {activeTab === "configs" && canConfig && (
              <div style={S.configGrid}>
                {Object.entries(STAGE_LABELS).map(([stage, label]) => {
                  const cfg = configs.find((c) => c.stage === stage) || {
                    stage,
                    stageLabel: label,
                    ...DEFAULT_SLA[stage],
                    isActive: true,
                  };
                  const isEditing = editingConfig?.stage === stage;
                  const myStage = myStages.includes(stage);

                  return (
                    <div
                      key={stage}
                      style={{
                        ...S.configCard,
                        ...(myStage ? { borderTop: "3px solid #2563eb" } : {}),
                      }}
                    >
                      <div style={S.configHeader}>
                        <div>
                          <div style={S.configStage}>{label}</div>
                          {myStage && (
                            <div style={S.myStageTag}>Your stage</div>
                          )}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              ...S.activeBadge,
                              background: cfg.isActive ? "#f0fdf4" : "#f8fafc",
                              color: cfg.isActive ? "#16a34a" : "#94a3b8",
                            }}
                          >
                            {cfg.isActive ? "● Active" : "○ Inactive"}
                          </span>
                          <button
                            style={S.editCfgBtn}
                            onClick={() =>
                              setEditingConfig(isEditing ? null : { ...cfg })
                            }
                          >
                            {isEditing ? "Cancel" : "Edit"}
                          </button>
                        </div>
                      </div>

                      {!isEditing ? (
                        <div style={S.configInfo}>
                          <div style={S.cfgRow}>
                            <span style={S.cfgLabel}>SLA Window</span>
                            <strong>{cfg.hoursAllowed}h</strong>
                          </div>
                          <div style={S.cfgRow}>
                            <span style={S.cfgLabel}>Reminder Every</span>
                            <strong>{cfg.reminderIntervalHours}h</strong>
                          </div>
                          <div style={S.cfgRow}>
                            <span style={S.cfgLabel}>Escalate To</span>
                            <strong style={{ textTransform: "capitalize" }}>
                              {cfg.escalateTo?.replace(/_/g, " ")}
                            </strong>
                          </div>
                          <div style={S.cfgRow}>
                            <span style={S.cfgLabel}>Status</span>
                            <strong
                              style={{
                                color: cfg.isActive ? "#16a34a" : "#94a3b8",
                              }}
                            >
                              {cfg.isActive ? "Active" : "Inactive"}
                            </strong>
                          </div>
                        </div>
                      ) : (
                        <div style={S.configForm}>
                          <div style={S.cfgField}>
                            <label style={S.cfgFieldLabel}>
                              SLA Window (hours)
                            </label>
                            <input
                              style={S.cfgInput}
                              type="number"
                              min="1"
                              value={editingConfig.hoursAllowed}
                              onChange={(e) =>
                                setEditingConfig((c) => ({
                                  ...c,
                                  hoursAllowed: Number(e.target.value),
                                }))
                              }
                            />
                          </div>
                          <div style={S.cfgField}>
                            <label style={S.cfgFieldLabel}>
                              Reminder Every (hours)
                            </label>
                            <input
                              style={S.cfgInput}
                              type="number"
                              min="1"
                              value={editingConfig.reminderIntervalHours}
                              onChange={(e) =>
                                setEditingConfig((c) => ({
                                  ...c,
                                  reminderIntervalHours: Number(e.target.value),
                                }))
                              }
                            />
                          </div>
                          <div style={S.cfgField}>
                            <label style={S.cfgFieldLabel}>Escalate To</label>
                            <select
                              style={S.cfgInput}
                              value={editingConfig.escalateTo || "super_admin"}
                              onChange={(e) =>
                                setEditingConfig((c) => ({
                                  ...c,
                                  escalateTo: e.target.value,
                                }))
                              }
                            >
                              <option value="super_admin">Super Admin</option>
                              <option value="accounts">Accounts</option>
                              <option value="cluster_head">Cluster Head</option>
                            </select>
                          </div>
                          <div style={S.cfgField}>
                            <label
                              style={{
                                ...S.cfgFieldLabel,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={editingConfig.isActive}
                                onChange={(e) =>
                                  setEditingConfig((c) => ({
                                    ...c,
                                    isActive: e.target.checked,
                                  }))
                                }
                              />
                              Active
                            </label>
                          </div>
                          <button
                            style={{
                              ...S.saveConfigBtn,
                              opacity: savingConfig ? 0.7 : 1,
                            }}
                            onClick={() => handleSaveConfig(editingConfig)}
                            disabled={savingConfig}
                          >
                            {savingConfig
                              ? "Saving..."
                              : "💾 Save Configuration"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
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
    marginBottom: 16,
    flexWrap: "wrap",
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: "#888", marginTop: 4 },
  triggerBtn: {
    padding: "9px 18px",
    background: C.primary,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "10px 16px",
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 14,
    display: "flex",
    justifyContent: "space-between",
  },
  infoBox: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 10,
    padding: "14px 18px",
    fontSize: 13,
    color: "#1d4ed8",
    marginBottom: 16,
    display: "flex",
    gap: 12,
    lineHeight: 1.6,
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 14,
    marginBottom: 20,
  },
  statCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "18px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    textAlign: "center",
    cursor: "pointer",
    transition: "box-shadow .2s",
  },
  statIcon: { fontSize: 28, marginBottom: 6 },
  statCount: { fontSize: 28, fontWeight: 700, color: C.primary },
  statLabel: { fontSize: 13, color: "#64748b", marginTop: 4 },
  tabs: {
    display: "flex",
    gap: 2,
    marginBottom: 16,
    background: "#fff",
    borderRadius: 10,
    padding: 4,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    width: "fit-content",
  },
  tab: {
    padding: "9px 18px",
    border: "none",
    borderRadius: 8,
    background: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    color: "#64748b",
  },
  tabActive: { background: C.primary, color: "#fff", fontWeight: 700 },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  emptyCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "60px 20px",
    textAlign: "center",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
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
    whiteSpace: "nowrap",
  },
  tr: { borderBottom: "1px solid #f8fafc" },
  td: { padding: "11px 14px", color: "#334155", verticalAlign: "middle" },
  reqId: {
    fontFamily: "monospace",
    fontWeight: 700,
    color: C.primary,
    fontSize: 13,
  },
  stageBadge: {
    background: "#eff6ff",
    color: "#2563eb",
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  statusBadge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  reminderBadge: {
    background: "#fefce8",
    color: "#d97706",
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
  },
  viewBtn: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 6,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    color: C.accent,
    whiteSpace: "nowrap",
  },
  configGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: 16,
  },
  configCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "18px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  configHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  configStage: { fontSize: 15, fontWeight: 700, color: C.primary },
  myStageTag: {
    fontSize: 11,
    fontWeight: 600,
    color: "#2563eb",
    background: "#eff6ff",
    padding: "1px 7px",
    borderRadius: 10,
    marginTop: 4,
    display: "inline-block",
  },
  activeBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 20,
  },
  editCfgBtn: {
    background: "none",
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
  },
  configInfo: { display: "flex", flexDirection: "column", gap: 8 },
  cfgRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    borderBottom: "1px solid #f8fafc",
    fontSize: 13,
  },
  cfgLabel: { color: "#64748b" },
  configForm: { display: "flex", flexDirection: "column", gap: 10 },
  cfgField: { display: "flex", flexDirection: "column", gap: 4 },
  cfgFieldLabel: { fontSize: 12, fontWeight: 600, color: "#475569" },
  cfgInput: {
    padding: "8px 10px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 7,
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  saveConfigBtn: {
    padding: "9px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
};
