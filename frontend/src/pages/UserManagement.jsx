// ============================================================
// FRONTEND: src/pages/UserManagement.jsx
// ============================================================
import { useState, useEffect, useCallback } from "react";
import React from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";

const ROLES_LIST = [
  "branch_user",
  "branch_partner",
  "cluster_head",
  "accounts",
  "director",
  "super_admin",
];
const ROLE_COLORS = {
  branch_user: "#2563eb",
  branch_partner: "#7c3aed",
  cluster_head: "#d97706",
  accounts: "#16a34a",
  director: "#dc2626",
  super_admin: "#0f172a",
};
const ROLE_LABELS = {
  branch_user: "Branch User",
  branch_partner: "Branch Partner",
  cluster_head: "Cluster Head",
  accounts: "Accounts",
  director: "Director",
  super_admin: "Super Admin",
};

const INIT_USER = {
  name: "",
  email: "",
  mobile: "",
  role: "branch_user",
  branches: [],
  status: "active",
};

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [modal, setModal] = useState(null); // null | 'create' | 'edit'
  const [form, setForm] = useState(INIT_USER);
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: 15,
        ...(search && { search }),
        ...(filterRole && { role: filterRole }),
        ...(filterStatus && { status: filterStatus }),
      });
      const { data } = await api.get(`/users?${params}`);
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterRole, filterStatus]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);
  useEffect(() => {
    api
      .get("/branches")
      .then((r) =>
        setBranches(Array.isArray(r.data) ? r.data : r.data.branches || []),
      )
      .catch(console.error);
  }, []);

  const set = (f) => (e) => {
    setForm((fm) => ({ ...fm, [f]: e.target.value }));
    if (errors[f]) setErrors((er) => ({ ...er, [f]: "" }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Name required";
    if (!form.email.trim()) e.email = "Email required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Invalid email";
    if (!form.mobile.trim()) e.mobile = "Mobile required";
    if (!form.role) e.role = "Role required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (modal === "create") {
        await api.post("/users", form);
        setSuccess("User created successfully!");
      } else {
        await api.put(`/users/${form._id}`, form);
        setSuccess("User updated successfully!");
      }
      setModal(null);
      setForm(INIT_USER);
      fetchUsers();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (userId) => {
    try {
      await api.patch(`/users/${userId}/toggle-status`);
      fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (user) => {
    setForm({ ...user, branches: user.branches?.map((b) => b._id || b) || [] });
    setErrors({});
    setModal("edit");
  };

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>User Management</h1>
            <p style={S.sub}>{total} users registered</p>
          </div>
          <button
            style={S.createBtn}
            onClick={() => {
              setForm(INIT_USER);
              setErrors({});
              setModal("create");
            }}
          >
            + Add User
          </button>
        </div>

        {success && <div style={S.success}>{success}</div>}

        {/* Filters */}
        <div style={S.filterBar}>
          <input
            style={S.searchInput}
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            style={S.select}
            value={filterRole}
            onChange={(e) => {
              setFilterRole(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Roles</option>
            {ROLES_LIST.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
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
              setFilterRole("");
              setFilterStatus("");
              setPage(1);
            }}
          >
            Reset
          </button>
        </div>

        {/* Table */}
        <div style={S.tableCard}>
          {loading ? (
            <div style={S.loading}>Loading users...</div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  {[
                    "Name",
                    "Email",
                    "Mobile",
                    "Role",
                    "Branches",
                    "Status",
                    "Last Login",
                    "Actions",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id} style={S.tr}>
                    <td style={S.td}>
                      <div style={S.userAvatar}>
                        <div
                          style={{
                            ...S.avatar,
                            background: ROLE_COLORS[u.role] + "22",
                            color: ROLE_COLORS[u.role],
                          }}
                        >
                          {u.name?.[0]?.toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, color: "#334155" }}>
                          {u.name}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...S.td, fontSize: 13 }}>{u.email}</td>
                    <td style={S.td}>{u.mobile}</td>
                    <td style={S.td}>
                      <span
                        style={{
                          ...S.roleBadge,
                          background: ROLE_COLORS[u.role] + "15",
                          color: ROLE_COLORS[u.role],
                        }}
                      >
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td style={S.td}>
                      {u.branches?.length > 0 ? (
                        <div
                          style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                        >
                          {u.branches.slice(0, 2).map((b) => (
                            <span key={b._id || b} style={S.branchTag}>
                              {b.name || b}
                            </span>
                          ))}
                          {u.branches.length > 2 && (
                            <span style={S.branchTag}>
                              +{u.branches.length - 2}
                            </span>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={S.td}>
                      <span
                        style={{
                          ...S.statusDot,
                          background:
                            u.status === "active" ? "#16a34a" : "#dc2626",
                        }}
                      />
                      <span
                        style={{
                          fontSize: 13,
                          color: u.status === "active" ? "#16a34a" : "#dc2626",
                          fontWeight: 600,
                          textTransform: "capitalize",
                        }}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: "#94a3b8" }}>
                      {u.lastLogin
                        ? new Date(u.lastLogin).toLocaleDateString("en-GB")
                        : "Never"}
                    </td>
                    <td style={S.td}>
                      <div style={S.actions}>
                        <button style={S.actionBtn} onClick={() => openEdit(u)}>
                          Edit
                        </button>
                        <button
                          style={{
                            ...S.actionBtn,
                            color:
                              u.status === "active" ? "#dc2626" : "#16a34a",
                          }}
                          onClick={() => handleToggleStatus(u._id)}
                        >
                          {u.status === "active" ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: 40,
                        textAlign: "center",
                        color: "#94a3b8",
                      }}
                    >
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

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
            disabled={users.length < 15}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>

        {/* User Modal */}
        {modal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <div style={S.modalHeader}>
                <h3 style={S.modalTitle}>
                  {modal === "create" ? "➕ Add New User" : "✏️ Edit User"}
                </h3>
                <button style={S.closeBtn} onClick={() => setModal(null)}>
                  ✕
                </button>
              </div>

              {errors.submit && <div style={S.errorBox}>{errors.submit}</div>}

              <div style={S.formGrid}>
                <MField label="Full Name *" error={errors.name}>
                  <input
                    style={{ ...S.input, ...(errors.name ? S.inputError : {}) }}
                    value={form.name}
                    onChange={set("name")}
                    placeholder="Full name"
                  />
                </MField>
                <MField label="Email *" error={errors.email}>
                  <input
                    style={{
                      ...S.input,
                      ...(errors.email ? S.inputError : {}),
                    }}
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    placeholder="email@domain.com"
                    disabled={modal === "edit"}
                  />
                </MField>
                <MField label="Mobile *" error={errors.mobile}>
                  <input
                    style={{
                      ...S.input,
                      ...(errors.mobile ? S.inputError : {}),
                    }}
                    value={form.mobile}
                    onChange={set("mobile")}
                    placeholder="10-digit mobile"
                    maxLength={10}
                  />
                </MField>
                <MField label="Role *" error={errors.role}>
                  <select
                    style={S.input}
                    value={form.role}
                    onChange={set("role")}
                  >
                    {ROLES_LIST.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
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
                <MField label="Branches" fullWidth>
                  <div style={S.branchSelect}>
                    {branches.map((b) => (
                      <label key={b._id} style={S.checkItem}>
                        <input
                          type="checkbox"
                          checked={form.branches.includes(b._id)}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              branches: e.target.checked
                                ? [...f.branches, b._id]
                                : f.branches.filter((id) => id !== b._id),
                            }))
                          }
                        />
                        <span style={{ fontSize: 13 }}>
                          {b.name} ({b.code})
                        </span>
                      </label>
                    ))}
                  </div>
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
                      ? "Create User"
                      : "Update User"}
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
  filterBar: { display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" },
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
  tr: { borderBottom: "1px solid #f8fafc" },
  td: { padding: "12px 14px", color: "#334155", verticalAlign: "middle" },
  userAvatar: { display: "flex", alignItems: "center", gap: 10 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
    flexShrink: 0,
  },
  roleBadge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  branchTag: {
    background: "#f0f4ff",
    color: "#2563eb",
    padding: "2px 7px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
  },
  statusDot: {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    marginRight: 5,
  },
  actions: { display: "flex", gap: 10 },
  actionBtn: {
    background: "none",
    border: "none",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
    padding: "2px 4px",
  },
  loading: { padding: 50, textAlign: "center", color: "#94a3b8" },
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
  branchSelect: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 6,
    maxHeight: 160,
    overflowY: "auto",
    padding: "8px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#f8fafc",
  },
  checkItem: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    cursor: "pointer",
    padding: "4px 6px",
    borderRadius: 6,
  },
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
