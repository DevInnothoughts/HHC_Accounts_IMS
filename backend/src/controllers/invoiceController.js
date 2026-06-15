const InvoiceRequest = require("../models/InvoiceRequest");
const Vendor = require("../models/Vendor");
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

exports.createInvoice = async (req, res) => {
  try {
    const { branch, vendor, expenseType, invoiceNumber, items } = req.body;

    const vendorDoc = await Vendor.findById(vendor);
    if (!vendorDoc)
      return res.status(404).json({ message: "Vendor not found" });
    if (vendorDoc.approvalStatus !== "approved") {
      return res.status(403).json({
        message: `Vendor "${vendorDoc.vendorName}" is not approved by accounts.`,
        vendorApprovalStatus: vendorDoc.approvalStatus,
      });
    }

    // ✅ Build payload and derive totals from line items when provided
    const payload = { ...req.body };
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
      payload.netPayable = +(totals.amount + totals.gstAmount).toFixed(2);
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
    // Accounts can submit any Rejected invoice (after fixing it)
    if (isAccounts && invoice.status !== "Rejected") {
      return res.status(403).json({
        message: "Accounts can only resubmit rejected invoices",
      });
    }
    if (!["Draft", "Rejected"].includes(invoice.status)) {
      return res.status(400).json({
        message: `Cannot submit invoice with status: ${invoice.status}`,
      });
    }

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
      });
      for (const u of accountsUsers) {
        await sendNotificationEmail(
          u.email,
          `📋 New Invoice Request: ${invoice.requestId}`,
          `<p>Invoice <strong>${invoice.requestId}</strong> has been submitted directly to accounts (no branch partner assigned).</p>`,
        ).catch(console.error);
      }
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

    // ✅ Handle partner-skipped invoices — accounts can act on Submitted directly
    // ✅ Handle partner-skipped invoices — accounts can act on Submitted directly
    const partnerSkipped =
      invoice.partnerSkipped && invoice.status === INVOICE_STATUS.SUBMITTED;
    const normalTurn = canActOnInvoice(req.user.role, invoice.status);

    if (!normalTurn && !partnerSkipped) {
      const step = getWorkflowStep(invoice.status);
      return res.status(403).json({
        message: step
          ? `Not your turn. Awaiting: ${step.actingRole.replace(/_/g, " ")}`
          : `Invoice status "${invoice.status}" does not require approval`,
      });
    }

    // ✅ For partner-skipped invoices, use accounts approval step
    const step = partnerSkipped
      ? {
          label: "Accounts Approval (Partner Skipped)",
          nextStatus: "Accounts Approved",
          nextStage: "cluster_head",
        }
      : getWorkflowStep(invoice.status);

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
      // Recalculate TDS amount and net payable based on base amount
      invoice.tdsPercentage = tds;
      invoice.tdsAmount = parseFloat(((invoice.amount * tds) / 100).toFixed(2));
      invoice.netPayable = parseFloat(
        (invoice.amount + (invoice.gstAmount || 0) - invoice.tdsAmount).toFixed(
          2,
        ),
      );
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

    await invoice.save();

    // ✅ If Cluster Head approves — invoice processing COMPLETE
    // Create a PaymentProcessing record automatically in 'Payment Pending' state
    if (step.nextStatus === "Cluster Head Approved") {
      const PaymentProcessing = require("../models/PaymentProcessing");
      const payment = await PaymentProcessing.create({
        invoiceRequest: invoice._id,
        branch: invoice.branch._id || invoice.branch,
        vendor: invoice.vendor._id || invoice.vendor,
        totalAmount: invoice.netPayable, // ✅ store total
        paymentAmount: invoice.netPayable,
        paidAmount: 0,
        remainingAmount: invoice.netPayable,
        status: "Payment Pending",
        currentStage: "branch",
        raisedBy: invoice.createdBy._id || invoice.createdBy,
      });

      // Link payment back to invoice
      invoice.paymentRequest = payment._id;
      await invoice.save();

      // Notify branch user invoice is fully approved
      if (invoice.createdBy?.email) {
        await sendNotificationEmail(
          invoice.createdBy.email,
          `✅ Invoice Approved: ${invoice.requestId}`,
          `
            <p>Your invoice <strong>${invoice.requestId}</strong> has been fully approved by the Cluster Head.</p>
            <p>You can now raise a payment request for this invoice in the <strong>Payment Processing</strong> section.</p>
          `,
        ).catch(console.error);
      }

      await completeSLATracking(invoice._id);
    } else {
      // Notify next role
      await startSLATracking(invoice._id, step.nextStatus);
      const nextStep = getWorkflowStep(step.nextStatus);
      if (nextStep) {
        const nextUsers = await User.find({
          role: nextStep.actingRole,
          status: "active",
        });
        for (const u of nextUsers) {
          await sendNotificationEmail(
            u.email,
            `✅ Action Required: Invoice ${invoice.requestId}`,
            `<p>Invoice <strong>${invoice.requestId}</strong> is now at your stage: <strong>${nextStep.label}</strong></p>`,
          ).catch(console.error);
        }
      }
    }

    await logAction({
      userId: req.user._id,
      action: "APPROVE_INVOICE",
      module: "Invoice",
      targetId: invoice._id,
      req,
    });
    res.json(invoice);
  } catch (err) {
    console.error("approveInvoice error:", err); // ← add this
    res.status(500).json({ message: err.message });
  }
};

exports.rejectInvoice = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim())
      return res.status(400).json({ message: "Rejection reason is required" });

    const invoice = await InvoiceRequest.findById(req.params.id).populate(
      "createdBy",
      "name email",
    );
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

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
      targetId: invoice._id,
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

    // ✅ Recompute base/GST/net from edited line items
    if (Array.isArray(updateData.items) && updateData.items.length > 0) {
      const totals = computeInvoiceTotals(updateData.items);
      updateData.items = totals.items;
      updateData.amount = totals.amount;
      updateData.gstAmount = totals.gstAmount;
      updateData.netPayable = +(totals.amount + totals.gstAmount).toFixed(2);
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
      page = 1,
      limit = 20,
    } = req.query;
    const query = {};

    // AFTER
    const branchScopedRoles = [
      ROLES.BRANCH_USER,
      ROLES.BRANCH_PARTNER,
      ROLES.ACCOUNTS,
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
      query.createdAt = {
        ...(from && { $gte: new Date(from) }),
        ...(to && { $lte: new Date(to) }),
      };
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
      invoices,
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
    const branchScopedRoles = ["branch_user", "branch_partner", "accounts"];
    if (branchScopedRoles.includes(req.user.role)) {
      const allowed = req.user.branches.map((b) => b._id.toString());
      const recordBranch = (invoice.branch?._id || invoice.branch)?.toString();
      if (!allowed.includes(recordBranch)) {
        return res
          .status(403)
          .json({ message: "You do not have access to this record" });
      }
    }
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
