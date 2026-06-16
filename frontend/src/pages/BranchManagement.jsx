// ============================================================
// FRONTEND: src/pages/BranchManagement.jsx
// ============================================================
import { useState, useEffect, useCallback } from "react";
import React from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";

const INIT_BRANCH = {
  name: "",
  code: "",
  location: "",
  // clusterHead: "",
  // partner: "",
  monthlyBudget: "",
  status: "active",
};

export default function BranchManagement() {
  const [branches, setBranches] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(INIT_BRANCH);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState("");

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: 15,
        ...(search && { search }),
        ...(filterStatus && { status: filterStatus }),
      });
      const { data } = await api.get(`/branches?${params}`);
      setBranches(data.branches || data);
      setTotal(data.total || (data.branches || data).length);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterStatus]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  // useEffect(() => {
  //   api
  //     .get("/users?role=cluster_head&limit=100")
  //     .then((r) =>
  //       setUsers(Array.isArray(r.data) ? r.data : r.data.users || []),
  //     )
  //     .catch(console.error);

  //   api
  //     .get("/users?role=branch_partner&limit=100")
  //     .then((r) => {
  //       const incoming = Array.isArray(r.data) ? r.data : r.data.users || [];
  //       setUsers((u) => {
  //         const existing = u.map((x) => x._id);
  //         return [...u, ...incoming.filter((x) => !existing.includes(x._id))];
  //       });
  //     })
  //     .catch(console.error);
  // }, []);

  const set = (f) => (e) => {
    setForm((fm) => ({ ...fm, [f]: e.target.value }));
    if (errors[f]) setErrors((er) => ({ ...er, [f]: "" }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Branch name required";
    if (!form.code.trim()) e.code = "Branch code required";
    if (!form.location.trim()) e.location = "Location required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        // ...(form.clusterHead === "" && { clusterHead: null }),
        //...(form.partner === "" && { partner: null }),
      };
      if (modal === "create") {
        await api.post("/branches", payload);
        setSuccess("Branch created!");
      } else {
        await api.put(`/branches/${form._id}`, payload);
        setSuccess("Branch updated!");
      }
      setModal(null);
      setForm(INIT_BRANCH);
      fetchBranches();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id) => {
    try {
      await api.patch(`/branches/${id}/toggle-status`);
      fetchBranches();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (b) => {
    setForm({
      ...b,
      //clusterHead: b.clusterHead?._id || "",
      //partner: b.partner?._id || "",
      monthlyBudget: b.monthlyBudget || "",
    });
    setErrors({});
    setModal("edit");
  };

  //const clusterHeads = users.filter((u) => u.role === "cluster_head");
  //const partners = users.filter((u) => u.role === "branch_partner");

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>Branch Management</h1>
            <p style={S.sub}>{total} branches registered</p>
          </div>
          <button
            style={S.createBtn}
            onClick={() => {
              setForm(INIT_BRANCH);
              setErrors({});
              setModal("create");
            }}
          >
            + Add Branch
          </button>
        </div>

        {success && <div style={S.success}>{success}</div>}

        <div style={S.filterBar}>
          <input
            style={S.searchInput}
            placeholder="Search name, code, location..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            style={S.select}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            style={S.resetBtn}
            onClick={() => {
              setSearch("");
              setFilterStatus("");
              setPage(1);
            }}
          >
            Reset
          </button>
        </div>

        {/* Branch Cards */}
        {loading ? (
          <div style={S.loading}>Loading branches...</div>
        ) : (
          <div style={S.branchGrid}>
            {branches.map((b) => (
              <div
                key={b._id}
                style={{
                  ...S.branchCard,
                  borderTop: `3px solid ${b.status === "active" ? "#16a34a" : "#94a3b8"}`,
                }}
              >
                <div style={S.branchCardHeader}>
                  <div>
                    <div style={S.branchCardName}>{b.name}</div>
                    <div style={S.branchCardCode}>{b.code}</div>
                  </div>
                  <span
                    style={{
                      ...S.statusBadge,
                      background: b.status === "active" ? "#f0fdf4" : "#f8fafc",
                      color: b.status === "active" ? "#16a34a" : "#94a3b8",
                    }}
                  >
                    {b.status === "active" ? "● Active" : "○ Inactive"}
                  </span>
                </div>

                <div style={S.branchDetail}>
                  <span style={S.detailIcon}>📍</span>
                  {b.location}
                </div>
                {b.clusterHead && (
                  <div style={S.branchDetail}>
                    <span style={S.detailIcon}>👔</span>CH: {b.clusterHead.name}
                  </div>
                )}
                {b.partner && (
                  <div style={S.branchDetail}>
                    <span style={S.detailIcon}>🤝</span>Partner:{" "}
                    {b.partner.name}
                  </div>
                )}
                {b.monthlyBudget > 0 && (
                  <div style={S.branchDetail}>
                    <span style={S.detailIcon}>💰</span>Budget: ₹
                    {b.monthlyBudget.toLocaleString("en-IN")}/mo
                  </div>
                )}

                <div style={S.branchCardActions}>
                  <button style={S.cardActionBtn} onClick={() => openEdit(b)}>
                    ✏️ Edit
                  </button>
                  <button
                    style={{
                      ...S.cardActionBtn,
                      color: b.status === "active" ? "#dc2626" : "#16a34a",
                    }}
                    onClick={() => handleToggle(b._id)}
                  >
                    {b.status === "active" ? "⊘ Deactivate" : "✓ Activate"}
                  </button>
                </div>
              </div>
            ))}
            {branches.length === 0 && (
              <div style={S.empty}>No branches found</div>
            )}
          </div>
        )}

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
            disabled={branches.length < 15}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>

        {/* Branch Modal */}
        {modal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <div style={S.modalHeader}>
                <h3 style={S.modalTitle}>
                  {modal === "create" ? "🏥 Add Branch" : "✏️ Edit Branch"}
                </h3>
                <button style={S.closeBtn} onClick={() => setModal(null)}>
                  ✕
                </button>
              </div>

              {errors.submit && <div style={S.errorBox}>{errors.submit}</div>}

              <div style={S.formGrid}>
                <MField label="Branch Name *" error={errors.name}>
                  <input
                    style={{ ...S.input, ...(errors.name ? S.inputError : {}) }}
                    value={form.name}
                    onChange={set("name")}
                    placeholder="e.g. Pune Main Branch"
                  />
                </MField>
                <MField label="Branch Code *" error={errors.code}>
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
                    placeholder="e.g. PNQ01"
                    maxLength={10}
                    disabled={modal === "edit"}
                  />
                </MField>
                <MField label="Location *" error={errors.location} fullWidth>
                  <input
                    style={{
                      ...S.input,
                      ...(errors.location ? S.inputError : {}),
                    }}
                    value={form.location}
                    onChange={set("location")}
                    placeholder="City, State"
                  />
                </MField>
                {/* <MField label="Cluster Head">
                  <select
                    style={S.input}
                    value={form.clusterHead}
                    onChange={set("clusterHead")}
                  >
                    <option value="">None</option>
                    {clusterHeads.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </MField>
                <MField label="Branch Partner">
                  <select
                    style={S.input}
                    value={form.partner}
                    onChange={set("partner")}
                  >
                    <option value="">None</option>
                    {partners.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </MField> */}
                <MField label="Monthly Budget (₹)">
                  <div style={{ position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 11,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#64748b",
                        fontWeight: 600,
                      }}
                    >
                      ₹
                    </span>
                    <input
                      style={{ ...S.input, paddingLeft: 24 }}
                      type="number"
                      min="0"
                      value={form.monthlyBudget}
                      onChange={set("monthlyBudget")}
                      placeholder="0"
                    />
                  </div>
                </MField>
                <MField label="Status">
                  <select
                    style={S.input}
                    value={form.status}
                    onChange={set("status")}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </MField>
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
                      ? "Create Branch"
                      : "Update Branch"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const MField = ({ label, error, children, fullWidth }) => (
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
  main: { flex: 1, padding: "24px 28px", overflowY: "auto" },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
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
  filterBar: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  searchInput: {
    flex: 1,
    minWidth: 200,
    padding: "9px 14px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
  },
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
  branchGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 16,
  },
  branchCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "18px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  branchCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  branchCardName: { fontSize: 16, fontWeight: 700, color: C.primary },
  branchCardCode: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "monospace",
    marginTop: 2,
  },
  statusBadge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  branchDetail: {
    fontSize: 13,
    color: "#475569",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  detailIcon: { fontSize: 14, width: 18 },
  branchCardActions: {
    display: "flex",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: `1px solid ${C.border}`,
  },
  cardActionBtn: {
    flex: 1,
    padding: "7px",
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    background: "#f8fafc",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
  },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  empty: {
    gridColumn: "1/-1",
    padding: 40,
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 14,
  },
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    marginTop: 18,
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
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
    padding: 20,
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    padding: 28,
    width: "100%",
    maxWidth: 560,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
    maxHeight: "90vh",
    overflowY: "auto",
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
    marginBottom: 16,
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
  inputError: { borderColor: "#dc2626", background: "#fef2f2" },
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
    fontSize: 14,
  },
};
