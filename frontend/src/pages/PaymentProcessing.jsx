import { useState, useEffect, useCallback } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { PAYMENT_WORKFLOW } from "../config/constants";
import SearchableSelect from "../components/SearchableSelect.jsx";

const STATUS_STYLES = {
  "Payment Pending": { bg: "#f1f5f9", color: "#475569", icon: "⏳" },
  "Payment Raised": { bg: "#eff6ff", color: "#2563eb", icon: "📤" },
  "Accounts Approved": { bg: "#f0fdf4", color: "#16a34a", icon: "✅" },
  "Excel Generated": { bg: "#f0fdf4", color: "#15803d", icon: "📊" },
  "Payment Processed": { bg: "#f0fdf4", color: "#166534", icon: "✅" },
  "Partially Paid": { bg: "#fffbeb", color: "#d97706", icon: "⚡" },
  "Fully Paid": { bg: "#f0fdf4", color: "#166534", icon: "🎉" },
  "Payment Rejected": { bg: "#fef2f2", color: "#dc2626", icon: "❌" },
};

export default function PaymentProcessing() {
  const { user } = useNavigate();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();

  const [tab, setTab] = useState("raise"); // 'raise' | 'processing'
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [raiseModal, setRaiseModal] = useState(null);
  const [raiseForm, setRaiseForm] = useState({
    paymentRemarks: "",
    scheduledDate: "",
    paymentAmount: "",
    paymentType: "full",
  });
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [utrModal, setUtrModal] = useState(null); // payment object
  const [utrInput, setUtrInput] = useState("");
  const [utrSubmitting, setUtrSubmitting] = useState(false);
  const [processedPayments, setProcessedPayments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchFilter, setBranchFilter] = useState("");

  useEffect(() => {
    if (["accounts", "super_admin", "cluster_head"].includes(authUser?.role)) {
      api
        .get("/branches?limit=100")
        .then((r) =>
          setBranches(Array.isArray(r.data) ? r.data : r.data.branches || []),
        )
        .catch(console.error);
    }
  }, [authUser]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const bq = branchFilter ? `branch=${branchFilter}` : "";
      const [invRes, payRes, processedRes] = await Promise.all([
        api.get(`/payments/approved-invoices${bq ? `?${bq}` : ""}`),
        api.get(`/payments${bq ? `?${bq}` : ""}`),
        api.get(`/payments?processedOnly=true&limit=100${bq ? `&${bq}` : ""}`),
      ]);
      setInvoices(
        Array.isArray(invRes.data) ? invRes.data : invRes.data.invoices || [],
      );
      const allPayments = Array.isArray(payRes.data)
        ? payRes.data
        : payRes.data.payments || [];
      setPayments(
        allPayments.filter(
          (p) =>
            !["Payment Processed", "Partially Paid", "Fully Paid"].includes(
              p.status,
            ),
        ),
      );
      setProcessedPayments(
        Array.isArray(processedRes.data)
          ? processedRes.data
          : processedRes.data.payments || [],
      );
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [branchFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRaisePayment = async () => {
    if (!raiseModal) return;
    setRaising(true);
    try {
      await api.post(`/payments/raise/${raiseModal._id}`, {
        ...raiseForm,
        paymentAmount: raiseForm.paymentAmount || raiseModal.netPayable,
      });
      setRaiseModal(null);
      setRaiseForm({
        paymentRemarks: "",
        scheduledDate: "",
        paymentAmount: "",
      });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to raise payment");
    } finally {
      setRaising(false);
    }
  };

  const handleApprove = async (paymentId, remarks = "") => {
    try {
      await api.patch(`/payments/${paymentId}/approve`, { remarks });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || "Approval failed");
    }
  };

  const handleReject = async (paymentId, reason) => {
    try {
      await api.patch(`/payments/${paymentId}/reject`, { reason });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || "Rejection failed");
    }
  };

  const handleGenerateExcel = async (paymentId) => {
    try {
      const res = await api.post(
        `/payments/${paymentId}/generate-excel`,
        {},
        { responseType: "blob" },
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Payment_${paymentId}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      fetchData();
    } catch (err) {
      console.error("Excel generation error:", err);
      setError(
        err.response?.data?.message || err.message || "Excel generation failed",
      );
    }
  };

  const isBranch = authUser?.role === "branch_user";
  const isAccounts = authUser?.role === "accounts";

  const eligiblePayments = payments.filter((p) =>
    ["Accounts Approved", "Excel Generated"].includes(p.status),
  );
  const allEligibleSelected =
    eligiblePayments.length > 0 &&
    eligiblePayments.every((p) => selectedIds.includes(p._id));

  const toggleSelectAll = () => {
    if (allEligibleSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(eligiblePayments.map((p) => p._id));
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleRecordUTR = async () => {
    if (!utrInput.trim()) return;
    setUtrSubmitting(true);
    try {
      await api.patch(`/payments/${utrModal._id}/utr`, {
        utrNumber: utrInput.trim(),
      });
      setUtrModal(null);
      setUtrInput("");
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to record UTR");
    } finally {
      setUtrSubmitting(false);
    }
  };

  const handleBulkExcel = async () => {
    if (selectedIds.length === 0) return;
    setBulkGenerating(true);
    try {
      const res = await api.post(
        "/payments/bulk-excel",
        { paymentIds: selectedIds },
        { responseType: "blob" },
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      const date = new Date().toISOString().slice(0, 10);
      link.setAttribute("download", `Bulk_Payments_${date}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setSelectedIds([]);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || "Bulk Excel generation failed");
    } finally {
      setBulkGenerating(false);
    }
  };

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>💳 Payment Processing</h1>
            <p style={S.sub}>Raise and track payments for approved invoices</p>
          </div>
        </div>

        {error && (
          <div style={S.errorBox}>
            {error}
            <button style={S.errorClose} onClick={() => setError("")}>
              ✕
            </button>
          </div>
        )}

        {/* Tabs */}
        <div style={S.tabs}>
          <button
            style={{ ...S.tab, ...(tab === "raise" ? S.tabActive : {}) }}
            onClick={() => setTab("raise")}
          >
            📋 Approved Invoices{" "}
            {invoices.length > 0 && (
              <span style={S.badge}>{invoices.length}</span>
            )}
          </button>
          <button
            style={{ ...S.tab, ...(tab === "processing" ? S.tabActive : {}) }}
            onClick={() => setTab("processing")}
          >
            💳 Payment Requests <span style={S.badge}>{payments.length}</span>
          </button>
          <button
            style={{ ...S.tab, ...(tab === "processed" ? S.tabActive : {}) }}
            onClick={() => setTab("processed")}
          >
            ✅ Payment Processed{" "}
            {processedPayments.length > 0 && (
              <span style={S.badge}>{processedPayments.length}</span>
            )}
          </button>
        </div>

        {["accounts", "super_admin", "cluster_head"].includes(
          authUser?.role,
        ) && (
          <div style={{ marginBottom: 16, maxWidth: 280 }}>
            <SearchableSelect
              options={[
                { _id: "", name: "All Branches", code: "" },
                ...branches,
              ]}
              value={branchFilter}
              onChange={(val) => setBranchFilter(val)}
              getOptionLabel={(b) =>
                b.code ? `${b.name} (${b.code})` : b.name
              }
              placeholder="All Branches"
            />
          </div>
        )}

        {loading ? (
          <div style={S.loading}>Loading...</div>
        ) : (
          <>
            {/* ── Tab 1: Approved Invoices ──────────────── */}
            {tab === "raise" && (
              <div>
                <div style={S.infoBox}>
                  ℹ️ These invoices are fully approved by Cluster Head and ready
                  for payment. The Accounts team can raise and process the
                  payment.
                </div>
                <div style={S.tableCard}>
                  <table style={S.table}>
                    <thead>
                      <tr style={S.thead}>
                        {[
                          "Invoice ID",
                          "Invoice No.",
                          "Vendor",
                          "Branch",
                          "Amount",
                          "Payment Progress",
                          "Payment Status",
                          "Action",
                        ].map((h) => (
                          <th key={h} style={S.th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => {
                        const pay = inv.paymentRequest;
                        const paySS =
                          STATUS_STYLES[pay?.status] ||
                          STATUS_STYLES["Payment Pending"];
                        const canRaise =
                          isAccounts &&
                          [
                            "Payment Pending",
                            "Partially Paid",
                            "Payment Rejected",
                          ].includes(pay?.status);
                        const isFullyPaid = pay?.status === "Fully Paid";
                        const hasActivePayment = [
                          "Payment Raised",
                          "Accounts Approved",
                          "Excel Generated",
                        ].includes(pay?.status);
                        const total = pay?.totalAmount || inv.netPayable || 0;
                        const paid = pay?.paidAmount || 0;
                        const remaining = pay?.remainingAmount ?? total;
                        const pct =
                          total > 0
                            ? Math.min(100, Math.round((paid / total) * 100))
                            : 0;
                        return (
                          <tr key={inv._id} style={S.tr}>
                            <td style={S.td}>
                              <span style={S.reqId}>{inv.requestId}</span>
                            </td>
                            <td style={S.td}>{inv.invoiceNumber}</td>
                            <td style={S.td}>
                              <div style={{ fontWeight: 600 }}>
                                {inv.vendor?.vendorName}
                              </div>
                              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                                {inv.vendor?.companyName}
                              </div>
                            </td>
                            <td style={S.td}>{inv.branch?.name}</td>
                            <td
                              style={{
                                ...S.td,
                                fontWeight: 700,
                                color: "#16a34a",
                              }}
                            >
                              ₹{inv.netPayable?.toLocaleString("en-IN")}
                            </td>
                            {/* ✅ Payment Progress */}
                            <td style={S.td}>
                              <div style={{ minWidth: 130 }}>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#64748b",
                                    marginBottom: 3,
                                  }}
                                >
                                  ₹{paid.toLocaleString("en-IN")} / ₹
                                  {total.toLocaleString("en-IN")}
                                </div>
                                <div
                                  style={{
                                    background: "#e2e8f0",
                                    borderRadius: 4,
                                    height: 6,
                                    overflow: "hidden",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${pct}%`,
                                      height: "100%",
                                      background:
                                        pct === 100 ? "#16a34a" : "#d97706",
                                      borderRadius: 4,
                                      transition: "width 0.3s",
                                    }}
                                  />
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: pct === 100 ? "#16a34a" : "#d97706",
                                    marginTop: 2,
                                    fontWeight: 600,
                                  }}
                                >
                                  {pct}% paid
                                  {remaining > 0 && pct > 0 && (
                                    <span
                                      style={{
                                        color: "#94a3b8",
                                        fontWeight: 400,
                                      }}
                                    >
                                      {" "}
                                      · ₹{remaining.toLocaleString(
                                        "en-IN",
                                      )}{" "}
                                      left
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={S.td}>
                              <span
                                style={{
                                  ...S.statusBadge,
                                  background: paySS.bg,
                                  color: paySS.color,
                                }}
                              >
                                {paySS.icon} {pay?.status || "Payment Pending"}
                              </span>
                            </td>
                            <td style={S.td}>
                              {isFullyPaid ? (
                                <span
                                  style={{
                                    fontSize: 12,
                                    color: "#16a34a",
                                    fontWeight: 700,
                                  }}
                                >
                                  🎉 Fully Paid
                                </span>
                              ) : canRaise ? (
                                <button
                                  style={{
                                    ...S.raiseBtn,
                                    ...(pay?.status === "Partially Paid"
                                      ? { background: "#d97706" }
                                      : {}),
                                  }}
                                  onClick={() => {
                                    setRaiseModal(inv);
                                    setRaiseForm({
                                      paymentRemarks: "",
                                      scheduledDate: "",
                                      paymentAmount: remaining,
                                      paymentType: "full",
                                    });
                                  }}
                                >
                                  {pay?.status === "Partially Paid"
                                    ? "⚡ Pay Remaining"
                                    : pay?.status === "Payment Rejected"
                                      ? "🔄 Re-raise Payment"
                                      : "💳 Raise Payment"}
                                </button>
                              ) : (
                                <button
                                  style={S.viewBtn}
                                  onClick={() =>
                                    navigate(`/payments/${pay?._id}`)
                                  }
                                >
                                  View
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {invoices.length === 0 && (
                        <tr>
                          <td colSpan={8} style={S.emptyCell}>
                            No approved invoices available for payment
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Tab 2: Payment Requests ───────────────── */}
            {tab === "processing" && (
              <div>
                {/* Bulk toolbar */}
                <div style={S.bulkBar}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span style={{ fontSize: 13, color: "#475569" }}>
                      {selectedIds.length > 0
                        ? `${selectedIds.length} selected`
                        : `${eligiblePayments.length} eligible for Excel`}
                    </span>
                    {selectedIds.length > 0 && (
                      <button
                        style={S.clearSelBtn}
                        onClick={() => setSelectedIds([])}
                      >
                        ✕ Clear
                      </button>
                    )}
                  </div>
                  <button
                    style={{
                      ...S.bulkExcelBtn,
                      opacity:
                        selectedIds.length === 0 || bulkGenerating ? 0.5 : 1,
                      cursor:
                        selectedIds.length === 0 || bulkGenerating
                          ? "not-allowed"
                          : "pointer",
                    }}
                    disabled={selectedIds.length === 0 || bulkGenerating}
                    onClick={() =>
                      selectedIds.length > 0 && setShowBulkConfirm(true)
                    }
                  >
                    {bulkGenerating
                      ? "⏳ Generating..."
                      : `📊 Generate Excel (${selectedIds.length})`}
                  </button>
                </div>

                <div style={S.tableCard}>
                  <table style={S.table}>
                    <thead>
                      <tr style={S.thead}>
                        <th style={{ ...S.th, width: 40, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={allEligibleSelected}
                            onChange={toggleSelectAll}
                            title="Select all eligible"
                            style={{ cursor: "pointer", width: 15, height: 15 }}
                          />
                        </th>
                        {[
                          "Payment ID",
                          "Invoice",
                          "Branch",
                          "Vendor",
                          "Amount",

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
                      {payments.map((pay) => {
                        const ss =
                          STATUS_STYLES[pay.status] ||
                          STATUS_STYLES["Payment Pending"];
                        const myTurn =
                          PAYMENT_WORKFLOW.find((w) => w.status === pay.status)
                            ?.actingRole === authUser?.role;
                        const canApprove =
                          isAccounts && pay.status === "Payment Raised";
                        const canExcel =
                          isAccounts &&
                          ["Accounts Approved", "Excel Generated"].includes(
                            pay.status,
                          );
                        const isEligible = [
                          "Accounts Approved",
                          "Excel Generated",
                        ].includes(pay.status);
                        const isChecked = selectedIds.includes(pay._id);

                        return (
                          <tr
                            key={pay._id}
                            style={{
                              ...S.tr,
                              background: isChecked ? "#eff6ff" : undefined,
                            }}
                          >
                            <td style={{ ...S.td, textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!isEligible}
                                onChange={() => toggleSelect(pay._id)}
                                style={{
                                  cursor: isEligible
                                    ? "pointer"
                                    : "not-allowed",
                                  opacity: isEligible ? 1 : 0.3,
                                  width: 15,
                                  height: 15,
                                }}
                              />
                            </td>
                            <td style={S.td}>
                              <span style={S.reqId}>{pay.paymentId}</span>
                            </td>
                            <td style={S.td}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>
                                {pay.invoiceRequest?.requestId}
                              </div>
                              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                                {pay.invoiceRequest?.invoiceNumber}
                              </div>
                            </td>
                            <td style={S.td}>{pay.branch?.name || "—"}</td>
                            <td style={S.td}>{pay.vendor?.vendorName}</td>
                            <td
                              style={{
                                ...S.td,
                                fontWeight: 700,
                                color: "#16a34a",
                              }}
                            >
                              ₹{pay.paymentAmount?.toLocaleString("en-IN")}
                            </td>

                            <td style={S.td}>
                              <span
                                style={{
                                  ...S.statusBadge,
                                  background: ss.bg,
                                  color: ss.color,
                                }}
                              >
                                {ss.icon} {pay.status}
                              </span>
                            </td>
                            <td style={S.td}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  style={S.viewBtn}
                                  onClick={() =>
                                    navigate(`/payments/${pay._id}`)
                                  }
                                >
                                  View
                                </button>
                                {canApprove && (
                                  <>
                                    <button
                                      style={S.rejectBtn}
                                      onClick={() => {
                                        const reason = window.prompt(
                                          "Rejection reason (required):",
                                        );
                                        if (reason?.trim())
                                          handleReject(pay._id, reason);
                                      }}
                                    >
                                      ✗ Reject
                                    </button>
                                    <button
                                      style={S.approveBtn}
                                      onClick={() => handleApprove(pay._id, "")}
                                    >
                                      ✓ Approve
                                    </button>
                                  </>
                                )}
                                {canExcel && (
                                  <button
                                    style={S.excelBtn}
                                    onClick={() => handleGenerateExcel(pay._id)}
                                  >
                                    📊 Excel
                                  </button>
                                )}
                                {pay.status === "Excel Generated" &&
                                  isAccounts && (
                                    <button
                                      style={{
                                        ...S.excelBtn,
                                        background: "#166534",
                                        fontSize: 12,
                                      }}
                                      onClick={() => {
                                        setUtrModal(pay);
                                        setUtrInput("");
                                      }}
                                    >
                                      🔢 Enter UTR
                                    </button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {payments.length === 0 && (
                        <tr>
                          <td colSpan={8} style={S.emptyCell}>
                            No payment requests found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Tab 3: Payment Processed ─────────────── */}
        {tab === "processed" && (
          <div style={S.tableCard}>
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  {[
                    "Payment ID",
                    "Invoice",
                    "Branch",
                    "Vendor",
                    "Amount",

                    "UTR Number",
                    "Processed At",
                    "Actions",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {processedPayments.map((pay) => (
                  <tr key={pay._id} style={S.tr}>
                    <td style={S.td}>
                      <span style={S.reqId}>{pay.paymentId}</span>
                    </td>
                    <td style={S.td}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {pay.invoiceRequest?.requestId || "—"}
                      </div>
                    </td>
                    <td style={S.td}>{pay.branch?.name || "—"}</td>
                    <td style={S.td}>{pay.vendor?.vendorName || "—"}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>
                      ₹{pay.paymentAmount?.toLocaleString("en-IN")}
                    </td>
                    <td style={S.td}>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 700,
                          color: "#166534",
                          background: "#f0fdf4",
                          padding: "3px 10px",
                          borderRadius: 6,
                          fontSize: 13,
                        }}
                      >
                        {pay.utrNumber}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: "#64748b", fontSize: 12 }}>
                      {pay.utrRecordedAt
                        ? new Date(pay.utrRecordedAt).toLocaleDateString(
                            "en-GB",
                            { day: "2-digit", month: "short", year: "numeric" },
                          )
                        : "—"}
                    </td>
                    <td style={S.td}>
                      <button
                        style={S.viewBtn}
                        onClick={() => navigate(`/payments/${pay._id}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {processedPayments.length === 0 && (
                  <tr>
                    <td colSpan={8} style={S.emptyCell}>
                      No processed payments yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Raise Payment Modal ──────────────────────── */}
        {raiseModal && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={S.modalTitle}>💳 Raise Payment Request</h3>
              <p style={S.modalSub}>
                Invoice <strong>{raiseModal.requestId}</strong> ·{" "}
                <strong>{raiseModal.vendor?.vendorName}</strong>
              </p>

              <div style={S.invoiceSummary}>
                <div style={S.summaryRow}>
                  <span>Invoice Amount</span>
                  <strong>₹{raiseModal.amount?.toLocaleString("en-IN")}</strong>
                </div>
                <div style={S.summaryRow}>
                  <span>GST</span>
                  <strong>
                    ₹{raiseModal.gstAmount?.toLocaleString("en-IN")}
                  </strong>
                </div>
                <div style={S.summaryRow}>
                  <span>TDS</span>
                  <strong>
                    ₹{raiseModal.tdsAmount?.toLocaleString("en-IN")}
                  </strong>
                </div>
                <div
                  style={{
                    ...S.summaryRow,
                    borderTop: "2px solid #e2e8f0",
                    paddingTop: 8,
                    marginTop: 4,
                  }}
                >
                  <span style={{ fontWeight: 700 }}>Net Payable</span>
                  <strong style={{ color: "#16a34a", fontSize: 16 }}>
                    ₹{raiseModal.netPayable?.toLocaleString("en-IN")}
                  </strong>
                </div>
              </div>

              <div style={S.invoiceSummary}>
                <div style={S.summaryRow}>
                  <span>Total Invoice Amount</span>
                  <strong>
                    ₹
                    {(
                      raiseModal.paymentRequest?.totalAmount ||
                      raiseModal.netPayable
                    )?.toLocaleString("en-IN")}
                  </strong>
                </div>
                <div style={S.summaryRow}>
                  <span>Already Paid</span>
                  <strong style={{ color: "#16a34a" }}>
                    ₹
                    {(
                      raiseModal.paymentRequest?.paidAmount || 0
                    )?.toLocaleString("en-IN")}
                  </strong>
                </div>
                <div
                  style={{
                    ...S.summaryRow,
                    borderTop: "2px solid #e2e8f0",
                    paddingTop: 8,
                    marginTop: 4,
                  }}
                >
                  <span style={{ fontWeight: 700 }}>Remaining Balance</span>
                  <strong style={{ color: "#d97706", fontSize: 16 }}>
                    ₹
                    {(
                      raiseModal.paymentRequest?.remainingAmount ??
                      raiseModal.netPayable
                    )?.toLocaleString("en-IN")}
                  </strong>
                </div>
              </div>

              {/* Payment Type */}
              <div style={S.field}>
                <label style={S.label}>Payment Type *</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {["full", "partial"].map((type) => (
                    <label
                      key={type}
                      style={{
                        flex: 1,
                        padding: "10px 14px",
                        border: `1.5px solid ${raiseForm.paymentType === type ? (type === "full" ? "#16a34a" : "#d97706") : "#e2e8f0"}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        textAlign: "center",
                        fontWeight: 600,
                        fontSize: 13,
                        background:
                          raiseForm.paymentType === type
                            ? type === "full"
                              ? "#f0fdf4"
                              : "#fffbeb"
                            : "#fff",
                        color:
                          raiseForm.paymentType === type
                            ? type === "full"
                              ? "#16a34a"
                              : "#d97706"
                            : "#475569",
                      }}
                    >
                      <input
                        type="radio"
                        name="paymentType"
                        value={type}
                        checked={raiseForm.paymentType === type}
                        onChange={(e) => {
                          const remaining =
                            raiseModal.paymentRequest?.remainingAmount ??
                            raiseModal.netPayable;
                          setRaiseForm((f) => ({
                            ...f,
                            paymentType: e.target.value,
                            paymentAmount:
                              e.target.value === "full" ? remaining : "",
                          }));
                        }}
                        style={{ display: "none" }}
                      />
                      {type === "full"
                        ? "💯 Full Payment"
                        : "⚡ Partial Payment"}
                    </label>
                  ))}
                </div>
              </div>

              {/* ✅ Amount input — always show, readonly for full */}
              <div style={S.field}>
                <label style={S.label}>
                  {raiseForm.paymentType === "partial"
                    ? "Partial Amount (₹) *"
                    : "Payment Amount (₹)"}
                </label>
                <div style={{ position: "relative" }}>
                  <span
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#64748b",
                      fontWeight: 600,
                      pointerEvents: "none",
                    }}
                  >
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    max={
                      raiseModal.paymentRequest?.remainingAmount ??
                      raiseModal.netPayable
                    }
                    step="0.01"
                    style={{
                      width: "100%",
                      padding: "10px 12px 10px 28px",
                      border: "1.5px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                      background:
                        raiseForm.paymentType === "full" ? "#f8fafc" : "#fff",
                      color:
                        raiseForm.paymentType === "full"
                          ? "#64748b"
                          : "#334155",
                    }}
                    value={raiseForm.paymentAmount}
                    readOnly={raiseForm.paymentType === "full"}
                    onChange={(e) => {
                      if (raiseForm.paymentType === "partial") {
                        setRaiseForm((f) => ({
                          ...f,
                          paymentAmount: e.target.value,
                        }));
                      }
                    }}
                    placeholder="Enter amount..."
                  />
                </div>
                {raiseForm.paymentType === "partial" && (
                  <span
                    style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}
                  >
                    Max: ₹
                    {(
                      raiseModal.paymentRequest?.remainingAmount ??
                      raiseModal.netPayable
                    )?.toLocaleString("en-IN")}
                  </span>
                )}
              </div>

              <div style={S.vendorBank}>
                <div style={S.vendorBankTitle}>🏦 Payment Destination</div>
                <div style={S.vendorBankGrid}>
                  <div>
                    <span style={S.bankLabel}>Account Holder</span>
                    <span style={S.bankVal}>
                      {raiseModal.vendor?.accountHolderName}
                    </span>
                  </div>
                  <div>
                    <span style={S.bankLabel}>Bank</span>
                    <span style={S.bankVal}>{raiseModal.vendor?.bankName}</span>
                  </div>
                  <div>
                    <span style={S.bankLabel}>Account No.</span>
                    <span style={S.bankVal}>
                      ****{raiseModal.vendor?.accountNumber?.slice(-4)}
                    </span>
                  </div>
                  <div>
                    <span style={S.bankLabel}>IFSC</span>
                    <span style={S.bankVal}>{raiseModal.vendor?.ifscCode}</span>
                  </div>
                </div>
              </div>

              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  onClick={() => {
                    setRaiseModal(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  style={{ ...S.raiseConfirmBtn, opacity: raising ? 0.7 : 1 }}
                  onClick={handleRaisePayment}
                  disabled={raising}
                >
                  {raising ? "Raising..." : "💳 Confirm & Raise Payment"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Bulk Excel Confirm Modal ──────────────────────── */}
      {showBulkConfirm &&
        (() => {
          const selectedPayments = payments.filter((p) =>
            selectedIds.includes(p._id),
          );
          const totalAmount = selectedPayments.reduce(
            (sum, p) => sum + (p.paymentAmount || 0),
            0,
          );
          return (
            <div style={S.overlay}>
              <div style={S.modal}>
                <h3 style={S.modalTitle}>📊 Confirm Bulk Excel Generation</h3>
                <p style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>
                  Please review the selected payments before downloading.
                </p>

                {/* Summary cards */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <div style={S.summaryCard}>
                    <div style={S.summaryLabel}>Total Invoices</div>
                    <div style={S.summaryValue}>{selectedPayments.length}</div>
                  </div>
                  <div style={S.summaryCard}>
                    <div style={S.summaryLabel}>Total Payment Amount</div>
                    <div style={{ ...S.summaryValue, color: "#16a34a" }}>
                      ₹
                      {totalAmount.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </div>
                  </div>
                </div>

                {/* Per-payment breakdown */}
                <div
                  style={{
                    maxHeight: 260,
                    overflowY: "auto",
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    marginBottom: 16,
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Payment ID", "Vendor", "Amount", "Status"].map(
                          (h) => (
                            <th
                              key={h}
                              style={{
                                padding: "8px 12px",
                                textAlign: "left",
                                fontWeight: 600,
                                color: "#475569",
                                fontSize: 11,
                                textTransform: "uppercase",
                                borderBottom: `1px solid ${C.border}`,
                              }}
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPayments.map((p, i) => (
                        <tr
                          key={p._id}
                          style={{
                            borderBottom: "1px solid #f8fafc",
                            background: i % 2 === 0 ? "#fff" : "#f8fafc",
                          }}
                        >
                          <td
                            style={{
                              padding: "8px 12px",
                              fontFamily: "monospace",
                              fontWeight: 700,
                              color: C.primary,
                            }}
                          >
                            {p.paymentId}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#334155" }}>
                            {p.vendor?.vendorName || "—"}
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              fontWeight: 600,
                              color: "#334155",
                            }}
                          >
                            ₹
                            {(p.paymentAmount || 0).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 20,
                                background:
                                  p.status === "Accounts Approved"
                                    ? "#f0fdf4"
                                    : "#eff6ff",
                                color:
                                  p.status === "Accounts Approved"
                                    ? "#16a34a"
                                    : "#2563eb",
                              }}
                            >
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={S.modalBtns}>
                  <button
                    style={S.cancelBtn}
                    onClick={() => setShowBulkConfirm(false)}
                    disabled={bulkGenerating}
                  >
                    Cancel
                  </button>
                  <button
                    style={{
                      ...S.confirmExcelBtn,
                      opacity: bulkGenerating ? 0.7 : 1,
                      cursor: bulkGenerating ? "not-allowed" : "pointer",
                    }}
                    disabled={bulkGenerating}
                    onClick={async () => {
                      setShowBulkConfirm(false);
                      await handleBulkExcel();
                    }}
                  >
                    {bulkGenerating
                      ? "⏳ Generating..."
                      : "📥 Confirm & Download Excel"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      {/* UTR Entry Modal */}
      {utrModal && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={S.modalTitle}>🔢 Record UTR Number</h3>
            <p style={S.modalSub}>
              Payment <strong>{utrModal.paymentId}</strong> ·{" "}
              <strong>{utrModal.vendor?.vendorName}</strong>
            </p>
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 13,
                color: "#475569",
              }}
            >
              Amount:{" "}
              <strong>
                ₹{utrModal.paymentAmount?.toLocaleString("en-IN")}
              </strong>
            </div>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#475569",
                display: "block",
                marginBottom: 6,
              }}
            >
              UTR / Reference Number *
            </label>
            <input
              type="text"
              placeholder="e.g. HDFC0000123456789"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 8,
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "monospace",
                marginBottom: 6,
              }}
              value={utrInput}
              onChange={(e) => setUtrInput(e.target.value.toUpperCase())}
              autoFocus
            />
            <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
              This will mark the payment as <strong>Payment Processed</strong>{" "}
              and notify the branch user.
            </p>
            <div style={S.modalBtns}>
              <button
                style={S.cancelBtn}
                onClick={() => {
                  setUtrModal(null);
                  setUtrInput("");
                }}
                disabled={utrSubmitting}
              >
                Cancel
              </button>
              <button
                style={{
                  flex: 2,
                  padding: "10px",
                  border: "none",
                  borderRadius: 8,
                  background: utrInput.trim() ? "#166534" : "#94a3b8",
                  color: "#fff",
                  cursor: utrInput.trim() ? "pointer" : "not-allowed",
                  fontWeight: 700,
                  fontSize: 14,
                  opacity: utrSubmitting ? 0.7 : 1,
                }}
                disabled={!utrInput.trim() || utrSubmitting}
                onClick={handleRecordUTR}
              >
                {utrSubmitting ? "Recording..." : "✅ Confirm & Mark Processed"}
              </button>
            </div>
          </div>
        </div>
      )}
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
    marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: "#888", marginTop: 4 },
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
  errorClose: {
    background: "none",
    border: "none",
    color: "#dc2626",
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 700,
  },
  tabs: {
    display: "flex",
    gap: 4,
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
    fontSize: 14,
    fontWeight: 500,
    color: "#64748b",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  tabActive: { background: C.primary, color: "#fff", fontWeight: 700 },
  badge: {
    background: "#ef4444",
    color: "#fff",
    borderRadius: 20,
    padding: "1px 7px",
    fontSize: 11,
    fontWeight: 700,
  },
  infoBox: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#1d4ed8",
    marginBottom: 14,
  },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
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
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  },
  tr: { borderBottom: "1px solid #f8fafc" },
  td: { padding: "12px 14px", color: "#334155", verticalAlign: "middle" },
  reqId: {
    fontFamily: "monospace",
    fontWeight: 700,
    color: C.primary,
    fontSize: 13,
  },
  statusBadge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  modeBadge: {
    background: "#f0f9ff",
    color: "#0369a1",
    padding: "2px 8px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
  },
  raiseBtn: {
    padding: "6px 14px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  viewBtn: {
    padding: "5px 12px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 6,
    color: C.accent,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  rejectBtn: {
    padding: "5px 12px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    color: "#dc2626",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  approveBtn: {
    padding: "5px 12px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 6,
    color: "#16a34a",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  excelBtn: {
    padding: "5px 12px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 6,
    color: "#16a34a",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  emptyCell: { padding: 40, textAlign: "center", color: "#94a3b8" },
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
    maxWidth: 540,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
    maxHeight: "90vh",
    overflowY: "auto",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 6,
  },
  modalSub: { fontSize: 14, color: "#475569", marginBottom: 14 },
  invoiceSummary: {
    background: "#f8fafc",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: "12px 16px",
    marginBottom: 16,
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "5px 0",
    fontSize: 13,
    borderBottom: "1px solid #f1f5f9",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginBottom: 16,
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
  vendorBank: {
    background: "#f0f9ff",
    border: "1px solid #bae6fd",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  vendorBankTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#0369a1",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  vendorBankGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  bankLabel: {
    display: "block",
    fontSize: 11,
    color: "#64748b",
    marginBottom: 2,
  },
  bankVal: {
    fontSize: 13,
    fontWeight: 600,
    color: C.primary,
    fontFamily: "monospace",
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
  raiseConfirmBtn: {
    flex: 2,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: C.accent,
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
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
    maxWidth: 560,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 8,
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
    fontSize: 14,
  },
  confirmExcelBtn: {
    flex: 2,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: "#16a34a",
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
  },
  summaryCard: {
    background: "#f8fafc",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: "14px 16px",
    textAlign: "center",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 6,
    fontWeight: 600,
    textTransform: "uppercase",
  },
  summaryValue: { fontSize: 22, fontWeight: 700, color: C.primary },
  viewBtn: {
    padding: "5px 12px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 6,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  bulkBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: "10px 16px",
    marginBottom: 10,
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  },
  bulkExcelBtn: {
    padding: "9px 20px",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  clearSelBtn: {
    padding: "4px 10px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    color: "#dc2626",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
};
