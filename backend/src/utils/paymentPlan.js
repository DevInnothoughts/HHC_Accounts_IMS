// ============================================================
// BACKEND: src/utils/paymentPlan.js  —  NEW FILE (Nov 2026)
// ------------------------------------------------------------
// Part payments — the pure rules (no database access).
//
// When adding an invoice the branch user chooses Full or Partial payment.
// Partial = pay ₹X of the invoice now. Every part, including the first,
// goes through the normal approval chain:
//     Partner → Accounts (TDS on THAT part) → Cluster Head
// Part 1 IS the invoice's own approval. Later parts are requested by the
// branch user from the "Part Payments" list and run the same chain on the
// part, while the invoice itself stays "Cluster Head Approved" (so
// reports, Tally and payment processing keep seeing it as approved).
//
// Figures
//   grossPayable = base + GST ± round off − special − cash discount
//                  (what the invoice is worth before TDS)
//   part.amount  = share of grossPayable the part releases (before TDS)
//   part TDS     = taxable share × TDS %, taxable share =
//                  base × part.amount / grossPayable (last part takes the
//                  remainder so the shares add up exactly to the base)
//   invoice.tdsAmount  = TDS of the parts Accounts has approved so far
//   invoice.netPayable = grossPayable − invoice.tdsAmount
//   Accounts may raise = Σ net of Cluster-Head-approved parts − paid
//
// An invoice WITHOUT paymentPlan is paid in one go, exactly as before.
// ============================================================

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 0.009; // one paisa tolerance (amounts are stored as floats)

const PART_STATUS = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PARTNER_APPROVED: "Partner Approved",
  ACCOUNTS_APPROVED: "Accounts Approved",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
const IN_APPROVAL = [
  PART_STATUS.SUBMITTED,
  PART_STATUS.PARTNER_APPROVED,
  PART_STATUS.ACCOUNTS_APPROVED,
];
const TDS_APPLIED = [PART_STATUS.ACCOUNTS_APPROVED, PART_STATUS.APPROVED];

// Payment record statuses (PaymentProcessing, parent level).
// Only one payment may be in motion at a time. Installment statuses are
// only ever "Raised" → "Processed" / "Rejected", so they cannot say whether
// a payment is in progress — the parent status can.
const PAYMENT_IN_PROGRESS_STATUSES = [
  "Payment Raised",
  "Accounts Approved",
  "Excel Generated",
];
const PAYMENT_CLOSED_STATUSES = ["Fully Paid", "Closed by Credit Note"];

const plain = (doc) => (doc?.toObject ? doc.toObject() : doc);

const paymentInProgress = (payment) =>
  !!payment && PAYMENT_IN_PROGRESS_STATUSES.includes(plain(payment).status);

const isPartPlan = (invoice) => plain(invoice)?.paymentPlan?.mode === "partial";

const partsOf = (invoice) =>
  (isPartPlan(invoice) && plain(invoice).paymentPlan.parts) || [];

const partByNo = (invoice, partNo) =>
  partsOf(invoice).find((p) => Number(p.partNo) === Number(partNo)) || null;

/** Base + GST ± round off − discounts: the invoice before TDS. */
const grossPayableOf = (invoice) => {
  const inv = plain(invoice) || {};
  return round2(
    (Number(inv.amount) || 0) +
      (Number(inv.gstAmount) || 0) +
      (Number(inv.roundOff) || 0) -
      (Number(inv.specialDiscount) || 0) -
      (Number(inv.cashDiscount) || 0),
  );
};

const livePart = (p) => p.status !== PART_STATUS.REJECTED;

/** Sum of the parts requested so far (rejected parts excluded). */
const requestedOf = (invoice) =>
  round2(
    partsOf(invoice)
      .filter(livePart)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );

/** Payable not yet asked for in any part. */
const unrequestedOf = (invoice) => {
  if (!isPartPlan(invoice)) return 0;
  const left = round2(grossPayableOf(invoice) - requestedOf(invoice));
  return left > EPS ? left : 0;
};

/** The part (any number) currently moving through approval, if any. */
const activePartOf = (invoice) =>
  partsOf(invoice).find((p) => IN_APPROVAL.includes(p.status)) || null;

/** Net amount the Cluster Head has approved for payment. */
const approvedNetOf = (invoice) => {
  const inv = plain(invoice);
  if (!isPartPlan(inv)) return round2(inv?.netPayable);
  return round2(
    partsOf(inv)
      .filter((p) => p.status === PART_STATUS.APPROVED)
      .reduce((s, p) => s + (Number(p.netAmount) || 0), 0),
  );
};

/**
 * Validate an amount the branch user asks for.
 * max = what may be requested; strictlyLess = first part must be below the
 * full payable (asking for all of it is simply a Full payment).
 */
const validatePartAmount = (value, max, { strictlyLess = false } = {}) => {
  const amount = round2(value);
  const cap = round2(max);
  if (!(amount > 0)) return { error: "Enter the amount to pay in this part" };
  if (strictlyLess && amount >= cap - EPS)
    return {
      error: `A part payment must be less than the payable amount of ₹${cap.toLocaleString("en-IN")} — choose Full Payment instead`,
    };
  if (amount - cap > EPS)
    return {
      error: `Amount cannot exceed ₹${cap.toLocaleString("en-IN")} still to be requested`,
    };
  return { amount };
};

/**
 * TDS on one part. Pure — returns the figures, does not modify the part.
 * Taxable share is proportional to the part's share of the gross payable;
 * the part that completes the payable takes whatever base is left, so the
 * shares always add up exactly to the invoice base.
 */
const computePartTds = (invoice, part, tdsPercentage) => {
  const pct = parseFloat(tdsPercentage);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100)
    return { error: "TDS percentage must be between 0 and 100" };

  const inv = plain(invoice);
  const gross = grossPayableOf(inv);
  const base = round2(inv.amount);
  const amount = round2(part.amount);
  if (!(gross > 0)) return { error: "Invoice has no payable amount" };

  const others = partsOf(inv).filter(
    (p) => livePart(p) && Number(p.partNo) !== Number(part.partNo),
  );
  const othersAmount = round2(
    others.reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );
  const completes = amount + othersAmount >= gross - EPS;

  let taxable;
  if (completes) {
    // Remainder of the base, after the taxable shares already fixed on
    // other parts (parts not yet at Accounts count at their proportional
    // share, which is what they will get).
    const othersTaxable = others.reduce(
      (s, p) =>
        s +
        (typeof p.taxableAmount === "number" && TDS_APPLIED.includes(p.status)
          ? p.taxableAmount
          : (base * (Number(p.amount) || 0)) / gross),
      0,
    );
    taxable = round2(Math.max(0, base - othersTaxable));
  } else {
    taxable = round2((base * amount) / gross);
  }
  let tdsAmount = Math.round((taxable * pct) / 100);
  // The completing part absorbs the rupee rounding when every other part
  // was taxed at the same rate, so the parts total exactly what one TDS on
  // the whole invoice would have been.
  if (
    completes &&
    others.length &&
    others.every(
      (p) => TDS_APPLIED.includes(p.status) && Number(p.tdsPercentage) === pct,
    )
  ) {
    const othersTds = others.reduce(
      (s, p) => s + (Number(p.tdsAmount) || 0),
      0,
    );
    tdsAmount = Math.max(0, Math.round((base * pct) / 100) - othersTds);
  }
  const netAmount = round2(amount - tdsAmount);
  if (netAmount < 0)
    return {
      error:
        "TDS on this part is more than the part amount — check the TDS % or the part amount",
    };
  return { taxableAmount: taxable, tdsPercentage: pct, tdsAmount, netAmount };
};

/**
 * Invoice-level TDS / net payable from the parts. Mutates `invoice` (a
 * Mongoose doc or plain object): tdsAmount = TDS of parts Accounts has
 * approved, netPayable = gross − that. tdsPercentage = latest part's %.
 */
const applyPlanTotals = (invoice) => {
  if (!isPartPlan(invoice)) return invoice;
  const parts = invoice.paymentPlan.parts || [];
  const applied = parts.filter((p) => TDS_APPLIED.includes(p.status));
  const tds = round2(
    applied.reduce((s, p) => s + (Number(p.tdsAmount) || 0), 0),
  );
  invoice.tdsAmount = tds;
  invoice.netPayable = round2(Math.max(0, grossPayableOf(invoice) - tds));
  const latest = [...applied].sort(
    (a, b) => new Date(b.tdsAppliedAt || 0) - new Date(a.tdsAppliedAt || 0),
  )[0];
  if (latest && typeof latest.tdsPercentage === "number")
    invoice.tdsPercentage = latest.tdsPercentage;
  return invoice;
};

/**
 * Who acts on a later part next. Mirrors INVOICE_WORKFLOW, including the
 * "no branch partner" skip straight to Accounts.
 */
const partStep = (part) => {
  if (!part) return null;
  if (part.status === PART_STATUS.SUBMITTED && !part.partnerSkipped)
    return {
      actingRole: "branch_partner",
      label: "Partner Verification",
      nextStatus: PART_STATUS.PARTNER_APPROVED,
    };
  if (
    part.status === PART_STATUS.PARTNER_APPROVED ||
    (part.status === PART_STATUS.SUBMITTED && part.partnerSkipped)
  )
    return {
      actingRole: "accounts",
      label: part.partnerSkipped
        ? "Accounts Approval (Partner Skipped)"
        : "Accounts Approval",
      nextStatus: PART_STATUS.ACCOUNTS_APPROVED,
    };
  if (part.status === PART_STATUS.ACCOUNTS_APPROVED)
    return {
      actingRole: "cluster_head",
      label: "Cluster Head Approval",
      nextStatus: PART_STATUS.APPROVED,
    };
  return null;
};

/** Mongo filter: invoices whose later part is waiting for `role`. */
const awaitingRoleFilter = (role) => {
  if (role === "branch_partner")
    return {
      "paymentPlan.activeStatus": PART_STATUS.SUBMITTED,
      "paymentPlan.activePartnerSkipped": { $ne: true },
    };
  if (role === "accounts")
    return {
      $or: [
        { "paymentPlan.activeStatus": PART_STATUS.PARTNER_APPROVED },
        {
          "paymentPlan.activeStatus": PART_STATUS.SUBMITTED,
          "paymentPlan.activePartnerSkipped": true,
        },
      ],
    };
  if (role === "cluster_head")
    return { "paymentPlan.activeStatus": PART_STATUS.ACCOUNTS_APPROVED };
  return null;
};

/** Keeps the queue fields in step with the later part in approval. */
const syncActive = (plan) => {
  const active = (plan.parts || []).find(
    (p) => Number(p.partNo) > 1 && IN_APPROVAL.includes(p.status),
  );
  plan.activePartNo = active ? active.partNo : undefined;
  plan.activeStatus = active ? active.status : undefined;
  plan.activePartnerSkipped = active
    ? !!active.partnerSkipped || undefined
    : undefined;
  return plan;
};

/**
 * Read-time summary for every screen. Nothing is written.
 * `payment` defaults to a populated invoice.paymentRequest.
 */
const planSummary = (invoice, payment) => {
  const inv = plain(invoice) || {};
  const pay = plain(payment !== undefined ? payment : inv.paymentRequest);
  const plan = isPartPlan(inv);
  const netPayable = round2(inv.netPayable);
  const approvedAmount = approvedNetOf(inv);
  const paid = round2(pay && typeof pay === "object" ? pay.paidAmount : 0);
  const availableToRaise = round2(Math.max(0, approvedAmount - paid));
  const unrequested = unrequestedOf(inv);
  const active = activePartOf(inv);
  const pendingApproval = plan
    ? round2(Math.max(0, netPayable - approvedAmount))
    : 0;
  const balancePending = plan && (pendingApproval > EPS || unrequested > EPS);
  const lastPart = partsOf(inv).slice(-1)[0];
  return {
    plan,
    partial: plan, // kept for older screens
    grossPayable: grossPayableOf(inv),
    netPayable,
    requested: requestedOf(inv),
    unrequested,
    approvedAmount, // net approved for payment
    pendingApproval, // net not yet approved (incl. TDS not yet applied)
    balancePending,
    paidAmount: paid,
    availableToRaise,
    // Everything approved is paid; the rest still needs a part request
    // or approval.
    awaitingApproval: balancePending && availableToRaise <= EPS,
    awaitingClusterHead: balancePending && availableToRaise <= EPS, // alias
    activePart: active
      ? {
          partNo: active.partNo,
          status: active.status,
          partnerSkipped: !!active.partnerSkipped,
          awaiting: partStep(active)?.actingRole || null,
        }
      : null,
    // Branch user may ask for the next part (or resubmit a rejected one)
    canRequestNext:
      plan &&
      inv.status === "Cluster Head Approved" &&
      !active &&
      (unrequested > EPS || lastPart?.status === PART_STATUS.REJECTED),
    lastPartRejected: lastPart?.status === PART_STATUS.REJECTED,
    parts: partsOf(inv),
  };
};

module.exports = {
  round2,
  EPS,
  PART_STATUS,
  IN_APPROVAL,
  TDS_APPLIED,
  PAYMENT_IN_PROGRESS_STATUSES,
  PAYMENT_CLOSED_STATUSES,
  paymentInProgress,
  isPartPlan,
  partsOf,
  partByNo,
  grossPayableOf,
  requestedOf,
  unrequestedOf,
  activePartOf,
  approvedNetOf,
  validatePartAmount,
  computePartTds,
  applyPlanTotals,
  partStep,
  awaitingRoleFilter,
  syncActive,
  planSummary,
};
