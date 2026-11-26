// ============================================================
// BACKEND: src/controllers/tallyExportController.js — NEW FILE (Nov 2026)
// ------------------------------------------------------------
// TallyPrime import file for Accounts. One branch per file (each branch
// is its own company in Tally).
//
//   GET  /api/tally/preview  ?branch&from&to&includeExported=1
//   POST /api/tally/export   { branch, from, to, includeExported }
//
// Included:
//   • Invoices at "Accounts Approved" or "Cluster Head Approved" whose
//     latest Accounts approval falls in the period (fixed-payment invoices
//     included — they carry an automatic Accounts approval).
//   • Credit notes approved in the period → Debit Note vouchers.
// By default only records not yet exported. Export stamps tallyExport on
// each record (additive optional field) and writes one audit entry.
// ============================================================
const mongoose = require("mongoose");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const InvoiceRequest = require("../models/InvoiceRequest");
const CreditNote = require("../models/CreditNote");
const Branch = require("../models/Branch");
const { INVOICE_STATUS } = require("../config/constants");
const { logAction } = require("../services/auditService");
const access = require("../utils/vendorAccess");
const {
  TALLY_COLUMNS,
  buildInvoiceVoucher,
  buildDebitNoteVoucher,
  buildPartTdsVoucher,
  accountsApprovalDate,
  toRows,
  fmtDate,
} = require("../services/tallyExportService");

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

// Validates input and returns { branch, start, end, includeExported } or { error }.
const parseParams = async (src, req) => {
  const { branch, from, to } = src;
  const includeExported = ["1", "true", true].includes(src.includeExported);
  if (!mongoose.isValidObjectId(branch)) return { error: "Select a branch" };
  if (!access.canAccessBranch(req, branch))
    return {
      error: "This branch is not in your assigned branches",
      status: 403,
    };
  if (!DATE_RX.test(String(from || "")) || !DATE_RX.test(String(to || "")))
    return { error: "Select the From and To dates" };
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${to}T23:59:59.999+05:30`);
  if (end < start) return { error: "To date is before From date" };
  if ((end - start) / 86400000 > MAX_DAYS)
    return { error: `Choose a period of at most ${MAX_DAYS} days` };
  const branchDoc = await Branch.findById(branch).select("name code").lean();
  if (!branchDoc) return { error: "Branch not found", status: 404 };
  return { branch, branchDoc, start, end, includeExported };
};

const inPeriod = (d, start, end) =>
  d && new Date(d) >= start && new Date(d) <= end;

const collect = async ({ branch, start, end, includeExported }) => {
  const invQuery = {
    branch,
    status: {
      $in: [INVOICE_STATUS.ACCOUNTS_APPROVED, INVOICE_STATUS.CLUSTER_APPROVED],
    },
    // Accounts approval updates the document, so anything approved in the
    // period was last updated on or after the period start.
    updatedAt: { $gte: start },
  };
  if (!includeExported) invQuery["tallyExport.exportedAt"] = { $exists: false };

  const invoices = await InvoiceRequest.find(invQuery)
    .populate("vendor", "vendorName")
    .populate("expenseCategory", "name code type")
    .lean();

  const cnQuery = {
    branch,
    status: CreditNote.STATUS.APPROVED,
    decidedAt: { $gte: start, $lte: end },
  };
  if (!includeExported) cnQuery["tallyExport.exportedAt"] = { $exists: false };
  const notes = await CreditNote.find(cnQuery)
    .populate({
      path: "invoice",
      select:
        "requestId invoiceNumber invoiceDate tdsPercentage gstType expenseCategory vendor items",
      populate: [
        { path: "expenseCategory", select: "name code type" },
        { path: "vendor", select: "vendorName" },
      ],
    })
    .populate("vendor", "vendorName")
    .lean();

  // Part payments (Nov 2026): TDS on later parts, one journal per part,
  // dated the day Accounts approved the part.
  const partElem = {
    partNo: { $gt: 1 },
    status: { $in: ["Accounts Approved", "Approved"] },
    tdsAmount: { $gt: 0 },
    tdsAppliedAt: { $gte: start, $lte: end },
  };
  if (!includeExported) partElem["tallyExport.exportedAt"] = { $exists: false };
  const partInvoices = await InvoiceRequest.find({
    branch,
    status: INVOICE_STATUS.CLUSTER_APPROVED,
    "paymentPlan.mode": "partial",
    "paymentPlan.parts": { $elemMatch: partElem },
  })
    .populate("vendor", "vendorName")
    .populate("expenseCategory", "name code type")
    .lean();
  const partVouchers = [];
  for (const inv of partInvoices) {
    for (const part of inv.paymentPlan.parts || []) {
      if (
        part.partNo > 1 &&
        ["Accounts Approved", "Approved"].includes(part.status) &&
        part.tdsAmount > 0 &&
        inPeriod(part.tdsAppliedAt, start, end) &&
        (includeExported || !part.tallyExport?.exportedAt)
      )
        partVouchers.push(buildPartTdsVoucher(inv, part));
    }
  }

  const vouchers = [
    ...invoices
      .filter((inv) => inPeriod(accountsApprovalDate(inv) || null, start, end))
      .map(buildInvoiceVoucher),
    ...partVouchers,
    ...notes.map(buildDebitNoteVoucher),
  ];
  // Date order, invoices before debit notes on the same day
  vouchers.sort(
    (a, b) =>
      new Date(a.voucherDate) - new Date(b.voucherDate) ||
      (a.kind === b.kind
        ? 0
        : a.kind === "invoice"
          ? -1
          : b.kind === "invoice"
            ? 1
            : a.kind === "invoice_part"
              ? -1
              : 1) ||
      String(a.voucherNumber).localeCompare(String(b.voucherNumber)),
  );
  return vouchers;
};

const summarise = (vouchers) => ({
  vouchers: vouchers.length,
  journal: vouchers.filter((v) => v.voucherType === "Journal").length,
  partTds: vouchers.filter((v) => v.kind === "invoice_part").length,
  purchase: vouchers.filter((v) => v.voucherType === "Purchase").length,
  debitNote: vouchers.filter((v) => v.voucherType === "Debit Note").length,
  withWarnings: vouchers.filter((v) => v.warnings.length).length,
  alreadyExported: vouchers.filter((v) => v.exportedAt).length,
});

// ── GET /api/tally/preview ─────────────────────────────────
exports.preview = async (req, res) => {
  try {
    const p = await parseParams(req.query, req);
    if (p.error) return res.status(p.status || 400).json({ message: p.error });
    const vouchers = await collect(p);
    res.json({
      branch: p.branchDoc,
      summary: summarise(vouchers),
      vouchers: vouchers.map((v) => ({
        ...v,
        voucherDate: fmtDate(v.voucherDate),
        refDate: fmtDate(v.refDate),
      })),
    });
  } catch (err) {
    console.error("Tally preview error:", err);
    res.status(500).json({ message: "Could not prepare the Tally preview" });
  }
};

// ── POST /api/tally/export ─────────────────────────────────
exports.exportExcel = async (req, res) => {
  try {
    const p = await parseParams(req.body || {}, req);
    if (p.error) return res.status(p.status || 400).json({ message: p.error });
    const vouchers = await collect(p);
    if (!vouchers.length)
      return res.status(404).json({
        message: p.includeExported
          ? "No approved invoices or credit notes in this period"
          : "Nothing new to export for this period (tick 'Include already exported' to export again)",
      });

    const wb = new ExcelJS.Workbook();
    wb.creator = "HHC PMS";
    wb.created = new Date();

    // Sheet 1 — exactly the Accounts team's import layout
    const ws = wb.addWorksheet("Tally Import");
    ws.addRow(TALLY_COLUMNS);
    ws.getRow(1).font = { bold: true };
    toRows(vouchers).forEach((r) => ws.addRow(r));
    const widths = [
      12, 12, 14, 18, 12, 60, 10, 32, 14, 8, 10, 10, 10, 10, 10, 10,
    ];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.getColumn(9).numFmt = "0.00";
    ws.views = [{ state: "frozen", ySplit: 1 }];

    // Sheet 2 — checklist for Accounts (Tally ignores it)
    const chk = wb.addWorksheet("Check Before Import");
    chk.addRow([
      "Voucher No.",
      "Type",
      "Voucher Date",
      "Vendor",
      "GST Type",
      "Dr Total",
      "Cr Total",
      "PMS Net / Reduction",
      "Previously Exported",
      "Check",
    ]);
    chk.getRow(1).font = { bold: true };
    vouchers.forEach((v) => {
      const row = chk.addRow([
        v.voucherNumber,
        v.voucherType,
        fmtDate(v.voucherDate),
        v.vendorName,
        v.gstType === "CGST_SGST" ? "CGST+SGST" : "IGST",
        v.drTotal,
        v.crTotal,
        v.pmsNetPayable,
        v.exportedAt ? fmtDate(v.exportedAt) : "",
        v.warnings.join(" • ") || "OK",
      ]);
      if (v.warnings.length)
        row.getCell(10).font = { color: { argb: "FFB45309" } };
    });
    [14, 12, 12, 30, 11, 13, 13, 16, 14, 90].forEach(
      (w, i) => (chk.getColumn(i + 1).width = w),
    );
    [6, 7, 8].forEach((c) => (chk.getColumn(c).numFmt = "#,##0.00"));

    const buffer = await wb.xlsx.writeBuffer();

    // Stamp the exported records (additive optional field only)
    const batchId = `TALLY-${new Date().toISOString().slice(0, 10)}-${crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()}`;
    const stamp = (ids) => [
      { _id: { $in: ids } },
      [
        {
          $set: {
            tallyExport: {
              exportedAt: "$$NOW",
              exportedBy: req.user._id,
              batchId,
              count: { $add: [{ $ifNull: ["$tallyExport.count", 0] }, 1] },
            },
          },
        },
      ],
    ];
    const invIds = vouchers
      .filter((v) => v.kind === "invoice")
      .map((v) => new mongoose.Types.ObjectId(v.sourceId));
    const cnIds = vouchers
      .filter((v) => v.kind === "credit_note")
      .map((v) => new mongoose.Types.ObjectId(v.sourceId));
    if (invIds.length) await InvoiceRequest.updateMany(...stamp(invIds));
    if (cnIds.length) await CreditNote.updateMany(...stamp(cnIds));
    // Part TDS journals (Nov 2026): stamp the part inside the invoice
    const partsByInvoice = {};
    for (const v of vouchers.filter((x) => x.kind === "invoice_part"))
      (partsByInvoice[v.invoiceId] = partsByInvoice[v.invoiceId] || []).push(
        v.partNo,
      );
    const partOps = Object.entries(partsByInvoice).map(([id, nums]) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(id) },
        update: {
          $set: {
            "paymentPlan.parts.$[p].tallyExport": {
              exportedAt: new Date(),
              exportedBy: req.user._id,
              batchId,
            },
          },
        },
        arrayFilters: [{ "p.partNo": { $in: nums } }],
      },
    }));
    if (partOps.length) await InvoiceRequest.bulkWrite(partOps);

    const s = summarise(vouchers);
    await logAction({
      userId: req.user._id,
      action: "TALLY_EXPORT",
      module: "Invoice",
      targetLabel: `${batchId} · ${p.branchDoc.name} · ${req.body.from} to ${req.body.to}`,
      branch: p.branch,
      newValue: {
        batchId,
        vouchers: s.vouchers,
        journal: s.journal,
        purchase: s.purchase,
        debitNote: s.debitNote,
        reExported: s.alreadyExported,
        voucherNumbers: vouchers.map((v) => v.voucherNumber),
      },
      req,
    });

    const fname = `Tally_${(p.branchDoc.code || p.branchDoc.name).replace(/[^\w-]+/g, "_")}_${req.body.from}_to_${req.body.to}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Tally export error:", err);
    res.status(500).json({ message: "Could not generate the Tally file" });
  }
};
