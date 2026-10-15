// ============================================================
// BACKEND: src/services/fixedPaymentService.js — NEW FILE
// ------------------------------------------------------------
// Creates the monthly invoice for an approved FixedPayment template.
//
// The invoice is created ALREADY at "Cluster Head Approved" (the normal
// Partner → Accounts → Cluster Head approvals are recorded as automatic,
// authorised by the Super Admin's one-time template approval), and gets
// its PaymentProcessing record exactly as approveInvoice creates one.
// From there it follows the normal payment flow: raise → approve →
// bank Excel → UTR. It is never held by the 8–10 / 18–21 cycle lock.
//
// Idempotent: one invoice per template per month, enforced by a unique
// index on InvoiceRequest { fixedPayment, fixedPeriod }.
// ============================================================
const FixedPayment = require("../models/FixedPayment");
const InvoiceRequest = require("../models/InvoiceRequest");
const PaymentProcessing = require("../models/PaymentProcessing");
const Vendor = require("../models/Vendor");
const VendorMaster = require("../models/VendorMaster");
const User = require("../models/User");
const {
  INVOICE_STATUS,
  INVOICE_WORKFLOW,
  ROLES,
} = require("../config/constants");
const { logAction } = require("./auditService");
const { sendNotificationEmail } = require("./emailService");
const {
  resolvePaymentCycle,
  toStoredShape,
  istParts,
} = require("../utils/paymentCycle");

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "2026-11" for an instant, in IST.
const periodOf = (instant = new Date()) => {
  const { year, monthIndex } = istParts(instant);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
};

const periodLabel = (period) => {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

const daysInMonth = (period) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// Day the invoice is due in a given month (31 → last day of short months).
const dueDayFor = (template, period) =>
  Math.min(template.dayOfMonth, daysInMonth(period));

const inRange = (template, period) =>
  period >= template.startPeriod &&
  (!template.endPeriod || period <= template.endPeriod);

// Same money rules as the manual flow: GST to 2 dp, TDS rounded to the
// rupee on the base amount (as approveInvoice does), net = base + GST − TDS.
const computeAmounts = (amount, gstPercentage, tdsPercentage) => {
  const base = round2(amount);
  const gstAmount = round2((base * (Number(gstPercentage) || 0)) / 100);
  const tdsAmount = Math.round((base * (Number(tdsPercentage) || 0)) / 100);
  const netPayable = round2(base + gstAmount - tdsAmount);
  return { base, gstAmount, tdsAmount, netPayable };
};

// Can money be sent to this vendor right now? Mirrors the invoice vendor
// gate: approved, active at branch level, and an approved/active master.
const vendorProblem = async (vendorId, branchId) => {
  const v = await Vendor.findById(vendorId)
    .select("vendorName approvalStatus status branch vendorMaster")
    .lean();
  if (!v) return "Vendor no longer exists";
  if (String(v.branch) !== String(branchId))
    return `Vendor "${v.vendorName}" is not in this branch's vendor list`;
  if (v.approvalStatus !== "approved")
    return `Vendor "${v.vendorName}" is not approved by accounts`;
  if (v.status && v.status !== "active")
    return `Vendor "${v.vendorName}" is ${v.status}`;
  if (v.vendorMaster) {
    const m = await VendorMaster.findById(v.vendorMaster)
      .select("approvalStatus status")
      .lean();
    if (!m || m.approvalStatus !== "approved" || m.status !== "active")
      return `Vendor "${v.vendorName}" is not active in the Vendor Master`;
  }
  return null;
};

// Payment record exactly as approveInvoice creates it on final approval.
const ensurePaymentRecord = async (invoice, scheduledDate) => {
  if (invoice.paymentRequest) {
    const existing = await PaymentProcessing.findById(invoice.paymentRequest);
    if (existing) return existing;
  }
  const payment = await PaymentProcessing.create({
    invoiceRequest: invoice._id,
    branch: invoice.branch,
    vendor: invoice.vendor,
    totalAmount: invoice.netPayable,
    paidAmount: 0,
    remainingAmount: invoice.netPayable,
    status: "Payment Pending",
    currentStage: "accounts",
    raisedBy: invoice.createdBy,
    scheduledDate,
  });
  invoice.paymentRequest = payment._id;
  await invoice.save();
  return payment;
};

const notifyAccounts = async (template, invoice) => {
  try {
    const users = await User.find({
      role: ROLES.ACCOUNTS,
      status: "active",
      branches: template.branch,
    }).select("email");
    for (const u of users) {
      await sendNotificationEmail(
        u.email,
        `🔁 Fixed payment due: ${template.title} (${periodLabel(invoice.fixedPeriod)})`,
        `<p>The fixed monthly payment <strong>${template.templateId} · ${template.title}</strong>
         for <strong>${periodLabel(invoice.fixedPeriod)}</strong> has been created as invoice
         <strong>${invoice.requestId}</strong> and is ready for payment processing.</p>
         <p>Net payable: <strong>₹${Number(invoice.netPayable).toLocaleString("en-IN")}</strong>.
         If this month's amount differs, adjust it from Payment Processing before raising the payment.</p>`,
      ).catch(console.error);
    }
  } catch (err) {
    console.error("Fixed payment notification failed:", err.message);
  }
};

const notifyFailure = async (template, period, message) => {
  try {
    const users = await User.find({
      role: { $in: [ROLES.ACCOUNTS, ROLES.SUPER_ADMIN] },
      status: "active",
      $or: [{ role: ROLES.SUPER_ADMIN }, { branches: template.branch }],
    }).select("email");
    for (const u of users) {
      await sendNotificationEmail(
        u.email,
        `⚠ Fixed payment not created: ${template.templateId} (${periodLabel(period)})`,
        `<p>The ${periodLabel(period)} invoice for fixed payment
         <strong>${template.templateId} · ${template.title}</strong> could not be created:</p>
         <p><strong>${message}</strong></p>
         <p>Fix the issue and use "Generate now" on the Fixed Payments page.</p>`,
      ).catch(console.error);
    }
  } catch (err) {
    console.error("Fixed payment failure notice failed:", err.message);
  }
};

/**
 * Create (or find) the invoice for one template and one month.
 *
 * @param {Document} template  FixedPayment document
 * @param {object}   opts
 * @param {string}   [opts.period]   YYYY-MM, default current IST month
 * @param {Date}     [opts.now]
 * @param {ObjectId} [opts.actorId]  who triggered it (manual) — null for the job
 * @param {boolean}  [opts.ignoreDueDay]  manual "generate now" before the day
 * @returns {{ status: "created"|"exists"|"skipped"|"failed", message?, invoice? }}
 */
const generateForTemplate = async (template, opts = {}) => {
  const now = opts.now || new Date();
  const period = opts.period || periodOf(now);

  if (template.status !== FixedPayment.STATUS.ACTIVE)
    return { status: "skipped", message: `Template is ${template.status}` };
  if (!inRange(template, period))
    return {
      status: "skipped",
      message: `${periodLabel(period)} is outside the template's months`,
    };

  if (!opts.ignoreDueDay && period === periodOf(now)) {
    const { day } = istParts(now);
    if (day < dueDayFor(template, period))
      return { status: "skipped", message: "Not due yet this month" };
  }

  // Already created? Repair a missing payment record if a previous run
  // stopped half-way, then report it as existing.
  const existing = await InvoiceRequest.findOne({
    fixedPayment: template._id,
    fixedPeriod: period,
  });
  if (existing) {
    if (!existing.paymentRequest) {
      await ensurePaymentRecord(
        existing,
        existing.paymentCycle?.assigned?.paymentDate,
      );
    }
    return { status: "exists", invoice: existing };
  }

  const problem = await vendorProblem(template.vendor, template.branch);
  if (problem) {
    template.lastError = { period, message: problem, at: now };
    await template.save();
    await notifyFailure(template, period, problem);
    return { status: "failed", message: problem };
  }

  const { base, gstAmount, tdsAmount, netPayable } = computeAmounts(
    template.amount,
    template.gstPercentage,
    template.tdsPercentage,
  );

  const cycle = resolvePaymentCycle(now);
  const authorisedBy = template.approvedBy || template.createdBy;
  const authNote = `Auto-approved — fixed monthly payment ${template.templateId}, approved once by Super Admin${
    template.approvedAt
      ? ` on ${new Date(template.approvedAt).toLocaleDateString("en-GB")}`
      : ""
  }`;

  // Record each normal approval stage as automatic, so stage reports,
  // the invoice timeline and the audit view all read consistently.
  const approvalHistory = INVOICE_WORKFLOW.map((step) => ({
    stage: `${step.label} (Auto — Fixed Payment)`,
    approvedBy: authorisedBy,
    action: "approved",
    remarks: authNote,
    actionAt: now,
  }));

  const attachments = template.agreement?.url
    ? [
        {
          name: template.agreement.name,
          url: template.agreement.url,
          // No `key`: the file belongs to the template. Deleting this
          // invoice attachment must never delete the shared agreement.
          type: "agreement",
          uploadedAt: template.agreement.uploadedAt || now,
        },
      ]
    : [];

  let invoice;
  try {
    invoice = await InvoiceRequest.create({
      branch: template.branch,
      vendor: template.vendor,
      expenseType: template.expenseType,
      expenseCategory: template.expenseCategory,
      items: [
        {
          description: `${template.title} — ${periodLabel(period)}`,
          amount: base,
          gstPercentage: Number(template.gstPercentage) || 0,
          gstAmount,
          total: round2(base + gstAmount),
        },
      ],
      amount: base,
      gstAmount,
      tdsPercentage: Number(template.tdsPercentage) || 0,
      tdsAmount,
      roundOff: 0,
      netPayable,
      invoiceNumber: `${template.templateId}/${period}`,
      invoiceDate: now,
      dueDate: now,
      description:
        template.description || `${template.title} — ${periodLabel(period)}`,
      remarks: `Fixed monthly payment ${template.templateId} · ${periodLabel(period)}`,
      attachments,
      status: INVOICE_STATUS.CLUSTER_APPROVED,
      currentStage: "completed",
      approvalHistory,
      createdBy: template.createdBy,
      source: "fixed_payment",
      fixedPayment: template._id,
      fixedPeriod: period,
      paymentCycle: {
        assigned: toStoredShape(cycle, { recordedAt: now }),
      },
    });
  } catch (err) {
    // Lost a race with another run: the unique index did its job.
    if (err?.code === 11000) {
      const again = await InvoiceRequest.findOne({
        fixedPayment: template._id,
        fixedPeriod: period,
      });
      return { status: "exists", invoice: again };
    }
    throw err;
  }

  await ensurePaymentRecord(invoice, cycle.paymentDate);

  template.lastGeneratedPeriod = period;
  template.lastGeneratedInvoice = invoice._id;
  template.lastError = undefined;
  await template.save();

  await logAction({
    userId: opts.actorId || authorisedBy,
    action: "AUTO_GENERATE_FIXED_INVOICE",
    module: "Invoice",
    targetDoc: invoice,
    statusTo: invoice.status,
    reason: `${template.templateId} · ${periodLabel(period)}${
      opts.actorId ? " (generated manually)" : " (scheduled)"
    }`,
    newValue: {
      fixedPayment: template.templateId,
      period,
      netPayable,
    },
  });

  await notifyAccounts(template, invoice);
  return { status: "created", invoice };
};

/** The daily job: every active template that is due this month. */
const runDueFixedPayments = async (now = new Date()) => {
  const period = periodOf(now);
  // Only templates that still owe an invoice this month. Once a month's
  // invoice exists, lastGeneratedPeriod equals this month and the template
  // drops out of the query — so on most days this returns nothing and the
  // whole run is one small indexed query. (lastGeneratedPeriod is written
  // only after the invoice AND its payment record exist.)
  const templates = await FixedPayment.find({
    status: FixedPayment.STATUS.ACTIVE,
    lastGeneratedPeriod: { $ne: period },
    startPeriod: { $lte: period },
    $or: [
      { endPeriod: { $exists: false } },
      { endPeriod: null },
      { endPeriod: { $gte: period } },
    ],
  });
  const summary = { created: 0, exists: 0, skipped: 0, failed: 0 };
  for (const t of templates) {
    try {
      const r = await generateForTemplate(t, { now });
      summary[r.status] = (summary[r.status] || 0) + 1;
    } catch (err) {
      summary.failed += 1;
      console.error(`Fixed payment ${t.templateId} failed:`, err.message);
    }
  }
  return summary;
};

module.exports = {
  generateForTemplate,
  runDueFixedPayments,
  computeAmounts,
  periodOf,
  periodLabel,
  dueDayFor,
  vendorProblem,
};
