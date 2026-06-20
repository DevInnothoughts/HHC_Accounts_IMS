// ============================================================
// FRONTEND: src/pages/Vendors.jsx
// ============================================================
import React from "react";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSearchParams } from "react-router-dom";

const VENDOR_CATEGORIES = [
  "Service Vendors",
  "Equipment Vendors",
  "Utility Vendors",
  "Consultant Vendors",
  "Medical Suppliers",
  "Miscellaneous Vendors",
];

const STATUS_STYLES = {
  active: { bg: "#f0fdf4", color: "#16a34a", label: "Active" },
  inactive: { bg: "#f8fafc", color: "#64748b", label: "Inactive" },
  blacklisted: { bg: "#fef2f2", color: "#dc2626", label: "Blacklisted" },
  frozen: { bg: "#eff6ff", color: "#2563eb", label: "Frozen" },
};

export default function Vendors() {
  const { user } = useAuth();
  const canApproveVendor = ["accounts", "super_admin"].includes(user?.role);
  const navigate = useNavigate();
  const [vendors, setVendors] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    status: "",
    category: "",
    branch: "",
    approvalStatus: searchParams.get("approvalStatus") || "", // ✅ honor dashboard deep-links
  });
  const [branches, setBranches] = useState([]);
  const [deleteModal, setDeleteModal] = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [blacklistReason, setBlacklistReason] = useState("");
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveModal, setApproveModal] = useState(null);

  useEffect(() => {
    if (["accounts", "super_admin", "cluster_head"].includes(user?.role)) {
      api
        .get("/branches?limit=100")
        .then((r) => {
          console.log("role:", user?.role, "branches response:", r.data);
          const list = Array.isArray(r.data) ? r.data : r.data.branches || [];
          console.log("branches list length:", list.length);
          setBranches(list);
        })
        .catch(console.error);
    }
  }, [user]);

  const canManage = ["branch_user", "accounts", "super_admin"].includes(
    user?.role,
  );
  const canChangeStatus = ["accounts", "super_admin"].includes(user?.role);

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: 15,
        ...(search && { search }),
        ...(filters.status && { status: filters.status }),
        ...(filters.category && { category: filters.category }),
        ...(filters.branch && { branch: filters.branch }),
        ...(filters.approvalStatus && {
          approvalStatus: filters.approvalStatus,
        }),
      });
      const { data } = await api.get(`/vendors?${params}`);
      setVendors(data.vendors);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, filters]);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  const handleDelete = async () => {
    try {
      await api.delete(`/vendors/${deleteModal._id}`);
      setDeleteModal(null);
      fetchVendors();
    } catch (err) {
      alert(err.response?.data?.message || "Delete failed");
    }
  };

  const handleStatusChange = async (status) => {
    try {
      await api.patch(`/vendors/${statusModal._id}/status`, {
        status,
        blacklistReason,
      });
      setStatusModal(null);
      setBlacklistReason("");
      fetchVendors();
    } catch (err) {
      alert(err.response?.data?.message || "Status update failed");
    }
  };

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        {/* Header */}
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>Vendor Management</h1>
            <p style={S.sub}>{total} vendors registered</p>
          </div>
          {canManage && (
            <button
              style={S.createBtn}
              onClick={() => navigate("/vendors/new")}
            >
              + Add Vendor
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={S.filterBar}>
          <input
            style={S.searchInput}
            placeholder="Search name, company, PAN, GST..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            style={S.select}
            value={filters.status}
            onChange={(e) => {
              setFilters((f) => ({ ...f, status: e.target.value }));
              setPage(1);
            }}
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_STYLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <select
            style={S.select}
            value={filters.category}
            onChange={(e) => {
              setFilters((f) => ({ ...f, category: e.target.value }));
              setPage(1);
            }}
          >
            <option value="">All Categories</option>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {["accounts", "super_admin", "cluster_head"].includes(user?.role) && (
            <select
              style={S.select}
              value={filters.branch}
              onChange={(e) => {
                setFilters((f) => ({ ...f, branch: e.target.value }));
                setPage(1);
              }}
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name} {b.code ? `(${b.code})` : ""}
                </option>
              ))}
            </select>
          )}
          <select
            style={S.select}
            value={filters.approvalStatus || ""}
            onChange={(e) => {
              setFilters((f) => ({ ...f, approvalStatus: e.target.value }));
              setPage(1);
            }}
          >
            <option value="">All Approval Status</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            style={S.resetBtn}
            onClick={() => {
              setSearch("");
              setFilters({
                status: "",
                category: "",
                branch: "",
                approvalStatus: "",
              });
              setPage(1);
            }}
          >
            Reset
          </button>
        </div>

        {/* Table */}
        <div style={S.tableCard}>
          {loading ? (
            <div style={S.loading}>Loading vendors...</div>
          ) : vendors.length === 0 ? (
            <div style={S.empty}>
              No vendors found.{" "}
              {canManage && (
                <span
                  style={{ color: "#2563eb", cursor: "pointer" }}
                  onClick={() => navigate("/vendors/new")}
                >
                  Add one now.
                </span>
              )}
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  {[
                    "Vendor Name",
                    "Company",
                    "Category",
                    "PAN / GST",
                    "Branch",
                    "Bank",
                    "Status",
                    "Actions",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => {
                  const ss = STATUS_STYLES[v.status] || STATUS_STYLES.active;
                  return (
                    <tr key={v._id} style={S.tr}>
                      <td style={S.td}>
                        <div style={S.vendorName}>{v.vendorName}</div>
                        <div style={S.vendorSub}>
                          {v.contactPerson || v.mobile}
                        </div>
                        {v.approvalStatus === "rejected" &&
                          v.rejectionReason && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#dc2626",
                                marginTop: 3,
                              }}
                            >
                              Rejected: {v.rejectionReason}
                            </div>
                          )}
                      </td>
                      <td style={S.td}>{v.companyName || "—"}</td>
                      <td style={S.td}>
                        <span style={S.catBadge}>{v.vendorCategory}</span>
                      </td>
                      <td style={S.td}>
                        <div style={{ fontSize: 12, fontFamily: "monospace" }}>
                          {v.panNumber}
                        </div>
                        {v.gstNumber && (
                          <div style={{ fontSize: 11, color: "#888" }}>
                            {v.gstNumber}
                          </div>
                        )}
                      </td>
                      <td style={S.td}>{v.branch?.name || "—"}</td>
                      <td style={S.td}>
                        <div style={{ fontSize: 12 }}>{v.bankName}</div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#888",
                            fontFamily: "monospace",
                          }}
                        >
                          ****{v.accountNumber?.slice(-4)}
                        </div>
                      </td>
                      <td style={S.td}>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          {/* Approval status */}
                          <span
                            style={{
                              ...S.statusBadge,
                              ...(v.approvalStatus === "approved"
                                ? { background: "#f0fdf4", color: "#16a34a" }
                                : v.approvalStatus === "rejected"
                                  ? { background: "#fef2f2", color: "#dc2626" }
                                  : {
                                      background: "#fffbeb",
                                      color: "#d97706",
                                    }),
                            }}
                          >
                            {
                              {
                                approved: "✓ Approved",
                                rejected: "✗ Rejected",
                                pending_approval: "⏳ Pending",
                              }[v.approvalStatus]
                            }
                          </span>
                          {/* Vendor active/inactive status */}
                          <span
                            style={{
                              ...S.statusBadge,
                              ...{ background: ss.bg, color: ss.color },
                              fontSize: 10,
                            }}
                          >
                            {ss.label}
                          </span>
                        </div>
                      </td>
                      <td style={S.td}>
                        <div style={S.actions}>
                          <button
                            style={S.actionBtn}
                            onClick={() => navigate(`/vendors/${v._id}`)}
                          >
                            View
                          </button>
                          {(() => {
                            const isApproved = v.approvalStatus === "approved";
                            const canEdit = isApproved
                              ? ["accounts", "super_admin"].includes(user?.role)
                              : [
                                  "branch_user",
                                  "accounts",
                                  "super_admin",
                                ].includes(user?.role);
                            if (!canEdit) return null;
                            return (
                              <button
                                style={S.actionBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/vendors/${v._id}/edit`);
                                }}
                              >
                                ✏️ Edit
                              </button>
                            );
                          })()}
                          {canChangeStatus && (
                            <button
                              style={{ ...S.actionBtn, color: "#d97706" }}
                              onClick={() => setStatusModal(v)}
                            >
                              Status
                            </button>
                          )}
                          {canChangeStatus && (
                            <button
                              style={{ ...S.actionBtn, color: "#dc2626" }}
                              onClick={() => setDeleteModal(v)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
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
            disabled={vendors.length < 15}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>

        {/* Delete Modal */}
        {deleteModal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={S.modalTitle}>Delete Vendor</h3>
              <p style={{ color: "#475569", fontSize: 14 }}>
                Are you sure you want to delete{" "}
                <strong>{deleteModal.vendorName}</strong>? This cannot be
                undone.
              </p>
              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  onClick={() => setDeleteModal(null)}
                >
                  Cancel
                </button>
                <button style={S.dangerBtn} onClick={handleDelete}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Status Modal */}
        {statusModal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={S.modalTitle}>Change Vendor Status</h3>
              <p style={{ color: "#475569", fontSize: 14, marginBottom: 16 }}>
                Update status for <strong>{statusModal.vendorName}</strong>
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                {Object.entries(STATUS_STYLES).map(([k, v]) => (
                  <button
                    key={k}
                    style={{
                      ...S.statusOption,
                      background: v.bg,
                      color: v.color,
                      border: `1.5px solid ${v.color}30`,
                    }}
                    onClick={() => {
                      if (k === "blacklisted") return;
                      handleStatusChange(k);
                    }}
                  >
                    {k === statusModal.status ? "✓ " : ""}
                    {v.label}
                  </button>
                ))}
                <div>
                  <input
                    style={S.input}
                    placeholder="Blacklist reason (required for blacklist)"
                    value={blacklistReason}
                    onChange={(e) => setBlacklistReason(e.target.value)}
                  />
                  <button
                    style={{
                      ...S.statusOption,
                      background: "#fef2f2",
                      color: "#dc2626",
                      border: "1.5px solid #dc262630",
                      marginTop: 8,
                    }}
                    onClick={() => {
                      if (!blacklistReason) return alert("Reason required");
                      handleStatusChange("blacklisted");
                    }}
                  >
                    Blacklist Vendor
                  </button>
                </div>
              </div>
              <button
                style={S.cancelBtn}
                onClick={() => {
                  setStatusModal(null);
                  setBlacklistReason("");
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
        {/* Approve Vendor Modal */}
        {approveModal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={{ ...S.modalTitle, color: "#16a34a" }}>
                ✓ Approve Vendor
              </h3>
              <p style={{ color: "#475569", fontSize: 14, marginBottom: 20 }}>
                Are you sure you want to approve{" "}
                <strong>{approveModal.vendorName}</strong>? The branch user will
                be notified and can start creating invoice requests.
              </p>
              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  onClick={() => setApproveModal(null)}
                >
                  Cancel
                </button>
                <button
                  style={{
                    flex: 1,
                    padding: "10px",
                    border: "none",
                    borderRadius: 8,
                    background: "#16a34a",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                  onClick={async () => {
                    try {
                      await api.patch(
                        `/vendors/${approveModal._id}/approve`,
                        {},
                      );
                      setApproveModal(null);
                      fetchVendors();
                    } catch (err) {
                      alert(err.response?.data?.message || "Approval failed");
                    }
                  }}
                >
                  ✓ Confirm Approve
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reject Vendor Modal */}
        {rejectModal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={{ ...S.modalTitle, color: "#dc2626" }}>
                ✗ Reject Vendor
              </h3>
              <p style={{ color: "#475569", fontSize: 14, marginBottom: 12 }}>
                Rejecting <strong>{rejectModal.vendorName}</strong>. The branch
                user will be notified with your reason.
              </p>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#475569",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Rejection Reason *
              </label>
              <textarea
                style={{
                  width: "100%",
                  minHeight: 90,
                  padding: "10px 12px",
                  border: "1.5px solid #fecaca",
                  borderRadius: 8,
                  fontSize: 14,
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                  marginBottom: 16,
                }}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Provide a clear reason (e.g. Bank details mismatch, GST certificate invalid...)"
              />
              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  onClick={() => {
                    setRejectModal(null);
                    setRejectReason("");
                  }}
                >
                  Cancel
                </button>
                <button
                  style={{
                    ...S.dangerBtn,
                    opacity: !rejectReason.trim() ? 0.5 : 1,
                  }}
                  disabled={!rejectReason.trim()}
                  onClick={async () => {
                    await api.patch(`/vendors/${rejectModal._id}/reject`, {
                      reason: rejectReason,
                    });
                    setRejectModal(null);
                    setRejectReason("");
                    fetchVendors();
                  }}
                >
                  ✗ Confirm Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const C = {
  primary: "#1a3c6e",
  accent: "#2563eb",
  border: "#e2e8f0",
  danger: "#dc2626",
};
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", overflowX: "hidden" },
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
  filterBar: {
    display: "flex",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    minWidth: 220,
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
  tableCard: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  thead: { background: "#f8fafc" },
  th: {
    padding: "11px 14px",
    textAlign: "left",
    fontWeight: 600,
    color: "#475569",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: `1px solid ${C.border}`,
  },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "12px 14px", color: "#334155", verticalAlign: "middle" },
  vendorName: { fontWeight: 600, color: C.primary },
  vendorSub: { fontSize: 12, color: "#888", marginTop: 2 },
  catBadge: {
    background: "#eff6ff",
    color: "#2563eb",
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
  },
  statusBadge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  actionBtn: {
    background: "none",
    border: "none",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
    padding: "2px 6px",
  },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  empty: { padding: 60, textAlign: "center", color: "#94a3b8" },
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
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    padding: 28,
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 12,
  },
  modalBtns: { display: "flex", gap: 12, marginTop: 20 },
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
  dangerBtn: {
    flex: 1,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: C.danger,
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  statusOption: {
    padding: "10px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
    textAlign: "left",
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  },
};
