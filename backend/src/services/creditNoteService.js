// ============================================================
// BACKEND: src/services/creditNoteService.js — NEW FILE
// ------------------------------------------------------------
// The credit-note rules in one place, used when a credit note is
// recorded (validation + preview) and again when it is approved.
//
// Money rules match the rest of PMS:
//   GST   — per line at that line's GST %, rounded to paise
//   TDS   — on the base (pre-GST) amount, rounded to the rupee, recomputed
//           on the reduced base (so the TDS deduction falls too)
//   Net   — base + GST + roundOff − TDS
// Payment side, applied on approval:
//   totalAmount = max(new net, already paid)   → remaining = new net − paid
//   anything already paid above the new net    → refund due (outside PMS)
// ============================================================
const CreditNote = require("../models/CreditNote");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Payment states in which money is in motion for this invoice. A credit
// note is not allowed (or approved) while one exists: the bank file amount
// must not change underneath it.
const IN_PROGRESS = ["Payment Raised", "Accounts Approved", "Excel Generated"];
const ACTIVE_INSTALLMENT = ["Raised", "Approved", "Excel Generated"];

const paymentInProgress = (payment) =>
  !!payment &&
  (IN_PROGRESS.includes(payment.status) ||
    (payment.installments || []).some((i) => ACTIVE_INSTALLMENT.includes(i.status)));

// The invoice's ORIGINAL lines. Older invoices may have no items; they are
// treated as one line worth the original base amount.
const originalLines = (invoice) => {
  const base = invoice.originalTotals?.amount ?? invoice.amount ?? 0;
  const gst = invoice.originalTotals?.gstAmount ?? invoice.gstAmount ?? 0;
  if (Array.isArray(invoice.items) && invoice.items.length) {
    return invoice.items.map((it, i) => ({
      itemIndex: i,
      description: it.description || `Item ${i + 1}`,
      amount: round2(it.amount),
      gstPercentage: Number(it.gstPercentage) || 0,
    }));
  }
  return [
    {
      itemIndex: 0,
      description: invoice.description || "Invoice amount",
      amount: round2(base),
      gstPercentage: base > 0 ? round2((gst / base) * 100) : 0,
    },
  ];
};

// Base amount already credited per line by OTHER credit notes that are
// approved or still pending (pending ones reserve their amount, so two
// pending notes can never together exceed a line).
const creditedByLine = async (invoiceId, excludeId = null) => {
  const query = {
    invoice: invoiceId,
    status: { $in: [CreditNote.STATUS.APPROVED, CreditNote.STATUS.PENDING] },
  };
  if (excludeId) query._id = { $ne: excludeId };
  const notes = await CreditNote.find(query).select("lines status").lean();
  const map = {};
  for (const n of notes)
    for (const l of n.lines || [])
      map[l.itemIndex] = round2((map[l.itemIndex] || 0) + l.amount);
  return map;
};

/**
 * Validate requested lines against the invoice and compute every figure.
 * @param requested [{ itemIndex, amount }]
 * @returns { ok, message } or { ok: true, lines, baseAmount, gstAmount,
 *            tdsReversal, netReduction, newTotals, lineAvailability }
 */
const computeCreditNote = async (invoice, requested, { excludeId } = {}) => {
  const lines = originalLines(invoice);
  const already = await creditedByLine(invoice._id, excludeId);

  const lineAvailability = lines.map((l) => ({
    ...l,
    credited: already[l.itemIndex] || 0,
    available: round2(Math.max(0, l.amount - (already[l.itemIndex] || 0))),
  }));

  const fail = (message) => ({ ok: false, message, lineAvailability });
  const picked = [];
  const seen = new Set();
  for (const r of Array.isArray(requested) ? requested : []) {
    const amount = round2(r?.amount);
    if (!(amount > 0)) continue;
    const idx = Number(r.itemIndex);
    const line = lineAvailability.find((l) => l.itemIndex === idx);
    if (!line) return fail(`Line ${idx + 1} is not on this invoice`);
    if (seen.has(idx)) return fail(`Line ${idx + 1} is listed twice`);
    seen.add(idx);
    if (amount - line.available > 0.009) {
      return fail(
        `"${line.description}": only ₹${line.available.toLocaleString("en-IN")} can still be credited (₹${line.credited.toLocaleString("en-IN")} already credited or pending)`,
      );
    }
    const gstAmount = round2((amount * line.gstPercentage) / 100);
    picked.push({
      itemIndex: idx,
      description: line.description,
      amount,
      gstPercentage: line.gstPercentage,
      gstAmount,
      total: round2(amount + gstAmount),
    });
  }
  if (!picked.length) return fail("Enter the returned value for at least one line");

  const baseAmount = round2(picked.reduce((s, l) => s + l.amount, 0));
  const gstAmount = round2(picked.reduce((s, l) => s + l.gstAmount, 0));

  // Current (post previous credit notes) invoice figures.
  const curBase = round2(invoice.amount);
  const curGst = round2(invoice.gstAmount);
  const curTds = Math.round(Number(invoice.tdsAmount) || 0);
  const curRoundOff = Number(invoice.roundOff) || 0;

  const newBase = round2(Math.max(0, curBase - baseAmount));
  const newGst = round2(Math.max(0, curGst - gstAmount));
  const tdsPct =
    invoice.tdsPercentage !== null && invoice.tdsPercentage !== undefined
      ? Number(invoice.tdsPercentage)
      : null;
  const newTds =
    tdsPct !== null
      ? Math.round((newBase * tdsPct) / 100)
      : curBase > 0
        ? Math.round((curTds * newBase) / curBase)
        : 0;
  // A fully returned invoice should not leave a paise round-off payable.
  const newRoundOff = newBase === 0 ? 0 : curRoundOff;
  const newNet = round2(Math.max(0, newBase + newGst + newRoundOff - newTds));
  const curNet = round2(invoice.netPayable);

  return {
    ok: true,
    lines: picked,
    baseAmount,
    gstAmount,
    tdsReversal: Math.max(0, curTds - newTds),
    netReduction: round2(curNet - newNet),
    newTotals: {
      amount: newBase,
      gstAmount: newGst,
      tdsAmount: newTds,
      roundOff: newRoundOff,
      netPayable: newNet,
    },
    currentNetPayable: curNet,
    lineAvailability,
  };
};

/**
 * What approving this reduction would do to the payment record.
 * Pure: returns the new values, does not save.
 */
const paymentEffect = (payment, newNet, oldNet) => {
  const paid = round2(payment?.paidAmount);
  const totalAmount = round2(Math.max(newNet, paid));
  const remaining = round2(Math.max(0, newNet - paid));
  // Refund owed because of THIS credit note only: overpayment after it,
  // minus any overpayment that already existed before it.
  const previousRefund = round2(Math.max(0, paid - oldNet));
  const refundDueTotal = round2(Math.max(0, paid - newNet));
  let status = payment?.status;
  if (remaining === 0) {
    status = paid > 0 ? "Fully Paid" : "Closed by Credit Note";
  } else if (paid > 0) {
    status = "Partially Paid";
  }
  return {
    paid,
    totalAmount,
    remaining,
    status,
    refundDue: round2(Math.max(0, refundDueTotal - previousRefund)),
  };
};

module.exports = {
  computeCreditNote,
  paymentEffect,
  paymentInProgress,
  originalLines,
  round2,
};
