const PaymentProcessing = require("../models/PaymentProcessing");
const InvoiceRequest = require("../models/InvoiceRequest");
const User = require("../models/User");
const ExcelJS = require("exceljs");
const {
  PAYMENT_STATUS,
  PAYMENT_WORKFLOW,
  ROLES,
} = require("../config/constants");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");

const getPaymentWorkflowStep = (status) =>
  PAYMENT_WORKFLOW.find((w) => w.status === status) || null;

// ── List approved invoices available for payment ───────────
exports.getApprovedInvoicesForPayment = async (req, res) => {
  try {
    const { branch, page = 1, limit = 20 } = req.query;
    const query = {
      status: "Cluster Head Approved",
      paymentRequest: { $ne: null }, // has a payment record
    };

    if ([ROLES.BRANCH_USER, ROLES.BRANCH_PARTNER].includes(req.user.role)) {
      query.branch = { $in: req.user.branches.map((b) => b._id) };
    } else if (branch) {
      query.branch = branch;
    }

    const total = await InvoiceRequest.countDocuments(query);
    const invoices = await InvoiceRequest.find(query)
      .populate("branch", "name code")
      .populate(
        "vendor",
        "vendorName companyName accountNumber ifscCode bankName accountHolderName",
      )
      .populate("paymentRequest")
      .populate("createdBy", "name email")
      .sort({ updatedAt: -1 })
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

// ── List payment processing records ───────────────────────
exports.getPayments = async (req, res) => {
  try {
    const { status, branch, page = 1, limit = 20 } = req.query;
    const query = {};

    if ([ROLES.BRANCH_USER, ROLES.BRANCH_PARTNER].includes(req.user.role)) {
      query.branch = { $in: req.user.branches.map((b) => b._id) };
    } else if (branch) {
      query.branch = branch;
    }

    // ✅ Only show payments that have been raised by branch (not pending)
    if (status) {
      query.status = status;
    } else {
      query.status = { $ne: "Payment Pending" }; // pending ones shown in 'raise payment' list
    }

    const total = await PaymentProcessing.countDocuments(query);
    const payments = await PaymentProcessing.find(query)
      .populate(
        "invoiceRequest",
        "requestId invoiceNumber invoiceDate netPayable",
      )
      .populate("branch", "name code")
      .populate("vendor", "vendorName companyName")
      .populate("raisedBy", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      payments,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Branch raises payment request for approved invoice ─────
exports.raisePayment = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { paymentRemarks, scheduledDate, paymentAmount } = req.body;

    const invoice = await InvoiceRequest.findById(invoiceId).populate(
      "vendor branch createdBy",
    );
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    if (invoice.status !== "Cluster Head Approved") {
      return res.status(403).json({
        message: "Invoice must be fully approved before raising payment",
      });
    }

    // Find the auto-created payment record
    const payment = await PaymentProcessing.findById(invoice.paymentRequest);
    if (!payment)
      return res.status(404).json({ message: "Payment record not found" });
    if (payment.status !== "Payment Pending") {
      return res
        .status(400)
        .json({ message: `Payment already raised. Status: ${payment.status}` });
    }

    payment.status = "Payment Raised";
    payment.currentStage = "accounts";
    payment.paymentRemarks = paymentRemarks || "";
    payment.scheduledDate = scheduledDate ? new Date(scheduledDate) : null;
    payment.paymentAmount = paymentAmount || invoice.netPayable;
    payment.raisedBy = req.user._id;

    await payment.save();

    // Notify accounts team
    const accountsUsers = await User.find({
      role: ROLES.ACCOUNTS,
      status: "active",
    });
    for (const u of accountsUsers) {
      await sendNotificationEmail(
        u.email,
        `💳 Payment Request Raised: ${payment.paymentId}`,
        `
          <p>Branch has raised a payment request for invoice <strong>${invoice.requestId}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:12px;">
            <tr><td style="padding:6px;color:#666;">Payment ID</td><td style="padding:6px;font-weight:600;">${payment.paymentId}</td></tr>
            <tr><td style="padding:6px;color:#666;">Invoice No.</td><td style="padding:6px;font-weight:600;">${invoice.invoiceNumber}</td></tr>
            <tr><td style="padding:6px;color:#666;">Vendor</td><td style="padding:6px;font-weight:600;">${invoice.vendor?.vendorName}</td></tr>
            <tr><td style="padding:6px;color:#666;">Amount</td><td style="padding:6px;font-weight:600;">₹${payment.paymentAmount?.toLocaleString("en-IN")}</td></tr>
          </table>
          <p style="margin-top:12px;">Please review and approve to generate payment Excel.</p>
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
    sheet.mergeCells("A1:J1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = "HEALING HANDS CLINIC — PAYMENT INSTRUCTION";
    titleCell.font = { bold: true, size: 14, color: { argb: "FF1A3C6E" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;

    // Subtitle row
    sheet.mergeCells("A2:J2");
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
        "requestId invoiceNumber invoiceDate amount gstAmount tdsAmount netPayable description",
      )
      .populate(
        "vendor",
        "vendorName companyName accountHolderName bankName accountNumber ifscCode panNumber",
      )
      .populate("branch", "name code")
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
      { header: "TDS (₹)", key: "tds", width: 12 },
      { header: "Net Payable (₹)", key: "netPayable", width: 16 },
      { header: "Payment Amount (₹)", key: "paymentAmount", width: 18 },
      { header: "Scheduled Date", key: "scheduledDate", width: 16 },
      { header: "Remarks", key: "remarks", width: 24 },
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
        tds: inv?.tdsAmount || 0,
        netPayable: inv?.netPayable || 0,
        paymentAmount: pay.paymentAmount || 0,
        scheduledDate: pay.scheduledDate
          ? new Date(pay.scheduledDate).toLocaleDateString("en-GB")
          : "—",
        remarks: pay.paymentRemarks || "—",
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
      { $set: { status: "Excel Generated", excelGeneratedAt: new Date() } },
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
