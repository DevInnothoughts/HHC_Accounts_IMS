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

// POST /api/payments/:id/utr
// Body: { utrNumber }
exports.recordUTR = async (req, res) => {
  try {
    const { utrNumber, installmentIndex, paymentDate } = req.body;
    if (!utrNumber?.trim())
      return res.status(400).json({ message: "UTR number is required" });

    // Payment (value) date — validate if provided
    let parsedPaymentDate = null;
    if (paymentDate) {
      parsedPaymentDate = new Date(paymentDate);
      if (isNaN(parsedPaymentDate.getTime())) {
        return res.status(400).json({ message: "Invalid payment date" });
      }
    }

    const payment = await PaymentProcessing.findById(req.params.id)
      .populate("invoiceRequest", "requestId netPayable")
      .populate("vendor", "vendorName")
      .populate("branch", "name code bankAccounts") // ← ADD: needed for scoping + email body
      .populate("raisedBy", "email name status");

    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (!["Excel Generated", "Accounts Approved"].includes(payment.status)) {
      return res.status(400).json({
        message: "UTR can only be recorded after Excel is generated",
      });
    }

    const utr = utrNumber.trim().toUpperCase();

    // ✅ Update the latest installment
    const latestIdx =
      installmentIndex !== undefined
        ? installmentIndex
        : payment.installments.length - 1;

    if (payment.installments[latestIdx]) {
      payment.installments[latestIdx].utrNumber = utr;
      payment.installments[latestIdx].utrRecordedAt = new Date();
      payment.installments[latestIdx].utrRecordedBy = req.user._id;
      payment.installments[latestIdx].paymentDate = parsedPaymentDate;
      payment.installments[latestIdx].status = "Processed";
    }

    // ✅ Update paid amount
    const installmentAmount = payment.installments[latestIdx]?.amount || 0;
    payment.paidAmount = (payment.paidAmount || 0) + installmentAmount;
    payment.remainingAmount = payment.totalAmount - payment.paidAmount;

    // ✅ Determine overall status
    if (payment.remainingAmount <= 0) {
      payment.status = "Fully Paid";
    } else {
      payment.status = "Partially Paid";
    }

    // ✅ Legacy UTR fields
    payment.utrNumber = utr;
    payment.utrRecordedAt = new Date();
    payment.utrRecordedBy = req.user._id;
    payment.paymentDate = parsedPaymentDate;

    await payment.save();

    // ── Notify raiser + Branch Partner + Cluster Head ──────────
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

      if (recipients.length) {
        const [to, ...cc] = recipients;
        const invoice = payment.invoiceRequest;
        const paidOn = (
          payment.paymentDate || payment.utrRecordedAt
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
      }
    } catch (mailErr) {
      console.error("UTR notification error:", mailErr.message);
    }

    await logAction({
      userId: req.user._id,
      action: "RECORD_UTR",
      module: "Payment",
      targetId: payment._id,
      newValue: { utrNumber: utr, installmentAmount },
      req,
    });

    res.json(payment);
  } catch (err) {
    console.error("UTR record error:", err);
    res.status(500).json({ message: err.message });
  }
};
