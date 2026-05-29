import { useState, useEffect } from "react";
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function VendorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionModal, setActionModal] = useState(null); // 'approve' | 'reject'
  const [rejectReason, setRejectReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canEdit = ["branch_user", "accounts", "super_admin"].includes(
    user?.role,
  );
  const canApprove = ["accounts", "super_admin"].includes(user?.role);

  const refreshVendor = () =>
    api
      .get(`/vendors/${id}`)
      .then((r) => setVendor(r.data))
      .catch(console.error);

  useEffect(() => {
    api
      .get(`/vendors/${id}`)
      .then((r) => setVendor(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await api.patch(`/vendors/${id}/approve`, {});
      setActionModal(null);
      await refreshVendor();
    } catch (err) {
      setError(err.response?.data?.message || "Approval failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setError("Rejection reason is required");
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/vendors/${id}/reject`, { reason: rejectReason });
      setActionModal(null);
      setRejectReason("");
      await refreshVendor();
    } catch (err) {
      setError(err.response?.data?.message || "Rejection failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>Loading vendor...</div>
        </main>
      </div>
    );
  if (!vendor)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>Vendor not found.</div>
        </main>
      </div>
    );

  const STATUS_STYLES = {
    active: { bg: "#f0fdf4", color: "#16a34a" },
    inactive: { bg: "#f8fafc", color: "#64748b" },
    blacklisted: { bg: "#fef2f2", color: "#dc2626" },
    frozen: { bg: "#eff6ff", color: "#2563eb" },
  };
  const ss = STATUS_STYLES[vendor.status] || STATUS_STYLES.active;

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <button style={S.backBtn} onClick={() => navigate("/vendors")}>
              ← Back to Vendors
            </button>
            <div style={S.titleRow}>
              <h1 style={S.title}>{vendor.vendorName}</h1>
              <span
                style={{ ...S.statusBadge, background: ss.bg, color: ss.color }}
              >
                {vendor.status}
              </span>
              {vendor.verifiedByAccounts && (
                <span style={S.verifiedBadge}>✓ Verified</span>
              )}
              {/* Approval status badge */}
              <span
                style={{
                  ...S.approvalBadge,
                  ...(vendor.approvalStatus === "approved"
                    ? {
                        background: "#f0fdf4",
                        color: "#16a34a",
                        border: "1px solid #bbf7d0",
                      }
                    : vendor.approvalStatus === "rejected"
                      ? {
                          background: "#fef2f2",
                          color: "#dc2626",
                          border: "1px solid #fecaca",
                        }
                      : {
                          background: "#fffbeb",
                          color: "#d97706",
                          border: "1px solid #fde68a",
                        }),
                }}
              >
                {vendor.approvalStatus === "approved"
                  ? "✓ Approved"
                  : vendor.approvalStatus === "rejected"
                    ? "✗ Rejected"
                    : "⏳ Pending Approval"}
              </span>
            </div>
            <div style={S.meta}>
              {vendor.vendorCategory} · Branch: {vendor.branch?.name}
            </div>
          </div>

          {/* Action buttons */}
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {canEdit && (
              <button
                style={S.editBtn}
                onClick={() => navigate(`/vendors/${id}/edit`)}
              >
                ✏️ Edit Vendor
              </button>
            )}
            {canApprove && vendor.approvalStatus === "pending_approval" && (
              <>
                <button
                  style={S.rejectBtn}
                  onClick={() => {
                    setActionModal("reject");
                    setError("");
                  }}
                >
                  ✗ Reject
                </button>
                <button
                  style={S.approveBtn}
                  onClick={() => {
                    setActionModal("approve");
                    setError("");
                  }}
                >
                  ✓ Approve
                </button>
              </>
            )}
            {canApprove && vendor.approvalStatus === "approved" && (
              <button
                style={S.rejectBtn}
                onClick={() => {
                  setActionModal("reject");
                  setError("");
                }}
              >
                ✗ Revoke Approval
              </button>
            )}
          </div>
        </div>

        {/* Error banner */}
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

        {/* Rejection reason banner */}
        {vendor.approvalStatus === "rejected" && vendor.rejectionReason && (
          <div style={S.rejectionBanner}>
            <span style={{ fontSize: 20 }}>🚨</span>
            <div>
              <div
                style={{ fontWeight: 700, color: "#dc2626", marginBottom: 4 }}
              >
                Vendor Rejected
              </div>
              <div style={{ fontSize: 13, color: "#7f1d1d" }}>
                <strong>Reason:</strong> {vendor.rejectionReason}
              </div>
              {vendor.rejectedBy?.name && (
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                  Rejected by: {vendor.rejectedBy.name} ·{" "}
                  {vendor.rejectedAt
                    ? new Date(vendor.rejectedAt).toLocaleDateString("en-GB")
                    : ""}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={S.grid}>
          {/* Personal */}
          <InfoCard title="👤 Personal Details">
            <Row label="Vendor Name" value={vendor.vendorName} />
            <Row label="Contact Person" value={vendor.contactPerson || "—"} />
            <Row label="Mobile" value={vendor.mobile} />
            <Row label="Email" value={vendor.email || "—"} />
          </InfoCard>

          {/* Business */}
          <InfoCard title="🏢 Business Details">
            <Row label="Company" value={vendor.companyName || "—"} />
            <Row label="Category" value={vendor.vendorCategory} />
            <Row label="PAN Number" value={vendor.panNumber} mono />
            <Row label="GST Number" value={vendor.gstNumber || "—"} mono />
            <Row label="Address" value={vendor.businessAddress || "—"} />
          </InfoCard>

          {/* Bank */}
          <InfoCard title="🏦 Bank Details">
            <Row label="Account Holder" value={vendor.accountHolderName} />
            <Row label="Bank Name" value={vendor.bankName} />
            <Row
              label="Account Number"
              value={`****${vendor.accountNumber?.slice(-4)}`}
              mono
            />
            <Row label="IFSC Code" value={vendor.ifscCode} mono />
            <Row label="UPI ID" value={vendor.upiId || "—"} />
          </InfoCard>

          {/* Meta */}
          <InfoCard title="ℹ️ System Info">
            <Row label="Branch" value={vendor.branch?.name} />
            <Row label="Created By" value={vendor.createdBy?.name || "—"} />
            <Row
              label="Created At"
              value={new Date(vendor.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            />
            <Row
              label="Verified"
              value={vendor.verifiedByAccounts ? "✓ Yes" : "✗ No"}
            />

            {vendor.blacklistReason && (
              <Row label="Blacklist Reason" value={vendor.blacklistReason} />
            )}
          </InfoCard>
        </div>

        {/* Documents */}
        <InfoCard title="📄 Documents">
          {vendor.documents?.length > 0 ? (
            <div style={S.docGrid}>
              {vendor.documents.map((doc, i) => (
                <div key={i} style={S.docItem}>
                  <span style={{ fontSize: 24 }}>📎</span>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#334155",
                      }}
                    >
                      {doc.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      {doc.type}
                    </div>
                  </div>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    style={S.downloadLink}
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 14, padding: "10px 0" }}>
              No documents uploaded yet.
            </div>
          )}
        </InfoCard>
      </main>

      {/* Approve Modal */}
      {actionModal === "approve" && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={{ ...S.modalTitle, color: "#16a34a" }}>
              ✓ Approve Vendor
            </h3>
            <p style={{ fontSize: 14, color: "#475569", marginBottom: 20 }}>
              Are you sure you want to approve{" "}
              <strong>{vendor.vendorName}</strong>? The branch user will be
              notified and can start creating invoice requests.
            </p>
            {error && (
              <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}
            <div style={S.modalBtns}>
              <button
                style={S.cancelBtn}
                onClick={() => {
                  setActionModal(null);
                  setError("");
                }}
              >
                Cancel
              </button>
              <button
                style={{
                  ...S.approveModalBtn,
                  opacity: submitting ? 0.7 : 1,
                }}
                onClick={handleApprove}
                disabled={submitting}
              >
                {submitting ? "Approving..." : "✓ Confirm Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {actionModal === "reject" && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={{ ...S.modalTitle, color: "#dc2626" }}>
              ✗ Reject Vendor
            </h3>
            <p style={{ fontSize: 14, color: "#475569", marginBottom: 16 }}>
              Rejecting <strong>{vendor.vendorName}</strong>. The branch user
              will be notified with the reason provided.
            </p>
            <label style={S.fieldLabel}>Rejection Reason *</label>
            <textarea
              style={S.modalTextarea}
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                setError("");
              }}
              placeholder="Provide a clear reason for rejection..."
            />
            {error && (
              <div style={{ color: "#dc2626", fontSize: 13, marginTop: 6 }}>
                {error}
              </div>
            )}
            <div style={S.modalBtns}>
              <button
                style={S.cancelBtn}
                onClick={() => {
                  setActionModal(null);
                  setRejectReason("");
                  setError("");
                }}
              >
                Cancel
              </button>
              <button
                style={{
                  ...S.rejectModalBtn,
                  opacity: submitting || !rejectReason.trim() ? 0.5 : 1,
                  cursor: !rejectReason.trim() ? "not-allowed" : "pointer",
                }}
                onClick={handleReject}
                disabled={submitting || !rejectReason.trim()}
              >
                {submitting ? "Rejecting..." : "✗ Confirm Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const InfoCard = ({ title, children }) => (
  <div style={IC.card}>
    <div style={IC.title}>{title}</div>
    {children}
  </div>
);
const Row = ({ label, value, mono }) => (
  <div style={IC.row}>
    <span style={IC.label}>{label}</span>
    <span style={{ ...IC.value, fontFamily: mono ? "monospace" : "inherit" }}>
      {value || "—"}
    </span>
  </div>
);
const IC = {
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    marginBottom: 16,
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: "1px solid #f1f5f9",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    padding: "7px 0",
    borderBottom: "1px solid #f8fafc",
    gap: 12,
  },
  label: { fontSize: 13, color: "#64748b", flexShrink: 0 },
  value: {
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
    textAlign: "right",
    wordBreak: "break-all",
  },
};

const C = { primary: "#1a3c6e", accent: "#2563eb", border: "#e2e8f0" };
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px" },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    flexWrap: "wrap",
    gap: 12,
  },
  backBtn: {
    background: "none",
    border: "none",
    color: C.accent,
    cursor: "pointer",
    fontSize: 14,
    padding: 0,
    marginBottom: 6,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  title: { fontSize: 22, fontWeight: 700, color: C.primary, margin: 0 },
  statusBadge: {
    padding: "3px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    textTransform: "capitalize",
  },
  approvalBadge: {
    padding: "3px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  verifiedBadge: {
    background: "#f0fdf4",
    color: "#16a34a",
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  meta: { fontSize: 13, color: "#888", marginTop: 4 },
  editBtn: {
    padding: "9px 18px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  approveBtn: {
    padding: "9px 18px",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  rejectBtn: {
    padding: "9px 18px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#dc2626",
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "10px 16px",
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 16,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rejectionBanner: {
    background: "#fef2f2",
    border: "1.5px solid #fecaca",
    borderRadius: 10,
    padding: "14px 18px",
    marginBottom: 16,
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 16,
    marginBottom: 16,
  },
  docGrid: { display: "flex", flexDirection: "column", gap: 8 },
  docItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    background: "#f8fafc",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
  },
  downloadLink: {
    marginLeft: "auto",
    padding: "5px 12px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 6,
    color: C.accent,
    fontSize: 12,
    fontWeight: 600,
    textDecoration: "none",
  },
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
    maxWidth: 460,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    display: "block",
    marginBottom: 6,
  },
  modalTextarea: {
    width: "100%",
    minHeight: 90,
    padding: "10px 12px",
    border: `1.5px solid #fecaca`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  modalBtns: { display: "flex", gap: 10, marginTop: 16 },
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
  approveModalBtn: {
    flex: 1,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: "#16a34a",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  rejectModalBtn: {
    flex: 1,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: "#dc2626",
    color: "#fff",
    fontWeight: 700,
  },
};
