import { useState, useEffect } from "react";
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import FileUpload from "../components/FileUpload.jsx";
import { INVOICE_WORKFLOW, INVOICE_STAGES } from "../config/constants";

const STATUS_STYLES = {
  Draft: { bg: "#f1f5f9", color: "#475569", icon: "📝" },
  Submitted: { bg: "#eff6ff", color: "#2563eb", icon: "📤" },
  "Partner Approved": { bg: "#fefce8", color: "#d97706", icon: "⏳" },
  "Accounts Approved": { bg: "#fef3c7", color: "#b45309", icon: "⏳" },
  "Cluster Head Approved": { bg: "#f0fdf4", color: "#16a34a", icon: "✅" },
  Rejected: { bg: "#fef2f2", color: "#dc2626", icon: "❌" },
};

const PRIORITY_COLORS = {
  Normal: "#2563eb",
  Urgent: "#d97706",
  Critical: "#dc2626",
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("details");
  const [actionModal, setActionModal] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [tdsInput, setTdsInput] = useState("");

  const fetchInvoice = async () => {
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setInvoice(data);
    } catch {
      setError("Failed to load invoice");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoice();
  }, [id]);

  // ── Workflow visibility ────────────────────────────────
  const userId = user?._id || user?.id;
  const createdById =
    invoice?.createdBy?._id || invoice?.createdBy?.id || invoice?.createdBy;
  const isOwner =
    userId && createdById && userId.toString() === createdById.toString();

  const currentStage = INVOICE_WORKFLOW.find(
    (s) => s.status === invoice?.status,
  );
  // ✅ If partner was skipped, accounts acts on Submitted directly
  const partnerSkipped =
    invoice?.partnerSkipped && invoice?.status === "Submitted";
  const isMyTurn =
    (currentStage && currentStage.actingRole === user?.role) ||
    (partnerSkipped && user?.role === "accounts");

  const isBranchUser = user?.role === "branch_user";
  const isAccounts = user?.role === "accounts";

  const canEdit =
    (isBranchUser &&
      isOwner &&
      ["Draft", "Rejected"].includes(invoice?.status)) ||
    (isAccounts &&
      ["Draft", "Rejected", "Submitted", "Partner Approved"].includes(
        invoice?.status,
      ));

  const canSubmit =
    (isBranchUser && isOwner && invoice?.status === "Draft") ||
    (isAccounts && invoice?.status === "Rejected");

  const REQUIRED_DOC_TYPES = ["invoice", "quotation"];
  const missingRequiredDocs = REQUIRED_DOC_TYPES.filter(
    (t) => !invoice?.attachments?.some((a) => a.type === t),
  );
  const submitBlocked = canSubmit && missingRequiredDocs.length > 0;

  // ✅ Accounts can approve Submitted invoices when partner was skipped

  const canApprove =
    isMyTurn &&
    !["Draft", "Rejected", "Cluster Head Approved"].includes(invoice?.status);
  const canReject = canApprove;

  // ── Actions ────────────────────────────────────────────
  const handleSubmit = async () => {
    try {
      await api.patch(`/invoices/${id}/submit`);
      fetchInvoice();
    } catch (err) {
      setError(err.response?.data?.message || "Submit failed");
    }
  };

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await api.patch(`/invoices/${id}/approve`, {
        remarks,
        ...(user?.role === "accounts" && {
          tdsPercentage: parseFloat(tdsInput),
        }),
      });
      setActionModal(null);
      setRemarks("");
      setTdsInput("");
      fetchInvoice();
    } catch (err) {
      setError(err.response?.data?.message || "Approval failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!reason.trim()) {
      setError("Rejection reason is required");
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/invoices/${id}/reject`, { reason });
      setActionModal(null);
      setReason("");
      fetchInvoice();
    } catch (err) {
      setError(err.response?.data?.message || "Rejection failed");
    } finally {
      setSubmitting(false);
    }
  };

  const currentStageIndex = INVOICE_STAGES.findIndex(
    (s) => s.key === invoice?.status,
  );

  if (loading)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>Loading...</div>
        </main>
      </div>
    );
  if (!invoice)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>Invoice not found</div>
        </main>
      </div>
    );

  const ss = STATUS_STYLES[invoice.status] || STATUS_STYLES["Draft"];

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        {/* Header */}
        <div style={S.topBar}>
          <div>
            <button style={S.backBtn} onClick={() => navigate("/invoices")}>
              ← Back
            </button>
            <div style={S.titleRow}>
              <h1 style={S.title}>{invoice.requestId}</h1>
              <span
                style={{ ...S.statusBadge, background: ss.bg, color: ss.color }}
              >
                {ss.icon} {invoice.status}
              </span>
              <span
                style={{
                  ...S.priorityBadge,
                  color: PRIORITY_COLORS[invoice.priority],
                  background: PRIORITY_COLORS[invoice.priority] + "18",
                }}
              >
                {invoice.priority}
              </span>
            </div>
            <div style={S.meta}>
              Created by <strong>{invoice.createdBy?.name}</strong> ·{" "}
              {new Date(invoice.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div style={S.actionBtns}>
            {canEdit && (
              <button
                style={S.editBtn}
                onClick={() => navigate(`/invoices/${id}/edit`)}
              >
                ✏️{" "}
                {invoice.status === "Rejected"
                  ? "Edit & Resubmit"
                  : isAccounts
                    ? "Edit Invoice"
                    : "Edit Draft"}
              </button>
            )}
            {canSubmit && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 4,
                }}
              >
                {submitBlocked && (
                  <span
                    style={{ fontSize: 11, color: "#dc2626", fontWeight: 500 }}
                  >
                    Upload required docs first:{" "}
                    {missingRequiredDocs
                      .map((t) => (t === "invoice" ? "Invoice" : "Quotation"))
                      .join(", ")}
                  </span>
                )}
                <button
                  style={{
                    ...S.submitBtn,
                    opacity: submitBlocked ? 0.45 : 1,
                    cursor: submitBlocked ? "not-allowed" : "pointer",
                  }}
                  onClick={submitBlocked ? undefined : handleSubmit}
                  disabled={submitBlocked}
                >
                  {isAccounts ? "🔄 Resubmit to Partner" : "🚀 Submit"}
                </button>
              </div>
            )}
            {invoice.status === "Cluster Head Approved" && (
              <button
                style={S.paymentBtn}
                onClick={() => navigate("/payments")}
              >
                💳 Go to Payment
              </button>
            )}
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
            {!canApprove &&
              !canEdit &&
              !canSubmit &&
              !["Draft", "Rejected", "Cluster Head Approved"].includes(
                invoice?.status,
              ) && (
                <div style={S.waitingBadge}>
                  ⏳ Awaiting:{" "}
                  {partnerSkipped
                    ? "Accounts Team (Partner Skipped)"
                    : currentStage?.actingRole === "branch_partner"
                      ? "Branch Partner"
                      : currentStage?.actingRole === "accounts"
                        ? "Accounts Team"
                        : currentStage?.actingRole === "cluster_head"
                          ? "Cluster Head"
                          : currentStage?.actingRole?.replace(/_/g, " ")}
                </div>
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

        {/* Rejection banner */}
        {invoice.status === "Rejected" &&
          invoice.rejectionHistory?.length > 0 && (
            <div style={S.rejectionBanner}>
              <span style={{ fontSize: 22 }}>🚨</span>
              <div style={{ flex: 1 }}>
                <div style={S.rejectionTitle}>
                  Invoice Rejected — Returned to Branch
                </div>
                <div style={S.rejectionLabel}>Rejection Reason:</div>
                <div style={S.rejectionReason}>
                  {
                    invoice.rejectionHistory[
                      invoice.rejectionHistory.length - 1
                    ]?.reason
                  }
                </div>
                <div style={S.rejectionMeta}>
                  Rejected by:{" "}
                  {
                    invoice.rejectionHistory[
                      invoice.rejectionHistory.length - 1
                    ]?.rejectedBy?.name
                  }{" "}
                  ·{" "}
                  {new Date(
                    invoice.rejectionHistory[
                      invoice.rejectionHistory.length - 1
                    ]?.rejectedAt,
                  ).toLocaleDateString("en-GB")}
                </div>
              </div>
            </div>
          )}

        {/* Partner skipped banner */}
        {invoice.partnerSkipped && (
          <div
            style={{
              background: "#fffbeb",
              border: "1.5px solid #fde68a",
              borderRadius: 10,
              padding: "12px 18px",
              marginBottom: 16,
              display: "flex",
              gap: 12,
              alignItems: "center",
              fontSize: 13,
              color: "#92400e",
            }}
          >
            <span style={{ fontSize: 20 }}>⚡</span>
            <div>
              <strong>Partner step skipped</strong> — No branch partner is
              assigned to this branch. Invoice was routed directly to accounts
              team.
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div style={S.progressCard}>
          <div style={S.progressSteps}>
            {INVOICE_STAGES.map((stage, i) => {
              const done =
                i < currentStageIndex ||
                invoice.status === "Cluster Head Approved";
              const active = i === currentStageIndex;
              const rejected =
                invoice.status === "Rejected" && i === currentStageIndex;
              return (
                <div key={stage.key} style={S.progressStep}>
                  <div
                    style={{
                      ...S.progressDot,
                      background: rejected
                        ? "#dc2626"
                        : done
                          ? "#16a34a"
                          : active
                            ? "#2563eb"
                            : "#e2e8f0",
                      boxShadow: active ? "0 0 0 4px #dbeafe" : "none",
                      color: done || active || rejected ? "#fff" : "#94a3b8",
                    }}
                  >
                    {done ? "✓" : rejected ? "✗" : i + 1}
                  </div>
                  <div
                    style={{
                      ...S.progressLabel,
                      color: done ? "#16a34a" : active ? "#2563eb" : "#94a3b8",
                      fontWeight: active || done ? 600 : 400,
                    }}
                  >
                    {stage.label}
                  </div>
                  {i < INVOICE_STAGES.length - 1 && (
                    <div
                      style={{
                        ...S.progressLine,
                        background: done ? "#16a34a" : "#e2e8f0",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {[
            ["details", "📋 Details"],
            ["financials", "💰 Financials"],
            ["vendor", "🏢 Vendor"],
            ["history", "📜 History"],
            ["attachments", "📎 Attachments"],
          ].map(([k, l]) => (
            <button
              key={k}
              style={{ ...S.tab, ...(activeTab === k ? S.tabActive : {}) }}
              onClick={() => setActiveTab(k)}
            >
              {l}
            </button>
          ))}
        </div>

        <div style={S.tabContent}>
          {/* Details */}
          {activeTab === "details" && (
            <div style={S.grid2}>
              <InfoCard title="Invoice Information">
                <InfoRow label="Invoice ID" value={invoice.requestId} mono />
                <InfoRow label="Branch" value={invoice.branch?.name} />
                <InfoRow label="Expense Type" value={invoice.expenseType} />
                <InfoRow
                  label="Expense Category"
                  value={invoice.expenseCategory?.name}
                />
                <InfoRow
                  label="Priority"
                  value={
                    <span
                      style={{
                        color: PRIORITY_COLORS[invoice.priority],
                        fontWeight: 700,
                      }}
                    >
                      {invoice.priority}
                    </span>
                  }
                />
                <InfoRow
                  label="Invoice No."
                  value={invoice.invoiceNumber}
                  mono
                />
                <InfoRow
                  label="Invoice Date"
                  value={
                    invoice.invoiceDate
                      ? new Date(invoice.invoiceDate).toLocaleDateString(
                          "en-GB",
                        )
                      : "—"
                  }
                />
                <InfoRow
                  label="Due Date"
                  value={
                    invoice.dueDate
                      ? new Date(invoice.dueDate).toLocaleDateString("en-GB")
                      : "—"
                  }
                />
              </InfoCard>
              <InfoCard title="Description & Remarks">
                <div style={S.descBox}>
                  {invoice.description || (
                    <span style={{ color: "#94a3b8" }}>No description</span>
                  )}
                </div>
                {invoice.remarks && (
                  <>
                    <div style={S.remarksLabel}>Remarks</div>
                    <div style={S.descBox}>{invoice.remarks}</div>
                  </>
                )}
                {/* Payment link if invoice is fully approved */}
                {invoice.status === "Cluster Head Approved" &&
                  invoice.paymentRequest && (
                    <div style={S.paymentLink}>
                      <div style={S.paymentLinkTitle}>💳 Payment Status</div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#475569",
                          marginBottom: 8,
                        }}
                      >
                        This invoice has a payment request associated.
                      </div>
                      <button
                        style={S.paymentLinkBtn}
                        onClick={() =>
                          navigate(
                            `/payments/${invoice.paymentRequest._id || invoice.paymentRequest}`,
                          )
                        }
                      >
                        View Payment Request →
                      </button>
                    </div>
                  )}
              </InfoCard>
            </div>
          )}

          {/* Financials */}
          {activeTab === "financials" && (
            <>
              {invoice.items?.length > 0 && (
                <InfoCard title="Invoice Items">
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 13,
                      }}
                    >
                      <thead>
                        <tr>
                          <th
                            style={{
                              padding: "6px 8px",
                              textAlign: "left",
                              color: "#64748b",
                              fontSize: 11,
                              textTransform: "uppercase",
                            }}
                          >
                            Description
                          </th>
                          <th
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: "#64748b",
                              fontSize: 11,
                              textTransform: "uppercase",
                            }}
                          >
                            Value
                          </th>
                          <th
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: "#64748b",
                              fontSize: 11,
                              textTransform: "uppercase",
                            }}
                          >
                            GST %
                          </th>
                          <th
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: "#64748b",
                              fontSize: 11,
                              textTransform: "uppercase",
                            }}
                          >
                            GST Amt
                          </th>
                          <th
                            style={{
                              padding: "6px 8px",
                              textAlign: "right",
                              color: "#64748b",
                              fontSize: 11,
                              textTransform: "uppercase",
                            }}
                          >
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoice.items.map((it, i) => (
                          <tr
                            key={i}
                            style={{ borderTop: "1px solid #f1f5f9" }}
                          >
                            <td style={{ padding: "8px", color: "#334155" }}>
                              {it.description || "—"}
                            </td>
                            <td style={{ padding: "8px", textAlign: "right" }}>
                              ₹
                              {it.amount?.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                            </td>
                            <td style={{ padding: "8px", textAlign: "right" }}>
                              {it.gstPercentage}%
                            </td>
                            <td style={{ padding: "8px", textAlign: "right" }}>
                              ₹
                              {it.gstAmount?.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                            </td>
                            <td
                              style={{
                                padding: "8px",
                                textAlign: "right",
                                fontWeight: 700,
                                color: "#1a3c6e",
                              }}
                            >
                              ₹
                              {it.total?.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </InfoCard>
              )}
              <div style={S.grid2}>
                <InfoCard title="Amount Breakdown">
                  <div style={S.amountRow}>
                    <span style={S.amountLabel}>Base Amount</span>
                    <span style={S.amountVal}>
                      ₹
                      {invoice.amount?.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div style={S.amountRow}>
                    <span style={S.amountLabel}>GST Amount</span>
                    <span style={S.amountVal}>
                      + ₹
                      {invoice.gstAmount?.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div style={S.amountRow}>
                    <span style={S.amountLabel}>Round Off</span>
                    <span style={S.amountVal}>
                      {(invoice.roundOff || 0) < 0 ? "− " : "+ "}₹
                      {Math.abs(invoice.roundOff || 0).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div style={S.amountRow}>
                    <span style={S.amountLabel}>TDS Deduction</span>
                    <span style={{ ...S.amountVal, color: "#dc2626" }}>
                      − ₹
                      {invoice.tdsAmount?.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div style={S.divider} />
                  <div style={S.netRow}>
                    <span style={S.netLabel}>Net Payable</span>
                    <span style={S.netVal}>
                      ₹
                      {invoice.netPayable?.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </InfoCard>
                <InfoCard title="Payment Destination">
                  <InfoRow
                    label="Account Holder"
                    value={invoice.vendor?.accountHolderName}
                  />
                  <InfoRow label="Bank Name" value={invoice.vendor?.bankName} />
                  <InfoRow
                    label="Account No."
                    value={`****${invoice.vendor?.accountNumber?.slice(-4)}`}
                    mono
                  />
                  <InfoRow
                    label="IFSC Code"
                    value={invoice.vendor?.ifscCode}
                    mono
                  />
                </InfoCard>
              </div>
            </>
          )}

          {/* Vendor */}
          {activeTab === "vendor" && (
            <div style={S.grid2}>
              <InfoCard title="Vendor Details">
                <InfoRow
                  label="Vendor Name"
                  value={invoice.vendor?.vendorName}
                />
                <InfoRow
                  label="Company"
                  value={invoice.vendor?.companyName || "—"}
                />
                <InfoRow
                  label="Category"
                  value={invoice.vendor?.vendorCategory}
                />
                <InfoRow label="Mobile" value={invoice.vendor?.mobile} />
                <InfoRow label="Email" value={invoice.vendor?.email || "—"} />
              </InfoCard>
              <InfoCard title="Bank Details">
                <InfoRow
                  label="Account Holder"
                  value={invoice.vendor?.accountHolderName}
                />
                <InfoRow label="Bank" value={invoice.vendor?.bankName} />
                <InfoRow
                  label="Account No."
                  value={invoice.vendor?.accountNumber}
                  mono
                />
                <InfoRow label="IFSC" value={invoice.vendor?.ifscCode} mono />
              </InfoCard>
            </div>
          )}

          {/* History */}
          {activeTab === "history" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <InfoCard title="Approval Timeline">
                {invoice.approvalHistory?.length === 0 ? (
                  <div style={S.emptyHistory}>No approval actions yet</div>
                ) : (
                  invoice.approvalHistory.map((h, i) => (
                    <div key={i} style={S.historyItem}>
                      <div
                        style={{
                          ...S.historyDot,
                          background:
                            h.action === "approved" ? "#16a34a" : "#dc2626",
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={S.historyTop}>
                          <span style={{ fontWeight: 700, color: "#334155" }}>
                            {h.approvedBy?.name}
                          </span>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color:
                                h.action === "approved" ? "#16a34a" : "#dc2626",
                            }}
                          >
                            {h.action === "approved"
                              ? "✓ Approved"
                              : "✗ Rejected"}
                          </span>
                          <span style={S.historyTime}>
                            {new Date(h.actionAt).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#94a3b8",
                            marginTop: 2,
                            textTransform: "capitalize",
                          }}
                        >
                          {h.approvedBy?.role?.replace(/_/g, " ")} · {h.stage}
                        </div>
                        {h.remarks && (
                          <div style={S.historyRemarks}>"{h.remarks}"</div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </InfoCard>
            </div>
          )}

          {/* Attachments */}
          {activeTab === "attachments" && (
            <>
              {invoice.status === "Draft" && missingRequiredDocs.length > 0 && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontSize: 13,
                    color: "#dc2626",
                    marginBottom: 12,
                    fontWeight: 500,
                  }}
                >
                  ⚠️ Required documents missing before you can submit:{" "}
                  {missingRequiredDocs
                    .map((t) =>
                      t === "invoice" ? "🧾 Invoice" : "📋 Quotation",
                    )
                    .join(", ")}
                </div>
              )}
              <FileUpload
                entityType="payment"
                entityId={id}
                existingDocs={invoice.attachments || []}
                onUploadSuccess={fetchInvoice}
                canUpload={user?.role === "branch_user"}
              />
            </>
          )}
        </div>

        {/* Approve Modal */}
        {actionModal === "approve" && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={S.modalTitle}>✅ Approve Invoice</h3>
              <p style={S.modalSub}>
                Approving <strong>{invoice.requestId}</strong>
              </p>

              {/* ✅ TDS input — only shown to accounts team */}
              {user?.role === "accounts" && (
                <div style={{ marginBottom: 16 }}>
                  <label style={S.fieldLabel}>TDS Percentage (%) *</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="e.g. 2 or 10"
                      style={{
                        ...S.modalTextarea,
                        minHeight: "unset",
                        padding: "10px 40px 10px 12px",
                        resize: "none",
                      }}
                      value={tdsInput}
                      onChange={(e) => setTdsInput(e.target.value)}
                    />
                    <span
                      style={{
                        position: "absolute",
                        right: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#64748b",
                        fontWeight: 700,
                      }}
                    >
                      %
                    </span>
                  </div>
                  {tdsInput !== "" &&
                    (() => {
                      // Match the backend exactly: TDS rounded to nearest rupee
                      const tdsAmount = Math.round(
                        (invoice.amount * (parseFloat(tdsInput) || 0)) / 100,
                      );
                      const netPayable =
                        invoice.amount +
                        (invoice.gstAmount || 0) +
                        (invoice.roundOff || 0) -
                        tdsAmount;
                      return (
                        <div
                          style={{
                            marginTop: 8,
                            padding: "8px 12px",
                            background: "#f0fdf4",
                            border: "1px solid #bbf7d0",
                            borderRadius: 8,
                            fontSize: 12,
                            color: "#16a34a",
                          }}
                        >
                          TDS Amount: ₹
                          {tdsAmount.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}{" "}
                          · Net Payable: ₹
                          {netPayable.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}
                        </div>
                      );
                    })()}
                </div>
              )}

              <label style={S.fieldLabel}>Remarks (optional)</label>
              <textarea
                style={S.modalTextarea}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Add remarks..."
              />
              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  onClick={() => {
                    setActionModal(null);
                    setTdsInput("");
                  }}
                >
                  Cancel
                </button>
                <button
                  style={{
                    ...S.approveModalBtn,
                    opacity:
                      submitting ||
                      (user?.role === "accounts" && tdsInput === "")
                        ? 0.6
                        : 1,
                    cursor:
                      user?.role === "accounts" && tdsInput === ""
                        ? "not-allowed"
                        : "pointer",
                  }}
                  onClick={handleApprove}
                  disabled={
                    submitting || (user?.role === "accounts" && tdsInput === "")
                  }
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
                ✗ Reject Invoice
              </h3>
              <p style={S.modalSub}>
                Invoice will be returned to branch for revision.
              </p>
              <label style={S.fieldLabel}>Rejection Reason *</label>
              <textarea
                style={{ ...S.modalTextarea, borderColor: "#fecaca" }}
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

// ── Sub-components ─────────────────────────────────────────
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
    border: "1px solid #f1f5f9",
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
    alignItems: "flex-start",
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
  priorityBadge: {
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
  },
  meta: { fontSize: 13, color: "#888", marginTop: 4 },
  actionBtns: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  },
  editBtn: {
    padding: "9px 16px",
    background: "#f1f5f9",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
  },
  submitBtn: {
    padding: "9px 16px",
    background: C.accent,
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#fff",
  },
  paymentBtn: {
    padding: "9px 16px",
    background: "#16a34a",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#fff",
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
  waitingBadge: {
    padding: "8px 16px",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "#d97706",
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
  rejectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "#dc2626",
    marginBottom: 8,
  },
  rejectionLabel: {
    fontSize: 13,
    color: "#7f1d1d",
    fontWeight: 600,
    marginBottom: 4,
  },
  rejectionReason: {
    background: "#fff",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    color: "#334155",
    borderLeft: "3px solid #dc2626",
  },
  rejectionMeta: { fontSize: 12, color: "#94a3b8", marginTop: 6 },
  progressCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 20,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  progressSteps: { display: "flex", alignItems: "flex-start", minWidth: 400 },
  progressStep: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flex: 1,
    position: "relative",
  },
  progressDot: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
    zIndex: 1,
  },
  progressLabel: { fontSize: 11, textAlign: "center" },
  progressLine: {
    position: "absolute",
    top: 15,
    left: "55%",
    width: "90%",
    height: 2,
    zIndex: 0,
  },
  tabs: {
    display: "flex",
    gap: 2,
    marginBottom: 16,
    background: "#fff",
    borderRadius: 10,
    padding: 4,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  tab: {
    padding: "9px 16px",
    border: "none",
    borderRadius: 8,
    background: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    color: "#64748b",
    whiteSpace: "nowrap",
  },
  tabActive: { background: C.primary, color: "#fff", fontWeight: 700 },
  tabContent: { display: "flex", flexDirection: "column", gap: 16 },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 16,
  },
  descBox: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 1.6,
    padding: "10px 12px",
    background: "#f8fafc",
    borderRadius: 8,
  },
  remarksLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    marginTop: 12,
    marginBottom: 6,
  },
  amountRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: "1px solid #f8fafc",
  },
  amountLabel: { fontSize: 14, color: "#64748b" },
  amountVal: { fontSize: 14, fontWeight: 600, color: "#334155" },
  divider: { borderTop: "2px solid #e2e8f0", margin: "10px 0" },
  netRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
  },
  netLabel: { fontSize: 15, fontWeight: 700, color: C.primary },
  netVal: { fontSize: 22, fontWeight: 700, color: C.primary },
  historyItem: {
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
    paddingBottom: 14,
    borderBottom: "1px solid #f1f5f9",
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: 4,
  },
  historyTop: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  historyTime: { fontSize: 12, color: "#94a3b8", marginLeft: "auto" },
  historyRemarks: {
    fontSize: 13,
    color: "#475569",
    marginTop: 6,
    fontStyle: "italic",
  },
  emptyHistory: { padding: 20, textAlign: "center", color: "#94a3b8" },
  paymentLink: {
    marginTop: 16,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 10,
    padding: 14,
  },
  paymentLinkTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#16a34a",
    marginBottom: 6,
  },
  paymentLinkBtn: {
    padding: "7px 14px",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
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
  modalSub: { fontSize: 14, color: "#475569", marginBottom: 16 },
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
    border: `1.5px solid ${C.border}`,
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
    cursor: "pointer",
    fontWeight: 700,
  },
};
