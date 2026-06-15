// ============================================================
// BACKEND: controllers/reportController.js — Complete Rewrite
// ============================================================
const InvoiceRequest = require("../models/InvoiceRequest");
const PaymentProcessing = require("../models/PaymentProcessing");
const Vendor = require("../models/Vendor");
const Branch = require("../models/Branch");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");

// Returns a branch-scope match for branch-restricted roles, or {} for unrestricted roles.
const buildReportBranchScope = (user) => {
  const branchScopedRoles = ["branch_user", "branch_partner", "accounts"];
  if (!branchScopedRoles.includes(user.role)) return {}; // super_admin / director → all branches
  return { branch: { $in: (user.branches || []).map((b) => b._id) } };
};

// ── Dashboard Stats ────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const role = req.user.role;
    const branchFilter = [
      "branch_user",
      "branch_partner",
      "accounts",
      "cluster_head",
    ].includes(role)
      ? { branch: { $in: req.user.branches.map((b) => b._id) } }
      : {};

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());

    // ── Invoice Stats ──────────────────────────────────────
    const [
      totalInvoices,
      draftInvoices,
      submittedInvoices,
      accountsApprovedInvoices,
      partnerApprovedInvoices,
      clusterApprovedInvoices,
      rejectedInvoices,
      invoiceAmountAgg,
      monthlyInvoices,
    ] = await Promise.all([
      InvoiceRequest.countDocuments(branchFilter),
      InvoiceRequest.countDocuments({ ...branchFilter, status: "Draft" }),
      InvoiceRequest.countDocuments({ ...branchFilter, status: "Submitted" }),
      InvoiceRequest.countDocuments({
        ...branchFilter,
        status: "Accounts Approved",
      }),
      InvoiceRequest.countDocuments({
        ...branchFilter,
        status: "Partner Approved",
      }),
      InvoiceRequest.countDocuments({
        ...branchFilter,
        status: "Cluster Head Approved",
      }),
      InvoiceRequest.countDocuments({ ...branchFilter, status: "Rejected" }),
      InvoiceRequest.aggregate([
        { $match: branchFilter },
        {
          $group: {
            _id: null,
            total: { $sum: "$netPayable" },
            avg: { $avg: "$netPayable" },
          },
        },
      ]),
      InvoiceRequest.countDocuments({
        ...branchFilter,
        createdAt: { $gte: startOfMonth },
      }),
    ]);

    // ── Payment Stats ──────────────────────────────────────
    const [
      totalPayments,
      paymentPending,
      paymentRaised,
      paymentApproved,
      excelGenerated,
      paymentRejected,
      paymentAmountAgg,
      monthlyPayments,
    ] = await Promise.all([
      PaymentProcessing.countDocuments(branchFilter),
      PaymentProcessing.countDocuments({
        ...branchFilter,
        status: "Payment Pending",
      }),
      PaymentProcessing.countDocuments({
        ...branchFilter,
        status: "Payment Raised",
      }),
      PaymentProcessing.countDocuments({
        ...branchFilter,
        status: "Accounts Approved",
      }),
      PaymentProcessing.countDocuments({
        ...branchFilter,
        status: "Excel Generated",
      }),
      PaymentProcessing.countDocuments({
        ...branchFilter,
        status: "Payment Rejected",
      }),
      PaymentProcessing.aggregate([
        {
          $match: {
            ...branchFilter,
            status: { $in: ["Accounts Approved", "Excel Generated"] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$paymentAmount" },
            avg: { $avg: "$paymentAmount" },
          },
        },
      ]),
      PaymentProcessing.countDocuments({
        ...branchFilter,
        createdAt: { $gte: startOfMonth },
      }),
    ]);

    // ── Vendor Stats (non-branch roles) ───────────────────
    let vendorStats = null;
    if (!["branch_user", "branch_partner"].includes(role)) {
      const [totalVendors, pendingVendors, approvedVendors, rejectedVendors] =
        await Promise.all([
          Vendor.countDocuments(branchFilter),
          Vendor.countDocuments({
            ...branchFilter,
            approvalStatus: "pending_approval",
          }),
          Vendor.countDocuments({
            ...branchFilter,
            approvalStatus: "approved",
          }),
          Vendor.countDocuments({
            ...branchFilter,
            approvalStatus: "rejected",
          }),
        ]);
      vendorStats = {
        total: totalVendors,
        pending: pendingVendors,
        approved: approvedVendors,
        rejected: rejectedVendors,
      };
    }

    // ── Pending actions for current user ──────────────────
    const pendingActions = await getPendingActionsForRole(role, req.user);

    // ── Recent activity (last 5 audit logs) ───────────────
    const recentActivity = await AuditLog.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("action module createdAt");

    res.json({
      invoice: {
        total: totalInvoices,
        draft: draftInvoices,
        submitted: submittedInvoices,
        accountsApproved: accountsApprovedInvoices,
        partnerApproved: partnerApprovedInvoices,
        clusterApproved: clusterApprovedInvoices,
        rejected: rejectedInvoices,
        pendingApproval:
          submittedInvoices +
          accountsApprovedInvoices +
          partnerApprovedInvoices,
        totalAmount: invoiceAmountAgg[0]?.total || 0,
        avgAmount: Math.round(invoiceAmountAgg[0]?.avg || 0),
        thisMonth: monthlyInvoices,
      },
      payment: {
        total: totalPayments,
        pending: paymentPending,
        raised: paymentRaised,
        approved: paymentApproved,
        excel: excelGenerated,
        rejected: paymentRejected,
        totalAmount: paymentAmountAgg[0]?.total || 0,
        thisMonth: monthlyPayments,
      },
      vendor: vendorStats,
      pendingActions,
      recentActivity,
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ message: err.message });
  }
};

// Helper — what needs action from this role right now
async function getPendingActionsForRole(role, user) {
  // AFTER
  const branchFilter = [
    "branch_user",
    "branch_partner",
    "accounts",
    "cluster_head",
  ].includes(role)
    ? { branch: { $in: user.branches.map((b) => b._id) } }
    : {};

  const actions = [];

  // AFTER
  if (role === "accounts") {
    const [invoiceApprove, paymentApprove, vendorApprove] = await Promise.all([
      InvoiceRequest.countDocuments({
        ...branchFilter,
        status: "Partner Approved",
      }),
      PaymentProcessing.countDocuments({
        ...branchFilter,
        status: "Payment Raised",
      }),
      Vendor.countDocuments({
        ...branchFilter,
        approvalStatus: "pending_approval",
      }),
    ]);
    if (invoiceApprove > 0)
      actions.push({
        label: "Invoices awaiting your approval",
        count: invoiceApprove,
        path: "/invoices",
        color: "#2563eb",
      });
    if (paymentApprove > 0)
      actions.push({
        label: "Payments awaiting approval",
        count: paymentApprove,
        path: "/payments",
        color: "#16a34a",
      });
    if (vendorApprove > 0)
      actions.push({
        label: "Vendors awaiting approval",
        count: vendorApprove,
        path: "/vendors",
        color: "#d97706",
      });
  }

  if (role === "branch_partner") {
    const count = await InvoiceRequest.countDocuments({
      ...branchFilter,
      status: "Submitted", // partner acts first now
    });
    if (count > 0)
      actions.push({
        label: "Invoices awaiting your verification",
        count,
        path: "/invoices",
        color: "#7c3aed",
      });
  }

  if (role === "cluster_head") {
    const count = await InvoiceRequest.countDocuments({
      ...branchFilter,
      status: "Accounts Approved", // cluster head acts after accounts now
    });
    if (count > 0)
      actions.push({
        label: "Invoices awaiting your approval",
        count,
        path: "/invoices",
        color: "#d97706",
      });
  }

  if (role === "branch_user") {
    const [drafts, rejected, paymentPending] = await Promise.all([
      InvoiceRequest.countDocuments({
        ...branchFilter,
        status: "Draft",
        createdBy: user._id,
      }),
      InvoiceRequest.countDocuments({ ...branchFilter, status: "Rejected" }),
      PaymentProcessing.countDocuments({
        ...branchFilter,
        status: "Payment Pending",
      }),
    ]);
    if (drafts > 0)
      actions.push({
        label: "Draft invoices to submit",
        count: drafts,
        path: "/invoices",
        color: "#475569",
      });
    if (rejected > 0)
      actions.push({
        label: "Rejected invoices to revise",
        count: rejected,
        path: "/invoices",
        color: "#dc2626",
      });
    if (paymentPending > 0)
      actions.push({
        label: "Approved invoices ready to pay",
        count: paymentPending,
        path: "/payments",
        color: "#16a34a",
      });
  }

  return actions;
}

// ── Financial Report ───────────────────────────────────────
exports.getFinancialReport = async (req, res) => {
  try {
    // AFTER
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59));

    const branchScope = buildReportBranchScope(req.user); // ✅ branch restriction

    const invoiceMatch = {
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      ...branchScope,
    };
    const paymentMatch = {
      ...invoiceMatch, // inherits both date + branch scope
      status: { $in: ["Accounts Approved", "Excel Generated"] },
    };

    // Invoice: branch-wise
    const branchWiseInvoices = await InvoiceRequest.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: "$branch",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netPayable" },
          avgAmount: { $avg: "$netPayable" },
        },
      },
      {
        $lookup: {
          from: "branches",
          localField: "_id",
          foreignField: "_id",
          as: "branch",
        },
      },
      { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
      { $sort: { totalAmount: -1 } },
    ]);

    // Invoice: status-wise
    const statusWise = await InvoiceRequest.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netPayable" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // Invoice: expense type
    const expenseTypeWise = await InvoiceRequest.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: "$expenseType",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netPayable" },
        },
      },
    ]);

    // Invoice: priority
    const priorityWise = await InvoiceRequest.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netPayable" },
        },
      },
    ]);

    // Monthly trend — invoices
    const invoiceMonthlyTrend = await InvoiceRequest.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$netPayable" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Monthly trend — payments
    const paymentMonthlyTrend = await PaymentProcessing.aggregate([
      { $match: paymentMatch },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$paymentAmount" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Top vendors by invoice amount
    const topVendors = await InvoiceRequest.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: "$vendor",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netPayable" },
        },
      },
      {
        $lookup: {
          from: "vendors",
          localField: "_id",
          foreignField: "_id",
          as: "vendor",
        },
      },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
      { $sort: { totalAmount: -1 } },
      { $limit: 10 },
    ]);

    // Grand totals
    const [invoiceTotalAgg, paymentTotalAgg] = await Promise.all([
      InvoiceRequest.aggregate([
        { $match: invoiceMatch },
        {
          $group: {
            _id: null,
            total: { $sum: "$netPayable" },
            count: { $sum: 1 },
          },
        },
      ]),
      PaymentProcessing.aggregate([
        { $match: paymentMatch },
        {
          $group: {
            _id: null,
            total: { $sum: "$paymentAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    res.json({
      summary: {
        totalInvoiceAmount: invoiceTotalAgg[0]?.total || 0,
        totalInvoiceCount: invoiceTotalAgg[0]?.count || 0,
        totalPaymentAmount: paymentTotalAgg[0]?.total || 0,
        totalPaymentCount: paymentTotalAgg[0]?.count || 0,
      },
      branchWiseInvoices,
      statusWise,
      expenseTypeWise,
      priorityWise,
      invoiceMonthlyTrend,
      paymentMonthlyTrend,
      topVendors,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Excel Export: Financial Report ────────────────────────
exports.exportFinancialExcel = async (req, res) => {
  try {
    // AFTER
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59));

    const branchScope = buildReportBranchScope(req.user); // ✅ branch restriction
    const invoiceMatch = {
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      ...branchScope,
    };

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "HHC Accounts IMS";

    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A3C6E" },
    };
    const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    const border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };

    // ── Sheet 1: All Invoices ─────────────────────────────
    const invSheet = workbook.addWorksheet("Invoices");
    invSheet.columns = [
      { header: "Request ID", key: "requestId", width: 16 },
      { header: "Branch", key: "branch", width: 20 },
      { header: "Vendor", key: "vendor", width: 22 },
      { header: "Expense Type", key: "expenseType", width: 14 },
      { header: "Category", key: "category", width: 18 },
      { header: "Invoice No.", key: "invoiceNumber", width: 18 },
      { header: "Invoice Date", key: "invoiceDate", width: 14 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Status", key: "status", width: 22 },
      { header: "Base Amount", key: "amount", width: 15 },
      { header: "GST (₹)", key: "gst", width: 12 },
      { header: "TDS (₹)", key: "tds", width: 12 },
      { header: "Net Payable", key: "netPayable", width: 15 },
      { header: "Created At", key: "createdAt", width: 16 },
    ];
    const invHeader = invSheet.getRow(1);
    invHeader.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = border;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    invHeader.height = 28;

    const invoices = await InvoiceRequest.find(invoiceMatch)
      .populate("branch", "name")
      .populate("vendor", "vendorName")
      .populate("expenseCategory", "name")
      .sort({ createdAt: -1 });

    invoices.forEach((inv, idx) => {
      const row = invSheet.addRow({
        requestId: inv.requestId,
        branch: inv.branch?.name || "—",
        vendor: inv.vendor?.vendorName || "—",
        expenseType: inv.expenseType,
        category: inv.expenseCategory?.name || "—",
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate
          ? new Date(inv.invoiceDate).toLocaleDateString("en-GB")
          : "—",
        priority: inv.priority,
        status: inv.status,
        amount: inv.amount || 0,
        gst: inv.gstAmount || 0,
        tds: inv.tdsAmount || 0,
        netPayable: inv.netPayable || 0,
        createdAt: new Date(inv.createdAt).toLocaleDateString("en-GB"),
      });
      const fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" },
      };
      row.eachCell((cell) => {
        cell.border = border;
        cell.fill = fill;
        cell.alignment = { vertical: "middle" };
      });
      ["amount", "gst", "tds", "netPayable"].forEach((k) => {
        const c = row.getCell(k);
        c.numFmt = "#,##0.00";
        c.alignment = { horizontal: "right", vertical: "middle" };
      });
      row.height = 20;
    });

    // ── Sheet 2: Branch Summary ───────────────────────────
    const brSheet = workbook.addWorksheet("Branch Summary");
    brSheet.columns = [
      { header: "Branch", key: "branch", width: 22 },
      { header: "Invoice Count", key: "count", width: 14 },
      { header: "Total Amount", key: "totalAmount", width: 18 },
      { header: "Avg Amount", key: "avgAmount", width: 16 },
    ];
    const brHeader = brSheet.getRow(1);
    brHeader.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = border;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    const branchData = await InvoiceRequest.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: "$branch",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netPayable" },
          avgAmount: { $avg: "$netPayable" },
        },
      },
      {
        $lookup: {
          from: "branches",
          localField: "_id",
          foreignField: "_id",
          as: "branch",
        },
      },
      { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
      { $sort: { totalAmount: -1 } },
    ]);
    branchData.forEach((b, idx) => {
      const row = brSheet.addRow({
        branch: b.branch?.name || "Unknown",
        count: b.count,
        totalAmount: b.totalAmount,
        avgAmount: Math.round(b.avgAmount),
      });
      const fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" },
      };
      row.eachCell((cell) => {
        cell.border = border;
        cell.fill = fill;
      });
      ["totalAmount", "avgAmount"].forEach((k) => {
        const c = row.getCell(k);
        c.numFmt = "#,##0.00";
        c.alignment = { horizontal: "right" };
      });
    });

    // ── Sheet 3: Status Summary ───────────────────────────
    const stSheet = workbook.addWorksheet("Status Summary");
    stSheet.columns = [
      { header: "Status", key: "status", width: 26 },
      { header: "Count", key: "count", width: 12 },
      { header: "Total Amount", key: "totalAmount", width: 18 },
    ];
    const stHeader = stSheet.getRow(1);
    stHeader.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = border;
    });
    const statusData = await InvoiceRequest.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netPayable" },
        },
      },
      { $sort: { count: -1 } },
    ]);
    statusData.forEach((s, idx) => {
      const row = stSheet.addRow({
        status: s._id,
        count: s.count,
        totalAmount: s.totalAmount,
      });
      const fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" },
      };
      row.eachCell((cell) => {
        cell.border = border;
        cell.fill = fill;
      });
      const c = row.getCell("totalAmount");
      c.numFmt = "#,##0.00";
      c.alignment = { horizontal: "right" };
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Financial_Report_${timestamp}.xlsx`,
    );
    res.setHeader("Cache-Control", "no-cache");
    const buffer = await workbook.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    console.error("Financial Excel error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ── Excel Export: Audit Logs ───────────────────────────────
exports.exportAuditExcel = async (req, res) => {
  try {
    const { from, to, module: mod, action } = req.query;
    const query = {};
    if (mod) query.module = mod;
    if (action) query.action = { $regex: action, $options: "i" };
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to)
        query.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59));
    }

    const logs = await AuditLog.find(query)
      .populate("user", "name email role")
      .sort({ createdAt: -1 })
      .limit(5000);

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Audit Logs");
    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A3C6E" },
    };
    const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    const border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };

    sheet.columns = [
      { header: "Timestamp", key: "timestamp", width: 20 },
      { header: "User", key: "user", width: 22 },
      { header: "Email", key: "email", width: 26 },
      { header: "Role", key: "role", width: 16 },
      { header: "Action", key: "action", width: 28 },
      { header: "Module", key: "module", width: 16 },
    ];
    const hRow = sheet.getRow(1);
    hRow.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.border = border;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    hRow.height = 28;

    logs.forEach((log, idx) => {
      const row = sheet.addRow({
        timestamp: new Date(log.createdAt).toLocaleString("en-GB"),
        user: log.user?.name || "System",
        email: log.user?.email || "—",
        role: log.user?.role?.replace(/_/g, " ") || "—",
        action: log.action,
        module: log.module || "—",
      });
      const fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" },
      };
      row.eachCell((cell) => {
        cell.border = border;
        cell.fill = fill;
        cell.alignment = { vertical: "middle" };
      });
      row.height = 20;
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Audit_Logs_${timestamp}.xlsx`,
    );
    res.setHeader("Cache-Control", "no-cache");
    const buffer = await workbook.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    console.error("Audit Excel error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 30, module, action, from, to } = req.query;
    const query = {};
    if (module) query.module = module;
    if (action) query.action = { $regex: action, $options: "i" };
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to)
        query.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    const total = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
      .populate("user", "name email role")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const actionStats = await AuditLog.aggregate([
      { $match: query },
      { $group: { _id: "$module", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      logs,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      actionStats,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
