// ============================================================
// BACKEND: src/controllers/vendorReportController.js  —  NEW FILE
// ------------------------------------------------------------
// Vendor analysis for management and the accounts team.
//
//   getVendorReport   GET /api/reports/vendors
//       Vendor-wise totals, vendor × branch matrix, monthly trend,
//       concentration, and outstanding ageing — for every vendor in scope.
//   getVendorDetail   GET /api/reports/vendors/detail?key=<vendorKey>
//       One vendor: branch-wise, month-wise, subtype-wise, and the
//       invoice and payment lists behind them.
//
// TWO BASES (?basis=)
//   invoice  (default) — "what was billed": invoices in the period by
//            invoice date (or entry date), with their approval and payment
//            position. Answers: how much do we buy from whom, what is
//            still owed, how fast do we pay.
//   payment  — "what was paid": each UTR-recorded installment in the
//            period by its payment date. Answers: how much money went to
//            whom this month / quarter, from which branch.
//
// ONE VENDOR = ONE ROW. Uses the same identity as the rest of the
// reports (utils/vendorIdentity.js): the PAN, else the branch record.
// A supplier used by five branches is one vendor with five branches —
// before and after its records were linked to the Vendor Master.
//
// Read only. Branch scoping follows the other primary reports: branch-
// restricted roles only ever see their assigned branches.
// ============================================================
const mongoose = require("mongoose");
const InvoiceRequest = require("../models/InvoiceRequest");
const PaymentProcessing = require("../models/PaymentProcessing");
const Vendor = require("../models/Vendor");
const VendorMaster = require("../models/VendorMaster");
const Branch = require("../models/Branch");
const {
  REPORT_TZ,
  BRANCH_SCOPED_ROLES,
  EXPENSE_TYPE_SOURCE,
} = require("../config/reportConfig");
const { vendorIdentityStages } = require("../utils/vendorIdentity");

// ── Constants ───────────────────────────────────────────────
const APPROVED = "Cluster Head Approved";
const IN_FLIGHT = ["Submitted", "Partner Approved", "Accounts Approved"];
// Parent statuses meaning "paid in full". "Payment Processed" is the
// status used before installments existed.
const FULLY_PAID = ["Fully Paid", "Payment Processed"];
// Parent statuses meaning money has gone out (legacy records without
// an installments array are read from their top-level fields).
const LEGACY_PAID = ["Payment Processed", "Partially Paid", "Fully Paid"];
const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 1000; // invoice / payment rows in the detail view

// ── Small helpers ───────────────────────────────────────────
const toId = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null;
const str = (v) => (typeof v === "string" ? v.trim() : "");
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUM = (f) => ({ $ifNull: [f, 0] });
const idStr = (v) => (v == null ? "" : String(v));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// YYYY-MM-DD → the start / end of that day in IST. null for anything that
// is not a real calendar date (2026-13-01, 2026-02-31).
const validDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const dayStart = (s) => (validDay(s) ? new Date(`${s}T00:00:00.000+05:30`) : null);
const dayEnd = (s) => (validDay(s) ? new Date(`${s}T23:59:59.999+05:30`) : null);

const resolveBranchIds = (user, requested) => {
  const assigned = BRANCH_SCOPED_ROLES.includes(user.role)
    ? (user.branches || []).map((b) => b._id || b)
    : null;
  const asked = String(requested || "")
    .split(",")
    .map((s) => toId(s.trim()))
    .filter(Boolean);
  if (!assigned) return asked.length ? asked : null;
  if (!asked.length) return assigned;
  const allowed = new Set(assigned.map(String));
  return asked.filter((id) => allowed.has(String(id)));
};

class BadRequest extends Error {}

// Every query value goes through str()/toId() — qs can turn
// ?status[$ne]=x into an object, which must never reach a filter.
const parseFilters = (req) => {
  const q = req.query;
  const from = str(q.from);
  const to = str(q.to);
  if (from && !dayStart(from)) throw new BadRequest("From date is not a valid date (YYYY-MM-DD)");
  if (to && !dayEnd(to)) throw new BadRequest("To date is not a valid date (YYYY-MM-DD)");
  if (from && to && from > to) throw new BadRequest("The end date is before the start date");

  const expenseType = ["Revenue", "Capital"].includes(str(q.expenseType))
    ? str(q.expenseType)
    : "";
  const category = str(q.category) ? toId(str(q.category)) : null;
  if (str(q.category) && !category) throw new BadRequest("Invalid subtype");

  return {
    basis: str(q.basis) === "payment" ? "payment" : "invoice",
    from: from ? dayStart(from) : null,
    to: to ? dayEnd(to) : null,
    branchIds: resolveBranchIds(req.user, str(q.branch)),
    expenseType,
    category,
    status: ["approved", "inflight", "all", "withdrafts"].includes(str(q.status))
      ? str(q.status)
      : "",
    dateField: str(q.dateField) === "createdAt" ? "createdAt" : "invoiceDate",
    search: str(q.search).slice(0, 60),
  };
};

const rangeMatch = (from, to) => {
  if (!from && !to) return null;
  const m = {};
  if (from) m.$gte = from;
  if (to) m.$lte = to;
  return m;
};

// Category lookup + Revenue/Capital + subtype filter, for a path that
// holds the expenseCategory id and the invoice's own expenseType.
const categoryStages = (catPath, typePath, f) => {
  const stages = [
    {
      $lookup: {
        from: "expensecategories",
        localField: catPath,
        foreignField: "_id",
        as: "_cat",
      },
    },
    { $set: { _cat: { $arrayElemAt: ["$_cat", 0] } } },
  ];
  if (f.category) stages.push({ $match: { [catPath]: f.category } });
  if (f.expenseType) {
    stages.push({
      $match:
        EXPENSE_TYPE_SOURCE === "invoice"
          ? { [typePath]: f.expenseType }
          : { "_cat.type": f.expenseType },
    });
  }
  return stages;
};

// Narrow to one vendor (detail view) and/or a name / PAN search.
const vendorFilterStages = (f, key) => {
  const stages = [];
  if (key) {
    stages.push({ $match: { $expr: { $eq: [{ $toString: "$vendorKey" }, key] } } });
  }
  if (f.search) {
    const rx = escapeRx(f.search);
    stages.push({
      $match: {
        $or: [
          { vendorLabel: { $regex: rx, $options: "i" } },
          { vendorCompany: { $regex: rx, $options: "i" } },
          { $expr: { $regexMatch: { input: { $toString: "$vendorKey" }, regex: rx, options: "i" } } },
        ],
      },
    });
  }
  return stages;
};

// Branch vendor rows that can belong to vendor `key` — used to narrow the
// scan before the identity lookup. The exact key is re-checked after it.
const candidateVendorIds = async (key) => {
  if (PAN_RX.test(key)) {
    const rows = await Vendor.find({
      panNumber: { $regex: `^\\s*${key}\\s*$`, $options: "i" },
    })
      .select("_id")
      .lean();
    return rows.map((r) => r._id);
  }
  const id = toId(key);
  if (!id) return [];
  const rows = await Vendor.find({ $or: [{ _id: id }, { vendorMaster: id }] })
    .select("_id")
    .lean();
  return rows.map((r) => r._id);
};

// ── Invoice basis: one document per invoice ────────────────
const invoiceBase = (f, { vendorIds = null, key = null } = {}) => {
  const match = {};
  const range = rangeMatch(f.from, f.to);
  if (range) match[f.dateField] = range;
  if (f.branchIds) match.branch = { $in: f.branchIds };
  if (vendorIds) match.vendor = { $in: vendorIds };
  if (f.status === "approved") match.status = APPROVED;
  else if (f.status === "inflight") match.status = { $in: IN_FLIGHT };
  else if (f.status === "all") match.status = { $ne: "Draft" };
  else if (f.status === "withdrafts") {
    /* everything */
  } else match.status = { $nin: ["Draft", "Rejected"] };

  const now = new Date();
  return [
    { $match: match },
    ...categoryStages("expenseCategory", "expenseType", f),
    {
      $lookup: {
        from: "paymentprocessings",
        localField: "paymentRequest",
        foreignField: "_id",
        as: "_pay",
      },
    },
    { $set: { _pay: { $arrayElemAt: ["$_pay", 0] } } },
    ...vendorIdentityStages("vendor"),
    ...vendorFilterStages(f, key),
    {
      $set: {
        _date: `$${f.dateField}`,
        _net: NUM("$netPayable"),
        // Invoice value = taxable + GST + round-off (before TDS), so
        // value − TDS reconciles to net payable.
        _gross: { $add: [NUM("$amount"), NUM("$gstAmount"), NUM("$roundOff")] },
        _paid: NUM("$_pay.paidAmount"),
        _approved: { $eq: ["$status", APPROVED] },
        _inFlight: { $in: ["$status", IN_FLIGHT] },
        // Latest payment actually made: the newest processed installment's
        // value date (its UTR entry time when no value date was typed —
        // the date is optional in the UTR screens). The parent's own
        // paymentDate is only set when a date was typed, so it is a
        // fallback for records that predate installments.
        _payDate: {
          $ifNull: [
            {
              $max: {
                $map: {
                  input: {
                    $filter: {
                      input: { $ifNull: ["$_pay.installments", []] },
                      as: "i",
                      cond: { $eq: ["$$i.status", "Processed"] },
                    },
                  },
                  as: "i",
                  in: { $ifNull: ["$$i.paymentDate", "$$i.utrRecordedAt"] },
                },
              },
            },
            { $ifNull: ["$_pay.paymentDate", "$_pay.utrRecordedAt"] },
          ],
        },
        _fullyPaid: { $in: [{ $ifNull: ["$_pay.status", ""] }, FULLY_PAID] },
      },
    },
    {
      $set: {
        // Owed = approved but not yet paid. In-flight invoices are not a
        // liability until the approval chain finishes.
        _out: {
          $cond: ["$_approved", { $max: [0, { $subtract: ["$_net", "$_paid"] }] }, 0],
        },
        // Clamped at 0: invoice dates are stored as UTC midnight (05:30
        // IST), and a mistyped future date must still land in a bucket.
        _age: { $max: [0, { $divide: [{ $subtract: [now, "$invoiceDate"] }, DAY_MS] }] },
        _dtp: {
          $cond: [
            { $and: ["$_fullyPaid", { $gt: ["$_payDate", null] }] },
            { $max: [0, { $divide: [{ $subtract: ["$_payDate", "$invoiceDate"] }, DAY_MS] }] },
            null,
          ],
        },
      },
    },
  ];
};

const bucket = (lo, hi) => ({
  $sum: {
    $cond: [
      {
        $and: [
          { $gt: ["$_out", 0] },
          { $gte: ["$_age", lo] },
          ...(hi == null ? [] : [{ $lt: ["$_age", hi] }]),
        ],
      },
      "$_out",
      0,
    ],
  },
});

const invoiceMeasures = {
  invoices: { $sum: 1 },
  gross: { $sum: "$_gross" },
  gst: { $sum: NUM("$gstAmount") },
  tds: { $sum: NUM("$tdsAmount") },
  net: { $sum: "$_net" },
  paid: { $sum: "$_paid" },
  approvedNet: { $sum: { $cond: ["$_approved", "$_net", 0] } },
  inFlightNet: { $sum: { $cond: ["$_inFlight", "$_net", 0] } },
  outstanding: { $sum: "$_out" },
  age0_30: bucket(0, 31),
  age31_60: bucket(31, 61),
  age61_90: bucket(61, 91),
  age90p: bucket(91, null),
  avgDaysToPay: { $avg: "$_dtp" },
  firstDate: { $min: "$_date" },
  lastDate: { $max: "$_date" },
  lastPayment: { $max: "$_payDate" },
};

// ── Payment basis: one document per UTR-recorded installment ──
const paymentBase = (f, { vendorIds = null, key = null } = {}) => {
  const match = {};
  if (f.branchIds) match.branch = { $in: f.branchIds };
  if (vendorIds) match.vendor = { $in: vendorIds };
  const range = rangeMatch(f.from, f.to);
  return [
    { $match: match },
    // Records that predate the installments array carry their payment in
    // top-level fields — read them as one installment (same approach as
    // primaryReportController), so no historical payment is left out.
    {
      $set: {
        _inst: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ["$installments", []] } }, 0] },
            "$installments",
            [
              {
                status: { $cond: [{ $in: ["$status", LEGACY_PAID] }, "Processed", "legacy"] },
                amount: {
                  $cond: [
                    { $gt: [NUM("$paidAmount"), 0] },
                    "$paidAmount",
                    { $ifNull: ["$paymentAmount", "$totalAmount"] },
                  ],
                },
                paymentDate: "$paymentDate",
                utrRecordedAt: "$utrRecordedAt",
                utrNumber: "$utrNumber",
                paymentId: "$paymentId",
                legacyUpdatedAt: "$updatedAt",
              },
            ],
          ],
        },
      },
    },
    { $unwind: "$_inst" },
    { $match: { "_inst.status": "Processed" } },
    {
      $set: {
        // Value date; the UTR entry time when no value date was given.
        _date: {
          $ifNull: [
            "$_inst.paymentDate",
            { $ifNull: ["$_inst.utrRecordedAt", "$_inst.legacyUpdatedAt"] },
          ],
        },
        _amt: NUM("$_inst.amount"),
      },
    },
    { $match: { _date: { $ne: null } } },
    ...(range ? [{ $match: { _date: range } }] : []),
    {
      $lookup: {
        from: "invoicerequests",
        localField: "invoiceRequest",
        foreignField: "_id",
        as: "_inv",
      },
    },
    { $set: { _inv: { $arrayElemAt: ["$_inv", 0] } } },
    ...categoryStages("_inv.expenseCategory", "_inv.expenseType", f),
    ...vendorIdentityStages("vendor"),
    ...vendorFilterStages(f, key),
  ];
};

const paymentMeasures = {
  payments: { $sum: 1 },
  paid: { $sum: "$_amt" },
  invoiceSet: { $addToSet: "$invoiceRequest" },
  firstDate: { $min: "$_date" },
  lastDate: { $max: "$_date" },
};

const monthKey = {
  y: { $year: { date: "$_date", timezone: REPORT_TZ } },
  m: { $month: { date: "$_date", timezone: REPORT_TZ } },
};

// Vendor Master name / status for PAN keys — the master's name is the
// canonical one; branch records may spell it differently.
const masterInfo = async (keys) => {
  const pans = keys.filter((k) => PAN_RX.test(k));
  if (!pans.length) return new Map();
  const list = await VendorMaster.find({ panNumber: { $in: pans } })
    .select("vendorName companyName panNumber status approvalStatus gstins")
    .lean();
  return new Map(list.map((m) => [m.panNumber, m]));
};

const branchNames = async (ids) => {
  const list = await Branch.find(ids ? { _id: { $in: ids } } : {})
    .select("name code")
    .sort({ name: 1 })
    .lean();
  return list;
};

const concentration = (values) => {
  const total = values.reduce((s, v) => s + v, 0);
  if (!total) return { total: 0, top5Share: 0, top10Share: 0, paretoCount: 0 };
  const sorted = [...values].sort((a, b) => b - a);
  const share = (n) => round2((sorted.slice(0, n).reduce((s, v) => s + v, 0) / total) * 100);
  let acc = 0;
  let pareto = 0;
  for (const v of sorted) {
    acc += v;
    pareto++;
    if (acc / total >= 0.8) break;
  }
  return { total, top5Share: share(5), top10Share: share(10), paretoCount: pareto };
};

const sendError = (res, err, what) => {
  if (err instanceof BadRequest) return res.status(400).json({ message: err.message });
  console.error(`${what} error:`, err);
  res.status(500).json({ message: `Could not load the ${what}` });
};

// ════════════════════════════════════════════════════════════
// GET /reports/vendors
// ════════════════════════════════════════════════════════════
exports.getVendorReport = async (req, res) => {
  try {
    const f = parseFilters(req);
    const isInv = f.basis === "invoice";
    const Model = isInv ? InvoiceRequest : PaymentProcessing;
    const base = isInv ? invoiceBase(f) : paymentBase(f);
    const measures = isInv ? invoiceMeasures : paymentMeasures;
    const valueField = isInv ? "$_net" : "$_amt";

    const [r] = await Model.aggregate([
      ...base,
      {
        $facet: {
          vendors: [
            {
              $group: {
                _id: "$vendorKey",
                name: { $first: "$vendorLabel" },
                company: { $first: "$vendorCompany" },
                vendorCategory: { $first: "$vendorCategory" },
                branchSet: { $addToSet: "$branch" },
                gstSet: { $addToSet: "$vendorGst" },
                ...measures,
              },
            },
          ],
          matrix: [
            {
              $group: {
                _id: { k: "$vendorKey", b: "$branch" },
                value: { $sum: valueField },
                count: { $sum: 1 },
                ...(isInv ? { paid: { $sum: "$_paid" }, outstanding: { $sum: "$_out" } } : {}),
              },
            },
          ],
          monthly: [
            {
              $group: {
                _id: monthKey,
                value: { $sum: valueField },
                count: { $sum: 1 },
                ...(isInv
                  ? { approved: { $sum: { $cond: ["$_approved", "$_net", 0] } } }
                  : {}),
              },
            },
            { $sort: { "_id.y": 1, "_id.m": 1 } },
          ],
        },
      },
    ]);

    const masters = await masterInfo((r.vendors || []).map((v) => idStr(v._id)));

    const vendors = (r.vendors || []).map((v) => {
      const key = idStr(v._id);
      const m = masters.get(key);
      const row = {
        key,
        name: m?.vendorName || v.name || "Unknown",
        company: m?.companyName || v.company || "",
        vendorCategory: v.vendorCategory || "",
        pan: PAN_RX.test(key) ? key : "",
        inMaster: Boolean(m),
        masterStatus: m ? m.status : null,
        branchCount: (v.branchSet || []).length,
        gstins: (v.gstSet || []).filter(Boolean),
        firstDate: v.firstDate,
        lastDate: v.lastDate,
      };
      if (isInv) {
        Object.assign(row, {
          invoices: v.invoices,
          gross: round2(v.gross),
          gst: round2(v.gst),
          tds: round2(v.tds),
          net: round2(v.net),
          paid: round2(v.paid),
          approvedNet: round2(v.approvedNet),
          inFlightNet: round2(v.inFlightNet),
          outstanding: round2(v.outstanding),
          age0_30: round2(v.age0_30),
          age31_60: round2(v.age31_60),
          age61_90: round2(v.age61_90),
          age90p: round2(v.age90p),
          avgDaysToPay: v.avgDaysToPay == null ? null : Math.round(v.avgDaysToPay),
          lastPayment: v.lastPayment || null,
          value: round2(v.net),
        });
      } else {
        Object.assign(row, {
          payments: v.payments,
          paid: round2(v.paid),
          invoices: (v.invoiceSet || []).length,
          avgPayment: v.payments ? round2(v.paid / v.payments) : 0,
          value: round2(v.paid),
        });
      }
      return row;
    });

    const conc = concentration(vendors.map((v) => v.value));
    vendors.forEach((v) => {
      v.share = conc.total ? round2((v.value / conc.total) * 100) : 0;
    });
    vendors.sort((a, b) => b.value - a.value);

    const sum = (k) => round2(vendors.reduce((s, v) => s + (Number(v[k]) || 0), 0));
    const totals = isInv
      ? {
          vendors: vendors.length,
          multiBranchVendors: vendors.filter((v) => v.branchCount > 1).length,
          invoices: sum("invoices"),
          gross: sum("gross"),
          gst: sum("gst"),
          tds: sum("tds"),
          net: sum("net"),
          paid: sum("paid"),
          approvedNet: sum("approvedNet"),
          inFlightNet: sum("inFlightNet"),
          outstanding: sum("outstanding"),
          age0_30: sum("age0_30"),
          age31_60: sum("age31_60"),
          age61_90: sum("age61_90"),
          age90p: sum("age90p"),
        }
      : {
          vendors: vendors.length,
          multiBranchVendors: vendors.filter((v) => v.branchCount > 1).length,
          payments: sum("payments"),
          paid: sum("paid"),
          invoices: sum("invoices"),
        };

    // Branches that appear in the matrix, named.
    const matrixBranchIds = [...new Set((r.matrix || []).map((c) => idStr(c._id.b)))]
      .map(toId)
      .filter(Boolean);
    const branches = (await branchNames(matrixBranchIds)).map((b) => ({
      _id: b._id,
      name: b.name,
      code: b.code || "",
    }));

    res.json({
      basis: f.basis,
      dateField: isInv ? f.dateField : "paymentDate",
      generatedAt: new Date(),
      totals,
      concentration: {
        top5Share: conc.top5Share,
        top10Share: conc.top10Share,
        paretoCount: conc.paretoCount,
      },
      vendors,
      matrix: {
        branches,
        cells: (r.matrix || []).map((c) => ({
          key: idStr(c._id.k),
          branch: idStr(c._id.b),
          value: round2(c.value),
          count: c.count,
          ...(isInv ? { paid: round2(c.paid), outstanding: round2(c.outstanding) } : {}),
        })),
      },
      monthly: (r.monthly || []).map((m) => ({
        y: m._id.y,
        m: m._id.m,
        value: round2(m.value),
        count: m.count,
        ...(isInv ? { approved: round2(m.approved) } : {}),
      })),
    });
  } catch (err) {
    sendError(res, err, "vendor report");
  }
};

// ════════════════════════════════════════════════════════════
// GET /reports/vendors/detail?key=<vendorKey>
// Both lenses for one vendor: invoices in the period (by invoice / entry
// date) and payments made in the period (by payment date).
// ════════════════════════════════════════════════════════════
exports.getVendorDetail = async (req, res) => {
  try {
    const f = parseFilters(req);
    const key = str(req.query.key);
    if (!key || !(PAN_RX.test(key) || toId(key)))
      return res.status(400).json({ message: "Invalid vendor" });

    const vendorIds = await candidateVendorIds(key);
    if (!vendorIds.length) return res.status(404).json({ message: "Vendor not found" });
    // The detail is about one vendor; a name search does not apply.
    const fd = { ...f, search: "" };

    const [inv] = await InvoiceRequest.aggregate([
      ...invoiceBase(fd, { vendorIds, key }),
      {
        $facet: {
          totals: [{ $group: { _id: null, ...invoiceMeasures } }],
          byBranch: [
            {
              $group: {
                _id: "$branch",
                gstSet: { $addToSet: "$vendorGst" },
                ...invoiceMeasures,
              },
            },
          ],
          monthly: [
            {
              $group: {
                _id: monthKey,
                net: { $sum: "$_net" },
                approved: { $sum: { $cond: ["$_approved", "$_net", 0] } },
                invoices: { $sum: 1 },
              },
            },
          ],
          byCategory: [
            {
              $group: {
                _id: "$expenseCategory",
                code: { $first: "$_cat.code" },
                name: { $first: "$_cat.name" },
                invoices: { $sum: 1 },
                net: { $sum: "$_net" },
                paid: { $sum: "$_paid" },
              },
            },
            { $sort: { net: -1 } },
          ],
          list: [
            { $sort: { _date: -1 } },
            { $limit: LIST_LIMIT },
            {
              $project: {
                requestId: 1,
                invoiceNumber: 1,
                invoiceDate: 1,
                createdAt: 1,
                branch: 1,
                status: 1,
                category: { $ifNull: ["$_cat.name", ""] },
                gross: "$_gross",
                tds: NUM("$tdsAmount"),
                net: "$_net",
                paid: "$_paid",
                outstanding: "$_out",
                paymentStatus: { $ifNull: ["$_pay.status", ""] },
                lastPayment: "$_payDate",
                gstin: "$vendorGst",
              },
            },
          ],
          count: [{ $count: "n" }],
        },
      },
    ]);

    const [pay] = await PaymentProcessing.aggregate([
      ...paymentBase(fd, { vendorIds, key }),
      {
        $facet: {
          totals: [{ $group: { _id: null, ...paymentMeasures } }],
          byBranch: [{ $group: { _id: "$branch", ...paymentMeasures } }],
          monthly: [{ $group: { _id: monthKey, paid: { $sum: "$_amt" }, payments: { $sum: 1 } } }],
          list: [
            { $sort: { _date: -1 } },
            { $limit: LIST_LIMIT },
            {
              $project: {
                _id: 0,
                paymentId: { $ifNull: ["$_inst.paymentId", "$paymentId"] },
                paymentDate: "$_date",
                utr: "$_inst.utrNumber",
                amount: "$_amt",
                branch: 1,
                requestId: "$_inv.requestId",
                invoiceNumber: "$_inv.invoiceNumber",
              },
            },
          ],
          count: [{ $count: "n" }],
        },
      },
    ]);

    // A branch-restricted user may only look at vendors their branches use.
    const invCount = (inv.count || [])[0]?.n || 0;
    const payCount = (pay.count || [])[0]?.n || 0;
    if (BRANCH_SCOPED_ROLES.includes(req.user.role) && !invCount && !payCount) {
      const scope = { vendor: { $in: vendorIds }, branch: { $in: f.branchIds || [] } };
      const [i, p] = await Promise.all([
        InvoiceRequest.countDocuments(scope),
        PaymentProcessing.countDocuments(scope),
      ]);
      if (!i && !p) return res.status(404).json({ message: "This vendor has no activity in your branches" });
    }

    // Names for every branch mentioned in either lens.
    const bIds = [
      ...new Set([
        ...(inv.byBranch || []).map((b) => idStr(b._id)),
        ...(pay.byBranch || []).map((b) => idStr(b._id)),
      ]),
    ]
      .map(toId)
      .filter(Boolean);
    const bList = await branchNames(bIds);
    const bName = new Map(bList.map((b) => [String(b._id), b.name]));

    // One row per branch, both lenses side by side.
    const payByBranch = new Map((pay.byBranch || []).map((b) => [idStr(b._id), b]));
    const byBranch = bIds.map((id) => {
      const k = String(id);
      const i = (inv.byBranch || []).find((b) => idStr(b._id) === k) || {};
      const p = payByBranch.get(k) || {};
      return {
        branch: k,
        branchName: bName.get(k) || k,
        gstins: (i.gstSet || []).filter(Boolean),
        invoices: i.invoices || 0,
        net: round2(i.net),
        paid: round2(i.paid),
        outstanding: round2(i.outstanding),
        inFlightNet: round2(i.inFlightNet),
        avgDaysToPay: i.avgDaysToPay == null ? null : Math.round(i.avgDaysToPay),
        lastInvoice: i.lastDate || null,
        payments: p.payments || 0,
        paidInPeriod: round2(p.paid),
        lastPayment: p.lastDate || null,
      };
    });
    byBranch.sort((a, b) => b.net + b.paidInPeriod - (a.net + a.paidInPeriod));

    // Months from both lenses, merged.
    const months = new Map();
    const mk = (id) => `${id.y}-${String(id.m).padStart(2, "0")}`;
    (inv.monthly || []).forEach((m) =>
      months.set(mk(m._id), { y: m._id.y, m: m._id.m, net: round2(m.net), approved: round2(m.approved), invoices: m.invoices, paid: 0, payments: 0 }),
    );
    (pay.monthly || []).forEach((m) => {
      const row = months.get(mk(m._id)) || { y: m._id.y, m: m._id.m, net: 0, approved: 0, invoices: 0 };
      row.paid = round2(m.paid);
      row.payments = m.payments;
      months.set(mk(m._id), row);
    });
    const monthly = [...months.values()].sort((a, b) => a.y - b.y || a.m - b.m);

    // Vendor identity: master first, else the most recent branch record.
    const master = PAN_RX.test(key)
      ? await VendorMaster.findOne({ panNumber: key })
          .select("vendorName companyName panNumber vendorCategory status approvalStatus gstins msmeNumber")
          .lean()
      : null;
    const sample = await Vendor.findOne({ _id: { $in: vendorIds } })
      .sort({ updatedAt: -1 })
      .select("vendorName companyName vendorCategory panNumber")
      .lean();

    const it = (inv.totals || [])[0] || {};
    const pt = (pay.totals || [])[0] || {};
    res.json({
      vendor: {
        key,
        name: master?.vendorName || sample?.vendorName || "Unknown",
        company: master?.companyName || sample?.companyName || "",
        vendorCategory: master?.vendorCategory || sample?.vendorCategory || "",
        pan: PAN_RX.test(key) ? key : "",
        masterId: master?._id || null,
        masterStatus: master?.status || null,
        masterApproval: master?.approvalStatus || null,
        msme: master?.msmeNumber || "",
        gstins: (master?.gstins || []).map((g) => ({ gstin: g.gstin, stateCode: g.stateCode })),
      },
      dateField: f.dateField,
      totals: {
        invoices: it.invoices || 0,
        gross: round2(it.gross),
        gst: round2(it.gst),
        tds: round2(it.tds),
        net: round2(it.net),
        paid: round2(it.paid),
        approvedNet: round2(it.approvedNet),
        inFlightNet: round2(it.inFlightNet),
        outstanding: round2(it.outstanding),
        age0_30: round2(it.age0_30),
        age31_60: round2(it.age31_60),
        age61_90: round2(it.age61_90),
        age90p: round2(it.age90p),
        avgDaysToPay: it.avgDaysToPay == null ? null : Math.round(it.avgDaysToPay),
        firstInvoice: it.firstDate || null,
        lastInvoice: it.lastDate || null,
        payments: pt.payments || 0,
        paidInPeriod: round2(pt.paid),
        lastPayment: pt.lastDate || null,
        branches: byBranch.length,
      },
      byBranch,
      monthly,
      byCategory: (inv.byCategory || []).map((c) => ({
        categoryId: c._id,
        code: c.code || "",
        name: c.name || "Uncategorised",
        invoices: c.invoices,
        net: round2(c.net),
        paid: round2(c.paid),
      })),
      invoices: (inv.list || []).map((x) => ({
        ...x,
        branchName: bName.get(idStr(x.branch)) || "",
        gross: round2(x.gross),
        tds: round2(x.tds),
        net: round2(x.net),
        paid: round2(x.paid),
        outstanding: round2(x.outstanding),
      })),
      invoiceCount: (inv.count || [])[0]?.n || 0,
      payments: (pay.list || []).map((x) => ({
        ...x,
        branchName: bName.get(idStr(x.branch)) || "",
        amount: round2(x.amount),
      })),
      paymentCount: (pay.count || [])[0]?.n || 0,
      listLimit: LIST_LIMIT,
    });
  } catch (err) {
    sendError(res, err, "vendor detail");
  }
};

// Exposed for tests.
exports._internal = { parseFilters, concentration, resolveBranchIds, dayStart, dayEnd };
