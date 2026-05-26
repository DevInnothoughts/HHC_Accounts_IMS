import { useState, useEffect, useCallback } from "react";
import React from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";

const INIT = {
  name: "",
  code: "",
  type: "Revenue",
  description: "",
  status: "active",
};

export default function ExpenseCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(INIT);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState("");
  const [filter, setFilter] = useState("");

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/expense-categories");
      setCategories(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const set = (f) => (e) => {
    setForm((fm) => ({ ...fm, [f]: e.target.value }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Name required";
    if (!form.code.trim()) e.code = "Code required";
    if (!form.type) e.type = "Type required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (modal === "create") {
        await api.post("/expense-categories", {
          ...form,
          code: form.code.toUpperCase(),
        });
        setSuccess("Category created!");
      } else {
        await api.put(`/expense-categories/${form._id}`, form);
        setSuccess("Category updated!");
      }
      setModal(null);
      setForm(INIT);
      fetchCategories();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const filtered = categories.filter((c) => !filter || c.type === filter);

  const revenue = filtered.filter((c) => c.type === "Revenue");
  const capital = filtered.filter((c) => c.type === "Capital");

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>Expense Categories</h1>
            <p style={S.sub}>{categories.length} categories configured</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <select
              style={S.select}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">All Types</option>
              <option value="Revenue">Revenue</option>
              <option value="Capital">Capital</option>
            </select>
            <button
              style={S.createBtn}
              onClick={() => {
                setForm(INIT);
                setErrors({});
                setModal("create");
              }}
            >
              + Add Category
            </button>
          </div>
        </div>

        {success && <div style={S.success}>{success}</div>}

        {loading ? (
          <div style={S.loading}>Loading...</div>
        ) : (
          <div style={S.grid2}>
            {/* Revenue */}
            <div>
              <div style={S.groupHeader}>
                <span style={{ ...S.groupDot, background: "#2563eb" }} />
                <span style={S.groupTitle}>Revenue Expenses</span>
                <span style={S.groupCount}>{revenue.length}</span>
              </div>
              {revenue.map((c) => (
                <div key={c._id} style={S.catCard}>
                  <div style={S.catLeft}>
                    <div style={S.catCode}>{c.code}</div>
                    <div>
                      <div style={S.catName}>{c.name}</div>
                      {c.description && (
                        <div style={S.catDesc}>{c.description}</div>
                      )}
                    </div>
                  </div>
                  <div style={S.catRight}>
                    <span
                      style={{
                        ...S.statusDot,
                        background:
                          c.status === "active" ? "#16a34a" : "#dc2626",
                      }}
                    />
                    <button
                      style={S.editBtn}
                      onClick={() => {
                        setForm(c);
                        setErrors({});
                        setModal("edit");
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
              {revenue.length === 0 && (
                <div style={S.empty}>No revenue categories</div>
              )}
            </div>

            {/* Capital */}
            <div>
              <div style={S.groupHeader}>
                <span style={{ ...S.groupDot, background: "#d97706" }} />
                <span style={S.groupTitle}>Capital Expenses</span>
                <span style={S.groupCount}>{capital.length}</span>
              </div>
              {capital.map((c) => (
                <div key={c._id} style={S.catCard}>
                  <div style={S.catLeft}>
                    <div style={S.catCode}>{c.code}</div>
                    <div>
                      <div style={S.catName}>{c.name}</div>
                      {c.description && (
                        <div style={S.catDesc}>{c.description}</div>
                      )}
                    </div>
                  </div>
                  <div style={S.catRight}>
                    <span
                      style={{
                        ...S.statusDot,
                        background:
                          c.status === "active" ? "#16a34a" : "#dc2626",
                      }}
                    />
                    <button
                      style={S.editBtn}
                      onClick={() => {
                        setForm(c);
                        setErrors({});
                        setModal("edit");
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
              {capital.length === 0 && (
                <div style={S.empty}>No capital categories</div>
              )}
            </div>
          </div>
        )}

        {/* Modal */}
        {modal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <div style={S.modalHeader}>
                <h3 style={S.modalTitle}>
                  {modal === "create" ? "➕ Add Category" : "✏️ Edit Category"}
                </h3>
                <button style={S.closeBtn} onClick={() => setModal(null)}>
                  ✕
                </button>
              </div>
              {errors.submit && <div style={S.errorBox}>{errors.submit}</div>}
              <div style={S.formGrid}>
                <div style={S.field}>
                  <label style={S.label}>Category Name *</label>
                  <input
                    style={{ ...S.input, ...(errors.name ? S.inputError : {}) }}
                    value={form.name}
                    onChange={set("name")}
                    placeholder="e.g. Electricity Bill"
                  />
                  {errors.name && <span style={S.errText}>{errors.name}</span>}
                </div>
                <div style={S.field}>
                  <label style={S.label}>Category Code *</label>
                  <input
                    style={{
                      ...S.input,
                      ...(errors.code ? S.inputError : {}),
                      textTransform: "uppercase",
                    }}
                    value={form.code}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        code: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. ELEC"
                    maxLength={10}
                  />
                  {errors.code && <span style={S.errText}>{errors.code}</span>}
                </div>
                <div style={S.field}>
                  <label style={S.label}>Expense Type *</label>
                  <select
                    style={S.input}
                    value={form.type}
                    onChange={set("type")}
                  >
                    <option value="Revenue">Revenue</option>
                    <option value="Capital">Capital</option>
                  </select>
                </div>
                <div style={S.field}>
                  <label style={S.label}>Status</label>
                  <select
                    style={S.input}
                    value={form.status}
                    onChange={set("status")}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div style={{ ...S.field, gridColumn: "1/-1" }}>
                  <label style={S.label}>Description</label>
                  <textarea
                    style={{
                      ...S.input,
                      minHeight: 70,
                      resize: "vertical",
                      fontFamily: "inherit",
                    }}
                    value={form.description}
                    onChange={set("description")}
                    placeholder="Optional description..."
                  />
                </div>
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
                      ? "Create"
                      : "Update"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

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
    padding: "10px 18px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  select: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
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
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 24,
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  groupDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  groupTitle: { fontSize: 15, fontWeight: 700, color: C.primary, flex: 1 },
  groupCount: {
    background: "#f1f5f9",
    color: "#475569",
    padding: "2px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  catCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#fff",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 8,
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    border: `1px solid ${C.border}`,
  },
  catLeft: { display: "flex", gap: 12, alignItems: "center" },
  catCode: {
    background: "#eff6ff",
    color: C.accent,
    padding: "4px 8px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "monospace",
    flexShrink: 0,
  },
  catName: { fontSize: 14, fontWeight: 600, color: "#334155" },
  catDesc: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  catRight: { display: "flex", alignItems: "center", gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: "50%" },
  editBtn: {
    background: "none",
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
  },
  empty: {
    padding: "20px",
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 13,
    background: "#f8fafc",
    borderRadius: 8,
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
    maxWidth: 480,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: 700, color: C.primary, margin: 0 },
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
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 12, fontWeight: 600, color: "#475569" },
  input: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  inputError: { borderColor: "#dc2626", background: "#fef2f2" },
  errText: { fontSize: 11, color: "#dc2626" },
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
