// ============================================================
// FRONTEND: src/components/PaymentPlanWidgets.jsx  —  NEW FILE (Nov 2026)
// ------------------------------------------------------------
// Part payments — shared UI.
//
//  • PaymentModeField   Full / Partial choice on the Add & Edit invoice forms
//  • PartPaymentsPanel  Parts of an invoice: approved / pending / paid, each
//                       part's status, TDS and cycle, plus the actions —
//                       Request next part (person who raised the invoice),
//                       Approve / Reject (Partner → Accounts → Cluster Head)
//  • PartPaymentBadge   Small pill for lists
//
// Screens read `paymentPlanSummary`, which the API derives at read time
// (backend utils/paymentPlan.js). Invoices without it are paid in one go.
// ============================================================
import React from "react";
import { useState } from "react";
import api from "../api/axios";
import {
  usePaymentCycle,
  ApprovalCycleNotice,
} from "./PaymentCycleWidgets.jsx";

export const inr = (n) =>
  "₹" +
  (Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const ROLE_LABEL = {
  branch_partner: "Branch Partner",
  accounts: "Accounts",
  cluster_head: "Cluster Head",
};

/** Error text for a part amount, or null. */
export const partAmountError = (amount, max, strictlyLess = false) => {
  if (amount === "" || amount === null || amount === undefined)
    return "Enter the amount to pay in this part";
  const v = round2(amount);
  if (!(v > 0)) return "Amount must be more than 0";
  if (strictlyLess && v >= round2(max))
    return `Must be less than ${inr(max)} — choose Full Payment instead`;
  if (!strictlyLess && v > round2(max)) return `Cannot exceed ${inr(max)}`;
  return null;
};

// ── Add / Edit invoice: Full or Partial ───────────────────
export function PaymentModeField({
  grossPayable,
  mode,
  amount,
  onMode,
  onAmount,
  error,
  disabled,
}) {
  const err =
    error ||
    (mode === "partial" && amount !== ""
      ? partAmountError(amount, grossPayable, true)
      : null);
  const balance =
    mode === "partial" && !err && amount !== ""
      ? round2(grossPayable - round2(amount))
      : null;
  return (
    <div style={W.box}>
      <div style={W.kicker}>PAYMENT</div>
      <div style={W.toggleRow}>
        {[
          ["full", "💯 Full Payment", "Pay the whole invoice"],
          ["partial", "⚡ Partial Payment", "Pay part now, the rest later"],
        ].map(([k, l, sub]) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            style={{ ...W.toggle, ...(mode === k ? W.toggleOn : {}) }}
            onClick={() => onMode(k)}
          >
            <div>{l}</div>
            <div style={W.toggleSub}>{sub}</div>
          </button>
        ))}
      </div>
      {mode === "partial" && (
        <>
          <label style={W.label}>Amount to pay now (before TDS) *</label>
          <div style={{ position: "relative" }}>
            <span style={W.rupee}>₹</span>
            <input
              type="number"
              min="0"
              step="0.01"
              disabled={disabled}
              placeholder={`Less than ${inr(grossPayable)}`}
              style={{ ...W.input, borderColor: err ? "#fca5a5" : "#e2e8f0" }}
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
            />
          </div>
          {err ? (
            <div style={W.err}>{err}</div>
          ) : balance !== null ? (
            <div style={W.note}>
              Part 1: <strong>{inr(amount)}</strong> goes for approval with this
              invoice. The balance of <strong>{inr(balance)}</strong> stays in{" "}
              <em>Invoice Processing → Part Payments</em>, from where you
              request it (in one go or in parts) when it is due. Accounts
              deducts TDS on each part as it is approved.
            </div>
          ) : (
            <div style={W.note}>Of {inr(grossPayable)} payable before TDS.</div>
          )}
        </>
      )}
    </div>
  );
}

// ── Pill for lists ────────────────────────────────────────
export function PartPaymentBadge({ summary, style }) {
  if (!summary?.plan) return null;
  const a = summary.activePart;
  const text = a
    ? `⚡ Part ${a.partNo} · ${a.status === "Accounts Approved" ? "with Cluster Head" : a.status === "Submitted" && !a.partnerSkipped ? "with Partner" : "with Accounts"}`
    : summary.balancePending
      ? `⚡ Part payment · ${inr(summary.unrequested)} to request`
      : "⚡ Part payment · all parts approved";
  const tone = a
    ? W.pillActive
    : summary.balancePending
      ? W.pillPending
      : W.pillDone;
  return (
    <span style={{ ...W.pill, ...tone, ...style }} title="Part-payment invoice">
      {text}
    </span>
  );
}

const PART_TONE = {
  Draft: { bg: "#f1f5f9", color: "#64748b" },
  Submitted: { bg: "#eff6ff", color: "#2563eb" },
  "Partner Approved": { bg: "#f5f3ff", color: "#7c3aed" },
  "Accounts Approved": { bg: "#ecfeff", color: "#0e7490" },
  Approved: { bg: "#f0fdf4", color: "#16a34a" },
  Rejected: { bg: "#fef2f2", color: "#dc2626" },
};

// ── Parts panel with actions ──────────────────────────────
export function PartPaymentsPanel({
  invoice,
  user,
  onChanged,
  readOnly = false,
}) {
  const summary = invoice?.paymentPlanSummary;
  const [modal, setModal] = useState(null); // "request" | "approve" | "reject"
  const [openHistory, setOpenHistory] = useState(null);
  if (!summary?.plan) return null;

  const userId = user?._id || user?.id;
  const creatorId =
    invoice.createdBy?._id || invoice.createdBy?.id || invoice.createdBy;
  const isCreator = !!userId && String(userId) === String(creatorId);
  const active = summary.activePart;
  const activePart =
    active && active.partNo > 1
      ? summary.parts.find((p) => p.partNo === active.partNo)
      : null;
  const myTurn = !readOnly && activePart && active.awaiting === user?.role;
  const canRequest = !readOnly && isCreator && summary.canRequestNext;

  const gross = summary.grossPayable || 0;
  const pctApproved = gross
    ? Math.min(
        100,
        Math.round(
          (summary.parts
            .filter((p) => p.status === "Approved")
            .reduce((s, p) => s + (p.amount || 0), 0) /
            gross) *
            100,
        ),
      )
    : 0;

  return (
    <div style={W.panel}>
      <div style={W.panelHead}>
        <div style={W.panelTitle}>⚡ Part Payments</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canRequest && (
            <button style={W.primaryBtn} onClick={() => setModal("request")}>
              {summary.lastPartRejected && summary.unrequested > 0
                ? "🔄 Resubmit / Request Part"
                : "➕ Request Next Part"}
            </button>
          )}
          {myTurn && (
            <>
              <button style={W.approveBtn} onClick={() => setModal("approve")}>
                ✓ Approve Part {activePart.partNo}
              </button>
              <button style={W.rejectBtn} onClick={() => setModal("reject")}>
                ✕ Reject
              </button>
            </>
          )}
        </div>
      </div>

      <div style={W.stats}>
        <Stat label="Payable (before TDS)" value={inr(gross)} />
        <Stat label="Requested in parts" value={inr(summary.requested)} />
        <Stat
          label="Approved for payment (net)"
          value={inr(summary.approvedAmount)}
          color="#16a34a"
        />
        <Stat label="Paid" value={inr(summary.paidAmount)} color="#2563eb" />
        <Stat
          label="Still to request"
          value={inr(summary.unrequested)}
          color={summary.unrequested > 0 ? "#b45309" : "#64748b"}
        />
      </div>
      <div style={W.bar}>
        <div style={{ ...W.barFill, width: `${pctApproved}%` }} />
      </div>
      <div style={W.barLabel}>
        {pctApproved}% of the invoice approved
        {active &&
          ` · Part ${active.partNo} waiting for ${ROLE_LABEL[active.awaiting] || active.awaiting}`}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={W.table}>
          <thead>
            <tr>
              {[
                "Part",
                "Amount",
                "Status",
                "TDS",
                "Net payable",
                "Payment cycle",
                "",
              ].map((h) => (
                <th key={h} style={W.th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.parts.map((p) => {
              const tone = PART_TONE[p.status] || PART_TONE.Draft;
              return (
                <tr key={p.partNo}>
                  <td style={{ ...W.td, fontWeight: 700 }}>
                    {p.partNo}
                    {p.partNo === 1 && <div style={W.kind}>with invoice</div>}
                  </td>
                  <td style={{ ...W.td, fontWeight: 700 }}>{inr(p.amount)}</td>
                  <td style={W.td}>
                    <span
                      style={{
                        ...W.pill,
                        background: tone.bg,
                        color: tone.color,
                        borderColor: "transparent",
                      }}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td style={W.td}>
                    {typeof p.tdsAmount === "number" ? (
                      <>
                        {inr(p.tdsAmount)}
                        <div style={W.kind}>
                          @ {p.tdsPercentage}% on {inr(p.taxableAmount)}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>at Accounts</span>
                    )}
                  </td>
                  <td style={{ ...W.td, fontWeight: 600 }}>
                    {typeof p.netAmount === "number" ? inr(p.netAmount) : "—"}
                  </td>
                  <td style={W.td}>{p.paymentCycle?.cycleLabel || "—"}</td>
                  <td style={W.td}>
                    {p.history?.length > 0 && (
                      <button
                        style={W.linkBtn}
                        onClick={() =>
                          setOpenHistory(
                            openHistory === p.partNo ? null : p.partNo,
                          )
                        }
                      >
                        {openHistory === p.partNo ? "Hide" : "History"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openHistory && (
        <div style={W.history}>
          {(
            summary.parts.find((p) => p.partNo === openHistory)?.history || []
          ).map((h, i) => (
            <div key={i} style={W.histRow}>
              <span
                style={{
                  fontWeight: 700,
                  color:
                    h.action === "rejected"
                      ? "#dc2626"
                      : h.action === "approved"
                        ? "#16a34a"
                        : "#2563eb",
                }}
              >
                {h.action === "requested"
                  ? "●"
                  : h.action === "approved"
                    ? "✓"
                    : "✕"}
              </span>
              <span>
                <strong>{h.stage}</strong> · {h.by?.name || "—"} ·{" "}
                {h.at
                  ? new Date(h.at).toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : ""}
                {h.remarks && (
                  <div style={{ color: "#64748b" }}>"{h.remarks}"</div>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {modal === "request" && (
        <RequestPartModal
          invoice={invoice}
          summary={summary}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            onChanged?.();
          }}
        />
      )}
      {modal === "approve" && activePart && (
        <ApprovePartModal
          invoice={invoice}
          part={activePart}
          summary={summary}
          role={user?.role}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            onChanged?.();
          }}
        />
      )}
      {modal === "reject" && activePart && (
        <RejectPartModal
          invoice={invoice}
          part={activePart}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, color = "#0f172a" }) {
  return (
    <div style={W.stat}>
      <div style={W.statLabel}>{label}</div>
      <div style={{ ...W.statValue, color }}>{value}</div>
    </div>
  );
}

function Modal({ title, sub, children, onClose, busy }) {
  return (
    <div style={W.overlay} onClick={() => !busy && onClose()}>
      <div
        style={W.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={W.modalTitle}>{title}</h3>
        {sub && <p style={W.modalSub}>{sub}</p>}
        {children}
      </div>
    </div>
  );
}

// ── Branch user: request the next part ────────────────────
export function RequestPartModal({ invoice, summary, onClose, onDone }) {
  const balance = summary.unrequested || 0;
  const [mode, setMode] = useState("full");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const invalid = mode === "partial" && !!partAmountError(amount, balance);
  const nextNo = summary.lastPartRejected
    ? summary.parts[summary.parts.length - 1].partNo
    : (summary.parts[summary.parts.length - 1]?.partNo || 0) + 1;

  const submit = async () => {
    if (invalid) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/invoices/${invoice._id}/parts`, {
        mode,
        ...(mode === "partial" && { amount: parseFloat(amount) }),
        remarks,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.message || "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`➕ Request Part ${nextNo}`}
      sub={`${invoice.requestId} · ${invoice.vendor?.vendorName || ""}`}
      onClose={onClose}
      busy={busy}
    >
      <div style={W.stats}>
        <Stat label="Payable (before TDS)" value={inr(summary.grossPayable)} />
        <Stat label="Requested so far" value={inr(summary.requested)} />
        <Stat label="Still to request" value={inr(balance)} color="#b45309" />
      </div>
      <div style={W.toggleRow}>
        {[
          ["full", `Full balance — ${inr(balance)}`],
          ["partial", "Part of it"],
        ].map(([k, l]) => (
          <button
            key={k}
            type="button"
            disabled={busy}
            style={{ ...W.toggle, ...(mode === k ? W.toggleOn : {}) }}
            onClick={() => setMode(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {mode === "partial" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ position: "relative" }}>
            <span style={W.rupee}>₹</span>
            <input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              disabled={busy}
              placeholder={`Up to ${inr(balance)}`}
              style={W.input}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {amount !== "" && partAmountError(amount, balance) && (
            <div style={W.err}>{partAmountError(amount, balance)}</div>
          )}
        </div>
      )}
      <div style={W.note}>
        This part goes through Partner → Accounts (TDS on this part) → Cluster
        Head, then to Accounts for payment.
      </div>
      <label style={W.label}>Remarks (optional)</label>
      <textarea
        style={W.textarea}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Why this part is due now..."
      />
      {error && <div style={W.errBox}>{error}</div>}
      <div style={W.actions}>
        <button style={W.cancel} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          style={{ ...W.confirm, opacity: busy || invalid ? 0.6 : 1 }}
          disabled={busy || invalid}
          onClick={submit}
        >
          {busy ? "Submitting…" : "Submit for Approval"}
        </button>
      </div>
    </Modal>
  );
}

// ── Approver: approve a later part ────────────────────────
export function ApprovePartModal({
  invoice,
  part,
  summary,
  role,
  onClose,
  onDone,
}) {
  const isAccounts = role === "accounts";
  const isCH = role === "cluster_head";
  const [tds, setTds] = useState(
    invoice.tdsPercentage !== undefined && invoice.tdsPercentage !== null
      ? String(invoice.tdsPercentage)
      : "",
  );
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { cycle, loading: cycleLoading } = usePaymentCycle();

  // Preview only — the server works out the exact figures.
  const gross = summary.grossPayable || 0;
  const taxable = gross
    ? round2(((invoice.amount || 0) * (part.amount || 0)) / gross)
    : 0;
  const tdsNum = parseFloat(tds);
  const tdsValid = Number.isFinite(tdsNum) && tdsNum >= 0 && tdsNum <= 100;
  const tdsAmt = tdsValid ? Math.round((taxable * tdsNum) / 100) : 0;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.patch(`/invoices/${invoice._id}/parts/${part.partNo}/approve`, {
        remarks,
        ...(isAccounts && { tdsPercentage: tdsNum }),
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.message || "Approval failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`✓ Approve Part ${part.partNo}`}
      sub={`${invoice.requestId} · ${invoice.vendor?.vendorName || ""}`}
      onClose={onClose}
      busy={busy}
    >
      <div style={W.stats}>
        <Stat label="This part (before TDS)" value={inr(part.amount)} />
        {typeof part.tdsAmount === "number" && (
          <Stat label="TDS" value={inr(part.tdsAmount)} />
        )}
        {typeof part.netAmount === "number" && (
          <Stat
            label="Net payable"
            value={inr(part.netAmount)}
            color="#16a34a"
          />
        )}
        <Stat label="Invoice payable" value={inr(gross)} />
      </div>
      {isAccounts && (
        <>
          <label style={W.label}>TDS % on this part *</label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            style={W.input}
            value={tds}
            onChange={(e) => setTds(e.target.value)}
            placeholder="e.g. 2"
          />
          <div style={W.note}>
            Taxable share ≈ {inr(taxable)} · TDS ≈{" "}
            <strong>{inr(tdsAmt)}</strong> · Net ≈{" "}
            <strong>{inr(round2((part.amount || 0) - tdsAmt))}</strong>
          </div>
        </>
      )}
      {isCH && (
        <ApprovalCycleNotice
          cycle={cycle}
          loading={cycleLoading}
          isFinalApproval
        />
      )}
      <label style={W.label}>Remarks (optional)</label>
      <textarea
        style={W.textarea}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Add remarks..."
      />
      {error && <div style={W.errBox}>{error}</div>}
      <div style={W.actions}>
        <button style={W.cancel} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          style={{
            ...W.confirm,
            opacity: busy || (isAccounts && !tdsValid) ? 0.6 : 1,
          }}
          disabled={busy || (isAccounts && !tdsValid)}
          onClick={submit}
        >
          {busy ? "Approving…" : "✓ Confirm Approve"}
        </button>
      </div>
    </Modal>
  );
}

// ── Approver: reject a later part ─────────────────────────
export function RejectPartModal({ invoice, part, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.patch(`/invoices/${invoice._id}/parts/${part.partNo}/reject`, {
        reason,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.message || "Rejection failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`✕ Reject Part ${part.partNo}`}
      sub={`${invoice.requestId} · ${inr(part.amount)}`}
      onClose={onClose}
      busy={busy}
    >
      <div style={W.note}>
        The amount goes back to the balance; the branch can resubmit it.
      </div>
      <label style={W.label}>Reason *</label>
      <textarea
        style={W.textarea}
        value={reason}
        autoFocus
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this part rejected?"
      />
      {error && <div style={W.errBox}>{error}</div>}
      <div style={W.actions}>
        <button style={W.cancel} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          style={{
            ...W.confirm,
            background: "#dc2626",
            opacity: busy || !reason.trim() ? 0.6 : 1,
          }}
          disabled={busy || !reason.trim()}
          onClick={submit}
        >
          {busy ? "Rejecting…" : "✕ Confirm Reject"}
        </button>
      </div>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────
const W = {
  box: {
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
  },
  kicker: {
    fontSize: 10.5,
    fontWeight: 700,
    color: "#64748b",
    letterSpacing: 0.6,
  },
  toggleRow: { display: "flex", gap: 8, marginTop: 8 },
  toggle: {
    flex: 1,
    padding: "9px 10px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#475569",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    textAlign: "center",
  },
  toggleSub: { fontSize: 11, fontWeight: 400, color: "#94a3b8", marginTop: 2 },
  toggleOn: { borderColor: "#0198A3", background: "#ecfeff", color: "#066A92" },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    margin: "12px 0 6px",
  },
  rupee: {
    position: "absolute",
    left: 12,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#64748b",
    fontWeight: 700,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px 10px 28px",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
  },
  note: { fontSize: 12, color: "#475569", marginTop: 8, lineHeight: 1.5 },
  err: { fontSize: 12, color: "#dc2626", marginTop: 6 },
  pill: {
    display: "inline-block",
    fontSize: 10.5,
    fontWeight: 600,
    borderRadius: 999,
    padding: "2px 8px",
    whiteSpace: "nowrap",
    border: "1px solid",
  },
  pillActive: {
    color: "#2563eb",
    background: "#eff6ff",
    borderColor: "#bfdbfe",
  },
  pillPending: {
    color: "#b45309",
    background: "#fffbeb",
    borderColor: "#fde68a",
  },
  pillDone: { color: "#16a34a", background: "#f0fdf4", borderColor: "#bbf7d0" },
  panel: {
    border: "1px solid #bae6fd",
    background: "#f8fdff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  panelHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  panelTitle: { fontWeight: 700, fontSize: 15, color: "#0f172a" },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: 10,
    margin: "12px 0",
  },
  stat: {
    background: "#fff",
    border: "1px solid #f1f5f9",
    borderRadius: 8,
    padding: "8px 10px",
  },
  statLabel: { fontSize: 11, color: "#64748b" },
  statValue: { fontSize: 15, fontWeight: 700, marginTop: 2 },
  bar: {
    height: 6,
    background: "#e2e8f0",
    borderRadius: 999,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    background: "linear-gradient(90deg,#066A92,#0198A3,#4CBC90)",
  },
  barLabel: { fontSize: 11, color: "#64748b", marginTop: 4 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 12,
    fontSize: 12.5,
  },
  th: {
    textAlign: "left",
    padding: "6px 8px",
    color: "#64748b",
    fontWeight: 600,
    borderBottom: "1px solid #e2e8f0",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "8px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "top",
  },
  kind: { fontSize: 10.5, color: "#94a3b8", fontWeight: 500 },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#0198A3",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    padding: 0,
  },
  history: {
    marginTop: 10,
    background: "#fff",
    border: "1px solid #f1f5f9",
    borderRadius: 8,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 12.5,
  },
  histRow: { display: "flex", gap: 8 },
  primaryBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    background: "linear-gradient(90deg,#066A92,#0198A3)",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  approveBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    background: "#16a34a",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  rejectBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #fecaca",
    background: "#fff",
    color: "#dc2626",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    padding: 22,
    width: "100%",
    maxWidth: 520,
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
  },
  modalTitle: { margin: 0, fontSize: 18, color: "#0f172a" },
  modalSub: { margin: "4px 0 6px", fontSize: 13, color: "#64748b" },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    minHeight: 64,
    padding: 10,
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 13,
    resize: "vertical",
  },
  errBox: {
    marginTop: 10,
    padding: "8px 12px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 8,
    fontSize: 12.5,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 16,
  },
  cancel: {
    padding: "9px 16px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  confirm: {
    padding: "9px 16px",
    borderRadius: 8,
    border: "none",
    background: "#16a34a",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
};
