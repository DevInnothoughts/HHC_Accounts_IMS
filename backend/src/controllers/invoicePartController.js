// ============================================================
// BACKEND: src/controllers/invoicePartController.js  —  NEW FILE (Nov 2026)
// ------------------------------------------------------------
// Part payments — later parts (2, 3, …) of a part-payment invoice.
//
//   POST  /api/invoices/:id/parts                    branch user requests
//   PATCH /api/invoices/:id/parts/:partNo/approve    Partner / Accounts / CH
//   PATCH /api/invoices/:id/parts/:partNo/reject     Partner / Accounts / CH
//
// Part 1 is the invoice's own approval (invoiceController). A later part
// runs the same chain on the part while the invoice stays "Cluster Head
// Approved":
//   Submitted → Partner Approved → Accounts Approved (TDS on this part)
//             → Approved (Cluster Head; own payment cycle)
// A branch with no active partner skips straight to Accounts, as invoices do.
//
// Every write is conditional on the part status that was read, so two
// approvers (or two tabs) cannot both move the same part.
// ============================================================
const mongoose = require("mongoose");
const InvoiceRequest = require("../models/InvoiceRequest");
const PaymentProcessing = require("../models/PaymentProcessing");
const User = require("../models/User");
const { INVOICE_STATUS, ROLES } = require("../config/constants");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");
const { resolvePaymentCycle, toStoredShape } = require("../utils/paymentCycle");
const plan = require("../utils/paymentPlan");

const inr = (n) => `₹${plan.round2(n).toLocaleString("en-IN")}`;

const userBranchIds = (req) =>
  (req.user.branches || []).map((b) => String(b?._id || b));

const loadInvoice = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return InvoiceRequest.findById(id).populate("branch vendor createdBy");
};

const fail = (res, status, message) => res.status(status).json({ message });

// Active users of a role on this invoice's branch.
const usersOf = (role, branchId) =>
  User.find({ role, status: "active", branches: branchId }).select(
    "email name",
  );

const emailAll = async (users, subject, html) => {
  for (const u of users) {
    if (u.email)
      await sendNotificationEmail(u.email, subject, html).catch(console.error);
  }
};

/**
 * Saves the plan (and TDS/net figures) only if the part is still in the
 * status we read. Returns false when someone else got there first.
 */
const commitPlan = async (invoice, partNo, expectedStatus, extraSet = {}) => {
  plan.syncActive(invoice.paymentPlan);
  const planObj = invoice.paymentPlan.toObject
    ? invoice.paymentPlan.toObject()
    : invoice.paymentPlan;
  const filter = {
    _id: invoice._id,
    status: INVOICE_STATUS.CLUSTER_APPROVED,
    "paymentPlan.mode": "partial",
  };
  if (expectedStatus === null) {
    // New part: nothing may be in approval, and the part count unchanged.
    filter["paymentPlan.activeStatus"] = null; // missing or null
    filter["paymentPlan.parts"] = { $size: extraSet.__partsBefore };
  } else {
    filter["paymentPlan.parts"] = {
      $elemMatch: { partNo: Number(partNo), status: expectedStatus },
    };
  }
  delete extraSet.__partsBefore;
  const r = await InvoiceRequest.updateOne(filter, {
    $set: {
      paymentPlan: planObj,
      tdsAmount: invoice.tdsAmount,
      netPayable: invoice.netPayable,
      ...(invoice.tdsPercentage !== undefined && invoice.tdsPercentage !== null
        ? { tdsPercentage: invoice.tdsPercentage }
        : {}),
      ...extraSet,
    },
  });
  return r.modifiedCount === 1;
};

/**
 * TDS on a later part changes the invoice's net payable — the payment
 * record follows, the same way a credit note moves it. Paid is never
 * reduced; remaining = total − paid.
 */
const syncPaymentTotals = async (invoice, extra = {}) => {
  if (!invoice.paymentRequest) return;
  const payment = await PaymentProcessing.findById(
    invoice.paymentRequest?._id || invoice.paymentRequest,
  );
  if (!payment) return;
  const paid = plan.round2(payment.paidAmount);
  const total = plan.round2(Math.max(invoice.netPayable, paid));
  await PaymentProcessing.updateOne(
    { _id: payment._id },
    {
      $set: {
        totalAmount: total,
        remainingAmount: plan.round2(total - paid),
        ...extra,
      },
    },
  );
};

// ── POST /api/invoices/:id/parts ───────────────────────────
// Body: { mode: "full" | "partial", amount?, remarks? }
//  • full    → the whole balance still to be requested
//  • partial → `amount` of it
// If the last part was rejected, this resubmits it (same part number).
exports.requestPart = async (req, res) => {
  try {
    const { mode, amount, remarks } = req.body || {};
    if (!["full", "partial"].includes(mode))
      return fail(res, 400, "Choose Full Balance or Part Amount");

    const invoice = await loadInvoice(req.params.id);
    if (!invoice) return fail(res, 404, "Invoice not found");

    // Same rule as submitting the invoice: the person who raised it.
    if (
      String(invoice.createdBy?._id || invoice.createdBy) !==
      String(req.user._id)
    )
      return fail(
        res,
        403,
        "Only the person who raised this invoice can request its next part",
      );
    if (
      !userBranchIds(req).includes(
        String(invoice.branch?._id || invoice.branch),
      )
    )
      return fail(res, 403, "This invoice is not in your assigned branches");

    if (!plan.isPartPlan(invoice))
      return fail(res, 400, "This invoice is not a part-payment invoice");
    if (invoice.status !== INVOICE_STATUS.CLUSTER_APPROVED)
      return fail(
        res,
        400,
        "The next part can be requested once the invoice is approved by the Cluster Head",
      );
    const active = plan.activePartOf(invoice);
    if (active)
      return fail(
        res,
        409,
        `Part ${active.partNo} is still in approval (${active.status}). Wait for it to be approved or rejected.`,
      );

    const parts = invoice.paymentPlan.parts;
    const last = parts[parts.length - 1];
    const resubmit =
      last && last.status === plan.PART_STATUS.REJECTED && last.partNo > 1;
    const balance = plan.unrequestedOf(invoice); // rejected parts already excluded
    if (balance <= 0)
      return fail(res, 400, "Nothing is left to request on this invoice");

    let partAmount = balance;
    if (mode === "partial") {
      const v = plan.validatePartAmount(amount, balance);
      if (v.error) return fail(res, 400, v.error);
      partAmount = v.amount;
    }

    const partnerExists = await User.exists({
      role: ROLES.BRANCH_PARTNER,
      branches: invoice.branch._id || invoice.branch,
      status: "active",
    });

    const partsBefore = parts.length;
    let part;
    if (resubmit) {
      part = last;
    } else {
      parts.push({ partNo: (last?.partNo || 0) + 1, amount: partAmount });
      part = parts[parts.length - 1];
    }
    Object.assign(part, {
      amount: partAmount,
      status: plan.PART_STATUS.SUBMITTED,
      partnerSkipped: partnerExists ? undefined : true,
      remarks: (remarks || "").trim(),
      requestedBy: req.user._id,
      requestedAt: new Date(),
      taxableAmount: undefined,
      tdsPercentage: undefined,
      tdsAmount: undefined,
      netAmount: undefined,
      tdsAppliedAt: undefined,
      approvedAt: undefined,
      paymentCycle: undefined,
    });
    part.history = part.history || [];
    part.history.push({
      stage: resubmit ? "Resubmitted" : "Requested",
      by: req.user._id,
      action: "requested",
      remarks: (remarks || "").trim(),
      at: new Date(),
    });

    const ok = await commitPlan(invoice, part.partNo, null, {
      __partsBefore: partsBefore,
    });
    if (!ok)
      return fail(
        res,
        409,
        "This invoice changed just now. Refresh and try again.",
      );

    // Notify the first approver
    const firstRole = partnerExists ? ROLES.BRANCH_PARTNER : ROLES.ACCOUNTS;
    await emailAll(
      await usersOf(firstRole, invoice.branch._id || invoice.branch),
      `📋 Part Payment Request: ${invoice.requestId} — Part ${part.partNo}`,
      `<p>Part <strong>${part.partNo}</strong> of invoice <strong>${invoice.requestId}</strong> (${invoice.vendor?.vendorName || "—"}, ${invoice.branch?.name || "—"}) has been requested for <strong>${inr(partAmount)}</strong> and needs your ${firstRole === ROLES.BRANCH_PARTNER ? "verification" : "approval"}.</p>
       <p>Find it under <strong>Invoice Processing → Part Payments</strong>.</p>`,
    );

    await logAction({
      userId: req.user._id,
      action: resubmit ? "RESUBMIT_INVOICE_PART" : "REQUEST_INVOICE_PART",
      module: "Invoice",
      targetDoc: invoice,
      statusFrom: invoice.status,
      statusTo: invoice.status,
      reason: `Part ${part.partNo}: ${inr(partAmount)}${remarks ? ` — ${remarks.trim()}` : ""}`,
      newValue: {
        partNo: part.partNo,
        amount: partAmount,
        partnerSkipped: !partnerExists,
      },
      req,
    }).catch((e) => console.error("requestPart audit:", e));

    res.json(await freshSummary(invoice._id));
  } catch (err) {
    console.error("requestPart error:", err);
    fail(res, 500, "Could not request the part. Please try again.");
  }
};

// Shared: load, scope and turn checks for approve / reject.
const loadForDecision = async (req) => {
  const invoice = await loadInvoice(req.params.id);
  if (!invoice) return { status: 404, message: "Invoice not found" };
  if (
    [ROLES.BRANCH_PARTNER, ROLES.ACCOUNTS, ROLES.CLUSTER_HEAD].includes(
      req.user.role,
    ) &&
    !userBranchIds(req).includes(String(invoice.branch?._id || invoice.branch))
  )
    return {
      status: 403,
      message: "You do not have access to this invoice's branch",
    };
  if (
    !plan.isPartPlan(invoice) ||
    invoice.status !== INVOICE_STATUS.CLUSTER_APPROVED
  )
    return {
      status: 400,
      message: "This invoice has no later part to approve",
    };

  const partNo = Number(req.params.partNo);
  if (!(partNo > 1))
    return {
      status: 400,
      message: "Part 1 is approved with the invoice itself",
    };
  const part = invoice.paymentPlan.parts.find((p) => p.partNo === partNo);
  if (!part) return { status: 404, message: `Part ${partNo} not found` };
  const step = plan.partStep(part);
  if (!step)
    return {
      status: 400,
      message: `Part ${partNo} is "${part.status}" — nothing to approve`,
    };
  if (step.actingRole !== req.user.role)
    return {
      status: 403,
      message: `Not your turn. Awaiting: ${step.actingRole.replace(/_/g, " ")}`,
    };
  return { invoice, part, step };
};

// ── PATCH /api/invoices/:id/parts/:partNo/approve ──────────
// Body: { remarks?, tdsPercentage (Accounts only) }
exports.approvePart = async (req, res) => {
  try {
    const d = await loadForDecision(req);
    if (d.message) return fail(res, d.status, d.message);
    const { invoice, part, step } = d;
    const { remarks, tdsPercentage } = req.body || {};
    const prevStatus = part.status;
    const now = new Date();

    let cycle = null;
    if (req.user.role === ROLES.ACCOUNTS) {
      if (
        tdsPercentage === undefined ||
        tdsPercentage === null ||
        tdsPercentage === ""
      )
        return fail(
          res,
          400,
          "TDS percentage is required for accounts approval",
        );
      const t = plan.computePartTds(invoice, part, tdsPercentage);
      if (t.error) return fail(res, 400, t.error);
      Object.assign(part, t, { tdsAppliedAt: now });
    }
    part.status = step.nextStatus;
    const isFinal = step.nextStatus === plan.PART_STATUS.APPROVED;
    if (isFinal) {
      // Each part gets its own payment cycle, from its approval date.
      cycle = resolvePaymentCycle(now);
      part.approvedAt = now;
      part.paymentCycle = toStoredShape(cycle, { recordedAt: now });
    }
    part.history = part.history || [];
    part.history.push({
      stage: step.label,
      by: req.user._id,
      action: "approved",
      remarks: (remarks || "").trim(),
      at: now,
    });
    plan.applyPlanTotals(invoice);

    const extraSet = isFinal
      ? { "paymentCycle.assigned": part.paymentCycle } // cycle for what is payable now
      : {};
    const ok = await commitPlan(invoice, part.partNo, prevStatus, extraSet);
    if (!ok)
      return fail(
        res,
        409,
        "This part was updated by someone else just now. Refresh and try again.",
      );

    if (req.user.role === ROLES.ACCOUNTS || isFinal)
      await syncPaymentTotals(
        invoice,
        isFinal && cycle ? { scheduledDate: cycle.paymentDate } : {},
      ).catch((e) => console.error("approvePart payment sync:", e));

    // Notifications
    const branchId = invoice.branch._id || invoice.branch;
    const label = `${invoice.requestId} — Part ${part.partNo}`;
    if (isFinal) {
      await emailAll(
        await usersOf(ROLES.ACCOUNTS, branchId),
        `💳 Part Approved for Payment: ${label}`,
        `<p>Part <strong>${part.partNo}</strong> of invoice <strong>${invoice.requestId}</strong> (${invoice.vendor?.vendorName || "—"}, ${invoice.branch?.name || "—"}) has been approved by the Cluster Head.</p>
         <p>Payable now: <strong>${inr(part.netAmount)}</strong> (${inr(part.amount)} less TDS ${inr(part.tdsAmount)}).</p>
         <p>Payment cycle: <strong>${cycle.cycleLabel} &middot; ${cycle.paymentWindowLabel}</strong></p>`,
      );
      if (invoice.createdBy?.email && invoice.createdBy?.status === "active")
        await sendNotificationEmail(
          invoice.createdBy.email,
          `✅ Part Approved: ${label}`,
          `<p>Part <strong>${part.partNo}</strong> (${inr(part.amount)}) of your invoice <strong>${invoice.requestId}</strong> has been approved and sent to Accounts for payment.</p>
           <p>Payment cycle: <strong>${cycle.cycleLabel} &middot; ${cycle.paymentWindowLabel}</strong></p>`,
        ).catch(console.error);
    } else {
      const next = plan.partStep(part);
      if (next)
        await emailAll(
          await usersOf(next.actingRole, branchId),
          `✅ Action Required: ${label}`,
          `<p>Part <strong>${part.partNo}</strong> (${inr(part.amount)}) of invoice <strong>${invoice.requestId}</strong> is now at your stage: <strong>${next.label}</strong>.</p>
           <p>Find it under <strong>Invoice Processing → Part Payments</strong>.</p>`,
        );
    }

    await logAction({
      userId: req.user._id,
      action: "APPROVE_INVOICE_PART",
      module: "Invoice",
      targetDoc: invoice,
      statusFrom: invoice.status,
      statusTo: invoice.status,
      reason: `Part ${part.partNo} · ${step.label}${remarks ? ` — ${remarks.trim()}` : ""}`,
      oldValue: { partNo: part.partNo, status: prevStatus },
      newValue: {
        partNo: part.partNo,
        status: part.status,
        ...(part.tdsAmount !== undefined && {
          tdsPercentage: part.tdsPercentage,
          tdsAmount: part.tdsAmount,
          netAmount: part.netAmount,
        }),
        ...(part.paymentCycle && { paymentCycle: part.paymentCycle }),
      },
      req,
    }).catch((e) => console.error("approvePart audit:", e));

    res.json(await freshSummary(invoice._id));
  } catch (err) {
    console.error("approvePart error:", err);
    fail(res, 500, "Part approval failed. Please try again.");
  }
};

// ── PATCH /api/invoices/:id/parts/:partNo/reject ───────────
// Body: { reason }. The part's amount goes back to the balance; the branch
// user can resubmit it (changed or not) from the Part Payments list.
exports.rejectPart = async (req, res) => {
  try {
    const reason = (req.body?.reason || "").trim();
    if (!reason) return fail(res, 400, "Rejection reason is required");
    const d = await loadForDecision(req);
    if (d.message) return fail(res, d.status, d.message);
    const { invoice, part, step } = d;
    const prevStatus = part.status;
    const hadTds = plan.TDS_APPLIED.includes(prevStatus);

    part.status = plan.PART_STATUS.REJECTED;
    part.history = part.history || [];
    part.history.push({
      stage: step.label,
      by: req.user._id,
      action: "rejected",
      remarks: reason,
      at: new Date(),
    });
    plan.applyPlanTotals(invoice); // its TDS (if any) drops out

    const ok = await commitPlan(invoice, part.partNo, prevStatus);
    if (!ok)
      return fail(
        res,
        409,
        "This part was updated by someone else just now. Refresh and try again.",
      );
    if (hadTds)
      await syncPaymentTotals(invoice).catch((e) =>
        console.error("rejectPart payment sync:", e),
      );

    if (invoice.createdBy?.email && invoice.createdBy?.status === "active")
      await sendNotificationEmail(
        invoice.createdBy.email,
        `❌ Part Rejected: ${invoice.requestId} — Part ${part.partNo}`,
        `<p>Part <strong>${part.partNo}</strong> (${inr(part.amount)}) of invoice <strong>${invoice.requestId}</strong> was rejected at <strong>${step.label}</strong>.</p>
         <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-top:12px;">
           <strong style="color:#dc2626;">Reason:</strong>
           <p style="margin:4px 0 0;color:#7f1d1d;">${reason}</p>
         </div>
         <p style="margin-top:12px;">You can resubmit it from <strong>Invoice Processing → Part Payments</strong>.</p>`,
      ).catch(console.error);

    await logAction({
      userId: req.user._id,
      action: "REJECT_INVOICE_PART",
      module: "Invoice",
      targetDoc: invoice,
      statusFrom: invoice.status,
      statusTo: invoice.status,
      reason: `Part ${part.partNo} · ${step.label} — ${reason}`,
      oldValue: { partNo: part.partNo, status: prevStatus },
      newValue: { partNo: part.partNo, status: part.status },
      req,
    }).catch((e) => console.error("rejectPart audit:", e));

    res.json(await freshSummary(invoice._id));
  } catch (err) {
    console.error("rejectPart error:", err);
    fail(res, 500, "Part rejection failed. Please try again.");
  }
};

// Response: the invoice with its plan summary, for the screen to refresh.
const freshSummary = async (id) => {
  const inv = await InvoiceRequest.findById(id)
    .populate(
      "paymentRequest",
      "paymentId status paidAmount remainingAmount totalAmount",
    )
    .populate("paymentPlan.parts.history.by", "name email role")
    .populate("paymentPlan.parts.requestedBy", "name email role")
    .lean();
  return { ...inv, paymentPlanSummary: plan.planSummary(inv) };
};
