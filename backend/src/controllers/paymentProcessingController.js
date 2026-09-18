const mongoose = require("mongoose");
const PaymentProcessing = require("../models/PaymentProcessing");
const InvoiceRequest = require("../models/InvoiceRequest");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const ExcelJS = require("exceljs");
const {
  PAYMENT_STATUS,
  PAYMENT_WORKFLOW,
  ROLES,
} = require("../config/constants");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");
const {
  buildFedOneWorkbook,
  validateForFedOne,
  resolveReference,
} = require("../services/fedOneExcelService");

// "Payment Remark" cell = invoice remarks + description.
// Remarks are frequently left blank, so the description keeps the column useful.
const buildRemarkText = (invoice) => {
  const parts = [invoice?.remarks, invoice?.description]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  // If the same text was entered in both fields, show it once
  const unique = parts.filter(
    (v, i) => parts.findIndex((p) => p.toLowerCase() === v.toLowerCase()) === i,
  );

  return unique.length ? unique.join(" | ") : "—";
};

const getPaymentWorkflowStep = (status) =>
  PAYMENT_WORKFLOW.find((w) => w.status === status) || null;

// Statuses that mean money has already gone out — kept out of the
// "Payment Requests" list, which only shows in-flight work.
const PROCESSED_STATUSES = [
  PAYMENT_STATUS.PROCESSED,
  PAYMENT_STATUS.PARTIALLY_PAID,
  PAYMENT_STATUS.FULLY_PAID,
];

// Payment statuses that still need action on the "Approved Invoices" tab.
const RAISEABLE_STATUSES = [
  PAYMENT_STATUS.PENDING, // nothing raised yet
  PAYMENT_STATUS.PARTIALLY_PAID, // part raised & paid, balance outstanding
  PAYMENT_STATUS.REJECTED, // bounced back, needs re-raising
];

// Bounded id lookup. NOTE: `.limit(n).distinct()` does NOT work — chaining
// distinct issues a distinct command, which has no limit option, so the cap is
// silently ignored. find + select + limit is the working form.
const limitedIds = async (Model, filter, cap = 500) => {
  const docs = await Model.find(filter).select("_id").limit(cap).lean();
  return docs.map((d) => d._id);
};

// find() casts strings to ObjectId from the schema; aggregate() does NOT.
// Anything that feeds both paths has to be cast explicitly.
const toId = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null;

// Page size guard: prevents a hand-edited ?limit=100000 from pulling the
// whole collection now that there is no default date window.
const clampPaging = ({ page, limit }, fallback = 20) => ({
  currentPage: Math.max(Number(page) || 1, 1),
  perPage: Math.min(Math.max(Number(limit) || fallback, 1), 100),
});

// ── List approved invoices available for payment ───────────
exports.getApprovedInvoicesForPayment = async (req, res) => {
  try {
    const { branch, search, from, to, paymentStatus } = req.query;
    const { currentPage, perPage } = clampPaging(req.query);
    const query = {
      status: "Cluster Head Approved",
      paymentRequest: { $ne: null }, // has a payment record
    };

    // AFTER
    const branchScopedRoles = [
      ROLES.BRANCH_USER,
      ROLES.BRANCH_PARTNER,
      ROLES.ACCOUNTS,
      ROLES.CLUSTER_HEAD,
    ];
    if (branchScopedRoles.includes(req.user.role)) {
      const assigned = req.user.branches.map((b) => b._id.toString());
      if (branch && assigned.includes(branch.toString())) {
        query.branch = toId(branch);
      } else {
        query.branch = { $in: req.user.branches.map((b) => b._id) };
      }
    } else if (branch) {
      query.branch = toId(branch);
    }

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Snapshot before the payment-status filter narrows things: this is the
    // "All" set, and the denominator every chip count is measured against.
    const baseQuery = { ...query };

    // Same scope but WITHOUT the "has a payment record" precondition. Approved
    // invoices with no linked PaymentProcessing row have always been invisible
    // in this module, which is the usual reason its total is lower than the
    // approved-invoice count shown elsewhere (e.g. the dashboard).
    const scopeQuery = { ...query };
    delete scopeQuery.paymentRequest;

    // ── Payment-status filter (quick filters on Approved Invoices) ──────
    // The status lives on the linked PaymentProcessing record, so resolve the
    // matching payment ids first, then constrain the invoice query by them.
    if (paymentStatus && RAISEABLE_STATUSES.includes(paymentStatus)) {
      const payIds = await limitedIds(
        PaymentProcessing,
        {
          status: paymentStatus,
          ...(query.branch ? { branch: query.branch } : {}),
        },
        2000,
      );
      // An empty $in returns nothing, which is the correct answer here.
      query.paymentRequest = { $in: payIds };
    }

    if (search) {
      const rx = { $regex: search.trim(), $options: "i" };
      // Capped: without a date window a broad term could otherwise build a
      // huge in-memory $in array.
      const vendorIds = await limitedIds(Vendor, {
        $or: [{ vendorName: rx }, { companyName: rx }],
      });
      query.$or = [
        { requestId: rx },
        { invoiceNumber: rx },
        ...(vendorIds.length ? [{ vendor: { $in: vendorIds } }] : []),
      ];
    }

    const total = await InvoiceRequest.countDocuments(query);

    // Chip counts. Computed from the unfiltered base set so they stay stable
    // whichever chip is active, and so the parts visibly sum to the whole.
    let statusCounts = null;
    let baseTotal = total;
    let unlinked = 0;
    let approvedWithoutPaymentRecord = 0;
    if (req.query.withCounts === "true") {
      const [agg, baseCount, orphanCount] = await Promise.all([
        InvoiceRequest.aggregate([
          { $match: baseQuery },
          {
            $lookup: {
              from: "paymentprocessings",
              localField: "paymentRequest",
              foreignField: "_id",
              as: "pay",
            },
          },
          { $unwind: "$pay" },
          { $group: { _id: "$pay.status", n: { $sum: 1 } } },
        ]),
        InvoiceRequest.countDocuments(baseQuery),
        InvoiceRequest.countDocuments({
          ...scopeQuery,
          paymentRequest: null,
        }),
      ]);
      approvedWithoutPaymentRecord = orphanCount;
      statusCounts = agg.reduce((acc, r) => {
        acc[r._id] = r.n;
        return acc;
      }, {});
      baseTotal = baseCount;
      // Invoices whose paymentRequest points at a missing payment record.
      // Should be 0; a non-zero value means the counts won't sum to the total.
      unlinked =
        baseCount - Object.values(statusCounts).reduce((s, n) => s + n, 0);
      if (unlinked !== 0) {
        console.warn(
          `[approved-invoices] ${unlinked} invoice(s) have a dangling paymentRequest reference`,
        );
      }
    }

    const invoices = await InvoiceRequest.find(query)
      .populate("branch", "name code bankAccounts")
      .populate(
        "vendor",
        "vendorName companyName accountNumber ifscCode bankName accountHolderName",
      )
      .populate("paymentRequest")
      .populate("createdBy", "name email")
      .sort({ updatedAt: -1 })
      .skip((currentPage - 1) * perPage)
      .limit(perPage);

    res.json({
      invoices,
      total, // rows matching the active filter
      baseTotal, // rows ignoring the payment-status filter ("All")
      statusCounts, // { "Payment Pending": n, ... } or null
      unlinked, // paymentRequest set but the payment row is gone
      approvedWithoutPaymentRecord, // approved, but no payment row was created
      page: currentPage,
      pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── List payment processing records ───────────────────────
exports.getPayments = async (req, res) => {
  try {
    const {
      status,
      search,
      branch,
      from,
      to,
      processedOnly,
      excludeProcessed,
    } = req.query;
    const { currentPage, perPage } = clampPaging(req.query);
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
      if (branch && assigned.includes(branch.toString())) {
        query.branch = branch;
      } else {
        query.branch = { $in: req.user.branches.map((b) => b._id) };
      }
    } else if (branch) {
      query.branch = branch;
    }

    const validStatus =
      status && Object.values(PAYMENT_STATUS).includes(status) ? status : null;

    if (processedOnly === "true") {
      query.utrNumber = { $ne: null, $exists: true };
      if (validStatus) query.status = validStatus; // combinable
    } else if (excludeProcessed === "true") {
      // "Payment Requests" tab: in-flight only. Filtered here rather than on
      // the client so `total` and the page slice agree.
      query.status = validStatus
        ? validStatus
        : { $nin: [PAYMENT_STATUS.PENDING, ...PROCESSED_STATUSES] };
    } else if (validStatus) {
      query.status = validStatus;
    } else {
      query.status = { $ne: PAYMENT_STATUS.PENDING };
    }

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      const rx = { $regex: search.trim(), $options: "i" };
      // Capped: see note on limitedIds.
      const [vendorIds, invoiceIds] = await Promise.all([
        limitedIds(Vendor, { $or: [{ vendorName: rx }, { companyName: rx }] }),
        limitedIds(InvoiceRequest, {
          $or: [{ requestId: rx }, { invoiceNumber: rx }],
        }),
      ]);
      query.$or = [
        { paymentId: rx },
        { utrNumber: rx },
        ...(vendorIds.length ? [{ vendor: { $in: vendorIds } }] : []),
        ...(invoiceIds.length ? [{ invoiceRequest: { $in: invoiceIds } }] : []),
      ];
    }

    const total = await PaymentProcessing.countDocuments(query);
    const payments = await PaymentProcessing.find(query)
      .populate(
        "invoiceRequest",
        "requestId invoiceNumber invoiceDate netPayable",
      )
      .populate("branch", "name code bankAccounts")
      .populate("vendor", "vendorName companyName")
      .populate("raisedBy", "name email")
      .sort({ createdAt: -1 })
      .skip((currentPage - 1) * perPage)
      .limit(perPage);

    res.json({
      payments,
      total,
      page: currentPage,
      pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Branch raises payment request for approved invoice ─────
exports.raisePayment = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { paymentRemarks, scheduledDate, paymentAmount, paymentType } =
      req.body;

    const invoice = await InvoiceRequest.findById(invoiceId).populate(
      "vendor branch createdBy",
    );
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    if (invoice.status !== "Cluster Head Approved") {
      return res.status(403).json({
        message: "Invoice must be fully approved before raising payment",
      });
    }

    const payment = await PaymentProcessing.findById(invoice.paymentRequest);
    if (!payment)
      return res.status(404).json({ message: "Payment record not found" });

    // ✅ Block if fully paid
    if (payment.status === "Fully Paid") {
      return res.status(400).json({
        message: "Payment is already fully cleared for this invoice",
      });
    }

    // ✅ Block if active installment pending
    const activeStatuses = [
      "Payment Raised",
      "Accounts Approved",
      "Excel Generated",
    ];
    const hasActiveInstallment = payment.installments.some((i) =>
      activeStatuses.includes(i.status),
    );
    if (hasActiveInstallment) {
      return res.status(400).json({
        message:
          "A payment is already in progress. Wait for it to be processed before raising another.",
      });
    }

    const totalAmount = payment.totalAmount || invoice.netPayable;
    const remaining = totalAmount - (payment.paidAmount || 0);
    const amount = parseFloat(paymentAmount) || remaining;

    if (amount <= 0) {
      return res.status(400).json({ message: "Invalid payment amount" });
    }
    if (amount > remaining) {
      return res.status(400).json({
        message: `Amount cannot exceed remaining balance of ₹${remaining.toLocaleString("en-IN")}`,
      });
    }

    const isPartial = amount < remaining;
    const installmentNumber = payment.installments.length + 1;
    const installmentId = `${payment.paymentId}-${installmentNumber}`;

    const installment = {
      amount,
      paymentId: installmentId,
      status: "Raised",
      raisedBy: req.user._id,
      raisedAt: new Date(),
      paymentRemarks: paymentRemarks || "",
      scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
    };

    payment.paymentType = isPartial ? "partial" : "full";
    payment.paymentAmount = amount;
    payment.paymentRemarks = paymentRemarks || "";
    payment.scheduledDate = scheduledDate ? new Date(scheduledDate) : null;
    payment.raisedBy = req.user._id;
    payment.totalAmount = payment.totalAmount || invoice.netPayable; // ✅ ensure required field is set
    payment.remainingAmount = payment.totalAmount - (payment.paidAmount || 0);
    payment.installments.push(installment);
    payment.status = "Payment Raised";
    payment.currentStage = "accounts";
    await payment.save();

    // Notify accounts
    const accountsUsers = await User.find({
      role: ROLES.ACCOUNTS,
      status: "active",
      branches: invoice.branch, // ✅ only accounts assigned to this branch
    });
    for (const u of accountsUsers) {
      await sendNotificationEmail(
        u.email,
        `💳 ${isPartial ? "Partial " : ""}Payment Request Raised: ${installmentId}`,
        `
          <p>A ${isPartial ? "<strong>partial</strong>" : "full"} payment request has been raised.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:12px;">
            <tr><td style="padding:6px;color:#666;">Installment ID</td><td style="padding:6px;font-weight:600;">${installmentId}</td></tr>
            <tr><td style="padding:6px;color:#666;">Invoice</td><td style="padding:6px;font-weight:600;">${invoice.requestId}</td></tr>
            <tr><td style="padding:6px;color:#666;">Vendor</td><td style="padding:6px;font-weight:600;">${invoice.vendor?.vendorName}</td></tr>
            <tr><td style="padding:6px;color:#666;">Amount</td><td style="padding:6px;font-weight:600;">₹${amount.toLocaleString("en-IN")}</td></tr>
            ${isPartial ? `<tr><td style="padding:6px;color:#666;">Remaining after this</td><td style="padding:6px;font-weight:600;color:#d97706;">₹${(remaining - amount).toLocaleString("en-IN")}</td></tr>` : ""}
          </table>
        `,
      ).catch(console.error);
    }

    await logAction({
      userId: req.user._id,
      action: "RAISE_PAYMENT",
      module: "Payment",
      targetId: payment._id,
      req,
    });
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Accounts approves payment ──────────────────────────────
exports.approvePayment = async (req, res) => {
  try {
    const { remarks } = req.body;
    const payment = await PaymentProcessing.findById(req.params.id).populate({
      path: "invoiceRequest",
      populate: { path: "vendor branch createdBy" },
    });

    if (!payment) return res.status(404).json({ message: "Payment not found" });

    const step = getPaymentWorkflowStep(payment.status);
    if (!step || step.actingRole !== req.user.role) {
      return res.status(403).json({
        message: step
          ? `Not your turn. Awaiting: ${step.actingRole.replace(/_/g, " ")}`
          : `Payment status "${payment.status}" does not require approval`,
      });
    }

    payment.status = step.nextStatus;
    payment.currentStage = step.nextStage;
    payment.approvalHistory.push({
      stage: step.label,
      approvedBy: req.user._id,
      action: "approved",
      remarks: remarks || "",
      actionAt: new Date(),
    });

    await payment.save();

    // Notify branch user
    const invoice = payment.invoiceRequest;
    const branchUser = invoice?.createdBy;
    if (branchUser?.email) {
      await sendNotificationEmail(
        branchUser.email,
        `✅ Payment Approved: ${payment.paymentId}`,
        `<p>Payment <strong>${payment.paymentId}</strong> for invoice <strong>${invoice.requestId}</strong> has been approved. Excel will be generated shortly.</p>`,
      ).catch(console.error);
    }

    await logAction({
      userId: req.user._id,
      action: "APPROVE_PAYMENT",
      module: "Payment",
      targetId: payment._id,
      req,
    });
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Accounts rejects payment ───────────────────────────────
exports.rejectPayment = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim())
      return res.status(400).json({ message: "Rejection reason is required" });

    const payment = await PaymentProcessing.findById(req.params.id).populate({
      path: "invoiceRequest",
      populate: { path: "createdBy", select: "name email" },
    });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (req.user.role !== ROLES.ACCOUNTS) {
      return res
        .status(403)
        .json({ message: "Only accounts team can reject payments" });
    }

    payment.status = "Payment Rejected";
    payment.currentStage = "branch";
    payment.rejectionHistory.push({
      rejectedBy: req.user._id,
      stage: "Accounts Final Approval",
      reason: reason.trim(),
      rejectedAt: new Date(),
    });
    payment.approvalHistory.push({
      stage: "Accounts Final Approval",
      approvedBy: req.user._id,
      action: "rejected",
      remarks: reason.trim(),
      actionAt: new Date(),
    });

    await payment.save();

    const branchUser = payment.invoiceRequest?.createdBy;
    if (branchUser?.email) {
      await sendNotificationEmail(
        branchUser.email,
        `❌ Payment Rejected: ${payment.paymentId}`,
        `
          <p>Payment <strong>${payment.paymentId}</strong> was rejected.</p>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-top:12px;">
            <strong style="color:#dc2626;">Reason:</strong>
            <p style="margin:4px 0 0;color:#7f1d1d;">${reason.trim()}</p>
          </div>
        `,
      ).catch(console.error);
    }

    await logAction({
      userId: req.user._id,
      action: "REJECT_PAYMENT",
      module: "Payment",
      targetId: payment._id,
      req,
    });
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Generate Excel for bank payment ───────────────────────
exports.generateExcel = async (req, res) => {
  try {
    const payment = await PaymentProcessing.findById(req.params.id)
      .populate({
        path: "invoiceRequest",
        populate: { path: "vendor branch expenseCategory" },
      })
      .populate("raisedBy", "name email");

    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (!["Accounts Approved", "Excel Generated"].includes(payment.status)) {
      return res.status(400).json({
        message: `Excel can only be generated after Accounts Approval. Current status: ${payment.status}`,
      });
    }
    if (req.user.role !== ROLES.ACCOUNTS) {
      return res
        .status(403)
        .json({ message: "Only accounts team can generate payment Excel" });
    }

    const invoice = payment.invoiceRequest;
    const vendor = invoice?.vendor;
    const branch = invoice?.branch;

    // Payment remark column = invoice remarks, falling back to / combined with description
    const paymentRemark = buildRemarkText(invoice); // was: invoice?.remarks || "—"

    const isRegeneration = payment.status === PAYMENT_STATUS.EXCEL_GENERATED;
    if (!isRegeneration) {
      payment.status = PAYMENT_STATUS.EXCEL_GENERATED;
      payment.currentStage = "closed";
      payment.approvalHistory.push({
        stage: "Excel Generation",
        approvedBy: req.user._id,
        action: "approved",
        remarks: "Excel generated for bank payment",
        actionAt: new Date(),
      });
    } else {
      payment.approvalHistory.push({
        stage: "Excel Regeneration",
        approvedBy: req.user._id,
        action: "approved",
        remarks: "Excel regenerated for bank payment",
        actionAt: new Date(),
      });
    }
    payment.excelGeneratedAt = new Date();

    // ── Build Excel using ExcelJS ──────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PMS — Healing Hands Clinic";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Payment Instruction", {
      pageSetup: { paperSize: 9, orientation: "landscape" },
    });

    // ── Header styling ─────────────────────────────────────
    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A3C6E" },
    };
    const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    const borderStyle = { style: "thin", color: { argb: "FFD1D5DB" } };
    const allBorders = {
      top: borderStyle,
      left: borderStyle,
      bottom: borderStyle,
      right: borderStyle,
    };

    // Title row
    sheet.mergeCells("A1:K1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = "HEALING HANDS CLINIC — PAYMENT INSTRUCTION";
    titleCell.font = { bold: true, size: 14, color: { argb: "FF1A3C6E" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;

    // Subtitle row
    sheet.mergeCells("A2:K2");
    const subCell = sheet.getCell("A2");
    subCell.value = `Payment ID: ${payment.paymentId}  |  Invoice: ${invoice?.requestId}  |  Date: ${new Date().toLocaleDateString("en-GB")}`;
    subCell.font = { size: 10, color: { argb: "FF6B7280" } };
    subCell.alignment = { horizontal: "center" };
    sheet.getRow(2).height = 18;

    sheet.addRow([]); // spacer

    // Column headers
    const headers = [
      "Payment ID",
      "Invoice No.",
      "Vendor Name",
      "Account Holder",
      "Bank Name",
      "Account Number",
      "IFSC Code",
      "Payment Mode",
      "Amount (₹)",
      "Branch",
      "Payment Remark",
    ];

    const headerRow = sheet.addRow(headers);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = allBorders;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    // Data row
    const dataRow = sheet.addRow([
      payment.paymentId,
      invoice?.invoiceNumber,
      vendor?.vendorName,
      vendor?.accountHolderName,
      vendor?.bankName,
      vendor?.accountNumber,
      vendor?.ifscCode,
      payment.paymentMode,
      payment.paymentAmount,
      branch?.name,
      paymentRemark,
    ]);

    dataRow.height = 20;
    dataRow.eachCell((cell, colNumber) => {
      cell.border = allBorders;
      cell.alignment = {
        horizontal: colNumber === 9 ? "right" : "left",
        vertical: "middle",
      };
      if (colNumber === 9) {
        cell.numFmt = "₹#,##0.00";
        cell.font = { bold: true, color: { argb: "FF16A34A" } };
      }
    });

    dataRow.getCell(11).alignment = {
      horizontal: "left",
      vertical: "middle",
      wrapText: true,
    };

    sheet.addRow([]); // spacer

    // Summary section
    const addSummaryRow = (label, value, bold = false) => {
      sheet.mergeCells(`A${sheet.rowCount + 1}:H${sheet.rowCount + 1}`);
      const row = sheet.addRow([label, "", "", "", "", "", "", "", value]);
      row.getCell(1).font = { bold, size: 10 };
      row.getCell(9).font = { bold, size: 10 };
      return row;
    };

    addSummaryRow(
      "Invoice Amount:",
      `₹${invoice?.amount?.toLocaleString("en-IN")}`,
    );
    addSummaryRow(
      "GST Amount:",
      `₹${invoice?.gstAmount?.toLocaleString("en-IN")}`,
    );
    addSummaryRow(
      "Round Off:",
      `${(invoice?.roundOff || 0) < 0 ? "− " : "+ "}₹${Math.abs(invoice?.roundOff || 0).toLocaleString("en-IN")}`,
    );
    addSummaryRow(
      "TDS Deduction:",
      `₹${invoice?.tdsAmount?.toLocaleString("en-IN")}`,
    );
    addSummaryRow(
      "Net Payable:",
      `₹${payment.paymentAmount?.toLocaleString("en-IN")}`,
      true,
    );

    sheet.addRow([]); // spacer

    // Approval info
    sheet.addRow([
      "Approved By:",
      req.user.name || req.user.email,
      "",
      "",
      "Date:",
      new Date().toLocaleDateString("en-GB"),
    ]);
    if (payment.paymentRemarks) {
      sheet.addRow(["Remarks:", payment.paymentRemarks]);
    }

    // Column widths
    sheet.columns = [
      { width: 14 },
      { width: 16 },
      { width: 22 },
      { width: 22 },
      { width: 18 },
      { width: 20 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 18 },
      { width: 34 },
    ];

    await payment.save();

    await logAction({
      userId: req.user._id,
      action: "GENERATE_PAYMENT_EXCEL",
      module: "Payment",
      targetId: payment._id,
      req,
    });

    // Stream Excel to browser
    const fileName = `Payment_${payment.paymentId}_${Date.now()}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel generation error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getPaymentById = async (req, res) => {
  try {
    const payment = await PaymentProcessing.findById(req.params.id)
      .populate({
        path: "invoiceRequest",
        populate: [
          {
            path: "vendor",
            select:
              "vendorName companyName mobile email bankName accountNumber ifscCode accountHolderName vendorCategory",
          },
          { path: "branch", select: "name code location" },
          { path: "expenseCategory", select: "name code type" },
          { path: "createdBy", select: "name email role" },
        ],
      })
      .populate("raisedBy", "name email role")
      .populate("approvalHistory.approvedBy", "name email role")
      .populate("rejectionHistory.rejectedBy", "name email role");

    if (!payment) return res.status(404).json({ message: "Payment not found" });
    const branchScopedRoles = [
      "branch_user",
      "branch_partner",
      "accounts",
      "cluster_head",
    ];
    if (branchScopedRoles.includes(req.user.role)) {
      const allowed = req.user.branches.map((b) => b._id.toString());
      const recordBranch = (payment.branch?._id || payment.branch)?.toString();
      if (!allowed.includes(recordBranch)) {
        return res
          .status(403)
          .json({ message: "You do not have access to this record" });
      }
    }
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/payments/bulk-excel
// Body: { paymentIds: ["id1", "id2", ...] }
exports.bulkGenerateExcel = async (req, res) => {
  try {
    const { paymentIds } = req.body;
    if (!paymentIds || paymentIds.length === 0)
      return res.status(400).json({ message: "No payment IDs provided" });

    const payments = await PaymentProcessing.find({
      _id: { $in: paymentIds },
      status: { $in: ["Accounts Approved", "Excel Generated"] },
    })
      .populate(
        "invoiceRequest",
        "requestId invoiceNumber invoiceDate amount gstAmount tdsAmount roundOff netPayable description remarks",
      )
      .populate(
        "vendor",
        "vendorName companyName accountHolderName bankName accountNumber ifscCode panNumber",
      )
      .populate("branch", "name code bankAccounts")
      .populate("raisedBy", "name");

    if (payments.length === 0)
      return res.status(404).json({ message: "No eligible payments found" });

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "HHC Accounts IMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Bulk Payments", {
      pageSetup: { paperSize: 9, orientation: "landscape" },
    });

    // ── Header styling ──────────────────────────────────
    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A3C6E" },
    };
    const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    const borderStyle = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };

    // ── Columns ─────────────────────────────────────────
    sheet.columns = [
      { header: "Payment ID", key: "paymentId", width: 15 },
      { header: "Invoice ID", key: "invoiceId", width: 14 },
      { header: "Invoice No.", key: "invoiceNumber", width: 18 },
      { header: "Invoice Date", key: "invoiceDate", width: 14 },
      { header: "Branch", key: "branch", width: 18 },
      { header: "Vendor Name", key: "vendorName", width: 22 },
      { header: "Company", key: "company", width: 20 },
      { header: "PAN", key: "pan", width: 14 },
      { header: "Account Holder", key: "accountHolder", width: 22 },
      { header: "Bank Name", key: "bankName", width: 18 },
      { header: "Account No.", key: "accountNumber", width: 20 },
      { header: "IFSC Code", key: "ifscCode", width: 14 },
      { header: "Base Amount (₹)", key: "amount", width: 16 },
      { header: "GST (₹)", key: "gst", width: 12 },
      { header: "Round Off (₹)", key: "roundOff", width: 14 }, // ✅ added
      { header: "TDS (₹)", key: "tds", width: 12 },
      { header: "Net Payable (₹)", key: "netPayable", width: 16 },
      { header: "Payment Amount (₹)", key: "paymentAmount", width: 18 },
      { header: "Scheduled Date", key: "scheduledDate", width: 16 },
      { header: "Raise Remark", key: "remarks", width: 24 },
      { header: "Payment Remark", key: "paymentRemark", width: 40 },
      { header: "Status", key: "status", width: 18 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = borderStyle;
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
    });
    headerRow.height = 30;

    // ── Data rows ────────────────────────────────────────
    payments.forEach((pay, idx) => {
      const inv = pay.invoiceRequest;
      const vendor = pay.vendor;

      const row = sheet.addRow({
        paymentId: pay.paymentId,
        invoiceId: inv?.requestId || "—",
        invoiceNumber: inv?.invoiceNumber || "—",
        invoiceDate: inv?.invoiceDate
          ? new Date(inv.invoiceDate).toLocaleDateString("en-GB")
          : "—",
        branch: pay.branch?.name || "—",
        vendorName: vendor?.vendorName || "—",
        company: vendor?.companyName || "—",
        pan: vendor?.panNumber || "—",
        accountHolder: vendor?.accountHolderName || "—",
        bankName: vendor?.bankName || "—",
        accountNumber: vendor?.accountNumber || "—",
        ifscCode: vendor?.ifscCode || "—",
        amount: inv?.amount || 0,
        gst: inv?.gstAmount || 0,
        roundOff: inv?.roundOff || 0,
        tds: inv?.tdsAmount || 0,
        netPayable: inv?.netPayable || 0,
        paymentAmount: pay.paymentAmount || 0,
        scheduledDate: pay.scheduledDate
          ? new Date(pay.scheduledDate).toLocaleDateString("en-GB")
          : "—",
        remarks: pay.paymentRemarks || "—", // "Raise Remark" — unchanged
        paymentRemark: buildRemarkText(inv), // was: inv?.remarks || "—"
        status: pay.status,
      });

      // Alternate row background
      const rowFill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" },
      };

      row.eachCell((cell) => {
        cell.border = borderStyle;
        cell.fill = rowFill;
        cell.alignment = { vertical: "middle", wrapText: true };
      });

      // Right-align and bold amount columns
      ["amount", "gst", "tds", "netPayable", "paymentAmount"].forEach((key) => {
        const cell = row.getCell(key);
        cell.alignment = { horizontal: "right", vertical: "middle" };
        cell.numFmt = "₹#,##0.00";
        cell.font = { bold: true };
      });

      row.height = 22;
    });

    // ── Total row ────────────────────────────────────────
    const totalRow = sheet.addRow({
      paymentId: "TOTAL",
      netPayable: payments.reduce(
        (s, p) => s + (p.invoiceRequest?.netPayable || 0),
        0,
      ),
      paymentAmount: payments.reduce((s, p) => s + (p.paymentAmount || 0), 0),
    });
    totalRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FF1A3C6E" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0EAFF" },
      };
      cell.border = borderStyle;
    });
    totalRow.getCell("netPayable").numFmt = "₹#,##0.00";
    totalRow.getCell("paymentAmount").numFmt = "₹#,##0.00";

    // ── Mark all as Excel Generated ─────────────────────
    await PaymentProcessing.updateMany(
      { _id: { $in: payments.map((p) => p._id) } },
      {
        $set: {
          status: PAYMENT_STATUS.EXCEL_GENERATED,
          currentStage: "closed",
          excelGeneratedAt: new Date(),
        },
        $push: {
          approvalHistory: {
            stage: "Excel Generation",
            approvedBy: req.user._id,
            action: "approved",
            remarks: "Excel generated for bank payment (bulk)",
            actionAt: new Date(),
          },
        },
      },
    );

    // ── Stream response ──────────────────────────────────
    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Bulk_Payments_${timestamp}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Bulk Excel error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ── FedOne (Federal Bank) bank-upload sheet ───────────────
// Same eligibility, permissions and status transition as the existing
// Excel export — only the file layout differs.

// POST /api/payments/:id/fedone-excel
exports.generateFedOneExcel = async (req, res) => {
  try {
    const { debitAccountId } = req.body;
    const payment = await PaymentProcessing.findById(req.params.id)
      .populate({
        path: "invoiceRequest",
        select: "requestId invoiceNumber expenseCategory",
        populate: { path: "expenseCategory", select: "name code type" },
      })
      .populate(
        "vendor",
        "vendorName accountHolderName accountNumber ifscCode email",
      )
      .populate("branch", "name code bankAccounts");

    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (req.user.role !== ROLES.ACCOUNTS) {
      return res
        .status(403)
        .json({ message: "Only accounts team can generate payment Excel" });
    }

    if (
      ![
        PAYMENT_STATUS.ACCOUNTS_APPROVED,
        PAYMENT_STATUS.EXCEL_GENERATED,
      ].includes(payment.status)
    ) {
      return res.status(400).json({
        message: `Excel can only be generated after Accounts Approval. Current status: ${payment.status}`,
      });
    }

    // Branch scope — mirrors getPaymentById.
    const branchScopedRoles = [
      ROLES.BRANCH_USER,
      ROLES.BRANCH_PARTNER,
      ROLES.ACCOUNTS,
      ROLES.CLUSTER_HEAD,
    ];
    if (branchScopedRoles.includes(req.user.role)) {
      const allowed = req.user.branches.map((b) => b._id.toString());
      const recordBranch = (payment.branch?._id || payment.branch)?.toString();
      if (!allowed.includes(recordBranch)) {
        return res
          .status(403)
          .json({ message: "You do not have access to this record" });
      }
    }

    const errors = validateForFedOne(payment, debitAccountId);
    if (errors.length) {
      return res.status(400).json({
        message: "This payment cannot be exported in FedOne format",
        errors,
      });
    }

    const isRegeneration = payment.status === PAYMENT_STATUS.EXCEL_GENERATED;
    if (!isRegeneration) {
      payment.status = PAYMENT_STATUS.EXCEL_GENERATED;
      payment.currentStage = "closed";
    }
    payment.approvalHistory.push({
      stage: isRegeneration
        ? "FedOne Excel Regeneration"
        : "FedOne Excel Generation",
      approvedBy: req.user._id,
      action: "approved",
      remarks: "FedOne bank upload sheet generated",
      actionAt: new Date(),
    });
    payment.excelGeneratedAt = new Date();
    await payment.save();

    const workbook = buildFedOneWorkbook([payment], debitAccountId);

    await logAction({
      userId: req.user._id,
      action: "GENERATE_FEDONE_EXCEL",
      module: "Payment",
      targetId: payment._id,
      req,
    });

    const fileName = `FedOne_${payment.paymentId}_${Date.now()}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("FedOne Excel error:", err);
    res.status(500).json({ message: "FedOne Excel generation failed" });
  }
};

// POST /api/payments/bulk-fedone-excel
// Body: { paymentIds: ["id1", "id2", ...] }
exports.bulkGenerateFedOneExcel = async (req, res) => {
  try {
    const { paymentIds } = req.body;
    const { debitAccountId } = req.body;
    if (!Array.isArray(paymentIds) || paymentIds.length === 0)
      return res.status(400).json({ message: "No payment IDs provided" });

    const ids = paymentIds.map(toId).filter(Boolean);
    if (ids.length === 0)
      return res.status(400).json({ message: "No valid payment IDs provided" });

    const query = {
      _id: { $in: ids },
      status: {
        $in: [PAYMENT_STATUS.ACCOUNTS_APPROVED, PAYMENT_STATUS.EXCEL_GENERATED],
      },
    };

    // Branch scope — an accounts user must not be able to pull payments
    // from branches they aren't assigned to by posting arbitrary ids.
    const branchScopedRoles = [
      ROLES.BRANCH_USER,
      ROLES.BRANCH_PARTNER,
      ROLES.ACCOUNTS,
      ROLES.CLUSTER_HEAD,
    ];
    if (branchScopedRoles.includes(req.user.role)) {
      query.branch = { $in: req.user.branches.map((b) => b._id) };
    }

    const payments = await PaymentProcessing.find(query)
      .populate({
        path: "invoiceRequest",
        select: "requestId invoiceNumber expenseCategory",
        populate: { path: "expenseCategory", select: "name code type" },
      })
      .populate(
        "vendor",
        "vendorName accountHolderName accountNumber ifscCode email",
      )
      .populate("branch", "name code bankAccounts");

    if (payments.length === 0)
      return res.status(404).json({ message: "No eligible payments found" });

    // All-or-nothing: a half-valid file uploaded to the bank is worse
    // than a clear error listing what to fix.
    const errors = payments.flatMap((p) =>
      validateForFedOne(p, debitAccountId),
    );
    if (errors.length) {
      return res.status(400).json({
        message: `${errors.length} payment(s) cannot be exported in FedOne format`,
        errors,
      });
    }

    // The bank rejects a file containing duplicate reference numbers.
    const refs = payments.map((p) => resolveReference(p));
    const duplicates = refs.filter((r, i) => refs.indexOf(r) !== i);
    if (duplicates.length) {
      return res.status(400).json({
        message: "Duplicate reference numbers in selection",
        errors: [...new Set(duplicates)],
      });
    }

    const workbook = buildFedOneWorkbook(payments, debitAccountId);

    await PaymentProcessing.updateMany(
      { _id: { $in: payments.map((p) => p._id) } },
      {
        $set: {
          status: PAYMENT_STATUS.EXCEL_GENERATED,
          currentStage: "closed",
          excelGeneratedAt: new Date(),
        },
        $push: {
          approvalHistory: {
            stage: "FedOne Excel Generation",
            approvedBy: req.user._id,
            action: "approved",
            remarks: "FedOne bank upload sheet generated (bulk)",
            actionAt: new Date(),
          },
        },
      },
    );

    await logAction({
      userId: req.user._id,
      action: "GENERATE_FEDONE_EXCEL_BULK",
      module: "Payment",
      targetId: null,
      req,
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="FedOne_Payments_${timestamp}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Bulk FedOne Excel error:", err);
    res.status(500).json({ message: "FedOne Excel generation failed" });
  }
};

// ============================================================
// UTR RECORDING
// ------------------------------------------------------------
// Single entry (PATCH /:id/utr) and bulk entry (PATCH /bulk-utr)
// share one core — applyUtrToPayment — so eligibility, the amount
// maths, the status transition and the audit trail cannot drift
// apart between the two screens.
// ============================================================

// A UTR may only be posted from these states. The single-payment screen
// keeps both, as it always has — Accounts sometimes pay one invoice off
// the approval directly, without producing a bank file for it.
const UTR_RECORDABLE_STATUSES = [
  PAYMENT_STATUS.EXCEL_GENERATED,
  PAYMENT_STATUS.ACCOUNTS_APPROVED,
];

// Bulk entry is stricter: the Excel IS the bank batch. A payment with no
// bank file was never in the batch the operator is keying UTRs from, so
// offering it in the grid would only invite a UTR being typed against a
// payment the bank never saw.
const BULK_UTR_RECORDABLE_STATUSES = [PAYMENT_STATUS.EXCEL_GENERATED];

// Populate set every UTR path needs: branch scoping, the email body
// and the audit label all read from it.
const UTR_POPULATE = [
  { path: "invoiceRequest", select: "requestId invoiceNumber netPayable" },
  { path: "vendor", select: "vendorName" },
  { path: "branch", select: "name code bankAccounts" },
  { path: "raisedBy", select: "email name status" },
];

// One bank batch is a few hundred rows at most. The caps stop a
// hand-crafted payload from turning one request into an unbounded
// write loop.
const MAX_BULK_UTR_ENTRIES = 500;
const MAX_UTR_CANDIDATES = 1000;

// Money is stored as a JS float (known tech debt — see paidAmount /
// installment amounts). Rounding to paise at the settlement boundary
// stops 1e-10 drift from leaving a fully settled invoice stuck on
// "Partially Paid" forever.
const toPaise = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Payment ids are stored exactly as they are printed (PAY-000123,
// PAY-000123-2). Only case and stray whitespace are forgiven, so the
// lookup stays an exact, indexed match.
const cleanRefInput = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();

// getPayments already restricts these roles to their mapped branches,
// so a payment outside that set is only reachable by guessing an id.
// Posting a UTR moves money in the ledger, so it is checked here too.
const BRANCH_SCOPED_ROLES = [
  ROLES.BRANCH_USER,
  ROLES.BRANCH_PARTNER,
  ROLES.ACCOUNTS,
  ROLES.CLUSTER_HEAD,
];

const isPaymentInScope = (user, payment) => {
  if (!BRANCH_SCOPED_ROLES.includes(user.role)) return true;
  const branchId = String(payment.branch?._id || payment.branch || "");
  return (user.branches || []).some(
    (b) => String(b?._id || b) === branchId && branchId,
  );
};

// A UTR is evidence money has already left the account, so a value date
// in the future is always a typo. Tomorrow's date is allowed as the
// boundary because the server may sit a timezone behind the branch.
const parseDateOrNull = (value) => {
  if (!value) return { ok: true, date: null };
  const date = new Date(value);
  if (isNaN(date.getTime()))
    return { ok: false, date: null, message: "Invalid payment date" };

  const limit = new Date();
  limit.setDate(limit.getDate() + 1);
  if (date > limit)
    return {
      ok: false,
      date: null,
      message: "Payment date cannot be in the future",
    };

  return { ok: true, date };
};

// ── Core: apply one UTR to one payment ─────────────────────
// Mutates and saves the document, then returns a plain result. No HTTP
// concerns, so the bulk path can collect per-row outcomes instead of
// aborting a whole batch on the first bad row.
const applyUtrToPayment = async (
  payment,
  {
    utrNumber,
    paymentDate,
    installmentRef,
    installmentIndex,
    userId,
    source,
    allowedStatuses = UTR_RECORDABLE_STATUSES,
  },
) => {
  const utr = String(utrNumber || "")
    .trim()
    .toUpperCase();
  if (!utr) return { ok: false, message: "UTR number is required" };

  if (!allowedStatuses.includes(payment.status)) {
    return {
      ok: false,
      message:
        source === "bulk"
          ? `Bulk UTR needs the bank Excel generated first — this payment is "${payment.status}"`
          : `A UTR can only be recorded once a payment is approved by Accounts — this one is "${payment.status}"`,
    };
  }

  // ── Pick the installment ──────────────────────────────────
  // installmentRef (the printed id, PAY-000123-2) is preferred over a
  // bare array index. A screen can sit open while the payment is
  // rejected and re-raised, and by then index 0 is a different, abandoned
  // installment — the id still names the one the operator was looking at.
  let idx = -1;
  if (installmentRef) {
    const wanted = cleanRefInput(installmentRef);
    idx = payment.installments.findIndex(
      (inst) => cleanRefInput(inst?.paymentId) === wanted,
    );
    if (idx < 0)
      return {
        ok: false,
        message: `Installment ${installmentRef} is no longer on this payment — reopen the screen and try again`,
      };
  } else if (installmentIndex !== undefined && installmentIndex !== null) {
    idx = Number(installmentIndex);
    if (!Number.isInteger(idx))
      return { ok: false, message: "Invalid installment reference" };
  } else {
    idx = payment.installments.length - 1;
  }

  if (idx < 0 || idx >= payment.installments.length) {
    return {
      ok: false,
      message: "No open installment to record a UTR against",
    };
  }

  const installment = payment.installments[idx];
  if (!installment)
    return {
      ok: false,
      message: "No open installment to record a UTR against",
    };

  // paidAmount is incremented, not recomputed, so re-posting the same
  // installment would silently double-credit it. The status guard above
  // blocks the ordinary replay; this catches an explicit reference aimed
  // at an installment that was already settled.
  if (installment.utrNumber) {
    return {
      ok: false,
      message: `${installment.paymentId || `Installment ${idx + 1}`} already carries UTR ${installment.utrNumber}`,
    };
  }

  // Installments are only ever created as "Raised" and marked "Processed"
  // here — the approve / excel / reject handlers move the PARENT status
  // only. So the parent status is what says a UTR is due, and these two
  // checks say whether it is due against THIS installment.
  if (["Processed", "Rejected"].includes(installment.status)) {
    return {
      ok: false,
      message: `${installment.paymentId || `Installment ${idx + 1}`} is "${installment.status}" — a UTR cannot be recorded against it`,
    };
  }

  // Only the newest installment is payable. Partial payments always append,
  // so an earlier installment either already carries its UTR or was
  // abandoned when the payment was rejected and re-raised. Without this a
  // screen left open across a re-raise would book the money against the
  // abandoned row and leave the live one open to be paid twice.
  if (idx !== payment.installments.length - 1) {
    return {
      ok: false,
      message: `${installment.paymentId || `Installment ${idx + 1}`} has been superseded by a newer installment — reopen the screen and try again`,
    };
  }

  const installmentAmount = installment.amount || 0;
  if (!(installmentAmount > 0))
    return { ok: false, message: "Installment has no amount to settle" };

  // Never let a payment be credited beyond its own invoice value.
  if (
    toPaise((payment.paidAmount || 0) + installmentAmount) -
      payment.totalAmount >
    0.009
  ) {
    return {
      ok: false,
      message: "Recording this would pay more than the invoice total",
    };
  }

  const recordedAt = new Date();
  const statusFrom = payment.status;
  const historyEntry = {
    stage: "UTR Recorded",
    approvedBy: userId,
    action: "approved",
    remarks: `UTR ${utr} recorded${source === "bulk" ? " (bulk entry)" : ""}`,
    actionAt: recordedAt,
  };

  installment.utrNumber = utr;
  installment.utrRecordedAt = recordedAt;
  installment.utrRecordedBy = userId;
  // Only overwrite the value date when one was actually supplied — a blank
  // cell must not erase a date already on the record.
  if (paymentDate) installment.paymentDate = paymentDate;
  installment.status = "Processed";
  installment.approvalHistory.push(historyEntry);

  payment.paidAmount = toPaise((payment.paidAmount || 0) + installmentAmount);
  payment.remainingAmount = toPaise(payment.totalAmount - payment.paidAmount);
  payment.status =
    payment.remainingAmount <= 0
      ? PAYMENT_STATUS.FULLY_PAID
      : PAYMENT_STATUS.PARTIALLY_PAID;

  // Top-level mirror of the latest installment, kept for the list views
  // and reports that still read these fields.
  payment.utrNumber = utr;
  payment.utrRecordedAt = recordedAt;
  payment.utrRecordedBy = userId;
  if (paymentDate) payment.paymentDate = paymentDate;

  // Audit parity with approve / reject: the state change is recorded on
  // the document itself, not only in the AuditLog collection.
  payment.approvalHistory.push(historyEntry);

  await payment.save();

  return {
    ok: true,
    utr,
    installmentAmount,
    installmentId: installment.paymentId || null,
    statusFrom,
    statusTo: payment.status,
  };
};

// ── Notify raiser + Branch Partner + Cluster Head ──────────
// Never throws: a dead SMTP must not fail a recorded payment.
const sendUtrNotification = async (payment, { utr, installmentAmount }) => {
  try {
    const branchId = payment.branch?._id || payment.branch;

    const approvers = await User.find({
      role: { $in: [ROLES.BRANCH_PARTNER, ROLES.CLUSTER_HEAD] },
      status: "active",
      branches: branchId, // only approvers mapped to this payment's branch
    }).select("email name role");

    // Raiser goes on To:, partner + cluster head on Cc:. De-duped, case-insensitive.
    const seen = new Set();
    const recipients = [];
    const raiserEmail =
      payment.raisedBy?.status === "active" ? payment.raisedBy.email : null;

    for (const raw of [raiserEmail, ...approvers.map((u) => u.email)]) {
      const email = raw?.trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push(email);
    }

    if (!recipients.length) return;

    const [to, ...cc] = recipients;
    const invoice = payment.invoiceRequest;
    const paidOn = (
      payment.paymentDate ||
      payment.utrRecordedAt ||
      new Date()
    ).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const row = (label, value, color) =>
      `<tr><td style="padding:6px;color:#666;">${label}</td><td style="padding:6px;font-weight:600;${color ? `color:${color};` : ""}">${value}</td></tr>`;

    await sendNotificationEmail(
      to,
      `✅ Payment ${payment.status}: ${payment.paymentId}`,
      `
          <p>Payment <strong>${payment.paymentId}</strong> has been processed by the Accounts team and the UTR has been recorded.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:12px;">
            ${row("UTR Number", utr, "#16a34a")}
            ${row("Payment Date", paidOn)}
            ${row("Invoice", invoice?.requestId || "—")}
            ${row("Vendor", payment.vendor?.vendorName || "—")}
            ${row("Branch", payment.branch?.name || "—")}
            ${row("Amount Paid", `₹${installmentAmount.toLocaleString("en-IN")}`)}
            ${row("Total Paid", `₹${payment.paidAmount.toLocaleString("en-IN")}`)}
            ${payment.remainingAmount > 0 ? row("Remaining", `₹${payment.remainingAmount.toLocaleString("en-IN")}`, "#d97706") : ""}
          </table>
          ${
            payment.status === "Fully Paid"
              ? "<p style='color:#16a34a;font-weight:700;margin-top:12px;'>✅ Invoice fully cleared!</p>"
              : "<p style='color:#d97706;margin-top:12px;'>Remaining balance can be paid in the next installment.</p>"
          }
          <p style="color:#94a3b8;font-size:12px;margin-top:16px;">This is an automated confirmation — no action is required.</p>
        `,
      cc.length ? { cc } : {},
    );
  } catch (mailErr) {
    console.error("UTR notification error:", mailErr.message);
  }
};

// ── Bulk: one digest per branch, not one mail per invoice ──
// A 200-invoice batch for one branch would otherwise put 200 near-identical
// mails in the same partner's inbox. Recipients are resolved once per branch
// and the payments are listed in a single table. Never throws.
const sendBulkUtrDigest = async (posted) => {
  try {
    // branchId -> { branch, rows[], raiserEmails:Set }
    const byBranch = new Map();
    for (const [payment, result] of posted) {
      const branchId = String(payment.branch?._id || payment.branch || "none");
      if (!byBranch.has(branchId))
        byBranch.set(branchId, {
          branch: payment.branch,
          rows: [],
          raiserEmails: new Set(),
        });
      const group = byBranch.get(branchId);
      group.rows.push({ payment, result });
      if (payment.raisedBy?.status === "active" && payment.raisedBy.email)
        group.raiserEmails.add(payment.raisedBy.email.trim());
    }

    for (const [branchId, group] of byBranch) {
      const approvers = mongoose.isValidObjectId(branchId)
        ? await User.find({
            role: { $in: [ROLES.BRANCH_PARTNER, ROLES.CLUSTER_HEAD] },
            status: "active",
            branches: branchId,
          }).select("email")
        : [];

      const seen = new Set();
      const recipients = [];
      for (const raw of [
        ...group.raiserEmails,
        ...approvers.map((u) => u.email),
      ]) {
        const email = raw?.trim();
        if (!email) continue;
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        recipients.push(email);
      }
      if (!recipients.length) continue;

      const [to, ...cc] = recipients;
      const totalPaid = group.rows.reduce(
        (sum, r) => sum + (r.result.installmentAmount || 0),
        0,
      );

      const body = group.rows
        .map(
          ({ payment, result }) => `
            <tr>
              <td style="padding:6px;border-top:1px solid #eee;">${payment.invoiceRequest?.requestId || "—"}</td>
              <td style="padding:6px;border-top:1px solid #eee;">${payment.vendor?.vendorName || "—"}</td>
              <td style="padding:6px;border-top:1px solid #eee;text-align:right;">₹${(result.installmentAmount || 0).toLocaleString("en-IN")}</td>
              <td style="padding:6px;border-top:1px solid #eee;font-family:monospace;color:#16a34a;">${result.utr}</td>
              <td style="padding:6px;border-top:1px solid #eee;">${payment.status}</td>
            </tr>`,
        )
        .join("");

      await sendNotificationEmail(
        to,
        `✅ ${group.rows.length} payment${group.rows.length === 1 ? "" : "s"} processed — ${group.branch?.name || "your branch"}`,
        `
          <p>The Accounts team has recorded UTRs for the following payment${group.rows.length === 1 ? "" : "s"}.</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
            <thead>
              <tr style="background:#f8fafc;text-align:left;">
                <th style="padding:6px;">Invoice</th>
                <th style="padding:6px;">Vendor</th>
                <th style="padding:6px;text-align:right;">Amount</th>
                <th style="padding:6px;">UTR</th>
                <th style="padding:6px;">Status</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
          <p style="margin-top:12px;font-weight:700;">Total recorded: ₹${totalPaid.toLocaleString("en-IN")}</p>
          <p style="color:#94a3b8;font-size:12px;margin-top:16px;">This is an automated confirmation — no action is required.</p>
        `,
        cc.length ? { cc } : {},
      );
    }
  } catch (mailErr) {
    console.error("Bulk UTR digest error:", mailErr.message);
  }
};

// ── PATCH /api/payments/:id/utr ────────────────────────────
// Body: { utrNumber, paymentDate?, installmentIndex? }
exports.recordUTR = async (req, res) => {
  try {
    const { utrNumber, installmentRef, installmentIndex, paymentDate } =
      req.body;
    if (!utrNumber?.trim())
      return res.status(400).json({ message: "UTR number is required" });

    const parsed = parseDateOrNull(paymentDate);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message });

    const payment = await PaymentProcessing.findById(req.params.id).populate(
      UTR_POPULATE,
    );

    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (!isPaymentInScope(req.user, payment))
      return res
        .status(403)
        .json({ message: "This payment belongs to another branch" });

    const result = await applyUtrToPayment(payment, {
      utrNumber,
      paymentDate: parsed.date,
      installmentRef,
      installmentIndex,
      userId: req.user._id,
      source: "single",
    });

    if (!result.ok) return res.status(400).json({ message: result.message });

    await sendUtrNotification(payment, result);

    await logAction({
      userId: req.user._id,
      action: "RECORD_UTR",
      module: "Payment",
      targetDoc: payment,
      statusFrom: result.statusFrom,
      statusTo: result.statusTo,
      amount: result.installmentAmount,
      newValue: {
        utrNumber: result.utr,
        installmentId: result.installmentId,
        installmentAmount: result.installmentAmount,
      },
      req,
    });

    res.json(payment);
  } catch (err) {
    console.error("UTR record error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ── GET /api/payments/awaiting-utr ─────────────────────────
// Every payment a UTR can still be posted against, in one lean response,
// so the bulk screen can show the whole outstanding set rather than only
// the page that happened to be on screen.
exports.getPaymentsAwaitingUTR = async (req, res) => {
  try {
    // This endpoint feeds the bulk screen only, so it uses the stricter set.
    const query = { status: { $in: BULK_UTR_RECORDABLE_STATUSES } };

    if (BRANCH_SCOPED_ROLES.includes(req.user.role)) {
      const assigned = (req.user.branches || []).map((b) => b?._id || b);
      const picked = req.query.branch;
      query.branch =
        picked && assigned.some((a) => String(a) === String(picked))
          ? picked
          : { $in: assigned };
    } else if (req.query.branch) {
      query.branch = req.query.branch;
    }

    const total = await PaymentProcessing.countDocuments(query);

    const payments = await PaymentProcessing.find(query)
      .select(
        "paymentId status paymentAmount totalAmount paidAmount remainingAmount scheduledDate installments invoiceRequest branch vendor",
      )
      .populate("invoiceRequest", "requestId invoiceNumber netPayable")
      .populate("branch", "name code")
      .populate("vendor", "vendorName companyName")
      .sort({ createdAt: -1 })
      .limit(MAX_UTR_CANDIDATES)
      .lean();

    // Only the open installment is exposed — that is the one a UTR lands on
    // — identified by its printed id so the server can resolve it by name
    // rather than by a position that may shift.
    const rows = payments
      // Legacy records predating the installments array have nothing for a
      // UTR to land on, so listing them would only offer rows that always
      // fail. They are still payable through the single-payment screen.
      .filter((p) => (p.installments?.length || 0) > 0)
      .map((p) => {
        const idx = p.installments.length - 1;
        const last = p.installments[idx];
        return {
          _id: p._id,
          paymentId: p.paymentId,
          status: p.status,
          installmentIndex: idx,
          installmentId: last?.paymentId || null,
          amount: last?.amount ?? p.paymentAmount ?? 0,
          scheduledDate: p.scheduledDate || last?.scheduledDate || null,
          alreadyRecorded: Boolean(last?.utrNumber),
          invoiceRequest: p.invoiceRequest,
          branch: p.branch,
          vendor: p.vendor,
          references: [p.paymentId, last?.paymentId].filter(Boolean),
        };
      });

    res.json({
      payments: rows,
      total,
      returned: rows.length,
      cap: MAX_UTR_CANDIDATES,
      // Compare against what the query returned, not what survived the
      // legacy filter — otherwise filtering one old record would claim the
      // list had been cut short.
      truncated:
        payments.length >= MAX_UTR_CANDIDATES && total > payments.length,
    });
  } catch (err) {
    console.error("Awaiting-UTR list error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ── PATCH /api/payments/bulk-utr ───────────────────────────
// Body: {
//   entries: [{ _id? , reference?, utrNumber, paymentDate?, installmentRef? }],
//   paymentDate?   // fallback value date for entries that omit their own
// }
//
// Accounts release payments as one bank batch, then key the UTRs back in
// off the statement, so each row is applied independently: a bad row is
// reported and the rows around it still go through. Nothing is rolled
// back, because a UTR that has already been posted is a fact about money
// that moved — the batch reports per-row outcomes instead.
exports.bulkRecordUTR = async (req, res) => {
  try {
    const { entries, paymentDate: fallbackDate } = req.body;

    if (!Array.isArray(entries) || entries.length === 0)
      return res.status(400).json({ message: "No UTR entries provided" });

    if (entries.length > MAX_BULK_UTR_ENTRIES)
      return res.status(400).json({
        message: `Too many entries — send at most ${MAX_BULK_UTR_ENTRIES} at a time`,
      });

    const parsedFallback = parseDateOrNull(fallbackDate);
    if (!parsedFallback.ok)
      return res.status(400).json({ message: parsedFallback.message });

    // ── Resolve references to ids in one query ────────────────
    // The bulk screen posts each row with its _id, so that is the normal
    // path. `reference` is accepted as a fallback for a caller that only
    // has the printed id (PAY-000123 or its installment PAY-000123-2);
    // it is an exact, indexed lookup — no full-collection scan.
    //
    // Only ids are resolved here, never documents. Each row re-reads its
    // own payment at the moment it is applied (below), so a row cannot be
    // judged against a snapshot that an earlier row in this same batch —
    // or another user's approval or rejection mid-batch — has since moved on.
    const refSet = new Set();
    entries.forEach((entry) => {
      const id = entry?._id || entry?.id;
      if (id && mongoose.isValidObjectId(id)) return;
      const ref = cleanRefInput(entry?.reference ?? entry?.paymentId);
      if (ref) refSet.add(ref);
    });

    const idByRef = new Map();
    if (refSet.size) {
      const refs = [...refSet];
      const found = await PaymentProcessing.find({
        $or: [
          { paymentId: { $in: refs } },
          { "installments.paymentId": { $in: refs } },
        ],
      }).select("paymentId installments.paymentId");

      for (const doc of found) {
        const keys = new Set([doc.paymentId]);
        (doc.installments || []).forEach((inst) => {
          if (inst?.paymentId) keys.add(inst.paymentId);
        });
        for (const key of keys) {
          if (key && refSet.has(key)) idByRef.set(key, String(doc._id));
        }
      }
    }

    const results = [];
    const notifications = [];
    let updated = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] || {};
      const label = String(
        entry.reference || entry.paymentId || entry._id || `Row ${i + 1}`,
      );
      const record = (status, message, doc) =>
        results.push({
          index: i,
          reference: label,
          paymentId: doc?.paymentId || null,
          status,
          message,
        });

      const utr = String(entry.utrNumber || "").trim();
      if (!utr) {
        record("failed", "UTR number is missing");
        continue;
      }

      const id = entry._id || entry.id;
      const targetId =
        id && mongoose.isValidObjectId(id)
          ? String(id)
          : idByRef.get(cleanRefInput(entry.reference ?? entry.paymentId));

      // Re-read per row. This is what makes the batch safe: the same
      // payment listed twice, or one approved away underneath us while
      // earlier rows were being written, is judged on its current state.
      const doc = targetId
        ? await PaymentProcessing.findById(targetId).populate(UTR_POPULATE)
        : null;

      if (!doc) {
        record("failed", "No payment awaiting a UTR matched this reference");
        continue;
      }

      if (!isPaymentInScope(req.user, doc)) {
        record("failed", "Payment belongs to another branch", doc);
        continue;
      }

      const rowDate = parseDateOrNull(entry.paymentDate);
      if (!rowDate.ok) {
        record("failed", rowDate.message, doc);
        continue;
      }

      try {
        const result = await applyUtrToPayment(doc, {
          utrNumber: utr,
          paymentDate: rowDate.date || parsedFallback.date,
          installmentRef: entry.installmentRef,
          installmentIndex: entry.installmentIndex,
          userId: req.user._id,
          source: "bulk",
          allowedStatuses: BULK_UTR_RECORDABLE_STATUSES,
        });

        if (!result.ok) {
          // Already settled / wrong state — reported, not an error.
          record("skipped", result.message, doc);
          continue;
        }

        updated++;
        record("success", `UTR ${result.utr} recorded`, doc);
        notifications.push([doc, result]);

        await logAction({
          userId: req.user._id,
          action: "RECORD_UTR",
          module: "Payment",
          targetDoc: doc,
          statusFrom: result.statusFrom,
          statusTo: result.statusTo,
          amount: result.installmentAmount,
          newValue: {
            utrNumber: result.utr,
            installmentId: result.installmentId,
            installmentAmount: result.installmentAmount,
            source: "bulk",
          },
          req,
        });
      } catch (err) {
        console.error("Bulk UTR row error:", err);
        record("failed", err.message || "Could not record this UTR", doc);
      }
    }

    // Mail goes out after the writes, as one digest per branch rather than
    // one mail per invoice. A slow or dead SMTP then delays the response
    // instead of holding the batch half-written, and it stays a handful of
    // sends however large the batch was.
    await sendBulkUtrDigest(notifications);

    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;

    await logAction({
      userId: req.user._id,
      action: "BULK_RECORD_UTR",
      module: "Payment",
      newValue: { requested: entries.length, updated, skipped, failed },
      req,
    });

    res.json({
      message: `${updated} of ${entries.length} payment${entries.length === 1 ? "" : "s"} updated`,
      total: entries.length,
      updated,
      skipped,
      failed,
      results,
    });
  } catch (err) {
    console.error("Bulk UTR error:", err);
    res.status(500).json({ message: err.message });
  }
};
