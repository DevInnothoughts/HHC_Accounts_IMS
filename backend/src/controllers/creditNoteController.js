// ============================================================
// BACKEND: src/controllers/creditNoteController.js — NEW FILE
// ------------------------------------------------------------
// Credit notes against fully approved invoices.
//   Branch User / Accounts / Super Admin — record (with the vendor's
//                                           credit-note file)
//   Accounts / Super Admin (not the creator) — approve / reject
// Branch users and Accounts act only within their assigned branches.
//   Creator — cancel while pending
// Approval reduces the invoice (amount, GST, TDS, net payable) and its
// payment record. Records are never deleted.
// ============================================================
const mongoose = require("mongoose");
const CreditNote = require("../models/CreditNote");
const InvoiceRequest = require("../models/InvoiceRequest");
const PaymentProcessing = require("../models/PaymentProcessing");
const User = require("../models/User");
const { ROLES, INVOICE_STATUS } = require("../config/constants");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");
const {
  uploadFile,
  validateFile,
} = require("../services/linodeStorageService");
const {
  computeCreditNote,
  paymentEffect,
  paymentInProgress,
  round2,
} = require("../services/creditNoteService");

const S = CreditNote.STATUS;
const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

// Same visibility as invoices: these roles see only their branches.
const SCOPED = [
  ROLES.BRANCH_USER,
  ROLES.BRANCH_PARTNER,
  ROLES.ACCOUNTS,
  ROLES.CLUSTER_HEAD,
];
const myBranchIds = (req) =>
  (req.user?.branches || []).map((b) => String(b?._id || b));
const canSeeBranch = (req, branchId) =>
  !SCOPED.includes(req.user?.role) ||
  myBranchIds(req).includes(String(branchId?._id || branchId));

const POPULATE = [
  {
    path: "invoice",
    select: "requestId invoiceNumber netPayable originalTotals status",
  },
  { path: "branch", select: "name code" },
  { path: "vendor", select: "vendorName companyName" },
  { path: "createdBy", select: "name email" },
  { path: "decidedBy", select: "name email" },
];

const label = (cn, invoice) =>
  `${cn.creditNoteId}${invoice?.requestId ? ` · ${invoice.requestId}` : ""}`;

// Shared eligibility checks for record + approve.
const checkInvoice = async (invoice) => {
  if (!invoice) return { status: 404, message: "Invoice not found" };
  if (invoice.status !== INVOICE_STATUS.CLUSTER_APPROVED)
    return {
      status: 400,
      message:
        "Credit notes can only be added to fully approved invoices. Before final approval, edit the invoice instead.",
    };
  const payment = invoice.paymentRequest
    ? await PaymentProcessing.findById(invoice.paymentRequest)
    : null;
  if (!payment)
    return { status: 400, message: "This invoice has no payment record yet" };
  if (paymentInProgress(payment))
    return {
      status: 409,
      message: `A payment for this invoice is in progress (${payment.status}). Wait until its UTR is recorded, or reject it, then add the credit note.`,
    };
  return { payment };
};

const parseLines = (raw) => {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// ── GET /api/credit-notes ───────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { status, invoice, branch } = req.query;
    const query = {};
    if (status && Object.values(S).includes(status)) query.status = status;
    if (invoice && mongoose.isValidObjectId(invoice)) query.invoice = invoice;
    if (SCOPED.includes(req.user.role)) {
      query.branch = { $in: myBranchIds(req) };
      if (branch && canSeeBranch(req, branch)) query.branch = branch;
    } else if (branch && mongoose.isValidObjectId(branch)) {
      query.branch = branch;
    }

    const notes = await CreditNote.find(query)
      .populate(POPULATE)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const countScope = { ...query };
    delete countScope.status;
    const cast = (v) => new mongoose.Types.ObjectId(String(v));
    if (countScope.branch?.$in)
      countScope.branch = { $in: countScope.branch.$in.map(cast) };
    else if (countScope.branch) countScope.branch = cast(countScope.branch);
    if (countScope.invoice) countScope.invoice = cast(countScope.invoice);
    const counts = await CreditNote.aggregate([
      { $match: countScope },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);

    res.json({
      notes,
      counts: counts.reduce((a, c) => ({ ...a, [c._id]: c.n }), {}),
    });
  } catch (err) {
    console.error("Credit note list error:", err);
    res.status(500).json({ message: "Could not load credit notes" });
  }
};

// ── POST /api/credit-notes/preview ──────────────────────────
// Lines available on an invoice, and the effect of the requested lines.
exports.preview = async (req, res) => {
  try {
    const { invoiceId, lines } = req.body || {};
    if (!mongoose.isValidObjectId(invoiceId))
      return res.status(400).json({ message: "Invalid invoice" });
    const invoice = await InvoiceRequest.findById(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    if (!canSeeBranch(req, invoice.branch))
      return res
        .status(403)
        .json({ message: "This invoice is not in your assigned branches" });

    const elig = await checkInvoice(invoice);
    const calc = await computeCreditNote(invoice, parseLines(lines));
    const payment =
      elig.payment ||
      (invoice.paymentRequest
        ? await PaymentProcessing.findById(invoice.paymentRequest)
        : null);

    res.json({
      eligible: !elig.status,
      blockedReason: elig.message || null,
      currentNetPayable: round2(invoice.netPayable),
      originalNetPayable: round2(
        invoice.originalTotals?.netPayable ?? invoice.netPayable,
      ),
      paidAmount: round2(payment?.paidAmount),
      paymentStatus: payment?.status || null,
      lines: calc.lineAvailability || [],
      result: calc.ok
        ? {
            baseAmount: calc.baseAmount,
            gstAmount: calc.gstAmount,
            tdsReversal: calc.tdsReversal,
            netReduction: calc.netReduction,
            newNetPayable: calc.newTotals.netPayable,
            payment: paymentEffect(
              payment,
              calc.newTotals.netPayable,
              round2(invoice.netPayable),
            ),
          }
        : null,
      message: calc.ok ? null : calc.message,
    });
  } catch (err) {
    console.error("Credit note preview error:", err);
    res.status(500).json({ message: "Could not calculate the credit note" });
  }
};

// ── POST /api/credit-notes  (multipart: file + fields) ──────
exports.create = async (req, res) => {
  try {
    const { invoiceId, vendorCreditNoteNumber, creditNoteDate, reason } =
      req.body || {};
    if (!mongoose.isValidObjectId(invoiceId))
      return res.status(400).json({ message: "Invalid invoice" });
    const number = String(vendorCreditNoteNumber || "").trim();
    if (!number)
      return res
        .status(400)
        .json({ message: "Vendor credit note number is required" });
    const why = String(reason || "").trim();
    if (why.length < 3)
      return res.status(400).json({ message: "Reason is required" });
    const date = new Date(creditNoteDate);
    if (!creditNoteDate || Number.isNaN(date.getTime()))
      return res.status(400).json({ message: "Credit note date is required" });
    if (date.getTime() > Date.now() + 24 * 3600 * 1000)
      return res
        .status(400)
        .json({ message: "Credit note date cannot be in the future" });
    if (!req.file)
      return res
        .status(400)
        .json({ message: "Attach the vendor's credit note (PDF or image)" });
    const errs = validateFile(req.file, { maxSizeMB: 10 });
    if (errs.length) return res.status(400).json({ message: errs.join(", ") });

    const invoice = await InvoiceRequest.findById(invoiceId);
    if (invoice && !canSeeBranch(req, invoice.branch))
      return res
        .status(403)
        .json({ message: "This invoice is not in your assigned branches" });
    const elig = await checkInvoice(invoice);
    if (elig.status)
      return res.status(elig.status).json({ message: elig.message });

    // The same vendor credit note must not be recorded twice.
    const dup = await CreditNote.findOne({
      vendor: invoice.vendor,
      vendorCreditNoteNumber: {
        $regex: `^${number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      },
      status: { $in: [S.PENDING, S.APPROVED] },
    })
      .select("creditNoteId")
      .lean();
    if (dup)
      return res.status(409).json({
        message: `Vendor credit note ${number} is already recorded as ${dup.creditNoteId}`,
      });

    const calc = await computeCreditNote(invoice, parseLines(req.body.lines));
    if (!calc.ok) return res.status(400).json({ message: calc.message });
    if (!(calc.netReduction > 0))
      return res
        .status(400)
        .json({ message: "This credit note does not reduce the invoice" });

    const { key, url, fileName } = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      `invoices/${invoice._id}/credit-notes`,
    );

    const cn = await CreditNote.create({
      invoice: invoice._id,
      branch: invoice.branch,
      vendor: invoice.vendor,
      vendorCreditNoteNumber: number,
      creditNoteDate: date,
      reason: why,
      lines: calc.lines,
      baseAmount: calc.baseAmount,
      gstAmount: calc.gstAmount,
      tdsReversal: calc.tdsReversal,
      netReduction: calc.netReduction,
      document: { name: fileName, url, key, uploadedAt: new Date() },
      status: S.PENDING,
      createdBy: req.user._id,
    });

    await logAction({
      userId: req.user._id,
      action: "CREATE_CREDIT_NOTE",
      module: "CreditNote",
      targetId: cn._id,
      targetLabel: label(cn, invoice),
      branch: invoice.branch,
      amount: calc.netReduction,
      reason: why,
      newValue: {
        vendorCreditNoteNumber: number,
        baseAmount: calc.baseAmount,
        netReduction: calc.netReduction,
      },
      req,
    });

    // Tell the approvers: Accounts users assigned to this branch.
    try {
      const approvers = await User.find({
        role: ROLES.ACCOUNTS,
        status: "active",
        branches: invoice.branch,
      }).select("email");
      for (const a of approvers) {
        if (String(a._id) === String(req.user._id)) continue;
        await sendNotificationEmail(
          a.email,
          `🧾 Credit note awaiting approval: ${cn.creditNoteId} (${invoice.requestId})`,
          `<p>${req.user.name || "A user"} recorded credit note <strong>${cn.creditNoteId}</strong>
           (vendor ref ${number}) against invoice <strong>${invoice.requestId}</strong>.</p>
           <p>Net payable reduction: <strong>${inr(calc.netReduction)}</strong>. Reason: ${why}</p>
           <p>Approve or reject it from Credit Notes in PMS.</p>`,
        ).catch(console.error);
      }
    } catch (mailErr) {
      console.error("Credit note notification failed:", mailErr.message);
    }

    const full = await CreditNote.findById(cn._id).populate(POPULATE);
    res.status(201).json(full);
  } catch (err) {
    console.error("Credit note create error:", err);
    res.status(500).json({ message: "Could not record the credit note" });
  }
};

// ── PATCH /api/credit-notes/:id/approve  (accounts, super_admin) ─
exports.approve = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ message: "Invalid credit note" });

  const existing = await CreditNote.findById(req.params.id)
    .select("createdBy status branch")
    .lean();
  if (!existing)
    return res.status(404).json({ message: "Credit note not found" });
  if (!canSeeBranch(req, existing.branch))
    return res
      .status(403)
      .json({ message: "This credit note is not in your assigned branches" });
  if (String(existing.createdBy) === String(req.user._id))
    return res.status(403).json({
      message:
        "A credit note must be approved by someone other than the person who recorded it",
    });

  // Claim it atomically so a double click / two admins cannot apply it twice.
  const cn = await CreditNote.findOneAndUpdate(
    { _id: req.params.id, status: S.PENDING },
    {
      $set: {
        status: S.APPROVED,
        decidedBy: req.user._id,
        decidedAt: new Date(),
        decisionRemarks: String(req.body?.remarks || "").trim(),
      },
    },
    { new: true },
  );
  if (!cn)
    return res.status(400).json({
      message: `Only pending credit notes can be approved (this one is ${existing.status})`,
    });

  const release = async (message, status = 400) => {
    await CreditNote.updateOne(
      { _id: cn._id },
      {
        $set: { status: S.PENDING },
        $unset: { decidedBy: 1, decidedAt: 1, decisionRemarks: 1 },
      },
    );
    return res.status(status).json({ message });
  };

  try {
    const invoice = await InvoiceRequest.findById(cn.invoice);
    const elig = await checkInvoice(invoice);
    if (elig.status) return release(elig.message, elig.status);
    const payment = elig.payment;

    // Recompute against the invoice as it is now (excluding this note's
    // own reservation), so the figures applied are always current.
    const calc = await computeCreditNote(
      invoice,
      cn.lines.map((l) => ({ itemIndex: l.itemIndex, amount: l.amount })),
      { excludeId: cn._id },
    );
    if (!calc.ok) return release(calc.message);
    if (!(calc.netReduction > 0))
      return release("This credit note no longer reduces the invoice");

    const oldNet = round2(invoice.netPayable);
    const effect = paymentEffect(payment, calc.newTotals.netPayable, oldNet);
    const paymentStatusBefore = payment.status;

    // ── Invoice ──
    if (
      !invoice.originalTotals?.netPayable &&
      invoice.originalTotals?.netPayable !== 0
    ) {
      invoice.originalTotals = {
        amount: invoice.amount,
        gstAmount: invoice.gstAmount,
        tdsAmount: invoice.tdsAmount,
        roundOff: invoice.roundOff,
        netPayable: invoice.netPayable,
      };
    }
    Object.assign(invoice, calc.newTotals);
    invoice.creditNoteTotal = round2(
      (invoice.creditNoteTotal || 0) + calc.netReduction,
    );
    if (effect.refundDue > 0)
      invoice.creditNoteRefundDue = round2(
        (invoice.creditNoteRefundDue || 0) + effect.refundDue,
      );
    invoice.approvalHistory.push({
      stage: `Credit Note ${cn.creditNoteId}`,
      approvedBy: req.user._id,
      action: "approved",
      remarks: `Vendor CN ${cn.vendorCreditNoteNumber}: net payable ${inr(oldNet)} → ${inr(calc.newTotals.netPayable)}. ${cn.reason}`,
      actionAt: new Date(),
    });
    // The vendor's credit note travels with the invoice (documents ZIP,
    // attachment list). No `key`: deleting the attachment from the invoice
    // must never delete the credit note's own file.
    if (cn.document?.url) {
      invoice.attachments.push({
        name: `${cn.creditNoteId} - ${cn.document.name}`,
        url: cn.document.url,
        type: "credit_note",
        uploadedAt: new Date(),
      });
    }

    // ── Payment ──
    payment.totalAmount = effect.totalAmount; // pre-save recomputes remainingAmount
    payment.status = effect.status;
    payment.approvalHistory.push({
      stage: `Credit Note ${cn.creditNoteId}`,
      approvedBy: req.user._id,
      action: "approved",
      remarks: `Payable reduced by ${inr(calc.netReduction)}${effect.refundDue > 0 ? `; refund due from vendor ${inr(effect.refundDue)}` : ""}`,
      actionAt: new Date(),
    });

    // ── Freeze the applied figures on the credit note ──
    cn.lines = calc.lines;
    cn.baseAmount = calc.baseAmount;
    cn.gstAmount = calc.gstAmount;
    cn.tdsReversal = calc.tdsReversal;
    cn.netReduction = calc.netReduction;
    cn.applied = {
      netPayableBefore: oldNet,
      netPayableAfter: calc.newTotals.netPayable,
      paidAmountAtApproval: effect.paid,
      refundDue: effect.refundDue,
      paymentStatusBefore,
      paymentStatusAfter: effect.status,
    };

    // All three documents change together or not at all (MongoDB Atlas
    // runs as a replica set, so multi-document transactions are available).
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await invoice.save({ session });
        await payment.save({ session });
        await cn.save({ session });
      });
    } finally {
      await session.endSession();
    }

    await logAction({
      userId: req.user._id,
      action: "APPROVE_CREDIT_NOTE",
      module: "CreditNote",
      targetId: cn._id,
      targetLabel: label(cn, invoice),
      branch: invoice.branch,
      statusFrom: S.PENDING,
      statusTo: S.APPROVED,
      amount: calc.netReduction,
      oldValue: { netPayable: oldNet, paymentStatus: paymentStatusBefore },
      newValue: {
        netPayable: calc.newTotals.netPayable,
        paymentStatus: effect.status,
        refundDue: effect.refundDue,
      },
      req,
    });

    try {
      const creator = await User.findById(cn.createdBy).select("email status");
      if (creator?.email && creator.status === "active") {
        await sendNotificationEmail(
          creator.email,
          `✅ Credit note approved: ${cn.creditNoteId} (${invoice.requestId})`,
          `<p>Credit note <strong>${cn.creditNoteId}</strong> was approved. Invoice <strong>${invoice.requestId}</strong>
           net payable is now <strong>${inr(calc.newTotals.netPayable)}</strong> (was ${inr(oldNet)}).</p>
           ${effect.refundDue > 0 ? `<p><strong>${inr(effect.refundDue)}</strong> was already paid above the new amount — collect this refund from the vendor outside PMS.</p>` : ""}`,
        ).catch(console.error);
      }
    } catch (mailErr) {
      console.error("Credit note approval mail failed:", mailErr.message);
    }

    const full = await CreditNote.findById(cn._id).populate(POPULATE);
    res.json(full);
  } catch (err) {
    console.error("Credit note approve error:", err);
    // The transaction rolled back (or nothing was written yet), so the
    // credit note can safely go back to pending.
    if (!res.headersSent)
      await release("Approval failed. Please try again.", 500).catch(() => {});
  }
};

// ── PATCH /api/credit-notes/:id/reject  (accounts, super_admin) ─
exports.reject = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    if (!reason)
      return res.status(400).json({ message: "Rejection reason is required" });
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ message: "Invalid credit note" });
    const existing = await CreditNote.findById(req.params.id)
      .select("createdBy branch")
      .lean();
    if (!existing)
      return res.status(404).json({ message: "Credit note not found" });
    if (!canSeeBranch(req, existing.branch))
      return res
        .status(403)
        .json({ message: "This credit note is not in your assigned branches" });
    if (String(existing.createdBy) === String(req.user._id))
      return res.status(403).json({
        message:
          "You cannot reject a credit note you recorded — cancel it instead",
      });
    const cn = await CreditNote.findOneAndUpdate(
      { _id: req.params.id, status: S.PENDING },
      {
        $set: {
          status: S.REJECTED,
          decidedBy: req.user._id,
          decidedAt: new Date(),
          decisionRemarks: reason,
        },
      },
      { new: true },
    ).populate("invoice", "requestId");
    if (!cn)
      return res
        .status(400)
        .json({ message: "Only pending credit notes can be rejected" });

    await logAction({
      userId: req.user._id,
      action: "REJECT_CREDIT_NOTE",
      module: "CreditNote",
      targetId: cn._id,
      targetLabel: label(cn, cn.invoice),
      branch: cn.branch,
      statusFrom: S.PENDING,
      statusTo: S.REJECTED,
      reason,
      req,
    });
    try {
      const creator = await User.findById(cn.createdBy).select("email status");
      if (creator?.email && creator.status === "active") {
        await sendNotificationEmail(
          creator.email,
          `❌ Credit note rejected: ${cn.creditNoteId}`,
          `<p>Credit note <strong>${cn.creditNoteId}</strong> (${cn.invoice?.requestId || ""}) was rejected.</p><p>Reason: ${reason}</p>`,
        ).catch(console.error);
      }
    } catch (mailErr) {
      console.error("Credit note rejection mail failed:", mailErr.message);
    }
    res.json(await CreditNote.findById(cn._id).populate(POPULATE));
  } catch (err) {
    console.error("Credit note reject error:", err);
    res.status(500).json({ message: "Rejection failed" });
  }
};

// ── PATCH /api/credit-notes/:id/cancel  (creator, pending only) ─
exports.cancel = async (req, res) => {
  try {
    const cn = await CreditNote.findOneAndUpdate(
      { _id: req.params.id, status: S.PENDING, createdBy: req.user._id },
      {
        $set: {
          status: S.CANCELLED,
          decidedBy: req.user._id,
          decidedAt: new Date(),
          decisionRemarks: String(
            req.body?.reason || "Cancelled by creator",
          ).trim(),
        },
      },
      { new: true },
    ).populate("invoice", "requestId");
    if (!cn)
      return res.status(400).json({
        message:
          "Only the person who recorded it can cancel a pending credit note",
      });
    await logAction({
      userId: req.user._id,
      action: "CANCEL_CREDIT_NOTE",
      module: "CreditNote",
      targetId: cn._id,
      targetLabel: label(cn, cn.invoice),
      branch: cn.branch,
      statusFrom: S.PENDING,
      statusTo: S.CANCELLED,
      req,
    });
    res.json(await CreditNote.findById(cn._id).populate(POPULATE));
  } catch (err) {
    console.error("Credit note cancel error:", err);
    res.status(500).json({ message: "Could not cancel the credit note" });
  }
};
