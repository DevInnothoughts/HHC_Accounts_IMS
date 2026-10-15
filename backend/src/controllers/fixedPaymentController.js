// ============================================================
// BACKEND: src/controllers/fixedPaymentController.js — NEW FILE
// ------------------------------------------------------------
// Fixed (recurring) monthly payments.
//   Accounts      — set up, edit, pause/resume/end, upload agreement,
//                   generate now, adjust a month's amount
//   Super Admin   — approve / reject (one-time), pause/resume/end,
//                   generate now
// Accounts are limited to their assigned branches; Super Admin sees all.
// Nothing is ever deleted — a template is ended, not removed.
// ============================================================
const mongoose = require("mongoose");
const FixedPayment = require("../models/FixedPayment");
const InvoiceRequest = require("../models/InvoiceRequest");
const PaymentProcessing = require("../models/PaymentProcessing");
const ExpenseCategory = require("../models/ExpenseCategory");
const { ROLES } = require("../config/constants");
const { logAction } = require("../services/auditService");
const access = require("../utils/vendorAccess");
const {
  uploadFile,
  validateFile,
} = require("../services/linodeStorageService");
const {
  generateForTemplate,
  computeAmounts,
  periodOf,
  vendorProblem,
} = require("../services/fixedPaymentService");

const S = FixedPayment.STATUS;
const PERIOD_RX = /^\d{4}-(0[1-9]|1[0-2])$/;

// Fields Accounts may set. Anything else in the body is ignored.
const EDITABLE = [
  "title",
  "branch",
  "vendor",
  "expenseType",
  "expenseCategory",
  "description",
  "amount",
  "gstPercentage",
  "tdsPercentage",
  "dayOfMonth",
  "startPeriod",
  "endPeriod",
];
// Changing any of these on an active template sends it back for approval.
const MATERIAL = [
  "branch",
  "vendor",
  "expenseType",
  "expenseCategory",
  "amount",
  "gstPercentage",
  "tdsPercentage",
  "dayOfMonth",
  "startPeriod",
];

const POPULATE = [
  { path: "branch", select: "name code" },
  { path: "vendor", select: "vendorName companyName status approvalStatus" },
  { path: "expenseCategory", select: "name code type" },
  { path: "createdBy", select: "name email" },
  { path: "approvedBy", select: "name email" },
  { path: "history.by", select: "name" },
];

const isAdmin = (req) => req.user.role === ROLES.SUPER_ADMIN;

const canSee = (req, t) =>
  isAdmin(req) || access.canAccessBranch(req, t.branch?._id || t.branch);

const pick = (body) =>
  EDITABLE.reduce((acc, k) => {
    if (body[k] !== undefined) acc[k] = body[k];
    return acc;
  }, {});

// Shape + business validation. Returns an error message or null.
const validate = async (data, req) => {
  if (!String(data.title || "").trim()) return "Title is required";
  if (!mongoose.isValidObjectId(data.branch)) return "Select a branch";
  if (!access.canAccessBranch(req, data.branch))
    return "You can only set up fixed payments for your assigned branches";
  if (!mongoose.isValidObjectId(data.vendor)) return "Select a vendor";
  if (!["Revenue", "Capital"].includes(data.expenseType))
    return "Select an expense type";
  if (!mongoose.isValidObjectId(data.expenseCategory))
    return "Select an expense category";
  const cat = await ExpenseCategory.findById(data.expenseCategory)
    .select("type")
    .lean();
  if (!cat) return "Expense category not found";
  if (cat.type && cat.type !== data.expenseType)
    return `This category is for ${cat.type} expenses`;

  const amount = Number(data.amount);
  if (!(amount > 0)) return "Monthly amount must be more than zero";
  for (const k of ["gstPercentage", "tdsPercentage"]) {
    const v = Number(data[k] ?? 0);
    if (Number.isNaN(v) || v < 0 || v > 100)
      return `${k === "gstPercentage" ? "GST" : "TDS"} % must be between 0 and 100`;
  }
  const day = Number(data.dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31)
    return "Day of month must be between 1 and 31";
  if (!PERIOD_RX.test(String(data.startPeriod || "")))
    return "Start month is required";
  if (data.endPeriod) {
    if (!PERIOD_RX.test(String(data.endPeriod))) return "Invalid end month";
    if (data.endPeriod < data.startPeriod)
      return "End month cannot be before the start month";
  }
  const vp = await vendorProblem(data.vendor, data.branch);
  if (vp) return vp;
  return null;
};

const load = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ message: "Invalid fixed payment id" });
    return null;
  }
  const t = await FixedPayment.findById(req.params.id);
  if (!t) {
    res.status(404).json({ message: "Fixed payment not found" });
    return null;
  }
  if (!canSee(req, t)) {
    res
      .status(403)
      .json({ message: "This fixed payment is not in your branches" });
    return null;
  }
  return t;
};

const respond = async (res, t, code = 200) => {
  const full = await FixedPayment.findById(t._id).populate(POPULATE);
  res.status(code).json(full);
};

// ── GET /api/fixed-payments ─────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { status, branch, search } = req.query;
    const query = {};
    if (status && Object.values(S).includes(status)) query.status = status;
    if (!isAdmin(req)) {
      query.branch = { $in: access.userBranchIds(req) };
      if (branch && access.canAccessBranch(req, branch)) query.branch = branch;
    } else if (branch && mongoose.isValidObjectId(branch)) {
      query.branch = branch;
    }
    if (search) {
      const rx = { $regex: String(search).trim(), $options: "i" };
      query.$or = [{ templateId: rx }, { title: rx }, { description: rx }];
    }

    const templates = await FixedPayment.find(query)
      .populate(POPULATE)
      .sort({ status: 1, createdAt: -1 })
      .limit(500)
      .lean();

    // Counts per status for the filter chips (same branch scope).
    const scope = { ...query };
    delete scope.status;
    const counts = await FixedPayment.aggregate([
      {
        $match: {
          ...scope,
          ...(scope.branch?.$in
            ? {
                branch: {
                  $in: scope.branch.$in.map(
                    (b) => new mongoose.Types.ObjectId(String(b)),
                  ),
                },
              }
            : scope.branch
              ? { branch: new mongoose.Types.ObjectId(String(scope.branch)) }
              : {}),
        },
      },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);

    res.json({
      templates,
      counts: counts.reduce((a, c) => ({ ...a, [c._id]: c.n }), {}),
      currentPeriod: periodOf(),
    });
  } catch (err) {
    console.error("Fixed payments list error:", err);
    res.status(500).json({ message: "Could not load fixed payments" });
  }
};

// ── GET /api/fixed-payments/:id ─────────────────────────────
// Template plus the invoices it has generated, newest first.
exports.getOne = async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    const [full, invoices] = await Promise.all([
      FixedPayment.findById(t._id).populate(POPULATE).lean(),
      InvoiceRequest.find({ fixedPayment: t._id })
        .select(
          "requestId fixedPeriod netPayable amount status paymentRequest createdAt",
        )
        .populate("paymentRequest", "paymentId status paidAmount totalAmount")
        .sort({ fixedPeriod: -1 })
        .limit(36)
        .lean(),
    ]);
    res.json({ ...full, invoices });
  } catch (err) {
    console.error("Fixed payment get error:", err);
    res.status(500).json({ message: "Could not load the fixed payment" });
  }
};

// ── POST /api/fixed-payments  (accounts) ────────────────────
exports.create = async (req, res) => {
  try {
    const data = pick(req.body || {});
    const problem = await validate(data, req);
    if (problem) return res.status(400).json({ message: problem });

    const t = await FixedPayment.create({
      ...data,
      title: String(data.title).trim(),
      amount: Number(data.amount),
      gstPercentage: Number(data.gstPercentage) || 0,
      tdsPercentage: Number(data.tdsPercentage) || 0,
      dayOfMonth: Number(data.dayOfMonth),
      endPeriod: data.endPeriod || undefined,
      status: S.PENDING,
      createdBy: req.user._id,
      history: [{ action: "CREATED", by: req.user._id }],
    });

    await logAction({
      userId: req.user._id,
      action: "CREATE_FIXED_PAYMENT",
      module: "FixedPayment",
      targetId: t._id,
      targetLabel: `${t.templateId} · ${t.title}`,
      branch: t.branch,
      amount: t.amount,
      req,
    });
    await respond(res, t, 201);
  } catch (err) {
    console.error("Fixed payment create error:", err);
    res.status(400).json({ message: err.message });
  }
};

// ── PUT /api/fixed-payments/:id  (accounts) ─────────────────
exports.update = async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    if (t.status === S.ENDED)
      return res
        .status(400)
        .json({ message: "An ended fixed payment cannot be edited" });

    const changes = pick(req.body || {});
    const merged = { ...t.toObject(), ...changes };
    const problem = await validate(merged, req);
    if (problem) return res.status(400).json({ message: problem });

    const before = {};
    const after = {};
    let material = false;
    for (const k of Object.keys(changes)) {
      const oldV =
        t[k] instanceof mongoose.Types.ObjectId ? String(t[k]) : t[k];
      let newV = changes[k];
      if (
        ["amount", "gstPercentage", "tdsPercentage", "dayOfMonth"].includes(k)
      )
        newV = Number(newV) || 0;
      if (k === "endPeriod" && !newV) newV = undefined;
      if (String(oldV ?? "") === String(newV ?? "")) continue;
      before[k] = oldV;
      after[k] = newV;
      t[k] = newV;
      if (MATERIAL.includes(k)) material = true;
    }
    if (!Object.keys(after).length)
      return res.status(400).json({ message: "Nothing has changed" });

    const statusFrom = t.status;
    // A rejected template is resubmitted by editing it. An active or paused
    // one goes back for approval only when money terms change.
    if (
      t.status === S.REJECTED ||
      (material && [S.ACTIVE, S.PAUSED].includes(t.status))
    ) {
      t.status = S.PENDING;
      t.rejectionReason = undefined;
    }
    t.history.push({
      action:
        t.status === S.PENDING && statusFrom !== S.PENDING
          ? "EDITED_RESUBMITTED"
          : "EDITED",
      by: req.user._id,
      remarks: Object.keys(after).join(", "),
    });
    await t.save();

    await logAction({
      userId: req.user._id,
      action: "UPDATE_FIXED_PAYMENT",
      module: "FixedPayment",
      targetId: t._id,
      targetLabel: `${t.templateId} · ${t.title}`,
      branch: t.branch,
      statusFrom,
      statusTo: t.status,
      oldValue: before,
      newValue: after,
      req,
    });
    await respond(res, t);
  } catch (err) {
    console.error("Fixed payment update error:", err);
    res.status(400).json({ message: err.message });
  }
};

// ── POST /api/fixed-payments/:id/agreement  (accounts) ──────
exports.uploadAgreement = async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    if (t.status === S.ENDED)
      return res.status(400).json({ message: "This fixed payment has ended" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const errs = validateFile(req.file, { maxSizeMB: 10 });
    if (errs.length) return res.status(400).json({ message: errs.join(", ") });

    const { key, url, fileName } = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      `fixed-payments/${t._id}/agreement`,
    );
    // The previous file is kept in storage: invoices already generated
    // link to it, and records are never deleted.
    const replaced = Boolean(t.agreement?.url);
    t.agreement = {
      name: fileName,
      url,
      key,
      uploadedAt: new Date(),
      uploadedBy: req.user._id,
    };
    const statusFrom = t.status;
    // A new agreement on a running template needs Super Admin to see it.
    if ([S.ACTIVE, S.PAUSED, S.REJECTED].includes(t.status) && replaced) {
      t.status = S.PENDING;
    }
    t.history.push({
      action: replaced ? "AGREEMENT_REPLACED" : "AGREEMENT_UPLOADED",
      by: req.user._id,
      remarks: fileName,
    });
    await t.save();

    await logAction({
      userId: req.user._id,
      action: "UPLOAD_FIXED_PAYMENT_AGREEMENT",
      module: "FixedPayment",
      targetId: t._id,
      targetLabel: `${t.templateId} · ${t.title}`,
      branch: t.branch,
      statusFrom,
      statusTo: t.status,
      req,
    });
    await respond(res, t);
  } catch (err) {
    console.error("Fixed payment agreement upload error:", err);
    res.status(500).json({ message: "Upload failed" });
  }
};

// ── PATCH /api/fixed-payments/:id/approve  (super_admin) ────
exports.approve = async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    if (t.status !== S.PENDING)
      return res
        .status(400)
        .json({
          message: `Only templates pending approval can be approved (this one is ${t.status})`,
        });
    if (!t.agreement?.url)
      return res
        .status(400)
        .json({ message: "Upload the agreement before approving" });
    const vp = await vendorProblem(t.vendor, t.branch);
    if (vp) return res.status(400).json({ message: vp });

    t.status = S.ACTIVE;
    t.approvedBy = req.user._id;
    t.approvedAt = new Date();
    t.rejectionReason = undefined;
    t.history.push({
      action: "APPROVED",
      by: req.user._id,
      remarks: req.body?.remarks || "",
    });
    await t.save();

    await logAction({
      userId: req.user._id,
      action: "APPROVE_FIXED_PAYMENT",
      module: "FixedPayment",
      targetId: t._id,
      targetLabel: `${t.templateId} · ${t.title}`,
      branch: t.branch,
      statusFrom: S.PENDING,
      statusTo: S.ACTIVE,
      amount: t.amount,
      req,
    });

    // If this month's day has already passed, create this month's invoice
    // now rather than waiting for tomorrow's run.
    let generated = null;
    try {
      generated = await generateForTemplate(t, {});
    } catch (genErr) {
      console.error("Generate after approval failed:", genErr);
    }
    const full = await FixedPayment.findById(t._id).populate(POPULATE).lean();
    res.json({
      ...full,
      generated: generated && {
        status: generated.status,
        message: generated.message,
        requestId: generated.invoice?.requestId,
      },
    });
  } catch (err) {
    console.error("Fixed payment approve error:", err);
    res.status(500).json({ message: "Approval failed" });
  }
};

// ── PATCH /api/fixed-payments/:id/reject  (super_admin) ─────
exports.reject = async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    const reason = String(req.body?.reason || "").trim();
    if (!reason)
      return res.status(400).json({ message: "Rejection reason is required" });
    if (t.status !== S.PENDING)
      return res
        .status(400)
        .json({
          message: `Only templates pending approval can be rejected (this one is ${t.status})`,
        });

    t.status = S.REJECTED;
    t.rejectionReason = reason;
    t.history.push({ action: "REJECTED", by: req.user._id, remarks: reason });
    await t.save();

    await logAction({
      userId: req.user._id,
      action: "REJECT_FIXED_PAYMENT",
      module: "FixedPayment",
      targetId: t._id,
      targetLabel: `${t.templateId} · ${t.title}`,
      branch: t.branch,
      statusFrom: S.PENDING,
      statusTo: S.REJECTED,
      reason,
      req,
    });
    await respond(res, t);
  } catch (err) {
    console.error("Fixed payment reject error:", err);
    res.status(500).json({ message: "Rejection failed" });
  }
};

// ── PATCH /:id/pause | /:id/resume | /:id/end ───────────────
const transition =
  (action, from, to, auditAction, historyLabel) => async (req, res) => {
    try {
      const t = await load(req, res);
      if (!t) return;
      if (!from.includes(t.status))
        return res
          .status(400)
          .json({
            message: `Cannot ${action} a fixed payment that is ${t.status}`,
          });
      const statusFrom = t.status;
      t.status = to;
      t.history.push({
        action: historyLabel,
        by: req.user._id,
        remarks: req.body?.reason || "",
      });
      await t.save();
      await logAction({
        userId: req.user._id,
        action: auditAction,
        module: "FixedPayment",
        targetId: t._id,
        targetLabel: `${t.templateId} · ${t.title}`,
        branch: t.branch,
        statusFrom,
        statusTo: to,
        reason: req.body?.reason,
        req,
      });
      await respond(res, t);
    } catch (err) {
      console.error(`Fixed payment ${action} error:`, err);
      res
        .status(500)
        .json({ message: `Could not ${action} the fixed payment` });
    }
  };
exports.pause = transition(
  "pause",
  [S.ACTIVE],
  S.PAUSED,
  "PAUSE_FIXED_PAYMENT",
  "PAUSED",
);
exports.resume = transition(
  "resume",
  [S.PAUSED],
  S.ACTIVE,
  "RESUME_FIXED_PAYMENT",
  "RESUMED",
);
exports.end = transition(
  "end",
  [S.ACTIVE, S.PAUSED, S.PENDING, S.REJECTED],
  S.ENDED,
  "END_FIXED_PAYMENT",
  "ENDED",
);

// ── POST /api/fixed-payments/:id/generate ───────────────────
// Creates this month's invoice now, even before its day. Used to pull a
// payment forward, or to retry after fixing a vendor problem.
exports.generateNow = async (req, res) => {
  try {
    const t = await load(req, res);
    if (!t) return;
    const r = await generateForTemplate(t, {
      actorId: req.user._id,
      ignoreDueDay: true,
    });
    if (r.status === "created")
      return res.json({
        message: `Created ${r.invoice.requestId}`,
        requestId: r.invoice.requestId,
        invoiceId: r.invoice._id,
      });
    if (r.status === "exists")
      return res
        .status(409)
        .json({
          message: `This month's invoice already exists (${r.invoice?.requestId})`,
          invoiceId: r.invoice?._id,
        });
    return res
      .status(400)
      .json({ message: r.message || "Could not create the invoice" });
  } catch (err) {
    console.error("Fixed payment generate error:", err);
    res.status(500).json({ message: "Could not create the invoice" });
  }
};

// ── PATCH /api/fixed-payments/invoices/:invoiceId/amount ────
// Accounts adjusts ONE month's base amount (e.g. this month's bill differs)
// before any payment is raised. GST % and TDS % stay as on the template.
exports.adjustInvoiceAmount = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    if (!mongoose.isValidObjectId(invoiceId))
      return res.status(400).json({ message: "Invalid invoice id" });
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || "").trim();
    if (!(amount > 0))
      return res.status(400).json({ message: "Amount must be more than zero" });
    if (reason.length < 3)
      return res.status(400).json({ message: "Please give a reason" });

    const invoice = await InvoiceRequest.findById(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    if (invoice.source !== "fixed_payment")
      return res
        .status(400)
        .json({ message: "Only fixed monthly payments can be adjusted here" });
    if (!access.canAccessBranch(req, invoice.branch))
      return res
        .status(403)
        .json({ message: "This invoice is not in your assigned branches" });

    const payment = invoice.paymentRequest
      ? await PaymentProcessing.findById(invoice.paymentRequest)
      : null;
    if (!payment)
      return res.status(400).json({ message: "Payment record not found" });
    // A credit note has already re-based this invoice; changing the amount
    // now would silently overwrite it.
    if (invoice.creditNoteTotal > 0)
      return res
        .status(400)
        .json({
          message:
            "This invoice has an approved credit note — its amount can no longer be adjusted",
        });
    const pendingCn = await require("../models/CreditNote").exists({
      invoice: invoice._id,
      status: "pending_approval",
    });
    if (pendingCn)
      return res
        .status(400)
        .json({
          message:
            "A credit note is pending approval on this invoice — approve or reject it first",
        });
    if (
      payment.status !== "Payment Pending" ||
      (payment.paidAmount || 0) > 0 ||
      payment.installments?.length
    )
      return res
        .status(400)
        .json({
          message:
            "The amount can only be changed before any payment is raised",
        });

    const gstPct = Number(invoice.items?.[0]?.gstPercentage) || 0;
    const tdsPct = Number(invoice.tdsPercentage) || 0;
    const { base, gstAmount, tdsAmount, netPayable } = computeAmounts(
      amount,
      gstPct,
      tdsPct,
    );
    if (base === invoice.amount)
      return res.status(400).json({ message: "The amount is unchanged" });

    const before = { amount: invoice.amount, netPayable: invoice.netPayable };
    invoice.items = [
      {
        description:
          invoice.items?.[0]?.description ||
          invoice.description ||
          "Fixed payment",
        amount: base,
        gstPercentage: gstPct,
        gstAmount,
        total: Math.round((base + gstAmount) * 100) / 100,
      },
    ];
    invoice.amount = base;
    invoice.gstAmount = gstAmount;
    invoice.tdsAmount = tdsAmount;
    invoice.netPayable = netPayable;
    invoice.fixedAmountAdjustments = [
      ...(invoice.fixedAmountAdjustments || []),
      {
        from: before.amount,
        to: base,
        by: req.user._id,
        at: new Date(),
        reason,
      },
    ];
    await invoice.save();

    payment.totalAmount = netPayable;
    payment.remainingAmount = netPayable;
    await payment.save();

    await logAction({
      userId: req.user._id,
      action: "ADJUST_FIXED_INVOICE_AMOUNT",
      module: "Invoice",
      targetDoc: invoice,
      reason,
      oldValue: before,
      newValue: { amount: base, netPayable },
      req,
    });
    res.json({
      message: "Amount updated",
      amount: base,
      gstAmount,
      tdsAmount,
      netPayable,
    });
  } catch (err) {
    console.error("Fixed invoice adjust error:", err);
    res.status(500).json({ message: "Could not update the amount" });
  }
};
