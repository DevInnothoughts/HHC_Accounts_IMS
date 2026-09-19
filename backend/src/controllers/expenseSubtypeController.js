// ============================================================
// Vendor Master, Phase 5 — REPLACE WHOLE FILE. Vendor counts, top vendor,
// concentration % and the duplicate-invoice audit flag now group on the
// REAL vendor (Vendor Master → PAN → branch row; utils/vendorIdentity.js).
// Before, the same supplier used by five branches counted as five vendors
// and its concentration share was split five ways. Nothing else changed.
// ============================================================
// ============================================================
// BACKEND: src/controllers/expenseSubtypeController.js — NEW FILE
// ------------------------------------------------------------
// Subtype (ExpenseCategory) wise expense report for the accounts and
// audit team. Three endpoints:
//   getSubtypeReport     — the table, plus a subtype x branch matrix
//   getSubtypeInvoices   — drill-down: the invoices behind one cell
//   exportSubtypeExcel   — four-sheet workbook for the audit file
//
// Period is measured on invoiceDate by default, not createdAt: an
// invoice dated 28 March and entered on 4 April belongs to March in
// the books. Pass ?dateField=createdAt for entry-date behaviour.
//
// Read only. No model or document is modified.
// ============================================================
const mongoose = require("mongoose");
const InvoiceRequest = require("../models/InvoiceRequest");
const Branch = require("../models/Branch");
const { REPORT_TZ, BRANCH_SCOPED_ROLES } = require("../config/reportConfig");
const { vendorIdentityStages } = require("../utils/vendorIdentity");

const toId = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null;

const idList = (raw) =>
  String(raw || "")
    .split(",")
    .map((s) => toId(s.trim()))
    .filter(Boolean);

const resolveBranchIds = (user, requested) => {
  const assigned = BRANCH_SCOPED_ROLES.includes(user.role)
    ? (user.branches || []).map((b) => b._id || b)
    : null;
  const asked = idList(requested);
  if (!assigned) return asked.length ? asked : null;
  if (!asked.length) return assigned;
  const allowed = new Set(assigned.map(String));
  return asked.filter((id) => allowed.has(String(id)));
};

// Statuses that represent committed spend. Anything else is still in
// flight and should not be read as an expense figure.
const APPROVED = "Cluster Head Approved";
const IN_FLIGHT = [
  "Draft",
  "Submitted",
  "Partner Approved",
  "Accounts Approved",
];

const buildMatch = (req) => {
  const { from, to, branch, expenseType, status, dateField } = req.query;

  const field = dateField === "createdAt" ? "createdAt" : "invoiceDate";
  const branchIds = resolveBranchIds(req.user, branch);

  const match = {};

  if (from || to) {
    match[field] = {};
    if (from) match[field].$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      match[field].$lte = end;
    }
  }
  if (branchIds) match.branch = { $in: branchIds };

  // Default excludes drafts: an unsubmitted invoice is not an expense.
  if (status === "all") {
    /* no status filter */
  } else if (status === "approved") {
    match.status = APPROVED;
  } else if (status) {
    match.status = status;
  } else {
    match.status = { $ne: "Draft" };
  }

  return {
    match,
    field,
    branchIds,
    // The report is scoped to one expense type at a time; Revenue is
    // the one with a populated subtype list.
    expenseType: expenseType === "Capital" ? "Capital" : "Revenue",
    statusMode: status || "excludeDrafts",
  };
};

// ============================================================
// Subtype table + subtype x branch matrix
// ============================================================
exports.getSubtypeReport = async (req, res) => {
  try {
    const { match, field, branchIds, expenseType, statusMode } =
      buildMatch(req);

    const base = [
      { $match: match },
      {
        $lookup: {
          from: "expensecategories",
          localField: "expenseCategory",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      // Group on the category's own type so the subtype list always
      // reconciles to its parent total.
      { $match: { "category.type": expenseType } },
      {
        $lookup: {
          from: "paymentprocessings",
          localField: "paymentRequest",
          foreignField: "_id",
          as: "payment",
        },
      },
      { $unwind: { path: "$payment", preserveNullAndEmptyArrays: true } },
      // ✅ Vendor Master: one identity per REAL vendor (master → PAN → row),
      // so a vendor used by five branches counts once, not five times.
      ...vendorIdentityStages("vendor"),
      {
        $set: {
          paidAmount: { $ifNull: ["$payment.paidAmount", 0] },
          isApproved: { $eq: ["$status", APPROVED] },
          hasInvoiceDoc: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$attachments", []] },
                    as: "a",
                    cond: { $eq: ["$$a.type", "invoice"] },
                  },
                },
              },
              0,
            ],
          },
          wasRejected: {
            $gt: [{ $size: { $ifNull: ["$rejectionHistory", []] } }, 0],
          },
        },
      },
    ];

    const subtypeGroup = {
      _id: "$expenseCategory",
      code: { $first: "$category.code" },
      name: { $first: "$category.name" },
      categoryStatus: { $first: "$category.status" },

      invoices: { $sum: 1 },
      vendorSet: { $addToSet: "$vendorKey" },

      baseAmount: { $sum: { $ifNull: ["$amount", 0] } },
      gstAmount: { $sum: { $ifNull: ["$gstAmount", 0] } },
      tdsAmount: { $sum: { $ifNull: ["$tdsAmount", 0] } },
      roundOff: { $sum: { $ifNull: ["$roundOff", 0] } },
      netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
      paid: { $sum: "$paidAmount" },

      approvedNet: {
        $sum: { $cond: ["$isApproved", { $ifNull: ["$netPayable", 0] }, 0] },
      },
      approvedCount: { $sum: { $cond: ["$isApproved", 1, 0] } },
      inFlightNet: {
        $sum: {
          $cond: [
            { $in: ["$status", IN_FLIGHT] },
            { $ifNull: ["$netPayable", 0] },
            0,
          ],
        },
      },

      avgValue: { $avg: { $ifNull: ["$netPayable", 0] } },
      maxInvoice: { $max: { $ifNull: ["$netPayable", 0] } },
      firstDate: { $min: `$${field}` },
      lastDate: { $max: `$${field}` },

      // ── Audit flags ──────────────────────────────────────
      missingInvoiceDoc: { $sum: { $cond: ["$hasInvoiceDoc", 0, 1] } },
      zeroTdsApproved: {
        $sum: {
          $cond: [
            {
              $and: [
                "$isApproved",
                { $eq: [{ $ifNull: ["$tdsAmount", 0] }, 0] },
              ],
            },
            1,
            0,
          ],
        },
      },
      reworked: { $sum: { $cond: ["$wasRejected", 1, 0] } },
      // A round-off should be pennies. Anything above a rupee is a
      // manual adjustment worth eyeballing.
      largeRoundOff: {
        $sum: {
          $cond: [{ $gt: [{ $abs: { $ifNull: ["$roundOff", 0] } }, 1] }, 1, 0],
        },
      },
    };

    const [result] = await InvoiceRequest.aggregate([
      ...base,
      {
        $facet: {
          subtypes: [{ $group: subtypeGroup }, { $sort: { netPayable: -1 } }],

          // subtype x branch, for the pivot
          matrix: [
            {
              $group: {
                _id: { category: "$expenseCategory", branch: "$branch" },
                invoices: { $sum: 1 },
                netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
                paid: { $sum: "$paidAmount" },
              },
            },
          ],

          // Vendor concentration inside each subtype
          vendorSplit: [
            {
              $group: {
                _id: { category: "$expenseCategory", vendor: "$vendorKey" },
                netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
                vendorName: { $first: "$vendorLabel" },
              },
            },
            { $sort: { netPayable: -1 } },
          ],

          // Same invoice number twice for the same REAL vendor under the
          // same GSTIN — now also across branches (the bill paid twice).
          duplicates: [
            {
              $group: {
                _id: {
                  vendor: "$vendorKey",
                  gst: "$vendorGst",
                  invoiceNumber: { $toUpper: { $trim: { input: { $ifNull: ["$invoiceNumber", ""] } } } },
                },
                count: { $sum: 1 },
                netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
                requestIds: { $push: "$requestId" },
                categoryName: { $first: "$category.name" },
                vendorName: { $first: "$vendorLabel" },
                branchCount: { $addToSet: "$branch" },
              },
            },
            { $match: { count: { $gt: 1 }, "_id.invoiceNumber": { $ne: "" } } },
            { $sort: { netPayable: -1 } },
            { $limit: 50 },
          ],

          monthly: [
            {
              $group: {
                _id: {
                  category: "$expenseCategory",
                  y: { $year: { date: `$${field}`, timezone: REPORT_TZ } },
                  m: { $month: { date: `$${field}`, timezone: REPORT_TZ } },
                },
                netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
              },
            },
            { $sort: { "_id.y": 1, "_id.m": 1 } },
          ],
        },
      },
    ]);

    // Top vendor share per subtype
    const topVendor = {};
    const categoryTotal = {};
    (result.vendorSplit || []).forEach((v) => {
      const cid = String(v._id.category);
      categoryTotal[cid] = (categoryTotal[cid] || 0) + v.netPayable;
      if (!topVendor[cid]) {
        topVendor[cid] = {
          name: v.vendorName || "Unknown",
          amount: v.netPayable,
        };
      }
    });

    const subtypes = (result.subtypes || []).map((s) => {
      const cid = String(s._id);
      const tv = topVendor[cid];
      const total = categoryTotal[cid] || 0;
      return {
        categoryId: s._id,
        code: s.code || "—",
        name: s.name || "Uncategorised",
        categoryStatus: s.categoryStatus || "unknown",
        invoices: s.invoices,
        vendors: (s.vendorSet || []).length,
        baseAmount: s.baseAmount,
        gstAmount: s.gstAmount,
        tdsAmount: s.tdsAmount,
        roundOff: s.roundOff,
        netPayable: s.netPayable,
        paid: s.paid,
        outstanding: Math.max(0, s.netPayable - s.paid),
        approvedNet: s.approvedNet,
        approvedCount: s.approvedCount,
        inFlightNet: s.inFlightNet,
        avgValue: Math.round(s.avgValue || 0),
        maxInvoice: s.maxInvoice,
        firstDate: s.firstDate,
        lastDate: s.lastDate,
        topVendor: tv?.name || "—",
        topVendorShare:
          total > 0 && tv ? Math.round((tv.amount / total) * 1000) / 10 : null,
        flags: {
          missingInvoiceDoc: s.missingInvoiceDoc,
          zeroTdsApproved: s.zeroTdsApproved,
          reworked: s.reworked,
          largeRoundOff: s.largeRoundOff,
        },
      };
    });

    const sum = (k) => subtypes.reduce((a, s) => a + (s[k] || 0), 0);

    const branchDocs = await Branch.find(
      branchIds ? { _id: { $in: branchIds } } : {},
    )
      .select("name")
      .sort({ name: 1 })
      .lean();

    res.json({
      filters: {
        expenseType,
        dateField: field,
        statusMode,
        from: req.query.from || null,
        to: req.query.to || null,
      },
      subtypes,
      totals: {
        subtypeCount: subtypes.length,
        invoices: sum("invoices"),
        baseAmount: sum("baseAmount"),
        gstAmount: sum("gstAmount"),
        tdsAmount: sum("tdsAmount"),
        roundOff: sum("roundOff"),
        netPayable: sum("netPayable"),
        paid: sum("paid"),
        outstanding: sum("outstanding"),
        approvedNet: sum("approvedNet"),
        inFlightNet: sum("inFlightNet"),
      },
      branches: branchDocs.map((b) => ({
        branchId: b._id,
        branchName: b.name,
      })),
      matrix: (result.matrix || []).map((m) => ({
        categoryId: m._id.category,
        branchId: m._id.branch,
        invoices: m.invoices,
        netPayable: m.netPayable,
        paid: m.paid,
      })),
      monthly: (result.monthly || []).map((m) => ({
        categoryId: m._id.category,
        year: m._id.y,
        month: m._id.m,
        netPayable: m.netPayable,
      })),
      auditFlags: {
        duplicateInvoiceNumbers: (result.duplicates || []).map((d) => ({
          vendor: d.vendorName || "Unknown",
          crossBranch: (d.branchCount || []).length > 1,
          invoiceNumber: d._id.invoiceNumber,
          category: d.categoryName || "—",
          count: d.count,
          netPayable: d.netPayable,
          requestIds: d.requestIds,
        })),
      },
    });
  } catch (err) {
    console.error("getSubtypeReport error:", err);
    res.status(500).json({ message: "Could not build the subtype report" });
  }
};

// ============================================================
// Drill-down: the invoices behind one subtype (optionally one branch)
// ============================================================
exports.getSubtypeInvoices = async (req, res) => {
  try {
    const { match, field } = buildMatch(req);
    const categoryId = toId(req.params.categoryId);
    if (!categoryId)
      return res
        .status(400)
        .json({ message: "A valid category id is required" });

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const query = { ...match, expenseCategory: categoryId };
    if (req.query.branchId) {
      const b = toId(req.query.branchId);
      // Never widen past the caller's own scope.
      if (
        b &&
        (!match.branch || match.branch.$in.some((x) => String(x) === String(b)))
      )
        query.branch = b;
    }

    const [total, invoices] = await Promise.all([
      InvoiceRequest.countDocuments(query),
      InvoiceRequest.find(query)
        .populate("branch", "name")
        .populate("vendor", "vendorName companyName panNumber gstNumber")
        .populate("createdBy", "name")
        .populate(
          "paymentRequest",
          "paidAmount remainingAmount status utrNumber paymentDate",
        )
        .select(
          "requestId invoiceNumber invoiceDate dueDate amount gstAmount tdsAmount tdsPercentage roundOff netPayable status createdAt attachments rejectionHistory",
        )
        .sort({ [field]: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    res.json({
      total,
      page,
      pages: Math.ceil(total / limit),
      invoices: invoices.map((i) => ({
        ...i,
        hasInvoiceDoc: (i.attachments || []).some((a) => a.type === "invoice"),
        reworked: (i.rejectionHistory || []).length > 0,
        attachments: undefined,
        rejectionHistory: undefined,
      })),
    });
  } catch (err) {
    console.error("getSubtypeInvoices error:", err);
    res.status(500).json({ message: "Could not load the invoice list" });
  }
};

// ============================================================
// Excel export — four sheets for the audit file
// ============================================================
exports.exportSubtypeExcel = async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const { match, field, expenseType } = buildMatch(req);

    // Reuse the JSON builder so the workbook can never drift from the
    // on-screen table.
    const captured = {};
    await exports.getSubtypeReport(req, {
      json: (payload) => Object.assign(captured, payload),
      status: () => ({ json: () => {} }),
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "HHC Accounts IMS";
    wb.created = new Date();

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
    const money = "#,##0.00";

    const styleHeader = (sheet) => {
      const h = sheet.getRow(1);
      h.eachCell((c) => {
        c.fill = headerFill;
        c.font = headerFont;
        c.border = border;
        c.alignment = { vertical: "middle", wrapText: true };
      });
      h.height = 26;
      sheet.views = [{ state: "frozen", ySplit: 1 }];
    };

    const stripe = (sheet, moneyKeys = []) => {
      sheet.eachRow((row, i) => {
        if (i === 1) return;
        row.eachCell((c) => {
          c.border = border;
          c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: i % 2 ? "FFFFFFFF" : "FFF8FAFC" },
          };
        });
        moneyKeys.forEach((k) => {
          const c = row.getCell(k);
          c.numFmt = money;
          c.alignment = { horizontal: "right" };
        });
      });
    };

    // ── Sheet 1: subtype summary ──────────────────────────
    const s1 = wb.addWorksheet(`${expenseType} Subtypes`);
    s1.columns = [
      { header: "Code", key: "code", width: 10 },
      { header: "Subtype", key: "name", width: 38 },
      { header: "Invoices", key: "invoices", width: 10 },
      { header: "Vendors", key: "vendors", width: 9 },
      { header: "Taxable value", key: "baseAmount", width: 16 },
      { header: "GST", key: "gstAmount", width: 14 },
      { header: "TDS", key: "tdsAmount", width: 13 },
      { header: "Round off", key: "roundOff", width: 11 },
      { header: "Net payable", key: "netPayable", width: 16 },
      { header: "Paid", key: "paid", width: 15 },
      { header: "Outstanding", key: "outstanding", width: 15 },
      { header: "Approved value", key: "approvedNet", width: 16 },
      { header: "Still in workflow", key: "inFlightNet", width: 16 },
      { header: "Avg invoice", key: "avgValue", width: 13 },
      { header: "Largest invoice", key: "maxInvoice", width: 15 },
      { header: "Top vendor", key: "topVendor", width: 26 },
      { header: "Top vendor %", key: "topVendorShare", width: 12 },
      { header: "No invoice doc", key: "missingInvoiceDoc", width: 13 },
      { header: "Approved, nil TDS", key: "zeroTdsApproved", width: 15 },
      { header: "Reworked", key: "reworked", width: 10 },
    ];
    (captured.subtypes || []).forEach((s) =>
      s1.addRow({
        ...s,
        missingInvoiceDoc: s.flags.missingInvoiceDoc,
        zeroTdsApproved: s.flags.zeroTdsApproved,
        reworked: s.flags.reworked,
      }),
    );
    const t = captured.totals || {};
    const totalRow = s1.addRow({
      name: "TOTAL",
      invoices: t.invoices,
      baseAmount: t.baseAmount,
      gstAmount: t.gstAmount,
      tdsAmount: t.tdsAmount,
      roundOff: t.roundOff,
      netPayable: t.netPayable,
      paid: t.paid,
      outstanding: t.outstanding,
      approvedNet: t.approvedNet,
      inFlightNet: t.inFlightNet,
    });
    styleHeader(s1);
    stripe(s1, [
      "baseAmount",
      "gstAmount",
      "tdsAmount",
      "roundOff",
      "netPayable",
      "paid",
      "outstanding",
      "approvedNet",
      "inFlightNet",
      "avgValue",
      "maxInvoice",
    ]);
    totalRow.font = { bold: true };

    // ── Sheet 2: subtype x branch ─────────────────────────
    const s2 = wb.addWorksheet("Branch Matrix");
    const branches = captured.branches || [];
    s2.columns = [
      { header: "Code", key: "code", width: 10 },
      { header: "Subtype", key: "name", width: 38 },
      ...branches.map((b) => ({
        header: b.branchName,
        key: String(b.branchId),
        width: 16,
      })),
      { header: "Total", key: "__total", width: 16 },
    ];
    const cell = {};
    (captured.matrix || []).forEach((m) => {
      cell[`${m.categoryId}|${m.branchId}`] = m.netPayable;
    });
    (captured.subtypes || []).forEach((s) => {
      const row = { code: s.code, name: s.name, __total: s.netPayable };
      branches.forEach((b) => {
        row[String(b.branchId)] = cell[`${s.categoryId}|${b.branchId}`] || 0;
      });
      s2.addRow(row);
    });
    styleHeader(s2);
    stripe(s2, [...branches.map((b) => String(b.branchId)), "__total"]);

    // ── Sheet 3: invoice register ─────────────────────────
    const s3 = wb.addWorksheet("Invoice Register");
    s3.columns = [
      { header: "Request ID", key: "requestId", width: 14 },
      { header: "Invoice date", key: "invoiceDate", width: 13 },
      { header: "Invoice no.", key: "invoiceNumber", width: 20 },
      { header: "Branch", key: "branch", width: 20 },
      { header: "Vendor", key: "vendor", width: 26 },
      { header: "PAN", key: "pan", width: 13 },
      { header: "GSTIN", key: "gstin", width: 18 },
      { header: "Code", key: "code", width: 10 },
      { header: "Subtype", key: "category", width: 30 },
      { header: "Taxable value", key: "amount", width: 15 },
      { header: "GST", key: "gstAmount", width: 13 },
      { header: "TDS %", key: "tdsPercentage", width: 8 },
      { header: "TDS", key: "tdsAmount", width: 13 },
      { header: "Round off", key: "roundOff", width: 11 },
      { header: "Net payable", key: "netPayable", width: 15 },
      { header: "Status", key: "status", width: 20 },
      { header: "Paid", key: "paid", width: 14 },
      { header: "UTR", key: "utr", width: 20 },
      { header: "Paid on", key: "paidOn", width: 12 },
      { header: "Invoice doc", key: "doc", width: 11 },
    ];

    const register = await InvoiceRequest.find(match)
      .populate("branch", "name")
      .populate("vendor", "vendorName panNumber gstNumber")
      .populate("expenseCategory", "name code type")
      .populate("paymentRequest", "paidAmount utrNumber paymentDate")
      .sort({ [field]: 1 })
      .lean();

    const d = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "");
    register
      .filter((i) => i.expenseCategory?.type === expenseType)
      .forEach((i) =>
        s3.addRow({
          requestId: i.requestId,
          invoiceDate: d(i.invoiceDate),
          invoiceNumber: i.invoiceNumber,
          branch: i.branch?.name || "",
          vendor: i.vendor?.vendorName || "",
          pan: i.vendor?.panNumber || "",
          gstin: i.vendor?.gstNumber || "",
          code: i.expenseCategory?.code || "",
          category: i.expenseCategory?.name || "",
          amount: i.amount || 0,
          gstAmount: i.gstAmount || 0,
          tdsPercentage: i.tdsPercentage ?? "",
          tdsAmount: i.tdsAmount || 0,
          roundOff: i.roundOff || 0,
          netPayable: i.netPayable || 0,
          status: i.status,
          paid: i.paymentRequest?.paidAmount || 0,
          utr: i.paymentRequest?.utrNumber || "",
          paidOn: d(i.paymentRequest?.paymentDate),
          doc: (i.attachments || []).some((a) => a.type === "invoice")
            ? "Yes"
            : "MISSING",
        }),
      );
    styleHeader(s3);
    stripe(s3, [
      "amount",
      "gstAmount",
      "tdsAmount",
      "roundOff",
      "netPayable",
      "paid",
    ]);
    s3.autoFilter = { from: "A1", to: { row: 1, column: s3.columns.length } };

    // ── Sheet 4: audit flags ──────────────────────────────
    const s4 = wb.addWorksheet("Audit Flags");
    s4.columns = [
      { header: "Flag", key: "flag", width: 26 },
      { header: "Subtype", key: "subtype", width: 34 },
      { header: "Detail", key: "detail", width: 46 },
      { header: "Count", key: "count", width: 9 },
      { header: "Value", key: "value", width: 16 },
    ];
    (captured.subtypes || []).forEach((s) => {
      if (s.flags.missingInvoiceDoc)
        s4.addRow({
          flag: "No invoice document",
          subtype: `${s.code} ${s.name}`,
          detail: "Invoice attachment absent",
          count: s.flags.missingInvoiceDoc,
        });
      if (s.flags.zeroTdsApproved)
        s4.addRow({
          flag: "Approved with nil TDS",
          subtype: `${s.code} ${s.name}`,
          detail: "Fully approved but no TDS deducted",
          count: s.flags.zeroTdsApproved,
        });
      if (s.flags.largeRoundOff)
        s4.addRow({
          flag: "Round off over Rs 1",
          subtype: `${s.code} ${s.name}`,
          detail: "Manual adjustment beyond rounding",
          count: s.flags.largeRoundOff,
        });
      if (s.topVendorShare !== null && s.topVendorShare >= 75)
        s4.addRow({
          flag: "Vendor concentration",
          subtype: `${s.code} ${s.name}`,
          detail: `${s.topVendor} accounts for ${s.topVendorShare}% of this subtype`,
          count: 1,
          value: s.netPayable,
        });
    });
    (captured.auditFlags?.duplicateInvoiceNumbers || []).forEach((dup) =>
      s4.addRow({
        flag: "Duplicate invoice number",
        subtype: dup.category,
        detail: `${dup.vendor} — invoice ${dup.invoiceNumber} (${dup.requestIds.join(", ")})`,
        count: dup.count,
        value: dup.netPayable,
      }),
    );
    if (s4.rowCount === 1)
      s4.addRow({ flag: "None", detail: "No flags raised for this period" });
    styleHeader(s4);
    stripe(s4, ["value"]);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${expenseType}_Subtype_Report_${stamp}.xlsx`,
    );
    res.setHeader("Cache-Control", "no-cache");
    res.send(await wb.xlsx.writeBuffer());
  } catch (err) {
    console.error("exportSubtypeExcel error:", err);
    res.status(500).json({ message: "Could not build the workbook" });
  }
};
