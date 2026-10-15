// ============================================================
// FRONTEND: src/components/CreditNotesPanel.jsx — NEW FILE
// ------------------------------------------------------------
// Shown on the invoice page. Lists the invoice's credit notes for every
// role that can see the invoice. Branch users, Accounts and Super Admin can
// record one (line by line, with the vendor's credit-note file); it reduces
// the invoice only after Accounts or a Super Admin (not the creator)
// approves it.
// ============================================================
import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../api/axios";

const STATUS = {
  pending_approval: {
    label: "Pending approval",
    bg: "#fffbeb",
    color: "#b45309",
  },
  approved: { label: "Approved", bg: "#f0fdf4", color: "#16a34a" },
  rejected: { label: "Rejected", bg: "#fef2f2", color: "#dc2626" },
  cancelled: { label: "Cancelled", bg: "#f8fafc", color: "#94a3b8" },
};
const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function CreditNotesPanel({
  invoice,
  user,
  onChanged,
  openSignal = 0,
}) {
  const canManage = ["branch_user", "accounts", "super_admin"].includes(
    user?.role,
  );
  const canApprove = ["accounts", "super_admin"].includes(user?.role);
  const me = String(user?._id || user?.id || "");

  const [notes, setNotes] = useState([]);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [amounts, setAmounts] = useState({}); // itemIndex -> value
  const [form, setForm] = useState({
    vendorCreditNoteNumber: "",
    creditNoteDate: today(),
    reason: "",
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const timer = useRef(null);
  const cardRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/credit-notes?invoice=${invoice._id}`);
      setNotes(data.notes || []);
    } catch {
      setNotes([]);
    }
  }, [invoice._id]);

  useEffect(() => {
    load();
  }, [load]);

  const requestedLines = (a = amounts) =>
    Object.entries(a)
      .map(([itemIndex, v]) => ({
        itemIndex: Number(itemIndex),
        amount: parseFloat(v) || 0,
      }))
      .filter((l) => l.amount > 0);

  const runPreview = useCallback(
    async (a) => {
      try {
        const { data } = await api.post("/credit-notes/preview", {
          invoiceId: invoice._id,
          lines: requestedLines(a),
        });
        setPreview(data);
      } catch (err) {
        setError(err.response?.data?.message || "Could not calculate");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoice._id],
  );

  const openForm = () => {
    setAmounts({});
    setForm({
      vendorCreditNoteNumber: "",
      creditNoteDate: today(),
      reason: "",
    });
    setFile(null);
    setError("");
    setPreview(null);
    setOpen(true);
    runPreview({});
  };

  const setAmount = (idx, v) => {
    const next = { ...amounts, [idx]: v };
    setAmounts(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => runPreview(next), 300);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("invoiceId", invoice._id);
      fd.append("vendorCreditNoteNumber", form.vendorCreditNoteNumber.trim());
      fd.append("creditNoteDate", form.creditNoteDate);
      fd.append("reason", form.reason.trim());
      fd.append("lines", JSON.stringify(requestedLines()));
      if (file) fd.append("file", file);
      await api.post("/credit-notes", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setOpen(false);
      load();
      onChanged && onChanged();
    } catch (err) {
      setError(
        err.response?.data?.message || "Could not record the credit note",
      );
    } finally {
      setSaving(false);
    }
  };

  const decide = async (cn, action) => {
    let body = {};
    if (action === "reject") {
      const reason = window.prompt("Reason for rejecting this credit note:");
      if (!reason?.trim()) return;
      body = { reason: reason.trim() };
    } else if (action === "approve") {
      if (
        !window.confirm(
          `Approve ${cn.creditNoteId}? Net payable will reduce by ${inr(cn.netReduction)}.`,
        )
      )
        return;
    } else if (action === "cancel") {
      if (!window.confirm(`Cancel ${cn.creditNoteId}?`)) return;
    }
    setBusy(`${action}_${cn._id}`);
    try {
      await api.patch(`/credit-notes/${cn._id}/${action}`, body);
      load();
      onChanged && onChanged();
    } catch (err) {
      window.alert(err.response?.data?.message || "Action failed");
    } finally {
      setBusy("");
    }
  };

  const eligibleStatus = invoice.status === "Cluster Head Approved";

  // Opened from the invoice header button or from ?creditNote=new.
  useEffect(() => {
    if (!openSignal) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (canManage && eligibleStatus) openForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);
  const r = preview?.result;
  const ready =
    r &&
    form.vendorCreditNoteNumber.trim() &&
    form.creditNoteDate &&
    form.reason.trim().length >= 3 &&
    file &&
    !saving;

  if (
    !notes.length &&
    !(canManage && eligibleStatus) &&
    !invoice.originalTotals
  )
    return null;

  return (
    <div style={P.card} ref={cardRef}>
      <div style={P.head}>
        <div style={P.title}>🧾 Credit Notes</div>
        {canManage && eligibleStatus && (
          <button style={P.addBtn} onClick={openForm}>
            + Add Credit Note
          </button>
        )}
      </div>

      {invoice.originalTotals && (
        <div style={P.summary}>
          Original net payable{" "}
          <strong>{inr(invoice.originalTotals.netPayable)}</strong> − credit
          notes <strong>{inr(invoice.creditNoteTotal)}</strong> = now{" "}
          <strong>{inr(invoice.netPayable)}</strong>
          {invoice.creditNoteRefundDue > 0 && (
            <div style={{ marginTop: 4, color: "#b45309" }}>
              Refund due from vendor (collect outside PMS):{" "}
              <strong>{inr(invoice.creditNoteRefundDue)}</strong>
            </div>
          )}
        </div>
      )}

      {!notes.length ? (
        <div style={P.empty}>No credit notes on this invoice.</div>
      ) : (
        notes.map((cn) => {
          const st = STATUS[cn.status] || STATUS.cancelled;
          return (
            <div key={cn._id} style={P.row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={P.rowTop}>
                  <span style={P.mono}>{cn.creditNoteId}</span>
                  <span
                    style={{ ...P.badge, background: st.bg, color: st.color }}
                  >
                    {st.label}
                  </span>
                  <span style={P.amt}>− {inr(cn.netReduction)}</span>
                </div>
                <div style={P.meta}>
                  Vendor CN {cn.vendorCreditNoteNumber} ·{" "}
                  {new Date(cn.creditNoteDate).toLocaleDateString("en-GB")} ·{" "}
                  {cn.lines
                    ?.map((l) => `${l.description} ${inr(l.amount)}`)
                    .join(", ")}
                </div>
                <div style={P.meta}>
                  {cn.reason} · by {cn.createdBy?.name || "—"}
                  {cn.decidedBy &&
                    ` · ${st.label.toLowerCase()} by ${cn.decidedBy.name}`}
                  {cn.decisionRemarks && cn.status !== "approved"
                    ? ` (${cn.decisionRemarks})`
                    : ""}
                </div>
                {cn.applied?.refundDue > 0 && (
                  <div style={{ ...P.meta, color: "#b45309" }}>
                    Refund due from vendor: {inr(cn.applied.refundDue)}
                  </div>
                )}
                {cn.document?.url && (
                  <a
                    href={cn.document.url}
                    target="_blank"
                    rel="noreferrer"
                    style={P.link}
                  >
                    View vendor credit note
                  </a>
                )}
              </div>
              {cn.status === "pending_approval" && (
                <div style={P.actions}>
                  {canApprove && String(cn.createdBy?._id) !== me && (
                    <>
                      <button
                        style={P.okBtn}
                        disabled={!!busy}
                        onClick={() => decide(cn, "approve")}
                      >
                        Approve
                      </button>
                      <button
                        style={P.noBtn}
                        disabled={!!busy}
                        onClick={() => decide(cn, "reject")}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {String(cn.createdBy?._id) === me && (
                    <button
                      style={P.noBtn}
                      disabled={!!busy}
                      onClick={() => decide(cn, "cancel")}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {open && (
        <div style={P.overlay}>
          <div style={P.modal}>
            <h3 style={P.modalTitle}>Add Credit Note · {invoice.requestId}</h3>
            <p style={P.hint}>
              Enter the returned value (before GST) for each line. GST and TDS
              are recalculated. The invoice is reduced only after it is approved
              by Accounts.
            </p>

            {preview && !preview.eligible && (
              <div style={P.warn}>{preview.blockedReason}</div>
            )}

            <table style={P.table}>
              <thead>
                <tr>
                  {[
                    "Line",
                    "Value",
                    "Already credited",
                    "Returned value (₹)",
                  ].map((h) => (
                    <th key={h} style={P.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(preview?.lines || []).map((l) => (
                  <tr key={l.itemIndex}>
                    <td style={P.td}>
                      {l.description}
                      <div style={P.small}>GST {l.gstPercentage}%</div>
                    </td>
                    <td style={P.td}>{inr(l.amount)}</td>
                    <td style={P.td}>
                      {l.credited > 0 ? inr(l.credited) : "—"}
                    </td>
                    <td style={P.td}>
                      <input
                        type="number"
                        min="0"
                        max={l.available}
                        step="0.01"
                        disabled={l.available <= 0}
                        placeholder={
                          l.available > 0
                            ? `max ${l.available}`
                            : "fully credited"
                        }
                        style={P.input}
                        value={amounts[l.itemIndex] ?? ""}
                        onChange={(e) => setAmount(l.itemIndex, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {preview?.message && requestedLines().length > 0 && (
              <div style={P.warn}>{preview.message}</div>
            )}

            {r && (
              <div style={P.calc}>
                Returned {inr(r.baseAmount)} + GST {inr(r.gstAmount)} − TDS no
                longer deducted {inr(r.tdsReversal)} ={" "}
                <strong>net payable reduces by {inr(r.netReduction)}</strong>
                <br />
                Net payable {inr(preview.currentNetPayable)} →{" "}
                <strong>{inr(r.newNetPayable)}</strong>
                {preview.paidAmount > 0 && (
                  <> · already paid {inr(preview.paidAmount)}</>
                )}
                {r.payment?.refundDue > 0 && (
                  <div style={{ color: "#b45309", marginTop: 4 }}>
                    {inr(r.payment.refundDue)} has already been paid above the
                    new amount — the vendor must refund it outside PMS.
                  </div>
                )}
                {r.payment?.status === "Closed by Credit Note" && (
                  <div style={{ marginTop: 4 }}>
                    Nothing will be left to pay on this invoice.
                  </div>
                )}
              </div>
            )}

            <div style={P.grid}>
              <label style={P.label}>
                Vendor credit note no. *
                <input
                  style={P.input}
                  value={form.vendorCreditNoteNumber}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      vendorCreditNoteNumber: e.target.value,
                    }))
                  }
                />
              </label>
              <label style={P.label}>
                Credit note date *
                <input
                  type="date"
                  max={today()}
                  style={P.input}
                  value={form.creditNoteDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, creditNoteDate: e.target.value }))
                  }
                />
              </label>
              <label style={{ ...P.label, gridColumn: "1 / -1" }}>
                Reason *
                <input
                  style={P.input}
                  placeholder="e.g. 4 units returned — damaged on delivery"
                  value={form.reason}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reason: e.target.value }))
                  }
                />
              </label>
              <label style={{ ...P.label, gridColumn: "1 / -1" }}>
                Vendor's credit note (PDF or image) *
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            {error && <div style={P.err}>{error}</div>}
            <div style={P.btns}>
              <button
                style={P.cancel}
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                style={{
                  ...P.save,
                  opacity: ready && preview?.eligible ? 1 : 0.5,
                }}
                disabled={!ready || !preview?.eligible}
                onClick={save}
              >
                {saving ? "Saving…" : "Send for approval"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const P = {
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "16px 18px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    marginBottom: 16,
  },
  head: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: { fontSize: 14, fontWeight: 700, color: "#1a3c6e" },
  addBtn: {
    background: "#0f766e",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "7px 14px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  summary: {
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 12.5,
    color: "#134e4a",
    marginBottom: 10,
  },
  empty: { fontSize: 12.5, color: "#94a3b8" },
  row: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    borderTop: "1px solid #f1f5f9",
    padding: "10px 0",
  },
  rowTop: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  mono: {
    fontFamily: "monospace",
    fontWeight: 700,
    color: "#0f766e",
    fontSize: 12.5,
  },
  badge: {
    padding: "2px 9px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
  },
  amt: { fontWeight: 700, color: "#dc2626", fontSize: 13 },
  meta: { fontSize: 12, color: "#64748b", marginTop: 3, lineHeight: 1.5 },
  link: { fontSize: 12, color: "#0f766e", fontWeight: 600 },
  actions: { display: "flex", gap: 6, flexShrink: 0 },
  okBtn: {
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 11px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  noBtn: {
    background: "#fff",
    color: "#dc2626",
    border: "1px solid #fecaca",
    borderRadius: 6,
    padding: "5px 11px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
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
    maxWidth: 640,
    maxHeight: "92vh",
    overflowY: "auto",
    boxShadow: "0 20px 45px rgba(0,0,0,0.22)",
  },
  modalTitle: { margin: 0, fontSize: 17, fontWeight: 700, color: "#1a3c6e" },
  hint: {
    fontSize: 12.5,
    color: "#64748b",
    margin: "6px 0 12px",
    lineHeight: 1.5,
  },
  warn: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 8,
    padding: "8px 11px",
    fontSize: 12.5,
    margin: "8px 0",
  },
  err: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 8,
    padding: "8px 11px",
    fontSize: 12.5,
    margin: "8px 0",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 },
  th: {
    textAlign: "left",
    fontSize: 11,
    color: "#64748b",
    fontWeight: 700,
    padding: "6px 6px",
    borderBottom: "1px solid #e2e8f0",
  },
  td: {
    padding: "7px 6px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "top",
    color: "#334155",
  },
  small: { fontSize: 11, color: "#94a3b8" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "7px 9px",
    border: "1px solid #cbd5e1",
    borderRadius: 7,
    fontSize: 13,
    marginTop: 4,
    fontFamily: "inherit",
  },
  calc: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 12.5,
    color: "#334155",
    margin: "12px 0",
    lineHeight: 1.6,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 10,
    marginTop: 8,
  },
  label: { fontSize: 12, fontWeight: 600, color: "#475569" },
  btns: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 },
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
  save: {
    background: "#0f766e",
    color: "#fff",
    border: "none",
    padding: "9px 18px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
};
