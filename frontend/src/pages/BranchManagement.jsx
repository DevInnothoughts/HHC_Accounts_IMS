// ============================================================
// FRONTEND: src/pages/BranchManagement.jsx
// ============================================================
import { useState, useEffect, useCallback } from "react";
import React from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";

import { useAuth } from "../context/AuthContext.jsx";

const INDIAN_BANKS = [
  "Federal Bank",
  "HDFC Bank",
  "Kotak Mahindra Bank",
  "State Bank of India",
  "ICICI Bank",
  "Axis Bank",
  "Punjab National Bank",
  "Bank of Baroda",
  "Canara Bank",
  "Union Bank of India",
  "IndusInd Bank",
  "IDFC FIRST Bank",
  "Yes Bank",
  "Bank of India",
  "Central Bank of India",
  "Indian Bank",
  "RBL Bank",
  "Other",
];

const BLANK_ACCOUNT = {
  label: "",
  bankName: "Federal Bank",
  accountHolderName: "",
  accountNumber: "",
  ifscCode: "",
  rtgsThreshold: 200000,
  isDefault: false,
  status: "active",
};

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
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [accounts, setAccounts] = useState([]);
  const [accountErrors, setAccountErrors] = useState([]);
  const [savingAccounts, setSavingAccounts] = useState(false);
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

  const setAccount = (idx, field, value) =>
    setAccounts((list) =>
      list.map((a, i) => (i === idx ? { ...a, [field]: value } : a)),
    );

  const addAccount = () =>
    setAccounts((list) => [
      ...list,
      { ...BLANK_ACCOUNT, isDefault: list.length === 0 },
    ]);

  const removeAccount = (idx) =>
    setAccounts((list) => list.filter((_, i) => i !== idx));

  // Only one default, and only among active accounts.
  const makeDefault = (idx) =>
    setAccounts((list) => list.map((a, i) => ({ ...a, isDefault: i === idx })));

  const validateAccounts = () => {
    const errs = [];
    accounts.forEach((a, i) => {
      const n = i + 1;
      if (!a.bankName?.trim()) errs.push(`Account ${n}: select a bank`);
      if (!/^[0-9]{6,20}$/.test(String(a.accountNumber || "").trim()))
        errs.push(`Account ${n}: account number must be 6–20 digits`);
      if (
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(a.ifscCode || "").toUpperCase())
      )
        errs.push(`Account ${n}: invalid IFSC (e.g. FDRL0001234)`);
      if (a.rtgsThreshold !== "" && Number(a.rtgsThreshold) < 0)
        errs.push(`Account ${n}: RTGS threshold cannot be negative`);
    });
    const active = accounts.filter((a) => a.status !== "inactive");
    if (active.length > 0 && !active.some((a) => a.isDefault))
      errs.push("Mark one active account as the default");
    setAccountErrors(errs);
    return errs.length === 0;
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
    if (!validateAccounts()) return;

    // Accounts users only manage bank accounts on an existing branch.
    if (!isSuperAdmin) {
      setSavingAccounts(true);
      try {
        await api.put(`/branches/${form._id}/bank-accounts`, {
          bankAccounts: accounts,
        });
        setSuccess("Bank accounts updated!");
        setModal(null);
        setForm(INIT_BRANCH);
        fetchBranches();
        setTimeout(() => setSuccess(""), 3000);
      } catch (err) {
        const data = err.response?.data;
        setAccountErrors(data?.errors || [data?.message || "Save failed"]);
      } finally {
        setSavingAccounts(false);
      }
      return;
    }

    if (!validate()) return;
    setSaving(true);
    try {
      if (modal === "create") {
        // Bank accounts ride along with the new branch in one request.
        await api.post("/branches", { ...form, bankAccounts: accounts });
        setSuccess("Branch created!");
      } else {
        // updateBranch ignores bankAccounts by design — they go separately.
        await api.put(`/branches/${form._id}`, form);
        await api.put(`/branches/${form._id}/bank-accounts`, {
          bankAccounts: accounts,
        });
        setSuccess("Branch updated!");
      }
      setModal(null);
      setForm(INIT_BRANCH);
      setAccounts([]);
      fetchBranches();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors?.length) setAccountErrors(data.errors);
      else setErrors({ submit: data?.message || "Save failed" });
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
    setAccounts(b.bankAccounts?.map((a) => ({ ...a })) || []);
    setAccountErrors([]);
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
          {isSuperAdmin && (
            <button
              style={S.createBtn}
              onClick={() => {
                setForm(INIT_BRANCH);
                setErrors({});
                setAccounts([]);
                setAccountErrors([]);
                setModal("create");
              }}
            >
              + Add Branch
            </button>
          )}
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
                  {isSuperAdmin && (
                    <button
                      style={{
                        ...S.cardActionBtn,
                        color: b.status === "active" ? "#dc2626" : "#16a34a",
                      }}
                      onClick={() => handleToggle(b._id)}
                    >
                      {b.status === "active" ? "⊘ Deactivate" : "✓ Activate"}
                    </button>
                  )}
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
                    disabled={!isSuperAdmin}
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
                    disabled={modal === "edit" || !isSuperAdmin}
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
                    disabled={!isSuperAdmin}
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

              {/* ── Bank Accounts (debit side of payment files) ──── */}
              <div style={S.bankSection}>
                <div style={S.bankHeader}>
                  <div>
                    <h4 style={S.bankTitle}>🏦 Bank Accounts</h4>
                    <p style={S.bankSub}>
                      Used as the debit account on FedOne bank files. The
                      default is picked automatically unless another is chosen.
                    </p>
                  </div>
                  <button style={S.addAccountBtn} onClick={addAccount}>
                    + Add Account
                  </button>
                </div>

                {accountErrors.length > 0 && (
                  <div style={S.errorBox}>
                    {accountErrors.map((e, i) => (
                      <div key={i}>• {e}</div>
                    ))}
                  </div>
                )}

                {accounts.length === 0 && (
                  <div style={S.bankEmpty}>
                    No bank account yet. FedOne exports for this branch will
                    fail until one is added.
                  </div>
                )}

                {accounts.map((a, idx) => (
                  <div
                    key={a._id || idx}
                    style={{
                      ...S.accountCard,
                      ...(a.status === "inactive" ? { opacity: 0.6 } : {}),
                      ...(a.isDefault ? { borderColor: "#16a34a" } : {}),
                    }}
                  >
                    <div style={S.accountCardTop}>
                      <label style={S.defaultToggle}>
                        <input
                          type="radio"
                          name="defaultAccount"
                          checked={Boolean(a.isDefault)}
                          disabled={a.status === "inactive"}
                          onChange={() => makeDefault(idx)}
                        />
                        <span>{a.isDefault ? "Default" : "Set default"}</span>
                      </label>
                      <button
                        style={S.removeAccountBtn}
                        onClick={() => removeAccount(idx)}
                      >
                        ✕ Remove
                      </button>
                    </div>

                    <div style={S.accountGrid}>
                      <MField label="Bank *">
                        <select
                          style={S.input}
                          value={
                            INDIAN_BANKS.includes(a.bankName)
                              ? a.bankName
                              : "Other"
                          }
                          onChange={(e) =>
                            setAccount(
                              idx,
                              "bankName",
                              e.target.value === "Other" ? "" : e.target.value,
                            )
                          }
                        >
                          {INDIAN_BANKS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </MField>

                      {!INDIAN_BANKS.includes(a.bankName) && (
                        <MField label="Bank Name *">
                          <input
                            style={S.input}
                            value={a.bankName}
                            onChange={(e) =>
                              setAccount(idx, "bankName", e.target.value)
                            }
                            placeholder="Enter bank name"
                          />
                        </MField>
                      )}

                      <MField label="Account Number *">
                        <input
                          style={S.input}
                          value={a.accountNumber}
                          onChange={(e) =>
                            setAccount(
                              idx,
                              "accountNumber",
                              e.target.value.replace(/\D/g, ""),
                            )
                          }
                          placeholder="6–20 digits"
                          maxLength={20}
                        />
                      </MField>

                      <MField label="IFSC Code *">
                        <input
                          style={{ ...S.input, textTransform: "uppercase" }}
                          value={a.ifscCode}
                          onChange={(e) =>
                            setAccount(
                              idx,
                              "ifscCode",
                              e.target.value.toUpperCase(),
                            )
                          }
                          placeholder="e.g. FDRL0001234"
                          maxLength={11}
                        />
                      </MField>

                      <MField label="RTGS Threshold (₹)">
                        <input
                          style={S.input}
                          type="number"
                          min="0"
                          value={a.rtgsThreshold}
                          onChange={(e) =>
                            setAccount(idx, "rtgsThreshold", e.target.value)
                          }
                          placeholder="200000"
                        />
                      </MField>

                      <MField label="Label">
                        <input
                          style={S.input}
                          value={a.label}
                          onChange={(e) =>
                            setAccount(idx, "label", e.target.value)
                          }
                          placeholder="e.g. Operations A/c"
                        />
                      </MField>

                      <MField label="Status">
                        <select
                          style={S.input}
                          value={a.status}
                          onChange={(e) =>
                            setAccount(idx, "status", e.target.value)
                          }
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </MField>
                    </div>
                  </div>
                ))}
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
                  {saving || savingAccounts
                    ? "Saving..."
                    : !isSuperAdmin
                      ? "Save Bank Accounts"
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
  bankSection: {
    borderTop: `1px solid ${C.border}`,
    paddingTop: 18,
    marginBottom: 20,
  },
  bankHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 12,
  },
  bankTitle: { fontSize: 15, fontWeight: 700, color: C.primary, margin: 0 },
  bankSub: { fontSize: 12, color: "#64748b", margin: "4px 0 0" },
  addAccountBtn: {
    padding: "7px 12px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    color: "#0f766e",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  bankEmpty: {
    padding: "14px 16px",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 8,
    fontSize: 13,
    color: "#92400e",
  },
  accountCard: {
    border: `1.5px solid ${C.border}`,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    background: "#f8fafc",
  },
  accountCardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  defaultToggle: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
    fontWeight: 600,
    color: "#16a34a",
    cursor: "pointer",
  },
  removeAccountBtn: {
    background: "none",
    border: "none",
    color: "#dc2626",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  accountGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
};
