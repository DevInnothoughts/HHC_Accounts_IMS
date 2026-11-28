// ============================================================
// BACKEND: src/controllers/doctorTallyController.js — NEW FILE
// ------------------------------------------------------------
// TallyPrime import file for DOCTOR PAYMENTS — a separate option on the
// Tally Export screen, with its own preview and download. Same file
// layout and the same rules of use as the invoice export:
//
//   GET  /api/tally/doctors/preview  ?branch&from&to&includeExported=1
//   POST /api/tally/doctors/export   { branch, from, to, includeExported }
//
// One branch per file (each branch is its own company in Tally).
// Included: Doctor Referral and Surgeon records approved by the Cluster /
// Department Head in the period (approved, in payment or paid).
// By default only records not yet exported; the export stamps tallyExport
// on each record and writes one audit entry.
// ============================================================
const mongoose = require("mongoose");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const DoctorPayout = require("../models/DoctorPayout");
const Branch = require("../models/Branch");
const cfg = require("../config/doctorPayoutConfig");
const { logAction } = require("../services/auditService");
const access = require("../utils/vendorAccess");
const {
  TALLY_COLUMNS,
  toRows,
  fmtDate,
} = require("../services/tallyExportService");
const { buildDoctorVoucher } = require("../services/doctorTallyService");

const RS = cfg.PAYOUT_STATUS;
const APPROVED_ONWARDS = [RS.APPROVED, RS.RAISED, RS.FILE_GENERATED, RS.PAID];
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;
const MAX_VOUCHERS = 5000;

// Same validation as the invoice export.
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
  if (isNaN(start.getTime()) || isNaN(end.getTime()))
    return { error: "Select the From and To dates" };
  if (end < start) return { error: "To date is before From date" };
  if ((end - start) / 86400000 > MAX_DAYS)
    return { error: `Choose a period of at most ${MAX_DAYS} days` };
  const type = Object.values(cfg.TYPES).includes(src.type) ? src.type : "";
  const branchDoc = await Branch.findById(branch).select("name code").lean();
  if (!branchDoc) return { error: "Branch not found", status: 404 };
  return { branch, branchDoc, start, end, includeExported, type, from, to };
};

const collect = async ({ branch, start, end, includeExported, type }) => {
  const query = {
    branch,
    status: { $in: APPROVED_ONWARDS },
    approvedAt: { $gte: start, $lte: end },
  };
  if (type) query.type = type;
  if (!includeExported) query["tallyExport.exportedAt"] = { $exists: false };

  const payouts = await DoctorPayout.find(query)
    .select(
      "payoutId type doctor doctorName panNumber batch date approvedAt patientName noOfSurgeries basicAmount tdsAmount payableAmount tallyExport",
    )
    .populate("doctor", "name panNumber")
    .populate("batch", "batchId")
    .sort({ approvedAt: 1, payoutId: 1 })
    .limit(MAX_VOUCHERS + 1)
    .lean();
  return payouts.map(buildDoctorVoucher);
};

const summarise = (vouchers) => ({
  vouchers: vouchers.length,
  journal: vouchers.length,
  purchase: 0,
  debitNote: 0,
  referral: vouchers.filter((v) => v.payoutType === cfg.TYPES.REFERRAL).length,
  surgeon: vouchers.filter((v) => v.payoutType === cfg.TYPES.SURGEON).length,
  amount: Math.round(vouchers.reduce((s, v) => s + v.drTotal, 0) * 100) / 100,
  withWarnings: vouchers.filter((v) => v.warnings.length).length,
  alreadyExported: vouchers.filter((v) => v.exportedAt).length,
});

const tooMany = (res) =>
  res.status(400).json({
    message: `More than ${MAX_VOUCHERS} records in this period — choose a shorter period`,
  });

// ── GET /api/tally/doctors/preview ─────────────────────────
exports.preview = async (req, res) => {
  try {
    const p = await parseParams(req.query, req);
    if (p.error) return res.status(p.status || 400).json({ message: p.error });
    const vouchers = await collect(p);
    if (vouchers.length > MAX_VOUCHERS) return tooMany(res);
    res.json({
      branch: p.branchDoc,
      source: "doctors",
      ledgers: cfg.TALLY.EXPENSE_LEDGER,
      summary: summarise(vouchers),
      vouchers: vouchers.map((v) => ({
        ...v,
        voucherDate: fmtDate(v.voucherDate),
        refDate: fmtDate(v.refDate),
      })),
    });
  } catch (err) {
    console.error("Doctor Tally preview error:", err);
    res.status(500).json({ message: "Could not prepare the Tally preview" });
  }
};

// ── POST /api/tally/doctors/export ─────────────────────────
exports.exportExcel = async (req, res) => {
  try {
    const p = await parseParams(req.body || {}, req);
    if (p.error) return res.status(p.status || 400).json({ message: p.error });
    const vouchers = await collect(p);
    if (vouchers.length > MAX_VOUCHERS) return tooMany(res);
    if (!vouchers.length)
      return res.status(404).json({
        message: p.includeExported
          ? "No approved doctor payments in this period"
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
    [12, 12, 14, 18, 12, 60, 10, 32, 14, 8, 10, 10, 10, 10, 10, 10].forEach(
      (w, i) => (ws.getColumn(i + 1).width = w),
    );
    ws.getColumn(9).numFmt = "0.00";
    ws.views = [{ state: "frozen", ySplit: 1 }];

    // Sheet 2 — checklist for Accounts (Tally ignores it)
    const chk = wb.addWorksheet("Check Before Import");
    chk.addRow([
      "Voucher No.",
      "Type",
      "Voucher Date",
      "Doctor",
      "PAN",
      "Dr Total",
      "Cr Total",
      "PMS Payable",
      "Previously Exported",
      "Check",
    ]);
    chk.getRow(1).font = { bold: true };
    vouchers.forEach((v) => {
      const row = chk.addRow([
        v.voucherNumber,
        cfg.TYPE_LABELS[v.payoutType] || v.payoutType,
        fmtDate(v.voucherDate),
        v.vendorName,
        v.panNumber,
        v.drTotal,
        v.crTotal,
        v.pmsNetPayable,
        v.exportedAt ? fmtDate(v.exportedAt) : "",
        v.warnings.join(" • ") || "OK",
      ]);
      if (v.warnings.length)
        row.getCell(10).font = { color: { argb: "FFB45309" } };
    });
    [14, 18, 12, 30, 13, 13, 13, 14, 14, 90].forEach(
      (w, i) => (chk.getColumn(i + 1).width = w),
    );
    [6, 7, 8].forEach((c) => (chk.getColumn(c).numFmt = "#,##0.00"));

    const buffer = await wb.xlsx.writeBuffer();

    // Stamp the exported records (their own optional field only)
    const batchId = `TALLY-DR-${new Date().toISOString().slice(0, 10)}-${crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()}`;
    await DoctorPayout.updateMany(
      {
        _id: {
          $in: vouchers.map((v) => new mongoose.Types.ObjectId(v.sourceId)),
        },
      },
      {
        $set: {
          "tallyExport.exportedAt": new Date(),
          "tallyExport.exportedBy": req.user._id,
          "tallyExport.batchId": batchId,
        },
        $inc: { "tallyExport.count": 1 },
      },
    );

    const s = summarise(vouchers);
    await logAction({
      userId: req.user._id,
      action: "TALLY_EXPORT_DOCTOR_PAYMENTS",
      module: "DoctorPayout",
      targetLabel: `${batchId} · ${p.branchDoc.name} · ${p.from} to ${p.to}`,
      branch: p.branch,
      amount: s.amount,
      newValue: {
        batchId,
        vouchers: s.vouchers,
        referral: s.referral,
        surgeon: s.surgeon,
        reExported: s.alreadyExported,
        voucherNumbers: vouchers.slice(0, 500).map((v) => v.voucherNumber),
      },
      req,
    });

    const fname = `Tally_Doctors_${(p.branchDoc.code || p.branchDoc.name).replace(/[^\w-]+/g, "_")}_${p.from}_to_${p.to}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Doctor Tally export error:", err);
    res.status(500).json({ message: "Could not generate the Tally file" });
  }
};
