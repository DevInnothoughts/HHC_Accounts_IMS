// ============================================================
// FRONTEND: src/pages/BudgetManagement.jsx
// ============================================================
import { useState, useEffect, useCallback } from "react";
import React from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";

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
const EXPENSE_TYPES = ["All", "Revenue", "Capital"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

const INIT = {
  branch: "",
  expenseType: "All",
  totalBudget: "",
  alertThreshold: 80,
  hardLimit: false,
  year: CURRENT_YEAR,
  month: new Date().getMonth() + 1,
  status: "active",
};

export default function BudgetManagement() {
  const [budgets, setBudgets] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(INIT);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState("");
  const [filterYear, setFilterYear] = useState(CURRENT_YEAR);
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);

  const fetchBudgets = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(
        `/budgets?year=${filterYear}&month=${filterMonth}`,
      );
      setBudgets(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filterYear, filterMonth]);

  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);
  useEffect(() => {
    api
      .get("/branches")
      .then((r) => setBranches(r.data.branches || r.data))
      .catch(console.error);
  }, []);

  const set = (f) => (e) => setForm((fm) => ({ ...fm, [f]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.branch) e.branch = "Branch required";
    if (!form.totalBudget || Number(form.totalBudget) <= 0)
      e.totalBudget = "Valid budget amount required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (modal === "create") {
        await api.post("/budgets", {
          ...form,
          totalBudget: Number(form.totalBudget),
        });
      } else {
        await api.put(`/budgets/${form._id}`, {
          ...form,
          totalBudget: Number(form.totalBudget),
        });
      }
      setSuccess(modal === "create" ? "Budget created!" : "Budget updated!");
      setModal(null);
      fetchBudgets();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async (budgetId) => {
    try {
      await api.post(`/budgets/${budgetId}/recalculate`);
      fetchBudgets();
    } catch (err) {
      alert("Recalculation failed");
    }
  };

  const getUtilColor = (pct) =>
    pct >= 100 ? "#dc2626" : pct >= 80 ? "#d97706" : "#16a34a";

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>💰 Budget Management</h1>
            <p style={S.sub}>Monitor and control branch spending</p>
          </div>
          <button
            style={S.createBtn}
            onClick={() => {
              setForm(INIT);
              setErrors({});
              setModal("create");
            }}
          >
            + Set Budget
          </button>
        </div>

        {success && <div style={S.success}>{success}</div>}

        {/* Filters */}
        <div style={S.filterBar}>
          <select
            style={S.select}
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select
            style={S.select}
            value={filterMonth}
            onChange={(e) => setFilterMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div style={S.loading}>Loading budgets...</div>
        ) : (
          <div style={S.grid}>
            {budgets.map((b) => {
              const pct = Math.min(100, b.utilizationPercent || 0);
              const color = getUtilColor(pct);
              return (
                <div key={b._id} style={S.card}>
                  <div style={S.cardTop}>
                    <div>
                      <div style={S.branchName}>{b.branch?.name}</div>
                      <div style={S.branchCode}>
                        {b.branch?.code} · {b.expenseType} ·{" "}
                        {MONTHS[b.month - 1]} {b.year}
                      </div>
                    </div>
                    <div style={S.cardActions}>
                      {b.hardLimit && (
                        <span style={S.hardLimitBadge}>🔒 Hard Limit</span>
                      )}
                      <button
                        style={S.editBtn}
                        onClick={() => {
                          setForm({ ...b, branch: b.branch?._id });
                          setErrors({});
                          setModal("edit");
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={S.progressWrap}>
                    <div style={S.progressTrack}>
                      <div
                        style={{
                          ...S.progressFill,
                          width: `${pct}%`,
                          background: color,
                        }}
                      />
                      {b.alertThreshold && (
                        <div
                          style={{
                            ...S.thresholdLine,
                            left: `${b.alertThreshold}%`,
                          }}
                          title={`Alert at ${b.alertThreshold}%`}
                        />
                      )}
                    </div>
                    <span style={{ ...S.progressPct, color }}>{pct}%</span>
                  </div>

                  <div style={S.amounts}>
                    <div style={S.amtBox}>
                      <div style={S.amtLabel}>Total Budget</div>
                      <div style={S.amtVal}>
                        ₹{(b.totalBudget || 0).toLocaleString("en-IN")}
                      </div>
                    </div>
                    <div style={S.amtBox}>
                      <div style={S.amtLabel}>Utilized</div>
                      <div
                        style={{ ...S.amtVal, color }}
                      >{`₹${(b.utilized || 0).toLocaleString("en-IN")}`}</div>
                    </div>
                    <div style={S.amtBox}>
                      <div style={S.amtLabel}>Remaining</div>
                      <div style={{ ...S.amtVal, color: "#16a34a" }}>
                        ₹
                        {Math.max(
                          0,
                          (b.totalBudget || 0) - (b.utilized || 0),
                        ).toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>

                  <button
                    style={S.recalcBtn}
                    onClick={() => handleRecalculate(b._id)}
                  >
                    ↻ Recalculate
                  </button>
                </div>
              );
            })}
            {budgets.length === 0 && (
              <div style={S.empty}>
                No budgets configured for {MONTHS[filterMonth - 1]} {filterYear}
              </div>
            )}
          </div>
        )}

        {/* Modal */}
        {modal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <div style={S.modalHeader}>
                <h3 style={S.modalTitle}>
                  {modal === "create" ? "➕ Set Budget" : "✏️ Edit Budget"}
                </h3>
                <button style={S.closeBtn} onClick={() => setModal(null)}>
                  ✕
                </button>
              </div>
              {errors.submit && <div style={S.errorBox}>{errors.submit}</div>}
              <div style={S.formGrid}>
                <Field label="Branch *" error={errors.branch} fullWidth>
                  <select
                    style={{ ...S.input, ...(errors.branch ? S.inputErr : {}) }}
                    value={form.branch}
                    onChange={set("branch")}
                  >
                    <option value="">Select Branch</option>
                    {branches.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Year">
                  <select
                    style={S.input}
                    value={form.year}
                    onChange={set("year")}
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Month">
                  <select
                    style={S.input}
                    value={form.month}
                    onChange={set("month")}
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i + 1} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Expense Type">
                  <select
                    style={S.input}
                    value={form.expenseType}
                    onChange={set("expenseType")}
                  >
                    {EXPENSE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Total Budget (₹) *" error={errors.totalBudget}>
                  <input
                    style={{
                      ...S.input,
                      ...(errors.totalBudget ? S.inputErr : {}),
                    }}
                    type="number"
                    min="0"
                    value={form.totalBudget}
                    onChange={set("totalBudget")}
                    placeholder="e.g. 500000"
                  />
                </Field>
                <Field label={`Alert Threshold (${form.alertThreshold}%)`}>
                  <input
                    style={S.input}
                    type="range"
                    min="50"
                    max="100"
                    value={form.alertThreshold}
                    onChange={set("alertThreshold")}
                  />
                </Field>
                <Field label="Hard Limit" fullWidth>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.hardLimit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, hardLimit: e.target.checked }))
                      }
                      style={{ width: 18, height: 18 }}
                    />
                    <span style={{ fontSize: 13 }}>
                      Block payment requests that exceed this budget
                    </span>
                  </label>
                </Field>
              </div>
              <div style={S.modalBtns}>
                <button style={S.cancelBtn} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  style={{ ...S.saveBtn, opacity: saving ? 0.7 : 1 }}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : modal === "create"
                      ? "Create Budget"
                      : "Update Budget"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const Field = ({ label, error, children, fullWidth }) => (
  <div
    style={{
      gridColumn: fullWidth ? "1/-1" : undefined,
      display: "flex",
      flexDirection: "column",
      gap: 5,
    }}
  >
    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
      {label}
    </label>
    {children}
    {error && <span style={{ fontSize: 11, color: "#dc2626" }}>{error}</span>}
  </div>
);

const C = { primary: "#1a3c6e", accent: "#2563eb", border: "#e2e8f0" };
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px" },
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
  success: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    padding: "10px 16px",
    color: "#16a34a",
    fontSize: 14,
    marginBottom: 14,
  },
  filterBar: { display: "flex", gap: 10, marginBottom: 16 },
  select: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
  },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: 16,
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "18px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  branchName: { fontSize: 15, fontWeight: 700, color: C.primary },
  branchCode: { fontSize: 12, color: "#94a3b8", marginTop: 3 },
  cardActions: { display: "flex", gap: 8, alignItems: "center" },
  hardLimitBadge: {
    fontSize: 11,
    background: "#fef2f2",
    color: "#dc2626",
    padding: "2px 8px",
    borderRadius: 20,
    fontWeight: 600,
  },
  editBtn: {
    background: "none",
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
  },
  progressWrap: { display: "flex", alignItems: "center", gap: 10 },
  progressTrack: {
    flex: 1,
    height: 10,
    background: "#f1f5f9",
    borderRadius: 6,
    overflow: "visible",
    position: "relative",
  },
  progressFill: { height: "100%", borderRadius: 6, transition: "width 0.5s" },
  thresholdLine: {
    position: "absolute",
    top: -4,
    width: 2,
    height: 18,
    background: "#d97706",
    borderRadius: 1,
  },
  progressPct: { fontSize: 13, fontWeight: 700, minWidth: 38 },
  amounts: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 },
  amtBox: { background: "#f8fafc", borderRadius: 8, padding: "8px 10px" },
  amtLabel: {
    fontSize: 10,
    color: "#94a3b8",
    fontWeight: 600,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  amtVal: { fontSize: 13, fontWeight: 700, color: "#334155" },
  recalcBtn: {
    background: "none",
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    padding: "6px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
    alignSelf: "flex-end",
  },
  empty: {
    gridColumn: "1/-1",
    padding: 40,
    textAlign: "center",
    color: "#94a3b8",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    padding: 28,
    width: "100%",
    maxWidth: 520,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: 700, color: C.primary, margin: 0 },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    color: "#94a3b8",
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 14,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    marginBottom: 20,
  },
  input: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  inputErr: { borderColor: "#dc2626", background: "#fef2f2" },
  modalBtns: { display: "flex", gap: 10 },
  cancelBtn: {
    flex: 1,
    padding: "10px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    color: "#475569",
  },
  saveBtn: {
    flex: 1,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: C.accent,
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
};
