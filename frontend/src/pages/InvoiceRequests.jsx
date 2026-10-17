import { useState, useEffect, useCallback } from "react";
import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLES, INVOICE_WORKFLOW } from "../config/constants.js";
import {
  AttachmentChips,
  AttachmentPreview,
} from "../components/AttachmentChips.jsx";
import {
  usePaymentCycle,
  ApprovalCycleNotice,
} from "../components/PaymentCycleWidgets.jsx";

const STATUS_STYLES = {
  Draft: { bg: "#f1f5f9", color: "#475569", icon: "📝" },
  Submitted: { bg: "#eff6ff", color: "#2563eb", icon: "📤" },
  "Partner Approved": { bg: "#fefce8", color: "#d97706", icon: "⏳" },
  "Accounts Approved": { bg: "#fef3c7", color: "#b45309", icon: "⏳" },
  "Cluster Head Approved": { bg: "#f0fdf4", color: "#16a34a", icon: "✅" },
  Rejected: { bg: "#fef2f2", color: "#dc2626", icon: "❌" },
};

const STATUSES = [
  "",
  "Draft",
  "Submitted",
  "Partner Approved",
  "Accounts Approved",
  "Cluster Head Approved",
  "Rejected",
];

export default function InvoiceRequests() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const [preview, setPreview] = useState(null); // { invoice, index }

  // Restore last-used filters/search for this browser session so they survive
  // navigating into an invoice and back. A URL param (e.g. a Dashboard link
  // like ?status=Submitted) still takes precedence over the saved state.
  const savedState = React.useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("invoiceListState")) || {};
    } catch {
      return {};
    }
  }, []);
  const [filters, setFilters] = useState(() => {
    const urlFilters = {
      status: searchParams.get("status") || "",
      priority: "", // priority filter removed (Oct 2026)
      branch: searchParams.get("branch") || "",
      from: searchParams.get("from") || "",
      to: searchParams.get("to") || "",
    };
    if (Object.values(urlFilters).some((v) => v)) return urlFilters;
    return { ...urlFilters, ...(savedState.filters || {}), priority: "" };
  });
  const [branches, setBranches] = useState([]);
  const [actionLoading, setActionLoading] = useState("");
  // Quick-approve popup: every approval shows the payment cycle first.
  const [approveTarget, setApproveTarget] = useState(null); // invoice row
  const [approveTds, setApproveTds] = useState("");
  const [approveError, setApproveError] = useState("");
  const {
    cycle,
    loading: cycleLoading,
    reload: reloadCycle,
  } = usePaymentCycle();
  // ── Bulk approve (Cluster Head only) ──────────────────────
  // Selection is kept by id with the row data, so the summary popup can
  // list invoices even after the user pages or filters away from them.
  const isClusterHead = user?.role === ROLES.CLUSTER_HEAD;
  const [selected, setSelected] = useState({}); // { [id]: invoice }
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRemarks, setBulkRemarks] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkResult, setBulkResult] = useState(null);
  const [search, setSearch] = useState(savedState.search || "");
  const [debouncedSearch, setDebouncedSearch] = useState(
    savedState.search || "",
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Remember filters + search for this session so they persist across navigation
  useEffect(() => {
    sessionStorage.setItem(
      "invoiceListState",
      JSON.stringify({ filters, search }),
    );
  }, [filters, search]);

  // Opens the approval popup (payment cycle + TDS for accounts).
  const handleQuickApprove = (e, inv) => {
    e.stopPropagation(); // prevent row click navigation
    reloadCycle();
    setApproveTds(user?.role === "accounts" ? "0" : "");
    setApproveError("");
    setApproveTarget(inv);
  };

  const confirmQuickApprove = async () => {
    const inv = approveTarget;
    if (!inv) return;

    // Accounts approval requires a TDS %
    let tdsPercentage;
    if (user?.role === "accounts") {
      const tds = parseFloat(approveTds);
      if (approveTds === "" || isNaN(tds) || tds < 0 || tds > 100) {
        setApproveError("TDS percentage must be a number between 0 and 100.");
        return;
      }
      tdsPercentage = tds;
    }

    setActionLoading(`approve_${inv._id}`);
    try {
      await api.patch(`/invoices/${inv._id}/approve`, {
        remarks: "",
        ...(tdsPercentage !== undefined && { tdsPercentage }),
      });
      setApproveTarget(null);
      fetchInvoices();
    } catch (err) {
      setApproveError(err.response?.data?.message || "Approval failed");
    } finally {
      setActionLoading("");
    }
  };

  // Only invoices waiting at the Cluster Head stage can be bulk approved.
  const isBulkEligible = (inv) =>
    isClusterHead && inv?.status === "Accounts Approved";
  const selectedList = Object.values(selected);
  const selectedCount = selectedList.length;
  const selectedTotal = selectedList.reduce(
    (s, inv) => s + (Number(inv.netPayable) || 0),
    0,
  );
  const eligibleOnPage = invoices.filter(isBulkEligible);
  const allPageSelected =
    eligibleOnPage.length > 0 &&
    eligibleOnPage.every((inv) => selected[inv._id]);

  const toggleSelect = (inv) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (next[inv._id]) delete next[inv._id];
      else if (Object.keys(next).length < BULK_MAX) next[inv._id] = inv;
      return next;
    });

  const toggleSelectPage = () =>
    setSelected((prev) => {
      const next = { ...prev };
      if (allPageSelected) {
        eligibleOnPage.forEach((inv) => delete next[inv._id]);
      } else {
        for (const inv of eligibleOnPage) {
          if (Object.keys(next).length >= BULK_MAX) break;
          next[inv._id] = inv;
        }
      }
      return next;
    });

  const openBulkApprove = () => {
    if (!selectedCount) return;
    reloadCycle();
    setBulkRemarks("");
    setBulkError("");
    setBulkResult(null);
    setBulkOpen(true);
  };

  const closeBulk = () => {
    if (bulkLoading) return;
    setBulkOpen(false);
    setBulkResult(null);
  };

  const confirmBulkApprove = async () => {
    setBulkLoading(true);
    setBulkError("");
    try {
      const { data } = await api.post("/invoices/bulk-approve", {
        invoiceIds: selectedList.map((inv) => inv._id),
        remarks: bulkRemarks.trim(),
      });
      setBulkResult(data);
      // Approved invoices leave the selection; failed ones stay ticked so
      // the Cluster Head can see and retry or open them.
      setSelected((prev) => {
        const next = { ...prev };
        (data.approved || []).forEach((a) => delete next[a._id]);
        return next;
      });
      fetchInvoices();
    } catch (err) {
      setBulkError(err.response?.data?.message || "Bulk approval failed");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleQuickReject = async (e, invoiceId) => {
    e.stopPropagation();
    const reason = window.prompt("Rejection reason (required):");
    if (!reason?.trim()) return;
    setActionLoading(`reject_${invoiceId}`);
    try {
      await api.patch(`/invoices/${invoiceId}/reject`, { reason });
      fetchInvoices();
    } catch (err) {
      alert(err.response?.data?.message || "Rejection failed");
    } finally {
      setActionLoading("");
    }
  };

  useEffect(() => {
    if (["accounts", "super_admin", "cluster_head"].includes(user?.role)) {
      api
        .get("/branches?limit=100&all=true")
        .then((r) =>
          setBranches(Array.isArray(r.data) ? r.data : r.data.branches || []),
        )
        .catch(console.error);
    }
  }, [user]);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: 20,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      });
      const { data } = await api.get(`/invoices?${params}`);
      setInvoices(data.invoices || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, filters]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>📋 Invoice Processing</h1>
            <p style={S.sub}>{total} total invoices</p>
          </div>
          {["branch_user", "accounts"].includes(user?.role) && (
            <button
              style={S.createBtn}
              onClick={() => navigate("/invoices/new")}
            >
              + New Invoice
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={S.filterBar}>
          <input
            style={S.searchInput}
            placeholder="Search invoice ID, invoice no., vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={S.select}
            value={filters.status}
            onChange={(e) => {
              setFilters((f) => ({ ...f, status: e.target.value }));
              setPage(1);
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "All Statuses"}
              </option>
            ))}
          </select>
          {[ROLES.ACCOUNTS, ROLES.SUPER_ADMIN, ROLES.CLUSTER_HEAD].includes(
            user?.role,
          ) && (
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

          <div style={S.dateGroup}>
            <label style={S.dateLabel}>From</label>
            <input
              type="date"
              style={S.dateInput}
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => {
                setFilters((f) => ({ ...f, from: e.target.value }));
                setPage(1);
              }}
            />
          </div>
          <div style={S.dateGroup}>
            <label style={S.dateLabel}>To</label>
            <input
              type="date"
              style={S.dateInput}
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => {
                setFilters((f) => ({ ...f, to: e.target.value }));
                setPage(1);
              }}
            />
          </div>
          <button
            style={S.resetBtn}
            onClick={() => {
              setSearch("");
              setDebouncedSearch("");
              setSelected({});
              setFilters({
                status: "",
                priority: "",
                branch: "",
                from: "",
                to: "",
              });
              setPage(1);
            }}
          >
            Reset
          </button>
        </div>

        {/* Bulk approve bar — Cluster Head only */}
        {isClusterHead && selectedCount > 0 && (
          <div style={BA.bar}>
            <div style={BA.barText}>
              <strong>{selectedCount}</strong> invoice
              {selectedCount > 1 ? "s" : ""} selected ·{" "}
              <strong>{inr(selectedTotal)}</strong>
              {selectedCount >= BULK_MAX && (
                <span style={BA.barHint}> (max {BULK_MAX} per batch)</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={BA.clearBtn} onClick={() => setSelected({})}>
                Clear
              </button>
              <button style={BA.approveBtn} onClick={openBulkApprove}>
                ✓ Approve Selected
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div style={S.tableCard}>
          {loading ? (
            <div style={S.loading}>Loading invoices...</div>
          ) : invoices.length === 0 ? (
            <div style={S.empty}>
              No invoices found.
              {["branch_user", "accounts"].includes(user?.role) && (
                <span
                  style={{ color: "#2563eb", cursor: "pointer", marginLeft: 6 }}
                  onClick={() => navigate("/invoices/new")}
                >
                  Create one now.
                </span>
              )}
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  {isClusterHead && (
                    <th style={{ ...S.th, width: 36 }}>
                      <input
                        type="checkbox"
                        title="Select all invoices awaiting your approval on this page"
                        style={BA.checkbox}
                        checked={allPageSelected}
                        disabled={eligibleOnPage.length === 0}
                        onChange={toggleSelectPage}
                      />
                    </th>
                  )}
                  {[
                    "Invoice ID",
                    "Branch",
                    "Vendor",
                    "Amount",
                    "Status",
                    "Date",
                    "Docs",
                    "",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const ss =
                    STATUS_STYLES[inv.status] || STATUS_STYLES["Draft"];
                  return (
                    <tr
                      key={inv._id}
                      style={S.tr}
                      onClick={() => navigate(`/invoices/${inv._id}`)}
                    >
                      {isClusterHead && (
                        <td
                          style={{ ...S.td, width: 36 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isBulkEligible(inv) && (
                            <input
                              type="checkbox"
                              style={BA.checkbox}
                              checked={!!selected[inv._id]}
                              disabled={
                                !selected[inv._id] && selectedCount >= BULK_MAX
                              }
                              onChange={() => toggleSelect(inv)}
                            />
                          )}
                        </td>
                      )}
                      <td style={S.td}>
                        <span style={S.reqId}>{inv.requestId}</span>
                        {inv.source === "fixed_payment" && (
                          <span
                            title="Fixed monthly payment — auto-created and auto-approved"
                            style={{
                              marginLeft: 6,
                              fontSize: 10.5,
                              fontWeight: 600,
                              color: "#7c3aed",
                              background: "#f5f3ff",
                              border: "1px solid #ddd6fe",
                              borderRadius: 999,
                              padding: "1px 7px",
                            }}
                          >
                            🔁 Fixed
                          </span>
                        )}
                      </td>
                      <td style={S.td}>{inv.branch?.name || "—"}</td>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>
                          {inv.vendor?.vendorName}
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8" }}>
                          {inv.vendor?.companyName}
                        </div>
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>
                        ₹{inv.netPayable?.toLocaleString("en-IN")}
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            ...S.badge,
                            background: ss.bg,
                            color: ss.color,
                          }}
                        >
                          {ss.icon} {inv.status}
                        </span>
                      </td>
                      <td style={{ ...S.td, color: "#94a3b8", fontSize: 12 }}>
                        {new Date(inv.createdAt).toLocaleDateString("en-GB")}
                      </td>

                      {/* ── Attachment quick buttons ── */}
                      <td style={S.td} onClick={(e) => e.stopPropagation()}>
                        <AttachmentChips
                          attachments={inv.attachments || []}
                          onOpen={(index) =>
                            setPreview({ invoice: inv, index })
                          }
                        />
                      </td>
                      <td
                        style={{ ...S.td, textAlign: "right" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {(() => {
                          const currentStep = INVOICE_WORKFLOW.find(
                            (w) => w.status === inv.status,
                          );
                          // Branches without a partner send invoices straight to
                          // accounts at the "Submitted" stage — treat that as the
                          // accounts user's turn too.
                          const partnerSkipped =
                            inv.partnerSkipped && inv.status === "Submitted";
                          const isMyTurn =
                            currentStep?.actingRole === user?.role ||
                            (partnerSkipped && user?.role === "accounts");
                          if (!isMyTurn) return null;
                          const showApprove = true;
                          const approveLoading =
                            actionLoading === `approve_${inv._id}`;
                          const rejectLoading =
                            actionLoading === `reject_${inv._id}`;
                          return (
                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                justifyContent: "flex-end",
                              }}
                            >
                              {showApprove && (
                                <button
                                  title="Quick Approve"
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 8,
                                    border: "1px solid #bbf7d0",
                                    background: "#f0fdf4",
                                    color: "#16a34a",
                                    cursor: approveLoading
                                      ? "not-allowed"
                                      : "pointer",
                                    fontSize: 16,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    opacity: approveLoading ? 0.5 : 1,
                                    fontWeight: 700,
                                  }}
                                  disabled={approveLoading || rejectLoading}
                                  onClick={(e) => handleQuickApprove(e, inv)}
                                >
                                  {approveLoading ? "⏳" : "✓"}
                                </button>
                              )}
                              <button
                                title="Quick Reject"
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 8,
                                  border: "1px solid #fecaca",
                                  background: "#fef2f2",
                                  color: "#dc2626",
                                  cursor: rejectLoading
                                    ? "not-allowed"
                                    : "pointer",
                                  fontSize: 16,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  opacity: rejectLoading ? 0.5 : 1,
                                  fontWeight: 700,
                                }}
                                disabled={approveLoading || rejectLoading}
                                onClick={(e) => handleQuickReject(e, inv._id)}
                              >
                                {rejectLoading ? "⏳" : "✗"}
                              </button>
                            </div>
                          );
                        })()}
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
            disabled={invoices.length < 20}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
        {preview && (
          <AttachmentPreview
            title={preview.invoice.requestId}
            attachments={preview.invoice.attachments || []}
            index={preview.index}
            onIndex={(index) => setPreview((p) => ({ ...p, index }))}
            onClose={() => setPreview(null)}
          />
        )}
        {/* ── Quick-approve popup ─────────────────────────── */}
        {approveTarget && (
          <div
            style={QA.overlay}
            onClick={() => !actionLoading && setApproveTarget(null)}
          >
            <div
              style={QA.modal}
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={QA.title}>✅ Approve Invoice</h3>
              <p style={QA.sub}>
                Approving <strong>{approveTarget.requestId}</strong>
                {approveTarget.vendor?.vendorName
                  ? ` · ${approveTarget.vendor.vendorName}`
                  : ""}
              </p>

              <ApprovalCycleNotice
                cycle={cycle}
                loading={cycleLoading}
                isFinalApproval={approveTarget.status === "Accounts Approved"}
              />

              {user?.role === "accounts" && (
                <div style={{ marginBottom: 12 }}>
                  <label style={QA.label}>TDS Percentage (%) *</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    style={QA.input}
                    value={approveTds}
                    onChange={(e) => setApproveTds(e.target.value)}
                  />
                </div>
              )}

              {approveError && <div style={QA.error}>{approveError}</div>}

              <div style={QA.actions}>
                <button
                  style={QA.cancel}
                  disabled={!!actionLoading}
                  onClick={() => setApproveTarget(null)}
                >
                  Cancel
                </button>
                <button
                  style={{ ...QA.confirm, opacity: actionLoading ? 0.6 : 1 }}
                  disabled={!!actionLoading}
                  onClick={confirmQuickApprove}
                >
                  {actionLoading ? "Approving…" : "✓ Confirm Approve"}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* ── Bulk approve summary popup ───────────────────── */}
        {bulkOpen && (
          <div style={QA.overlay} onClick={closeBulk}>
            <div
              style={{ ...QA.modal, maxWidth: 680 }}
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              {!bulkResult ? (
                <>
                  <h3 style={QA.title}>✅ Bulk Approve — Summary</h3>
                  <p style={QA.sub}>
                    You are approving <strong>{selectedCount}</strong> invoice
                    {selectedCount > 1 ? "s" : ""} worth{" "}
                    <strong>{inr(selectedTotal)}</strong>. Each will move to
                    Accounts for payment processing.
                  </p>

                  <ApprovalCycleNotice
                    cycle={cycle}
                    loading={cycleLoading}
                    isFinalApproval
                  />

                  <div style={BA.listWrap}>
                    <table style={BA.table}>
                      <thead>
                        <tr>
                          {[
                            "Invoice ID",
                            "Branch",
                            "Vendor",
                            "Net Payable",
                          ].map((h) => (
                            <th
                              key={h}
                              style={{
                                ...BA.th,
                                textAlign:
                                  h === "Net Payable" ? "right" : "left",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedList.map((inv) => (
                          <tr key={inv._id}>
                            <td style={{ ...BA.td, ...S.reqId }}>
                              {inv.requestId}
                            </td>
                            <td style={BA.td}>{inv.branch?.name || "—"}</td>
                            <td style={BA.td}>
                              {inv.vendor?.vendorName || "—"}
                            </td>
                            <td
                              style={{
                                ...BA.td,
                                textAlign: "right",
                                fontWeight: 600,
                              }}
                            >
                              {inr(inv.netPayable)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td style={BA.tf} colSpan={3}>
                            Total ({selectedCount})
                          </td>
                          <td style={{ ...BA.tf, textAlign: "right" }}>
                            {inr(selectedTotal)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {branchBreakdown(selectedList).length > 1 && (
                    <div style={BA.branchRow}>
                      {branchBreakdown(selectedList).map((b) => (
                        <span key={b.name} style={BA.branchChip}>
                          {b.name}: {b.count} · {inr(b.total)}
                        </span>
                      ))}
                    </div>
                  )}

                  <label style={{ ...QA.label, marginTop: 12 }}>
                    Remarks (optional)
                  </label>
                  <input
                    style={QA.input}
                    placeholder="Added to every invoice's approval history"
                    value={bulkRemarks}
                    maxLength={300}
                    onChange={(e) => setBulkRemarks(e.target.value)}
                  />

                  {bulkError && (
                    <div style={{ ...QA.error, marginTop: 10 }}>
                      {bulkError}
                    </div>
                  )}

                  <div style={QA.actions}>
                    <button
                      style={QA.cancel}
                      disabled={bulkLoading}
                      onClick={closeBulk}
                    >
                      Cancel
                    </button>
                    <button
                      style={{ ...QA.confirm, opacity: bulkLoading ? 0.6 : 1 }}
                      disabled={bulkLoading}
                      onClick={confirmBulkApprove}
                    >
                      {bulkLoading
                        ? `Approving ${selectedCount}…`
                        : `✓ Confirm & Approve ${selectedCount}`}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 style={QA.title}>
                    {bulkResult.failedCount === 0
                      ? "✅ Bulk approval complete"
                      : "⚠ Bulk approval finished with issues"}
                  </h3>
                  <p style={QA.sub}>
                    <strong>{bulkResult.approvedCount}</strong> of{" "}
                    {bulkResult.requested} approved ·{" "}
                    <strong>{inr(bulkResult.totalApprovedAmount)}</strong> sent
                    to Accounts for payment processing.
                  </p>
                  {bulkResult.failedCount > 0 && (
                    <div style={QA.error}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        Not approved ({bulkResult.failedCount}) — still selected
                      </div>
                      {bulkResult.failed.map((f) => (
                        <div key={f._id}>
                          <span style={{ fontFamily: "monospace" }}>
                            {f.requestId || f._id}
                          </span>{" "}
                          — {f.message}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={QA.actions}>
                    <button style={QA.confirm} onClick={closeBulk}>
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Bulk approve helpers & styles ──────────────────────────
const BULK_MAX = 50; // keep in step with BULK_APPROVE_MAX in invoiceController

const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const branchBreakdown = (list) => {
  const map = {};
  list.forEach((inv) => {
    const name = inv.branch?.name || "—";
    map[name] = map[name] || { name, count: 0, total: 0 };
    map[name].count += 1;
    map[name].total += Number(inv.netPayable) || 0;
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
};

const BA = {
  bar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: 10,
    padding: "10px 14px",
    marginBottom: 12,
    position: "sticky",
    top: 0,
    zIndex: 5,
  },
  barText: { fontSize: 14, color: "#0f766e" },
  barHint: { fontSize: 12, color: "#64748b" },
  clearBtn: {
    background: "#fff",
    color: "#475569",
    border: "1px solid #cbd5e1",
    padding: "8px 14px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  approveBtn: {
    background: "#16a34a",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  checkbox: {
    width: 16,
    height: 16,
    cursor: "pointer",
    accentColor: "#0198A3",
  },
  listWrap: {
    maxHeight: 280,
    overflowY: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    marginTop: 12,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    position: "sticky",
    top: 0,
    background: "#f8fafc",
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: "1px solid #e2e8f0",
  },
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid #f1f5f9",
    color: "#334155",
  },
  tf: {
    position: "sticky",
    bottom: 0,
    background: "#f8fafc",
    padding: "9px 10px",
    fontWeight: 700,
    color: "#1a3c6e",
    borderTop: "1px solid #e2e8f0",
  },
  branchRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 },
  branchChip: {
    fontSize: 12,
    background: "#f1f5f9",
    color: "#475569",
    borderRadius: 999,
    padding: "3px 10px",
  },
};

const C = { primary: "#1a3c6e", accent: "#2563eb", border: "#e2e8f0" };
const QA = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 16,
  },
  modal: {
    background: "#fff",
    borderRadius: 12,
    padding: "20px 22px",
    width: "100%",
    maxWidth: 460,
    boxShadow: "0 20px 45px rgba(0,0,0,0.22)",
  },
  title: { margin: 0, fontSize: 17, fontWeight: 700, color: "#1a3c6e" },
  sub: { fontSize: 13, color: "#64748b", margin: "6px 0 14px" },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    marginBottom: 5,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
  },
  error: {
    fontSize: 12.5,
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "8px 10px",
    marginBottom: 10,
  },
  actions: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 14,
  },
  cancel: {
    background: "#fff",
    color: "#475569",
    border: "1px solid #cbd5e1",
    padding: "9px 18px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  confirm: {
    background: "#16a34a",
    color: "#fff",
    border: "none",
    padding: "9px 18px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
};

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
  filterBar: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
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
  },
  dateGroup: { display: "flex", alignItems: "center", gap: 6 },
  dateLabel: { fontSize: 12, fontWeight: 600, color: "#64748b" },
  dateInput: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
    color: "#334155",
    outline: "none",
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
  tr: { borderBottom: "1px solid #f8fafc", cursor: "pointer" },
  td: { padding: "12px 14px", color: "#334155", verticalAlign: "middle" },
  reqId: {
    fontFamily: "monospace",
    fontWeight: 700,
    color: C.primary,
    fontSize: 13,
  },
  badge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  loading: { padding: 50, textAlign: "center", color: "#94a3b8" },
  empty: { padding: 50, textAlign: "center", color: "#94a3b8" },
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
};
