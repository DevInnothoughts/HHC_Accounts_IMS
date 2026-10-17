// ============================================================
// BACKEND: src/controllers/tdsReportController.js — NEW FILE
// ------------------------------------------------------------
// TDS report for the Accounts team.    GET /api/reports/tds
//
// One response feeds every view of the TDS tab:
//   totals      headline figures for the filtered period
//   byVendor    deductee-wise (one row per PAN — the same vendor identity
//               the vendor report uses), with the branches and rates used
//   byBranch    branch-wise
//   byMonth     month-wise, with the indicative challan (deposit) due date
//   byQuarter   quarter-wise, with the indicative 26Q return due date
//   byRate      rate-wise (1%, 2%, 10% …)
//   exceptions  things to check before filing: TDS with no valid PAN,
//               one vendor at several rates, amount ≠ rate × taxable,
//               nil TDS on standard vendors
//   register    the invoice-level lines behind all of it (the Excel sheet)
//
// WHERE TDS COMES FROM. Accounts set the TDS % while approving an
// invoice; tdsAmount = taxable amount (pre-GST) × % — invoiceController.
// So an invoice only "has" TDS once it is past Accounts approval and not
// rejected afterwards: status "Accounts Approved" or "Cluster Head
// Approved". Earlier stages carry no TDS decision and are left out.
//
// PERIOD (?dateBasis=)
//   invoiceDate (default)  — the invoice's own date
//   tdsDate               — the day Accounts approved it (TDS applied),
//                            from approvalHistory
//
// Due dates are indicative (7th of the next month, 30 April for March;
// 26Q: 31 Jul / 31 Oct / 31 Jan / 31 May). The statutory dates follow
// the date of deduction/credit in the books, which this system does not
// record, so they are a planning aid, not a compliance determination.
//
// Read only. Branch scoping as in the other primary reports.
// ============================================================
const mongoose = require("mongoose");
const InvoiceRequest = require("../models/InvoiceRequest");
const { REPORT_TZ, EXPENSE_TYPE_SOURCE } = require("../config/reportConfig");
const { vendorIdentityStages } = require("../utils/vendorIdentity");
const {
  _internal: { resolveBranchIds, dayStart, dayEnd },
} = require("./vendorReportController");

const TDS_STATUSES = ["Accounts Approved", "Cluster Head Approved"];
const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MAX_SCAN = 50000; // invoices per request — beyond this, narrow the period
const MAX_REGISTER = 10000; // lines sent to the screen / Excel
const MISMATCH_TOLERANCE = 1; // ₹ — tdsAmount is rounded to the rupee

const toId = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null;
const str = (v) => (typeof v === "string" ? v.trim() : "");
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const NUM = (f) => ({ $ifNull: [f, 0] });

class BadRequest extends Error {}

// Every query value goes through str()/toId() — never an object into a filter.
const parseFilters = (req) => {
  const q = req.query;
  const from = str(q.from);
  const to = str(q.to);
  if (from && !dayStart(from))
    throw new BadRequest("From date is not a valid date (YYYY-MM-DD)");
  if (to && !dayEnd(to))
    throw new BadRequest("To date is not a valid date (YYYY-MM-DD)");
  if (from && to && from > to)
    throw new BadRequest("The end date is before the start date");

  const category = str(q.category) ? toId(str(q.category)) : null;
  if (str(q.category) && !category) throw new BadRequest("Invalid subtype");

  const rateRaw = str(q.rate);
  const rate = rateRaw === "" ? null : Number(rateRaw);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100))
    throw new BadRequest("Invalid TDS rate");

  return {
    from: from ? dayStart(from) : null,
    to: to ? dayEnd(to) : null,
    dateBasis: str(q.dateBasis) === "tdsDate" ? "tdsDate" : "invoiceDate",
    branchIds: resolveBranchIds(req.user, str(q.branch)),
    expenseType: ["Revenue", "Capital"].includes(str(q.expenseType))
      ? str(q.expenseType)
      : "",
    category,
    rate,
    // "with" = TDS deducted, "nil" = approved at 0%, "" = both
    tds: ["with", "nil"].includes(str(q.tds)) ? str(q.tds) : "",
    // "final" = Cluster Head approved only; default = past Accounts approval
    stage: str(q.stage) === "final" ? "final" : "",
    vendorKey: str(q.vendorKey).slice(0, 40),
    search: str(q.search).slice(0, 60),
  };
};

const pipeline = (f) => {
  const match = {
    status:
      f.stage === "final" ? "Cluster Head Approved" : { $in: TDS_STATUSES },
  };
  if (f.branchIds) match.branch = { $in: f.branchIds };
  if (f.category) match.expenseCategory = f.category;
  if (f.rate !== null) match.tdsPercentage = f.rate;
  if (f.tds === "with") match.tdsAmount = { $gt: 0 };
  if (f.tds === "nil") match.$or = [{ tdsAmount: 0 }, { tdsAmount: null }];
  const range = {};
  if (f.from) range.$gte = f.from;
  if (f.to) range.$lte = f.to;
  const hasRange = Object.keys(range).length > 0;
  if (hasRange && f.dateBasis === "invoiceDate") match.invoiceDate = range;

  const stages = [
    { $match: match },
    // When Accounts applied the TDS: the latest Accounts approval entry
    // (re-approvals after a rejection overwrite the TDS, so latest wins).
    {
      $set: {
        _tdsDate: {
          $max: {
            $map: {
              input: {
                $filter: {
                  input: { $ifNull: ["$approvalHistory", []] },
                  as: "h",
                  cond: {
                    $and: [
                      { $eq: ["$$h.action", "approved"] },
                      {
                        $regexMatch: {
                          input: { $ifNull: ["$$h.stage", ""] },
                          regex: "^Accounts Approval",
                        },
                      },
                    ],
                  },
                },
              },
              as: "h",
              in: "$$h.actionAt",
            },
          },
        },
      },
    },
  ];
  if (hasRange && f.dateBasis === "tdsDate")
    stages.push({ $match: { _tdsDate: range } });

  stages.push(
    { $limit: MAX_SCAN + 1 },
    // Expense category (+ Revenue/Capital filter, same source as the other reports)
    {
      $lookup: {
        from: "expensecategories",
        localField: "expenseCategory",
        foreignField: "_id",
        as: "_cat",
      },
    },
    { $set: { _cat: { $arrayElemAt: ["$_cat", 0] } } },
  );
  if (f.expenseType) {
    stages.push({
      $match:
        EXPENSE_TYPE_SOURCE === "invoice"
          ? { expenseType: f.expenseType }
          : { "_cat.type": f.expenseType },
    });
  }
  stages.push(
    // Raw vendor fields: the PAN as typed (to flag missing / invalid) and type
    {
      $lookup: {
        from: "vendors",
        localField: "vendor",
        foreignField: "_id",
        as: "_v",
      },
    },
    { $set: { _v: { $arrayElemAt: ["$_v", 0] } } },
    ...vendorIdentityStages("vendor"),
  );
  if (f.vendorKey) {
    stages.push({
      $match: { $expr: { $eq: [{ $toString: "$vendorKey" }, f.vendorKey] } },
    });
  }
  if (f.search) {
    const rx = escapeRx(f.search);
    stages.push({
      $match: {
        $or: [
          { vendorLabel: { $regex: rx, $options: "i" } },
          { vendorCompany: { $regex: rx, $options: "i" } },
          { "_v.panNumber": { $regex: rx, $options: "i" } },
        ],
      },
    });
  }
  stages.push(
    {
      $lookup: {
        from: "branches",
        localField: "branch",
        foreignField: "_id",
        as: "_b",
      },
    },
    { $set: { _b: { $arrayElemAt: ["$_b", 0] } } },
    {
      $lookup: {
        from: "paymentprocessings",
        localField: "paymentRequest",
        foreignField: "_id",
        as: "_p",
      },
    },
    { $set: { _p: { $arrayElemAt: ["$_p", 0] } } },
    {
      $project: {
        _id: 1,
        requestId: 1,
        invoiceNumber: 1,
        invoiceDate: 1,
        status: 1,
        tdsDate: "$_tdsDate",
        taxable: NUM("$amount"),
        gst: NUM("$gstAmount"),
        roundOff: NUM("$roundOff"),
        tdsPct: "$tdsPercentage",
        tds: NUM("$tdsAmount"),
        net: NUM("$netPayable"),
        branchId: "$branch",
        branchName: "$_b.name",
        branchCode: "$_b.code",
        category: "$_cat.name",
        categoryType: "$_cat.type",
        vendorKey: { $toString: "$vendorKey" },
        vendorName: "$vendorLabel",
        vendorCompany: 1,
        vendorGst: 1,
        accountHolder: "$_v.accountHolderName",
        panRaw: "$_v.panNumber",
        vendorType: "$_v.vendorType",
        payStatus: "$_p.status",
        paid: NUM("$_p.paidAmount"),
        lastUtr: { $ifNull: ["$_p.utrNumber", null] },
        lastPaidOn: { $ifNull: ["$_p.paymentDate", "$_p.utrRecordedAt"] },
      },
    },
  );
  return stages;
};

// ── Calendar helpers (IST) ─────────────────────────────────
const IST_OFFSET = 330 * 60 * 1000;
const ymOf = (d) => {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1 };
};
// Indian FY / quarter. April = Q1.
const fyOf = ({ y, m }) => (m >= 4 ? y : y - 1);
const fyLabel = (start) => `FY ${start}-${String(start + 1).slice(2)}`;
const quarterOf = ({ m }) =>
  m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
const isoDay = (y, m, d) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// Challan due: 7th of next month; tax deducted in March: 30 April.
const depositDue = ({ y, m }) =>
  m === 3
    ? isoDay(y, 4, 30)
    : m === 12
      ? isoDay(y + 1, 1, 7)
      : isoDay(y, m + 1, 7);
// 26Q due: Q1 31 Jul, Q2 31 Oct, Q3 31 Jan, Q4 31 May (FY start year based)
const returnDue = (fy, q) =>
  q === 1
    ? isoDay(fy, 7, 31)
    : q === 2
      ? isoDay(fy, 10, 31)
      : q === 3
        ? isoDay(fy + 1, 1, 31)
        : isoDay(fy + 1, 5, 31);

const panOf = (raw) => {
  const p = String(raw || "")
    .trim()
    .toUpperCase();
  return { pan: p, panValid: PAN_RX.test(p) };
};

const add = (acc, l) => {
  acc.invoices += 1;
  acc.taxable += l.taxable;
  acc.gst += l.gst;
  acc.tds += l.tds;
  acc.net += l.net;
  if (l.tds > 0) acc.withTds += 1;
  else {
    acc.nilInvoices += 1;
    acc.nilTaxable += l.taxable;
  }
  return acc;
};
const blank = () => ({
  invoices: 0,
  taxable: 0,
  gst: 0,
  tds: 0,
  net: 0,
  withTds: 0,
  nilInvoices: 0,
  nilTaxable: 0,
});
const finish = (o) => ({
  ...o,
  taxable: r2(o.taxable),
  gst: r2(o.gst),
  tds: r2(o.tds),
  net: r2(o.net),
  nilTaxable: r2(o.nilTaxable),
  // TDS as a share of the taxable value it was deducted on
  effectiveRate:
    o.taxable - o.nilTaxable > 0
      ? r2((o.tds / (o.taxable - o.nilTaxable)) * 100)
      : 0,
});

exports.getTdsReport = async (req, res) => {
  try {
    const f = parseFilters(req);
    const rows = await InvoiceRequest.aggregate(pipeline(f)).allowDiskUse(true);
    if (rows.length > MAX_SCAN)
      throw new BadRequest(
        `More than ${MAX_SCAN.toLocaleString("en-IN")} invoices match — narrow the period or pick a branch.`,
      );

    const basisDate = (l) =>
      f.dateBasis === "tdsDate" ? l.tdsDate : l.invoiceDate;

    // ── Lines ────────────────────────────────────────────
    const lines = rows
      .map((l) => {
        const { pan, panValid } = panOf(l.panRaw);
        const d = basisDate(l);
        const ym = d ? ymOf(d) : null;
        const expected =
          l.tdsPct != null ? Math.round((l.taxable * l.tdsPct) / 100) : null;
        return {
          ...l,
          id: String(l._id),
          branchId: String(l.branchId || ""),
          pan,
          panValid,
          rate: l.tdsPct == null ? null : Number(l.tdsPct),
          month: ym ? `${ym.y}-${String(ym.m).padStart(2, "0")}` : null,
          fy: ym ? fyLabel(fyOf(ym)) : null,
          quarter: ym ? `Q${quarterOf(ym)}` : null,
          depositDue: ym && l.tds > 0 ? depositDue(ym) : null,
          expectedTds: expected,
          mismatch:
            expected != null && Math.abs(expected - l.tds) > MISMATCH_TOLERANCE,
          paymentStatus: l.payStatus || "Not raised",
        };
      })
      .sort(
        (a, b) => new Date(basisDate(a) || 0) - new Date(basisDate(b) || 0),
      );

    // ── Totals ───────────────────────────────────────────
    const totals = finish(lines.reduce(add, blank()));
    const vendorSet = new Set(lines.map((l) => l.vendorKey));
    const branchSet = new Set(lines.map((l) => l.branchId));
    totals.vendors = vendorSet.size;
    totals.branches = branchSet.size;
    totals.deducteesWithTds = new Set(
      lines.filter((l) => l.tds > 0).map((l) => l.vendorKey),
    ).size;
    totals.tdsWithoutPan = r2(
      lines
        .filter((l) => l.tds > 0 && !l.panValid)
        .reduce((s, l) => s + l.tds, 0),
    );
    totals.tdsOnPaid = r2(
      lines.filter((l) => l.paid > 0).reduce((s, l) => s + l.tds, 0),
    );

    // ── By vendor (deductee) ─────────────────────────────
    const vMap = new Map();
    for (const l of lines) {
      let v = vMap.get(l.vendorKey);
      if (!v) {
        v = {
          key: l.vendorKey,
          name: l.vendorName,
          company: l.vendorCompany || "",
          pan: l.pan,
          panValid: l.panValid,
          vendorType: l.vendorType || "standard",
          branchSet: new Map(),
          rateSet: new Set(),
          lastDate: null,
          ...blank(),
        };
        vMap.set(l.vendorKey, v);
      }
      add(v, l);
      // A deductee can sit on several branch records — keep a valid PAN if any has one
      if (!v.panValid && l.panValid)
        Object.assign(v, { pan: l.pan, panValid: true });
      v.branchSet.set(l.branchId, l.branchName);
      if (l.rate != null) v.rateSet.add(l.rate);
      const d = basisDate(l);
      if (d && (!v.lastDate || d > v.lastDate)) v.lastDate = d;
    }
    const byVendor = [...vMap.values()]
      .map(({ branchSet, rateSet, ...v }) => ({
        ...finish(v),
        branches: [...branchSet.values()].filter(Boolean).sort(),
        branchCount: branchSet.size,
        rates: [...rateSet].sort((a, b) => a - b),
        share: totals.tds ? r2((v.tds / totals.tds) * 100) : 0,
      }))
      .sort((a, b) => b.tds - a.tds || b.taxable - a.taxable);

    // ── By branch ────────────────────────────────────────
    const bMap = new Map();
    for (const l of lines) {
      let b = bMap.get(l.branchId);
      if (!b) {
        b = {
          branchId: l.branchId,
          name: l.branchName || "—",
          code: l.branchCode || "",
          vSet: new Set(),
          ...blank(),
        };
        bMap.set(l.branchId, b);
      }
      add(b, l);
      b.vSet.add(l.vendorKey);
    }
    const byBranch = [...bMap.values()]
      .map(({ vSet, ...b }) => ({
        ...finish(b),
        vendors: vSet.size,
        share: totals.tds ? r2((b.tds / totals.tds) * 100) : 0,
      }))
      .sort((a, b) => b.tds - a.tds);

    // ── By month / quarter ───────────────────────────────
    const mMap = new Map();
    const qMap = new Map();
    for (const l of lines) {
      if (!l.month) continue;
      const [y, m] = l.month.split("-").map(Number);
      let mo = mMap.get(l.month);
      if (!mo) {
        mo = {
          month: l.month,
          y,
          m,
          fy: l.fy,
          quarter: l.quarter,
          depositDue: depositDue({ y, m }),
          vSet: new Set(),
          ...blank(),
        };
        mMap.set(l.month, mo);
      }
      add(mo, l);
      if (l.tds > 0) mo.vSet.add(l.vendorKey);

      const fy = fyOf({ y, m });
      const qn = quarterOf({ m });
      const qk = `${fy}-Q${qn}`;
      let q = qMap.get(qk);
      if (!q) {
        q = {
          key: qk,
          fy: fyLabel(fy),
          quarter: `Q${qn}`,
          returnDue: returnDue(fy, qn),
          form: "26Q",
          vSet: new Set(),
          ...blank(),
        };
        qMap.set(qk, q);
      }
      add(q, l);
      if (l.tds > 0) q.vSet.add(l.vendorKey);
    }
    const byMonth = [...mMap.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(({ vSet, ...mo }) => ({
        ...finish(mo),
        deductees: vSet.size,
        depositDue: mo.tds > 0 ? mo.depositDue : null, // nothing to deposit
      }));
    const byQuarter = [...qMap.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ vSet, ...q }) => ({ ...finish(q), deductees: vSet.size }));

    // ── By rate ──────────────────────────────────────────
    const rMap = new Map();
    for (const l of lines) {
      const k = l.rate == null ? "—" : String(l.rate);
      let r = rMap.get(k);
      if (!r) {
        r = { rate: l.rate, vSet: new Set(), ...blank() };
        rMap.set(k, r);
      }
      add(r, l);
      r.vSet.add(l.vendorKey);
    }
    const byRate = [...rMap.values()]
      .map(({ vSet, ...r }) => ({ ...finish(r), vendors: vSet.size }))
      .sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1));

    // ── Exceptions ───────────────────────────────────────
    const lineRef = (l) => ({
      id: l.id,
      requestId: l.requestId,
      invoiceNumber: l.invoiceNumber,
      invoiceDate: l.invoiceDate,
      branchName: l.branchName,
      vendorKey: l.vendorKey,
      vendorName: l.vendorName,
      pan: l.pan,
      taxable: l.taxable,
      rate: l.rate,
      tds: l.tds,
      expectedTds: l.expectedTds,
    });
    const exceptions = {
      // 26Q needs a valid PAN per deductee; without one, s.206AA's higher rate may apply
      tdsWithoutPan: lines.filter((l) => l.tds > 0 && !l.panValid).map(lineRef),
      // Same deductee at different rates in the period — often a section mix-up
      multiRateVendors: byVendor
        .filter((v) => v.rates.length > 1)
        .map((v) => ({
          key: v.key,
          name: v.name,
          pan: v.pan,
          rates: v.rates,
          invoices: v.invoices,
          tds: v.tds,
        })),
      // Stored TDS differs from rate × taxable by more than ₹1 (edited after approval, or legacy data)
      amountMismatch: lines.filter((l) => l.mismatch).map(lineRef),
      // Nil TDS on vendors set up as standard (statutory/utility vendors are usually exempt)
      nilOnStandard: lines
        .filter((l) => l.tds === 0 && l.vendorType !== "statutory")
        .map(lineRef),
    };

    // ── Register ─────────────────────────────────────────
    const register = lines.slice(0, MAX_REGISTER).map((l) => ({
      id: l.id,
      requestId: l.requestId,
      invoiceNumber: l.invoiceNumber,
      invoiceDate: l.invoiceDate,
      tdsDate: l.tdsDate,
      month: l.month,
      fy: l.fy,
      quarter: l.quarter,
      branchName: l.branchName,
      branchCode: l.branchCode,
      vendorKey: l.vendorKey,
      vendorName: l.vendorName,
      vendorCompany: l.vendorCompany,
      accountHolder: l.accountHolder,
      pan: l.pan,
      panValid: l.panValid,
      vendorGst: l.vendorGst,
      vendorType: l.vendorType || "standard",
      category: l.category,
      categoryType: l.categoryType,
      taxable: l.taxable,
      gst: l.gst,
      gross: r2(l.taxable + l.gst + l.roundOff),
      rate: l.rate,
      tds: l.tds,
      net: l.net,
      depositDue: l.depositDue,
      status: l.status,
      paymentStatus: l.paymentStatus,
      paid: l.paid,
      lastUtr: l.lastUtr,
      lastPaidOn: l.lastPaidOn,
    }));

    res.json({
      generatedAt: new Date(),
      filters: {
        from: f.from,
        to: f.to,
        dateBasis: f.dateBasis,
        stage: f.stage || "accounts",
        tds: f.tds,
        rate: f.rate,
        vendorKey: f.vendorKey || null,
      },
      totals,
      byVendor,
      byBranch,
      byMonth,
      byQuarter,
      byRate,
      rateOptions: [
        ...new Set(lines.map((l) => l.rate).filter((r) => r != null)),
      ].sort((a, b) => a - b),
      exceptions,
      register,
      registerTotal: lines.length,
      registerTruncated: lines.length > MAX_REGISTER,
    });
  } catch (err) {
    if (err instanceof BadRequest)
      return res.status(400).json({ message: err.message });
    console.error("getTdsReport error:", err);
    res.status(500).json({ message: "Could not load the TDS report" });
  }
};

// ============================================================
// Customised "TDS WORKING" Excel (Oct 2026)
// GET /api/reports/tds/working-excel   — same filters as /tds
// ------------------------------------------------------------
// Laid out exactly like the Accounts team's own sheet
// (TDS_Working_Formate.xlsx):
//   row 1   SUBTOTALs of GROSS, TDS and Net (follow any filter applied)
//   row 2   "<MONTH YEAR> TDS WORKING", merged A:K
//   row 3   DATE | BRANCH | PAYEE | PAN | GROSS | SECTION | Invoice | % |
//           TDS | Net | Nature | Invoice No. | PMS ID
//
// INVOICE-WISE: one row per invoice, never grouped by vendor. The on-screen
// vendor drill-down and vendor search are ignored here, so the sheet always
// lists every invoice for the period / branch / subtype chosen.
//   N3:R    Nature of Payment → Section / TDS % / GST % / TDS on GST?
//
// Values come from PMS as approved: GROSS = taxable (pre-GST) amount,
// Invoice = taxable + GST + round-off, % and TDS = what Accounts applied.
// Net is a live formula (Invoice − TDS), which equals PMS net payable.
// PMS does not record the TDS section, so "Nature" is a dropdown from the
// lookup table and SECTION fills itself from it. Nature is pre-filled only
// when the expense subtype clearly points to one AND its rate matches the
// rate applied (or the rate alone identifies it); otherwise it is left for
// Accounts to pick. A % that disagrees with the chosen Nature turns red.
//
// Only invoices with TDS deducted are included, unless the "Nil only"
// filter is chosen on screen.
// ============================================================
const NATURES = [
  // [Nature of Payment, Section, TDS %, GST %, TDS on GST?]
  ["Rent (Land/Building)", "194I", 0.1, 0.18, "No"],
  ["Professional Fees", "194J", 0.1, 0, "No"],
  ["Technical Services", "194J", 0.1, 0.18, "No"],
  ["Consultancy", "194J", 0.1, 0.18, "No"],
  ["Contract (Individual/HUF)", "194C", 0.01, 0, "No"],
  ["Contract (Other)", "194C", 0.02, 0.18, "No"],
  ["Maintenance", "194C", 0.01, 0, "No"],
  ["Advertising", "194C", 0.01, 0.18, "No"],
  ["Commission", "194H", 0.05, 0.18, "No"],
  ["Interest (Non-Bank)", "194A", 0.1, 0, "N/A"],
  ["Purchase", "194Q", 0.001, null, null],
  ["Salary", "192B", null, null, null],
];
const NATURE_RATE = new Map(NATURES.map((n) => [n[0], n[2]]));

// Subtype keyword → Nature. First match wins; contracts resolve by rate.
const NATURE_HINTS = [
  [/rent|lease/i, "Rent (Land/Building)"],
  [/commission|brokerage/i, "Commission"],
  [/interest/i, "Interest (Non-Bank)"],
  [/advertis|marketing|promotion|hoarding|branding/i, "Advertising"],
  [/maintenance|repair|amc|servic(e|ing) charge/i, "Maintenance"],
  [/consult/i, "Consultancy"],
  [
    /professional|doctor|surgeon|visiting|legal|audit|ca fee/i,
    "Professional Fees",
  ],
  [/technical|software|\bit\b|website|digital/i, "Technical Services"],
  [
    /contract|housekeeping|security|manpower|labour|labor|catering|transport/i,
    "CONTRACT",
  ],
  [/salary|wages|stipend/i, "Salary"],
];
// Rates that point to exactly one Nature in the table.
const UNIQUE_RATE_NATURE = {
  2: "Contract (Other)",
  5: "Commission",
  0.1: "Purchase",
};

const sameRate = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-9;

const guessNature = (category, ratePct) => {
  if (ratePct == null) return "";
  const r = ratePct / 100;
  for (const [rx, nature] of NATURE_HINTS) {
    if (!rx.test(category || "")) continue;
    if (nature === "CONTRACT")
      return sameRate(r, 0.01)
        ? "Contract (Individual/HUF)"
        : sameRate(r, 0.02)
          ? "Contract (Other)"
          : "";
    return sameRate(NATURE_RATE.get(nature), r) ? nature : "";
  }
  return UNIQUE_RATE_NATURE[ratePct] || "";
};

const MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];
const SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const istParts = (d) => {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate() };
};
// "SEPTEMBER 2026" for a single month, otherwise "01 SEP 2026 – 15 OCT 2026"
const periodTitle = (from, to) => {
  if (!from && !to) return "";
  const a = from ? istParts(from) : null;
  const b = to ? istParts(to) : null;
  if (a && b && a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.y}`;
  const fmt = (p) => `${String(p.d).padStart(2, "0")} ${SHORT[p.m]} ${p.y}`;
  if (a && b) return `${fmt(a)} – ${fmt(b)}`;
  return a ? `FROM ${fmt(a)}` : `UP TO ${fmt(b)}`;
};
// Excel has no timezone: store the IST calendar day as a UTC-midnight date.
const excelDate = (d) => {
  if (!d) return null;
  const p = istParts(d);
  return new Date(Date.UTC(p.y, p.m, p.d));
};

exports.exportTdsWorkingExcel = async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const f = parseFilters(req);
    if (f.tds === "") f.tds = "with"; // a TDS working lists deductions
    // Invoice-wise for the whole period — not narrowed to one vendor.
    f.vendorKey = "";
    f.search = "";

    const rows = await InvoiceRequest.aggregate(pipeline(f)).allowDiskUse(true);
    if (rows.length > MAX_SCAN)
      throw new BadRequest(
        `More than ${MAX_SCAN.toLocaleString("en-IN")} invoices match — narrow the period or pick a branch.`,
      );

    const basisDate = (l) =>
      f.dateBasis === "tdsDate" ? l.tdsDate : l.invoiceDate;
    const lines = rows
      .map((l) => ({ ...l, date: basisDate(l) }))
      // Invoice order: date, then PMS request id. Not grouped by vendor.
      .sort(
        (a, b) =>
          new Date(a.date || 0) - new Date(b.date || 0) ||
          String(a.requestId || "").localeCompare(
            String(b.requestId || ""),
            undefined,
            { numeric: true },
          ),
      );

    // Title period: the filter, else the span of the data itself.
    let title = periodTitle(f.from, f.to);
    if (!title && lines.length) {
      const dated = lines.filter((l) => l.date);
      if (dated.length)
        title = periodTitle(dated[0].date, dated[dated.length - 1].date);
    }
    title = `${title ? `${title} ` : ""}TDS WORKING`;

    // ── Workbook ─────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = "HHC PMS";
    wb.created = new Date();
    const ws = wb.addWorksheet("TDS Working", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
      },
    });

    const ACC = '_ * #,##0.00_ ;_ * \\-#,##0.00_ ;_ * "-"??_ ;_ @_ ';
    const thin = { style: "thin", color: { argb: "FF000000" } };
    const box = { top: thin, left: thin, bottom: thin, right: thin };
    const HEAD_FILL = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8497B0" },
    }; // template header
    const TOTAL_FILL = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF70AD47" },
    }; // template totals

    [
      10.3, 22, 45, 12, 14.3, 9, 14.3, 8, 13.2, 14.3, 26, 18, 15, 26, 8.5, 7.5,
      7.5, 12,
    ].forEach((w, i) => (ws.getColumn(i + 1).width = w));

    const FIRST = 4;
    const LAST = Math.max(FIRST, FIRST + lines.length - 1);
    const N_FIRST = 4;
    const N_LAST = N_FIRST + NATURES.length - 1;
    const NATURE_RANGE = `$N$${N_FIRST}:$R$${N_LAST}`;

    // Row 1 — SUBTOTALs (respect Excel filters, like the template)
    const r1 = ws.getRow(1);
    r1.getCell("E").value = { formula: `SUBTOTAL(9,E${FIRST}:E${LAST})` };
    r1.getCell("H").value = "Total";
    r1.getCell("I").value = { formula: `SUBTOTAL(9,I${FIRST}:I${LAST})` };
    r1.getCell("J").value = { formula: `SUBTOTAL(9,J${FIRST}:J${LAST})` };
    ["E", "H", "I", "J"].forEach((c) => {
      const cell = r1.getCell(c);
      cell.font = { name: "Calibri", size: 12, bold: true };
      cell.fill = TOTAL_FILL;
      cell.border = box;
      if (c === "H") cell.alignment = { horizontal: "center" };
      else cell.numFmt = ACC;
    });

    // Row 2 — title
    ws.mergeCells("A2:M2");
    const t = ws.getCell("A2");
    t.value = title;
    t.font = { name: "Calibri", size: 12, bold: true };
    t.alignment = { horizontal: "center", vertical: "middle" };
    const med = { style: "medium", color: { argb: "FF000000" } };
    t.border = { top: med, left: med, bottom: med, right: med };
    ws.getRow(2).height = 18;

    // Row 3 — headers
    const HEAD = [
      "DATE",
      "BRANCH",
      "PAYEE",
      "PAN",
      "GROSS",
      "SECTION",
      "Invoice",
      "%",
      "TDS ",
      "Net",
      "Nature",
      "Invoice No.",
      "PMS ID",
    ];
    const r3 = ws.getRow(3);
    r3.height = 31.5;
    HEAD.forEach((h, i) => {
      const cell = r3.getCell(i + 1);
      cell.value = h;
      cell.font = { name: "Times New Roman", size: 12, bold: true };
      cell.fill = HEAD_FILL;
      cell.border = box;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });

    // Lookup table N3:R
    const nHead = [
      "Nature of Payment",
      "Section",
      "TDS %",
      "GST %",
      "TDS on GST?",
    ];
    nHead.forEach((h, i) => {
      const cell = r3.getCell(14 + i);
      cell.value = h;
      cell.font = { name: "Calibri", size: 11, bold: true };
      cell.border = box;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });
    NATURES.forEach((n, k) => {
      const row = ws.getRow(N_FIRST + k);
      n.forEach((v, i) => {
        const cell = row.getCell(14 + i);
        if (v !== null) cell.value = v;
        cell.border = box;
        if (i === 2) cell.numFmt = "0.0##%";
        if (i === 3) cell.numFmt = "0%";
      });
    });

    // Data
    lines.forEach((l, k) => {
      const r = FIRST + k;
      const row = ws.getRow(r);
      const pan = String(l.panRaw || "")
        .trim()
        .toUpperCase();
      const invoiceTotal = r2(NUM_(l.taxable) + NUM_(l.gst) + NUM_(l.roundOff));
      const rate = l.tdsPct == null ? null : Number(l.tdsPct);

      row.getCell("A").value = excelDate(l.date);
      row.getCell("A").numFmt = "dd-mm-yy";
      row.getCell("B").value = l.branchName || "";
      row.getCell("C").value = l.vendorName || l.vendorCompany || "";
      row.getCell("D").value = pan;
      row.getCell("E").value = r2(l.taxable);
      row.getCell("F").value = {
        formula: `IFERROR(VLOOKUP(K${r},${NATURE_RANGE},2,FALSE),"")`,
      };
      row.getCell("G").value = invoiceTotal;
      row.getCell("H").value = rate == null ? null : rate / 100;
      row.getCell("H").numFmt = "0.00%";
      row.getCell("I").value = r2(l.tds);
      row.getCell("J").value = { formula: `G${r}-I${r}` };
      row.getCell("K").value = guessNature(l.category, rate);
      row.getCell("L").value = l.invoiceNumber || "";
      row.getCell("M").value = l.requestId || "";
      ["E", "G", "I", "J"].forEach((c) => (row.getCell(c).numFmt = ACC));
      for (let c = 1; c <= 13; c++) row.getCell(c).border = box;

      // Nature dropdown from the lookup table
      row.getCell("K").dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`$N$${N_FIRST}:$N$${N_LAST}`],
        showErrorMessage: true,
        errorTitle: "Nature of Payment",
        error: "Pick a nature from the list in column N.",
      };
    });

    if (lines.length) {
      ws.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: LAST, column: 13 },
      };
      const red = {
        type: "pattern",
        pattern: "solid",
        bgColor: { argb: "FFFFC7CE" },
      };
      const redFont = { color: { argb: "FF9C0006" } };
      ws.addConditionalFormatting({
        ref: `H${FIRST}:H${LAST}`,
        rules: [
          {
            // % applied in PMS differs from the % of the Nature chosen
            type: "expression",
            formulae: [
              `AND($K${FIRST}<>"",ISNUMBER(VLOOKUP($K${FIRST},${NATURE_RANGE},3,FALSE)),ROUND(VLOOKUP($K${FIRST},${NATURE_RANGE},3,FALSE),6)<>ROUND($H${FIRST},6))`,
            ],
            style: { fill: red, font: redFont },
          },
        ],
      });
      ws.addConditionalFormatting({
        ref: `D${FIRST}:D${LAST}`,
        rules: [
          {
            // TDS deducted but the PAN is missing / not a valid PAN
            type: "expression",
            formulae: [
              `AND($I${FIRST}>0,NOT(AND(LEN($D${FIRST})=10,ISNUMBER(--MID($D${FIRST},6,4)))))`,
            ],
            style: { fill: red, font: redFont },
          },
        ],
      });
    } else {
      ws.getCell("A4").value = "No invoices with TDS match these filters.";
      ws.getCell("A4").font = { italic: true, color: { argb: "FF64748B" } };
    }

    const safe = title
      .replace(/TDS WORKING$/, "")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    const filename = `TDS_Working${safe ? `_${safe}` : ""}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("Cache-Control", "no-cache");
    res.send(await wb.xlsx.writeBuffer());
  } catch (err) {
    if (err instanceof BadRequest)
      return res.status(400).json({ message: err.message });
    console.error("exportTdsWorkingExcel error:", err);
    res.status(500).json({ message: "Could not build the TDS working sheet" });
  }
};
const NUM_ = (n) => Number(n) || 0;

exports._internal = {
  parseFilters,
  pipeline,
  depositDue,
  returnDue,
  quarterOf,
  fyOf,
  guessNature,
  periodTitle,
};
