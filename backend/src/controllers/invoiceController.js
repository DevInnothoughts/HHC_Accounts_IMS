// ============================================================
// BACKEND: src/controllers/invoiceController.js  —  REPLACE WHOLE FILE
// Vendor Master, Phase 2 + Phase 5. Changes are confined to the vendor
// gate and duplicate checks; everything else is the current file.
//  • vendorGate() — ONE rule for create AND edit. The vendor must:
//      belong to the invoice's branch   (was never checked)
//      be approved by accounts          (as before)
//      be active at branch level        (was never checked — inactive,
//                                        frozen, blacklisted vendors could
//                                        still be invoiced)
//      have an approved, active Vendor Master, if linked   (Phase 2)
//  • updateInvoice runs the gate when the vendor or branch changes, and the
//    duplicate check when the vendor, invoice number or amount changes.
//    Previously an edit could switch to any vendor and any number.
//  • Duplicate detection now spans branches of the same real vendor
//    (services/duplicateInvoiceService.js).
// ============================================================
const mongoose = require("mongoose");
const InvoiceRequest = require("../models/InvoiceRequest");
const Vendor = require("../models/Vendor");
const VendorMaster = require("../models/VendorMaster");
const User = require("../models/User");
const {
  INVOICE_STATUS,
  ROLES,
  INVOICE_WORKFLOW,
} = require("../config/constants");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");
const {
  startSLATracking,
  completeSLATracking,
} = require("../services/slaService");
const { checkBudget } = require("../services/budgetService");
const {
  checkDuplicateInvoice,
} = require("../services/duplicateInvoiceService");
const {
  resolvePaymentCycle,
  toStoredShape,
  derivedStoredShape,
} = require("../utils/paymentCycle");
const access = require("../utils/vendorAccess");

// ── Can this branch raise an invoice against this vendor right now? ──
// Returns null when allowed, or { status, body } to send back.
const vendorGate = async (vendorId, branchId) => {
  if (!mongoose.isValidObjectId(vendorId))
    return { status: 400, body: { message: "Select a valid vendor" } };
  const v = await Vendor.findById(vendorId)
    .select("vendorName approvalStatus status branch vendorMaster")
    .lean();
  if (!v) return { status: 404, body: { message: "Vendor not found" } };

  if (branchId && String(v.branch) !== String(branchId)) {
    return {
      status: 400,
      body: {
        message: `Vendor "${v.vendorName}" is not in this branch's vendor list. Add it to the branch (Vendors → Add Vendor) first.`,
      },
    };
  }
  if (v.approvalStatus !== "approved") {
    return {
      status: 403,
      body: {
        message: `Vendor "${v.vendorName}" is not approved by accounts.`,
        vendorApprovalStatus: v.approvalStatus,
      },
    };
  }
  if (v.status && v.status !== "active") {
    return {
      status: 403,
      body: {
        message: `Vendor "${v.vendorName}" is ${v.status} and cannot be invoiced.`,
        vendorStatus: v.status,
      },
    };
  }
  // ✅ Vendor Master: a vendor frozen / blacklisted / unapproved at GROUP
  // level cannot be invoiced by any branch, whatever its branch row says.
  if (v.vendorMaster) {
    const master = await VendorMaster.findById(v.vendorMaster)
      .select("approvalStatus status")
      .lean();
    if (
      !master ||
      master.approvalStatus !== "approved" ||
      master.status !== "active"
    ) {
      return {
        status: 403,
        body: {
          message: master
            ? `Vendor "${v.vendorName}" is ${master.status !== "active" ? master.status : "not approved"} in the Vendor Master and cannot be invoiced.`
            : `Vendor "${v.vendorName}" is linked to a missing Vendor Master record.`,
          vendorMasterStatus: master?.status,
        },
      };
    }
  }
  return null;
};

const getWorkflowStep = (status) =>
  INVOICE_WORKFLOW.find((w) => w.status === status) || null;
const canActOnInvoice = (role, status) => {
  const step = getWorkflowStep(status);
  return step && step.actingRole === role;
};

// ✅ Derive base amount + total GST from invoice line items
const computeInvoiceTotals = (items = []) => {
  const normalized = (Array.isArray(items) ? items : []).map((it) => {
    const amount = Number(it.amount) || 0;
    const gstPercentage = Number(it.gstPercentage) || 0;
    const gstAmount = +((amount * gstPercentage) / 100).toFixed(2);
    return {
      description: (it.description || "").trim(),
      amount: +amount.toFixed(2),
      gstPercentage,
      gstAmount,
      total: +(amount + gstAmount).toFixed(2),
    };
  });
  const amount = +normalized.reduce((s, i) => s + i.amount, 0).toFixed(2);
  const gstAmount = +normalized.reduce((s, i) => s + i.gstAmount, 0).toFixed(2);
  return { items: normalized, amount, gstAmount };
};

// Existing invoices predate this field. Their cycle is derived at read
// time from the Cluster Head entry already present in approvalHistory.
// Nothing is written.
const withDerivedCycle = (doc) => {
  const obj = doc?.toObject ? doc.toObject() : doc;
  if (!obj) return obj;
  if (obj.paymentCycle?.assigned?.cycleKey) return obj;
  if (obj.status !== INVOICE_STATUS.CLUSTER_APPROVED) return obj;

  const finalApproval = [...(obj.approvalHistory || [])]
    .reverse()
    .find((h) => h.action === "approved" && /cluster/i.test(h.stage || ""));

  const basis = finalApproval?.actionAt || obj.updatedAt;
  if (!basis) return obj;

  // Uses the rule in force on the approval date (old 7th/21st rule for
  // approvals before the Oct 2026 change), so history is not rewritten.
  obj.paymentCycle = obj.paymentCycle || {};
  obj.paymentCycle.assigned = {
    ...derivedStoredShape(basis),
    recordedAt: new Date(basis),
    derived: true, // lets the UI mark it as inferred rather than recorded
  };
  return obj;
};

exports.createInvoice = async (req, res) => {
  try {
    const { branch, vendor, expenseType, invoiceNumber, items } = req.body;

    // ✅ Branch users and Accounts may only raise invoices for their own
    //    assigned branches. (Was never checked; the vendor gate only proved
    //    the vendor belonged to the branch, not the user.)
    if (!branch || !access.canAccessBranch(req, branch)) {
      return res
        .status(403)
        .json({ message: "You can only raise invoices for your assigned branches" });
    }

    const gate = await vendorGate(vendor, branch);
    if (gate) return res.status(gate.status).json(gate.body);

    // ✅ Build payload and derive totals from line items when provided
    const payload = { ...req.body };
    // Priority was removed from the form (Oct 2026). The field stays on the
    // model with its "Normal" default so existing documents are untouched.
    delete payload.priority;
    if (Array.isArray(items) && items.length > 0) {
      const totals = computeInvoiceTotals(items);
      if (totals.amount <= 0) {
        return res.status(400).json({
          message: "Invoice must have at least one item with a value.",
        });
      }
      payload.items = totals.items;
      payload.amount = totals.amount;
      payload.gstAmount = totals.gstAmount;
      // TDS is applied later at accounts approval, so netPayable here = base + GST
      const roundOff = parseFloat(payload.roundOff) || 0;
      payload.roundOff = roundOff;
      payload.netPayable = +(
        totals.amount +
        totals.gstAmount +
        roundOff
      ).toFixed(2);
    }
    const netPayable = payload.netPayable;

    const dupCheck = await checkDuplicateInvoice(
      branch,
      vendor,
      invoiceNumber,
      netPayable,
    );
    if (dupCheck.isDuplicate) {
      return res
        .status(409)
        .json({ message: "Duplicate invoice detected", duplicate: dupCheck });
    }

    const budgetCheck = await checkBudget(branch, expenseType, netPayable);
    if (!budgetCheck.allowed) {
      return res
        .status(400)
        .json({ message: budgetCheck.message, budget: budgetCheck.budget });
    }

    const invoice = await InvoiceRequest.create({
      ...payload,
      createdBy: req.user._id,
      status: INVOICE_STATUS.DRAFT,
      currentStage: "branch",
    });

    await logAction({
      userId: req.user._id,
      action: "CREATE_INVOICE",
      module: "Invoice",
      targetId: invoice._id,
      req,
    });

    res.status(201).json({
      invoice,
      budgetWarning: budgetCheck.warning
        ? { warning: budgetCheck.warning, message: budgetCheck.message }
        : null,
      duplicateWarning: dupCheck.warning
        ? { warning: dupCheck.warning, similarMatches: dupCheck.similarMatches }
        : null,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.submitInvoice = async (req, res) => {
  try {
    const invoice = await InvoiceRequest.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const isBranchUser = req.user.role === ROLES.BRANCH_USER;
    const isAccounts = req.user.role === ROLES.ACCOUNTS;

    // Branch user can only submit their own invoices
    if (
      isBranchUser &&
      invoice.createdBy.toString() !== req.user._id.toString()
    ) {
      return res
        .status(403)
        .json({ message: "You can only submit your own invoices" });
    }
    // Accounts can submit any Rejected invoice (after fixing it) in their
    // branches, and Drafts they created themselves. A branch user's draft
    // stays the branch user's to submit.
    if (isAccounts) {
      if (!access.canAccessBranch(req, invoice.branch)) {
        return res
          .status(403)
          .json({ message: "This invoice is not in your assigned branches" });
      }
      const isOwnDraft =
        invoice.status === "Draft" &&
        invoice.createdBy.toString() === req.user._id.toString();
      if (invoice.status !== "Rejected" && !isOwnDraft) {
        return res.status(403).json({
          message:
            "Accounts can submit their own drafts and resubmit rejected invoices",
        });
      }
    }
    const previousStatus = invoice.status;
    if (!["Draft", "Rejected"].includes(invoice.status)) {
      return res.status(400).json({
        message: `Cannot submit invoice with status: ${invoice.status}`,
      });
    }

    // ── Payment cycle (projected) ──────────────────────────
    // Indicative only. The real cycle is fixed when the Cluster Head
    // gives final approval, so this is recorded purely so we can
    // later compare what the branch expected against what happened.
    const projected = resolvePaymentCycle(new Date(), { projection: true });
    invoice.paymentCycle = invoice.paymentCycle || {};
    invoice.paymentCycle.projected = toStoredShape(projected, {
      recordedAt: new Date(),
    });

    // ✅ Check if branch has any active branch_partner
    const branchPartnerExists = await User.exists({
      role: ROLES.BRANCH_PARTNER,
      branches: invoice.branch,
      status: "active",
    });

    if (branchPartnerExists) {
      // ✅ Normal flow — goes to partner first
      invoice.status = INVOICE_STATUS.SUBMITTED;
      invoice.currentStage = "partner";
      await invoice.save();

      await startSLATracking(invoice._id, INVOICE_STATUS.SUBMITTED);

      const partnerUsers = await User.find({
        role: ROLES.BRANCH_PARTNER,
        branches: invoice.branch,
        status: "active",
      });
      for (const u of partnerUsers) {
        await sendNotificationEmail(
          u.email,
          `📋 New Invoice Request: ${invoice.requestId}`,
          `<p>Invoice <strong>${invoice.requestId}</strong> has been submitted and requires your verification.</p>`,
        ).catch(console.error);
      }
    } else {
      // ✅ No partner — skip directly to accounts
      invoice.status = INVOICE_STATUS.SUBMITTED;
      invoice.currentStage = "accounts";
      invoice.partnerSkipped = true; // flag so UI can show this
      await invoice.save();

      await startSLATracking(invoice._id, "Partner Approved"); // use accounts SLA stage

      const accountsUsers = await User.find({
        role: ROLES.ACCOUNTS,
        status: "active",
        branches: invoice.branch, // ✅ only accounts assigned to this branch
      });
      for (const u of accountsUsers) {
        await sendNotificationEmail(
          u.email,
          `📋 New Invoice Request: ${invoice.requestId}`,
          `<p>Invoice <strong>${invoice.requestId}</strong> has been submitted directly to accounts (no branch partner assigned).</p>`,
        ).catch(console.error);
      }
    }

    // Audit: submit had no log entry at all. Never allowed to turn a
    // committed submit into an error.
    try {
      await logAction({
        userId: req.user._id,
        action: "SUBMIT_INVOICE",
        module: "Invoice",
        targetDoc: invoice,
        statusFrom: previousStatus,
        statusTo: invoice.status,
        req,
      });
    } catch (auditErr) {
      console.error("Submit audit log failed:", auditErr);
    }

    res.json(invoice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.approveInvoice = async (req, res) => {
  try {
    const { remarks, tdsPercentage } = req.body;

    const invoice = await InvoiceRequest.findById(req.params.id).populate(
      "branch vendor createdBy",
    );
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const previousStatus = invoice.status;

    // Declared at function scope so the logAction call at the end can always
    // read them, including on approvals that never reach the cluster-head
    // stage. Both stay null for those.
    let assignedCycleBefore = null;
    let assignedCycle = null;

    // ✅ Handle partner-skipped invoices — accounts can act on Submitted directly
    const partnerSkipped =
      invoice.partnerSkipped && invoice.status === INVOICE_STATUS.SUBMITTED;
    const normalTurn = canActOnInvoice(req.user.role, invoice.status);

    if (!normalTurn && !partnerSkipped) {
      const blockingStep = getWorkflowStep(invoice.status);
      return res.status(403).json({
        message: blockingStep
          ? `Not your turn. Awaiting: ${blockingStep.actingRole.replace(/_/g, " ")}`
          : `Invoice status "${invoice.status}" does not require approval`,
      });
    }

    // ✅ For partner-skipped invoices, use accounts approval step
    const step = partnerSkipped
      ? {
          label: "Accounts Approval (Partner Skipped)",
          nextStatus: INVOICE_STATUS.ACCOUNTS_APPROVED,
          nextStage: "cluster_head",
        }
      : getWorkflowStep(invoice.status);

    if (!step) {
      return res.status(400).json({
        message: `Invoice status "${invoice.status}" has no approval step`,
      });
    }

    const isFinalApproval = step.nextStatus === INVOICE_STATUS.CLUSTER_APPROVED;

    // ✅ Accounts must provide TDS % when approving at their stage
    if (req.user.role === ROLES.ACCOUNTS) {
      if (
        tdsPercentage === undefined ||
        tdsPercentage === null ||
        tdsPercentage === ""
      ) {
        return res.status(400).json({
          message: "TDS percentage is required for accounts approval",
        });
      }
      const tds = parseFloat(tdsPercentage);
      if (isNaN(tds) || tds < 0 || tds > 100) {
        return res.status(400).json({
          message: "TDS percentage must be between 0 and 100",
        });
      }
      // Recalculate TDS amount and net payable from the base amount.
      // Recomputed, never decremented, so a repeat pass cannot compound it.
      invoice.tdsPercentage = tds;
      invoice.tdsAmount = Math.round((invoice.amount * tds) / 100);
      invoice.netPayable = parseFloat(
        (
          invoice.amount +
          (invoice.gstAmount || 0) +
          (invoice.roundOff || 0) -
          invoice.tdsAmount
        ).toFixed(2),
      );
    }

    // ── Payment cycle ──────────────────────────────────────
    // Assigned BEFORE the save, so the status change and the cycle commit
    // together in a single document write. Setting it after the save left a
    // window where a failure downstream stranded the invoice at
    // "Cluster Head Approved" with no cycle and no payment record.
    if (isFinalApproval) {
      assignedCycleBefore = invoice.paymentCycle?.assigned
        ? { ...invoice.paymentCycle.assigned }
        : null;

      const approvedAt = new Date();
      assignedCycle = resolvePaymentCycle(approvedAt);

      invoice.paymentCycle = invoice.paymentCycle || {};
      invoice.paymentCycle.assigned = toStoredShape(assignedCycle, {
        recordedAt: approvedAt,
      });
    }

    invoice.status = step.nextStatus;
    invoice.currentStage = step.nextStage;
    invoice.approvalHistory.push({
      stage: step.label,
      approvedBy: req.user._id,
      action: "approved",
      remarks: remarks || "",
      actionAt: new Date(),
    });

    // Single atomic write: status, stage, history, TDS and payment cycle.
    await invoice.save();

    // ✅ If Cluster Head approves — invoice processing COMPLETE
    if (isFinalApproval) {
      const PaymentProcessing = require("../models/PaymentProcessing");

      // Idempotent: if a payment record already exists for this invoice, a
      // previous attempt got this far. Reuse it rather than creating a
      // duplicate the Accounts team would have to reconcile by hand.
      let payment = invoice.paymentRequest
        ? await PaymentProcessing.findById(invoice.paymentRequest)
        : null;

      if (!payment) {
        payment = await PaymentProcessing.create({
          invoiceRequest: invoice._id,
          branch: invoice.branch._id || invoice.branch,
          vendor: invoice.vendor._id || invoice.vendor,
          totalAmount: invoice.netPayable,
          paidAmount: 0,
          remainingAmount: invoice.netPayable,
          status: "Payment Pending",
          currentStage: "accounts",
          raisedBy: invoice.createdBy._id || invoice.createdBy,
          scheduledDate: assignedCycle.paymentDate,
        });

        invoice.paymentRequest = payment._id;
        await invoice.save();
      }

      // Notify the originator — including which cycle they landed in
      if (invoice.createdBy?.email && invoice.createdBy?.status === "active") {
        await sendNotificationEmail(
          invoice.createdBy.email,
          `✅ Invoice Approved: ${invoice.requestId}`,
          `<p>Your invoice <strong>${invoice.requestId}</strong> has been fully approved by the Cluster Head.</p>
           <p>It has been forwarded to the <strong>Accounts team</strong> for payment processing — no further action is needed from you.</p>
           <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:12px;margin-top:12px;">
             <div style="font-size:13px;color:#0f766e;font-weight:600;">Payment Cycle</div>
             <div style="font-size:15px;color:#0f172a;font-weight:700;margin-top:4px;">
               ${assignedCycle.cycleLabel} &middot; ${assignedCycle.paymentWindowLabel}
             </div>
             <div style="font-size:12px;color:#64748b;margin-top:6px;">
               Payment will be released within this window. If a day in the window
               falls on a Sunday or a bank holiday, payment moves to the next working day.
             </div>
           </div>`,
        ).catch(console.error);
      }

      // ✅ Notify the vendor that their Purchase Order has been approved.
      //    CC the Cluster Head (the approver here) and attach the approved PO.
      if (invoice.vendor?.email) {
        const branchName = invoice.branch?.name || "—";
        const clusterHeadName =
          req.user.name || req.user.email || "Cluster Head";
        const approvalDate = new Date().toLocaleDateString("en-GB");
        const poNumber = invoice.requestId;

        const poDoc =
          invoice.attachments?.find((a) => a.type === "po") ||
          invoice.attachments?.find((a) => a.type === "invoice");
        const attachments = poDoc?.url
          ? [
              {
                filename: poDoc.name || `PO-${invoice.requestId}.pdf`,
                path: poDoc.url,
              },
            ]
          : [];

        await sendNotificationEmail(
          invoice.vendor.email,
          `Purchase Order Approved – ${branchName}`,
          `
            <p>Dear Vendor,</p>
            <p>A new Purchase Order has been approved by our Cluster Head and is now ready for processing.<br/>Please find attached the approved purchase order.</p>
            <p><strong>Purchase Order Details:</strong></p>
            <ul style="margin:8px 0;padding-left:20px;">
              <li><strong>PO Number:</strong> ${poNumber}</li>
              <li><strong>Approved By:</strong> ${clusterHeadName}</li>
              <li><strong>Branch/Unit:</strong> ${branchName}</li>
              <li><strong>Approval Date:</strong> ${approvalDate}</li>
            </ul>
            <p>Kindly acknowledge receipt of this email and initiate the production/dispatch process at the earliest.</p>
            <p>If you have any queries regarding the order, please get in touch with the concerned Cluster Head or the Procurement Team before proceeding.</p>
            <p>We request you to adhere to the agreed timelines and quality standards while fulfilling this order.</p>
            <p>Thank you for your continued support.</p>
            <p>Regards,<br/>Procurement Team<br/>Healing Hands Clinic</p>
          `,
          {
            cc: req.user.email || undefined,
            attachments,
          },
        ).catch(console.error);
      }

      await completeSLATracking(invoice._id);
    } else {
      // Notify next role
      await startSLATracking(invoice._id, step.nextStatus);
      const nextStep = getWorkflowStep(step.nextStatus);
      if (nextStep) {
        // ✅ Branch-scope the notification for branch-bound roles so only
        //    approvers assigned to this invoice's branch are notified.
        const branchScopedNotifyRoles = [
          ROLES.BRANCH_PARTNER,
          ROLES.ACCOUNTS,
          ROLES.CLUSTER_HEAD,
        ];
        const nextUsersQuery = {
          role: nextStep.actingRole,
          status: "active",
        };
        if (branchScopedNotifyRoles.includes(nextStep.actingRole)) {
          nextUsersQuery.branches = invoice.branch._id || invoice.branch;
        }
        const nextUsers = await User.find(nextUsersQuery);

        for (const u of nextUsers) {
          await sendNotificationEmail(
            u.email,
            `✅ Action Required: Invoice ${invoice.requestId}`,
            `<p>Invoice <strong>${invoice.requestId}</strong> is now at your stage: <strong>${nextStep.label}</strong></p>`,
          ).catch(console.error);
        }
      }
    }

    // The approval is already committed by this point. Nothing below may be
    // allowed to turn a successful write into a 500 — that is exactly what
    // produced the "assignedCycleBefore is not defined" banner on an invoice
    // that had in fact been approved.
    try {
      await logAction({
        userId: req.user._id,
        action: "APPROVE_INVOICE",
        module: "Invoice",
        targetDoc: invoice,
        statusFrom: previousStatus,
        statusTo: invoice.status,
        reason: remarks,
        oldValue: assignedCycleBefore
          ? { paymentCycle: assignedCycleBefore }
          : undefined,
        newValue: invoice.paymentCycle?.assigned
          ? { paymentCycle: invoice.paymentCycle.assigned }
          : undefined,
        req,
      });
    } catch (auditErr) {
      console.error("Approval audit log failed:", auditErr);
    }

    res.json(invoice);
  } catch (err) {
    console.error("approveInvoice error:", err);
    res.status(500).json({ message: "Approval failed. Please try again." });
  }
};

exports.rejectInvoice = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim())
      return res.status(400).json({ message: "Rejection reason is required" });

    const invoice = await InvoiceRequest.findById(req.params.id).populate(
      "createdBy",
      "name email status",
    );
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const previousStatus = invoice.status;
    let assignedCycleBefore = invoice.paymentCycle?.assigned
      ? { ...invoice.paymentCycle.assigned }
      : null;

    // ✅ Allow accounts to reject partner-skipped invoices at Submitted stage
    const partnerSkipped =
      invoice.partnerSkipped && invoice.status === INVOICE_STATUS.SUBMITTED;
    const normalTurn = canActOnInvoice(req.user.role, invoice.status);

    if (!normalTurn && !partnerSkipped) {
      const step = getWorkflowStep(invoice.status);
      return res.status(403).json({
        message: step
          ? `Not your turn. Awaiting: ${step.actingRole.replace(/_/g, " ")}`
          : `Invoice status "${invoice.status}" does not allow rejection`,
      });
    }

    const step = partnerSkipped
      ? { label: "Accounts Approval (Partner Skipped)" }
      : getWorkflowStep(invoice.status);

    invoice.status = INVOICE_STATUS.REJECTED;
    invoice.currentStage = "branch";
    invoice.rejectionHistory.push({
      rejectedBy: req.user._id,
      stage: step?.label || invoice.status,
      reason: reason.trim(),
      rejectedAt: new Date(),
    });
    invoice.approvalHistory.push({
      stage: step?.label || invoice.status,
      approvedBy: req.user._id,
      action: "rejected",
      remarks: reason.trim(),
      actionAt: new Date(),
    });

    await invoice.save();
    await completeSLATracking(invoice._id);

    if (invoice.createdBy?.email) {
      await sendNotificationEmail(
        invoice.createdBy.email,
        `❌ Invoice Rejected: ${invoice.requestId}`,
        `
          <p>Invoice <strong>${invoice.requestId}</strong> was rejected at <strong>${step?.label}</strong>.</p>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-top:12px;">
            <strong style="color:#dc2626;">Reason:</strong>
            <p style="margin:4px 0 0;color:#7f1d1d;">${reason.trim()}</p>
          </div>
          <p style="margin-top:12px;">Please edit and resubmit.</p>
        `,
      ).catch(console.error);
    }

    await logAction({
      userId: req.user._id,
      action: "REJECT_INVOICE",
      module: "Invoice",
      targetDoc: invoice,
      statusFrom: previousStatus,
      statusTo: "Rejected",
      reason: reason.trim(),
      req,
    });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await InvoiceRequest.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const isBranchUser = req.user.role === ROLES.BRANCH_USER;
    const isAccounts = req.user.role === ROLES.ACCOUNTS;

    // ── Branch user: can only edit own Draft or Rejected invoices
    if (isBranchUser) {
      if (invoice.createdBy.toString() !== req.user._id.toString()) {
        return res
          .status(403)
          .json({ message: "You can only edit your own invoices" });
      }
      if (!["Draft", "Rejected"].includes(invoice.status)) {
        return res.status(403).json({
          message: `Cannot edit invoice with status: ${invoice.status}`,
        });
      }
    }
    // ── Accounts: can edit Draft, Rejected, or Submitted (before their approval)
    else if (isAccounts) {
      if (!access.canAccessBranch(req, invoice.branch)) {
        return res
          .status(403)
          .json({ message: "This invoice is not in your assigned branches" });
      }
      if (
        !["Draft", "Rejected", "Submitted", "Partner Approved"].includes(
          invoice.status,
        )
      ) {
        return res.status(403).json({
          message: `Accounts cannot edit invoice with status: ${invoice.status}`,
        });
      }
    }
    // ── No other role can edit
    else {
      return res.status(403).json({
        message: "You do not have permission to edit invoices",
      });
    }

    const updateData = { ...req.body };
    // Always strip protected fields
    delete updateData.status;
    delete updateData.approvalHistory;
    delete updateData.rejectionHistory;
    delete updateData.createdBy;
    delete updateData.requestId;
    delete updateData.tdsPercentage; // ✅ TDS only set during approval, not edit
    delete updateData.tdsAmount; // ✅ recalculated during accounts approval
    delete updateData.priority; // removed from the form; existing value kept

    if (Array.isArray(updateData.items) && updateData.items.length > 0) {
      const totals = computeInvoiceTotals(updateData.items);
      updateData.items = totals.items;
      updateData.amount = totals.amount;
      updateData.gstAmount = totals.gstAmount;
    }

    const baseAmt = updateData.amount ?? invoice.amount;
    const gstAmt = updateData.gstAmount ?? invoice.gstAmount;
    const roundOff =
      updateData.roundOff !== undefined
        ? Number(updateData.roundOff) || 0
        : invoice.roundOff || 0;
    updateData.roundOff = roundOff;
    updateData.netPayable = +(baseAmt + gstAmt + roundOff).toFixed(2);

    // ✅ Same vendor rules as createInvoice when the vendor or branch changes.
    const newVendor = updateData.vendor ?? invoice.vendor;
    const newBranch = updateData.branch ?? invoice.branch;
    const vendorChanged = String(newVendor) !== String(invoice.vendor);
    const branchChanged = String(newBranch) !== String(invoice.branch);
    if (branchChanged && !access.canAccessBranch(req, newBranch)) {
      return res
        .status(403)
        .json({ message: "You can only move invoices to your assigned branches" });
    }
    if (vendorChanged || branchChanged) {
      const gate = await vendorGate(newVendor, newBranch);
      if (gate) return res.status(gate.status).json(gate.body);
    }

    // ✅ Duplicate re-check only when the invoice's IDENTITY changes (vendor,
    // branch or invoice number). An amount-only edit is not re-checked: the
    // stored netPayable can differ from the recomputed one (TDS applied at
    // approval, legacy items), and an old duplicate elsewhere must not
    // block routine corrections to this invoice.
    const newNumber = updateData.invoiceNumber ?? invoice.invoiceNumber;
    const numKey = (n) =>
      String(n || "")
        .trim()
        .toUpperCase();
    if (
      vendorChanged ||
      branchChanged ||
      numKey(newNumber) !== numKey(invoice.invoiceNumber)
    ) {
      const dupCheck = await checkDuplicateInvoice(
        newBranch,
        newVendor,
        newNumber,
        updateData.netPayable,
        invoice._id,
      );
      if (dupCheck.isDuplicate) {
        return res
          .status(409)
          .json({ message: "Duplicate invoice detected", duplicate: dupCheck });
      }
    }

    const updated = await InvoiceRequest.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true },
    );

    await logAction({
      userId: req.user._id,
      action: "UPDATE_INVOICE",
      module: "Invoice",
      targetId: invoice._id,
      newValue: { editedBy: req.user.role },
      req,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getInvoices = async (req, res) => {
  try {
    const {
      status,
      branch,
      priority,
      from,
      to,
      search,
      page = 1,
      limit = 20,
    } = req.query;
    const query = {};

    // AFTER
    const branchScopedRoles = [
      ROLES.BRANCH_USER,
      ROLES.BRANCH_PARTNER,
      ROLES.ACCOUNTS,
      ROLES.CLUSTER_HEAD,
    ];

    if (branchScopedRoles.includes(req.user.role)) {
      const assigned = req.user.branches.map((b) => b._id.toString());
      // Restrict to assigned branches; honor an explicit ?branch only if it's one of theirs
      if (branch && assigned.includes(branch.toString())) {
        query.branch = branch;
      } else {
        query.branch = { $in: req.user.branches.map((b) => b._id) };
      }
    } else if (branch) {
      // super_admin / director may filter by any branch
      query.branch = branch;
    }
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999); // include the entire "to" day
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      const rx = { $regex: search.trim(), $options: "i" };
      const vendorIds = await Vendor.find({
        $or: [{ vendorName: rx }, { companyName: rx }],
      }).distinct("_id");
      query.$or = [
        { requestId: rx },
        { invoiceNumber: rx },
        ...(vendorIds.length ? [{ vendor: { $in: vendorIds } }] : []),
      ];
    }

    const total = await InvoiceRequest.countDocuments(query);
    const invoices = await InvoiceRequest.find(query)
      .populate("branch", "name code")
      .populate("vendor", "vendorName companyName")
      .populate("expenseCategory", "name type")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      invoices: invoices.map(withDerivedCycle),
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getInvoiceById = async (req, res) => {
  try {
    const invoice = await InvoiceRequest.findById(req.params.id)
      .populate("branch", "name code location")
      .populate(
        "vendor",
        "vendorName companyName mobile email bankName accountNumber ifscCode accountHolderName vendorCategory",
      )
      .populate("expenseCategory", "name code type")
      .populate("createdBy", "name email role")
      .populate("paymentRequest")
      .populate("approvalHistory.approvedBy", "name email role")
      .populate("rejectionHistory.rejectedBy", "name email role");

    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    const branchScopedRoles = [
      "branch_user",
      "branch_partner",
      "accounts",
      "cluster_head",
    ];
    if (branchScopedRoles.includes(req.user.role)) {
      const allowed = req.user.branches.map((b) => b._id.toString());
      const recordBranch = (invoice.branch?._id || invoice.branch)?.toString();
      if (!allowed.includes(recordBranch)) {
        return res
          .status(403)
          .json({ message: "You do not have access to this record" });
      }
    }
    res.json(withDerivedCycle(invoice));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
