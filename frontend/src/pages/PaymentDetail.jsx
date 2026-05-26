import { useState, useEffect } from "react";
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_STYLES = {
  "Payment Pending": { bg: "#f1f5f9", color: "#475569", icon: "⏳" },
  "Payment Raised": { bg: "#eff6ff", color: "#2563eb", icon: "📤" },
  "Accounts Approved": { bg: "#f0fdf4", color: "#16a34a", icon: "✅" },
  "Excel Generated": { bg: "#f0fdf4", color: "#15803d", icon: "📊" },
  "Payment Rejected": { bg: "#fef2f2", color: "#dc2626", icon: "❌" },
};

export default function PaymentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionModal, setActionModal] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchPayment = async () => {
    try {
      const { data } = await api.get(`/payments/${id}`);
      setPayment(data);
    } catch {
      setError("Failed to load payment");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayment();
  }, [id]);

  const isAccounts = user?.role === "accounts";
  const canApprove = isAccounts && payment?.status === "Payment Raised";
  const canReject = canApprove;
  const canExcel =
    isAccounts &&
    ["Accounts Approved", "Excel Generated"].includes(payment?.status);

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await api.patch(`/payments/${id}/approve`, { remarks });
      setActionModal(null);
      setRemarks("");
      fetchPayment();
    } catch (err) {
      setError(err.response?.data?.message || "Approval failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!reason.trim()) {
      setError("Reason required");
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/payments/${id}/reject`, { reason });
      setActionModal(null);
      setReason("");
      fetchPayment();
    } catch (err) {
      setError(err.response?.data?.message || "Rejection failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExcel = async () => {
    try {
      const res = await api.post(
        `/payments/${id}/generate-excel`,
        {},
        { responseType: "blob" },
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Payment_${payment.paymentId}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      fetchPayment();
    } catch (err) {
      console.error("Excel generation error:", err);
      setError(
        err.response?.data?.message || err.message || "Excel generation failed",
      );
    }
  };

  if (loading)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>Loading...</div>
        </main>
      </div>
    );
  if (!payment)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>Payment not found</div>
        </main>
      </div>
    );

  const ss = STATUS_STYLES[payment.status] || STATUS_STYLES["Payment Pending"];
  const invoice = payment.invoiceRequest;
  const vendor = invoice?.vendor;

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <button style={S.backBtn} onClick={() => navigate("/payments")}>
              ← Back
            </button>
            <div style={S.titleRow}>
              <h1 style={S.title}>{payment.paymentId}</h1>
              <span
                style={{ ...S.statusBadge, background: ss.bg, color: ss.color }}
              >
                {ss.icon} {payment.status}
              </span>
            </div>
            <div style={S.meta}>
              Invoice: <strong>{invoice?.requestId}</strong> · Raised by{" "}
              <strong>{payment.raisedBy?.name}</strong>
            </div>
          </div>
          <div style={S.actionBtns}>
            {canReject && (
              <button
                style={S.rejectBtn}
                onClick={() => setActionModal("reject")}
              >
                ✗ Reject
              </button>
            )}
            {canApprove && (
              <button
                style={S.approveBtn}
                onClick={() => setActionModal("approve")}
              >
                ✓ Approve
              </button>
            )}
            {canExcel && (
              <button style={S.excelBtn} onClick={handleExcel}>
                📊 Generate Excel
              </button>
            )}
          </div>
        </div>

        {error && (
          <div style={S.errorBox}>
            {error}
            <button
              style={{
                background: "none",
                border: "none",
                color: "#dc2626",
                cursor: "pointer",
                fontWeight: 700,
              }}
              onClick={() => setError("")}
            >
              ✕
            </button>
          </div>
        )}

        {/* Rejection banner */}
        {payment.status === "Payment Rejected" &&
          payment.rejectionHistory?.length > 0 && (
            <div style={S.rejectionBanner}>
              <span style={{ fontSize: 22 }}>🚨</span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#dc2626",
                    marginBottom: 6,
                  }}
                >
                  Payment Rejected
                </div>
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 14,
                    color: "#334155",
                    borderLeft: "3px solid #dc2626",
                  }}
                >
                  {
                    payment.rejectionHistory[
                      payment.rejectionHistory.length - 1
                    ]?.reason
                  }
                </div>
              </div>
            </div>
          )}

        <div style={S.grid}>
          {/* Payment Details */}
          <InfoCard title="💳 Payment Details">
            <InfoRow label="Payment ID" value={payment.paymentId} mono />
            <InfoRow label="Invoice Ref." value={invoice?.requestId} mono />
            <InfoRow label="Payment Mode" value={payment.paymentMode} />
            <InfoRow
              label="Amount"
              value={`₹${payment.paymentAmount?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
            />
            <InfoRow
              label="Scheduled"
              value={
                payment.scheduledDate
                  ? new Date(payment.scheduledDate).toLocaleDateString("en-GB")
                  : "—"
              }
            />
            <InfoRow label="Remarks" value={payment.paymentRemarks || "—"} />
          </InfoCard>

          {/* Invoice Summary */}
          <InfoCard title="📋 Invoice Summary">
            <InfoRow label="Invoice No." value={invoice?.invoiceNumber} mono />
            <InfoRow
              label="Invoice Date"
              value={
                invoice?.invoiceDate
                  ? new Date(invoice.invoiceDate).toLocaleDateString("en-GB")
                  : "—"
              }
            />
            <InfoRow
              label="Base Amount"
              value={`₹${invoice?.amount?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
            />
            <InfoRow
              label="GST"
              value={`₹${invoice?.gstAmount?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
            />
            <InfoRow
              label="TDS"
              value={`₹${invoice?.tdsAmount?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
            />
            <InfoRow
              label="Net Payable"
              value={`₹${invoice?.netPayable?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
            />
          </InfoCard>

          {/* Bank Details */}
          <InfoCard title="🏦 Bank Details">
            <InfoRow label="Account Holder" value={vendor?.accountHolderName} />
            <InfoRow label="Bank" value={vendor?.bankName} />
            <InfoRow label="Account No." value={vendor?.accountNumber} mono />
            <InfoRow label="IFSC" value={vendor?.ifscCode} mono />
          </InfoCard>

          {/* Approval History */}
          <InfoCard title="📜 Approval History">
            {payment.approvalHistory?.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  color: "#94a3b8",
                  textAlign: "center",
                  fontSize: 13,
                }}
              >
                No actions yet
              </div>
            ) : (
              payment.approvalHistory.map((h, i) => (
                <div key={i} style={S.historyItem}>
                  <div
                    style={{
                      ...S.historyDot,
                      background:
                        h.action === "approved" ? "#16a34a" : "#dc2626",
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 13 }}>
                        {h.approvedBy?.name}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color:
                            h.action === "approved" ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {h.action === "approved" ? "✓ Approved" : "✗ Rejected"}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "#94a3b8",
                          marginLeft: "auto",
                        }}
                      >
                        {new Date(h.actionAt).toLocaleDateString("en-GB")}
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}
                    >
                      {h.stage}
                    </div>
                    {h.remarks && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "#475569",
                          marginTop: 4,
                          fontStyle: "italic",
                        }}
                      >
                        "{h.remarks}"
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </InfoCard>
        </div>

        {/* Approve Modal */}
        {actionModal === "approve" && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={S.modalTitle}>✅ Approve Payment</h3>
              <p style={{ fontSize: 14, color: "#475569", marginBottom: 14 }}>
                Approving payment <strong>{payment.paymentId}</strong> of{" "}
                <strong>
                  ₹{payment.paymentAmount?.toLocaleString("en-IN")}
                </strong>
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
                Remarks (optional)
              </label>
              <textarea
                style={S.textarea}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Add remarks..."
              />
              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  onClick={() => setActionModal(null)}
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
                ✗ Reject Payment
              </h3>
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
                style={{ ...S.textarea, borderColor: "#fecaca" }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Provide a clear reason..."
              />
              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  onClick={() => setActionModal(null)}
                >
                  Cancel
                </button>
                <button
                  style={{ ...S.rejectModalBtn, opacity: submitting ? 0.7 : 1 }}
                  onClick={handleReject}
                  disabled={submitting}
                >
                  {submitting ? "Rejecting..." : "✗ Confirm Reject"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const InfoCard = ({ title, children }) => (
  <div style={IC.card}>
    <div style={IC.title}>{title}</div>
    {children}
  </div>
);
const InfoRow = ({ label, value, mono }) => (
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
  main: { flex: 1, padding: "24px 28px", overflowY: "auto" },
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
    display: "block",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  title: { fontSize: 22, fontWeight: 700, color: C.primary, margin: 0 },
  statusBadge: {
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
  },
  meta: { fontSize: 13, color: "#888", marginTop: 4 },
  actionBtns: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
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
  approveBtn: {
    padding: "9px 18px",
    background: "#16a34a",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#fff",
  },
  excelBtn: {
    padding: "9px 18px",
    background: "#16a34a",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#fff",
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
  },
  rejectionBanner: {
    background: "#fef2f2",
    border: "1.5px solid #fecaca",
    borderRadius: 12,
    padding: "16px 20px",
    marginBottom: 16,
    display: "flex",
    gap: 14,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 16,
  },
  historyItem: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    paddingBottom: 12,
    borderBottom: "1px solid #f1f5f9",
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: 4,
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
    maxWidth: 460,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 8,
  },
  textarea: {
    width: "100%",
    minHeight: 90,
    padding: "10px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
    boxSizing: "border-box",
    marginBottom: 4,
  },
  modalBtns: { display: "flex", gap: 10, marginTop: 14 },
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
    cursor: "pointer",
    fontWeight: 700,
  },
};
