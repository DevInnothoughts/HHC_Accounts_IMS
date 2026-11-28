// ============================================================
// BACKEND: src/controllers/doctorPaymentController.js — NEW FILE
// ------------------------------------------------------------
// Payment processing for Doctor Referral and Surgeon payouts — the same
// three steps Accounts already use for vendor invoices:
//
//   1. RAISE      approved rows → payments (DRP-…)
//   2. BANK FILE  FedOne .xlsx or e-Net .csv, one payment or many
//   3. UTR        record the UTR and the payment date, one or many
//
// plus CANCEL (before a UTR) to put rows back, and UTR CORRECT (Super
// Admin only, as for vendor payments).
// ============================================================
const mongoose = require("mongoose");
const DoctorPayout = require("../models/DoctorPayout");
const DoctorPayment = require("../models/DoctorPayment");
const cfg = require("../config/doctorPayoutConfig");
const { logAction } = require("../services/auditService");
const {
  validatePayment,
  buildFedOne,
  buildEnet,
} = require("../services/doctorPaymentFileService");
const { bankOf } = require("../services/doctorPayoutValidation");
const { profileOf } = require("../utils/doctorProfile");
const access = require("../utils/doctorAccess");

const RS = cfg.PAYOUT_STATUS; // row status
const PS = cfg.PAYMENT_STATUS; // payment status
const OPEN = [PS.RAISED, PS.FILE_GENERATED]; // no UTR yet
const TYPES = Object.values(cfg.TYPES);
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ message, ...extra });

const typeOf = (v) => (TYPES.includes(v) ? v : undefined);

const cleanUtr = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

// A UTR is proof money already left the account, so a future date is a
// typo. Tomorrow is the limit because the server may sit behind IST.
const parsePaymentDate = (value) => {
  if (!value) return { ok: false, message: "Payment date is required" };
  const date =
    access.isoToDate(typeof value === "string" ? value : "") || new Date(value);
  if (isNaN(date.getTime()))
    return { ok: false, message: "Invalid payment date" };
  const limit = new Date();
  limit.setDate(limit.getDate() + 1);
  if (date > limit)
    return { ok: false, message: "Payment date cannot be in the future" };
  return { ok: true, date };
};

const withSession = async (work) => {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => {
      out = await work(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
};

const conflict = (message) => {
  const e = new Error(message);
  e.status = 409;
  return e;
};

const PAYMENT_POPULATE = [
  { path: "branch", select: "name code" },
  { path: "doctor", select: "doctorCode name status" },
  { path: "raisedBy", select: "name" },
  { path: "utrRecordedBy", select: "name" },
];

// ── GET /api/doctor-payments/summary ───────────────────────
// Tab badges for both types: rows to raise, payments in process, paid.
exports.summary = async (req, res) => {
  try {
    const branchCond = access.branchCondition(req.user, req.query.branch);
    const scope = branchCond !== undefined ? { branch: branchCond } : {};
    const [rows, payments] = await Promise.all([
      DoctorPayout.aggregate([
        { $match: { ...scope, status: RS.APPROVED } },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            amount: { $sum: "$payableAmount" },
          },
        },
      ]),
      DoctorPayment.aggregate([
        { $match: { ...scope, status: { $ne: PS.CANCELLED } } },
        {
          $group: {
            _id: { type: "$type", status: "$status" },
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    const blank = () => ({ count: 0, amount: 0 });
    const out = {};
    TYPES.forEach((t) => {
      out[t] = { raise: blank(), processing: blank(), paid: blank() };
    });
    rows.forEach((r) => {
      if (!out[r._id]) return;
      out[r._id].raise = { count: r.count, amount: access.round2(r.amount) };
    });
    payments.forEach((p) => {
      const bucket = out[p._id.type];
      if (!bucket) return;
      const key = p._id.status === PS.PAID ? "paid" : "processing";
      bucket[key].count += p.count;
      bucket[key].amount = access.round2(bucket[key].amount + p.amount);
    });
    res.json(out);
  } catch (err) {
    console.error("Doctor payment summary error:", err);
    fail(res, 500, "Could not load the counts");
  }
};

// ── GET /api/doctor-payments ───────────────────────────────
// ?type=&view=processing|paid|cancelled&branch=&search=&from=&to=&page=
exports.list = async (req, res) => {
  try {
    const { page, limit, skip } = access.paging(req.query, 50, 500);
    const query = {};
    const branchCond = access.branchCondition(req.user, req.query.branch);
    if (branchCond !== undefined) query.branch = branchCond;
    const type = typeOf(req.query.type);
    if (type) query.type = type;

    const view = access.qstr(req.query.view) || "processing";
    if (view === "paid") query.status = PS.PAID;
    else if (view === "cancelled") query.status = PS.CANCELLED;
    else if (view === "all") query.status = { $ne: PS.CANCELLED };
    else query.status = { $in: OPEN };

    if (mongoose.isValidObjectId(req.query.doctor))
      query.doctor = new mongoose.Types.ObjectId(String(req.query.doctor));

    // Date filter: payment date for paid, raise date otherwise.
    const from = access.isoToDate(access.qstr(req.query.from));
    const to = access.isoToDate(access.qstr(req.query.to));
    if (from || to) {
      const field = view === "paid" ? "paymentDate" : "raisedAt";
      query[field] = {};
      if (from) query[field].$gte = from;
      if (to) query[field].$lte = new Date(to.getTime() + 86399999);
    }

    const search = access.qstr(req.query.search);
    if (search) {
      const rx = { $regex: access.escapeRx(search), $options: "i" };
      query.$or = [
        { paymentId: rx },
        { doctorName: rx },
        { panNumber: rx },
        { utrNumber: rx },
      ];
    }

    const [total, payments, sums] = await Promise.all([
      DoctorPayment.countDocuments(query),
      DoctorPayment.find(query)
        .select("-history -payouts")
        .populate(PAYMENT_POPULATE)
        .sort(view === "paid" ? { paymentDate: -1, _id: -1 } : { _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DoctorPayment.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            basic: { $sum: "$basicAmount" },
            tds: { $sum: "$tdsAmount" },
            amount: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    res.json({
      payments,
      total,
      page,
      limit,
      totals: {
        basic: access.round2(sums[0]?.basic),
        tds: access.round2(sums[0]?.tds),
        amount: access.round2(sums[0]?.amount),
      },
    });
  } catch (err) {
    console.error("Doctor payment list error:", err);
    fail(res, 500, "Could not load the payments");
  }
};

const loadPayment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    fail(res, 400, "Invalid payment id");
    return null;
  }
  const payment = await DoctorPayment.findById(req.params.id);
  if (!payment) {
    fail(res, 404, "Payment not found");
    return null;
  }
  if (!access.inScope(req.user, payment.branch)) {
    fail(res, 403, "This payment belongs to another branch");
    return null;
  }
  return payment;
};

// ── GET /api/doctor-payments/:id ───────────────────────────
// The payment with the sheet rows it pays.
exports.getOne = async (req, res) => {
  try {
    const payment = await loadPayment(req, res);
    if (!payment) return;
    const [full, rows] = await Promise.all([
      DoctorPayment.findById(payment._id)
        .populate(PAYMENT_POPULATE)
        .populate("history.by", "name")
        .lean(),
      DoctorPayout.find({ _id: { $in: payment.payouts } })
        .select(
          "payoutId date patientName noOfSurgeries settledAmount basicAmount tdsAmount payableAmount status batch",
        )
        .populate("batch", "batchId")
        .sort({ date: 1 })
        .lean(),
    ]);
    res.json({ payment: full, rows });
  } catch (err) {
    console.error("Doctor payment get error:", err);
    fail(res, 500, "Could not open the payment");
  }
};

// ── POST /api/doctor-payments/raise ────────────────────────
// Body: { payoutIds: [...], consolidate?: boolean, scheduledDate?, remarks? }
// consolidate (default true): one payment per doctor + branch + type.
// All-or-nothing: if any selected row cannot be raised, none are.
exports.raise = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.payoutIds) ? req.body.payoutIds : [];
    const valid = access.toObjectIds(ids);
    if (!valid.length) return fail(res, 400, "Select the records to raise");
    if (valid.length > cfg.MAX_RAISE_ROWS)
      return fail(
        res,
        400,
        `Raise at most ${cfg.MAX_RAISE_ROWS} records at a time`,
      );
    const consolidate =
      req.body.consolidate === undefined
        ? cfg.CONSOLIDATE_BY_DEFAULT
        : req.body.consolidate !== false && req.body.consolidate !== "false";

    let scheduledDate;
    if (req.body.scheduledDate) {
      scheduledDate = access.isoToDate(String(req.body.scheduledDate));
      if (!scheduledDate) return fail(res, 400, "Invalid payment (value) date");
    }
    const remarks = String(req.body.remarks || "")
      .trim()
      .slice(0, 300);

    const query = { _id: { $in: valid }, status: RS.APPROVED };
    const branchCond = access.branchCondition(req.user);
    if (branchCond !== undefined) query.branch = branchCond;
    const rows = await DoctorPayout.find(query)
      .populate(
        "doctor",
        "name panNumber email status accountNumber ifscCode bankName accountHolderName documents",
      )
      .sort({ date: 1, _id: 1 })
      .lean();

    if (rows.length !== valid.length)
      return fail(
        res,
        409,
        `${valid.length - rows.length} of the selected records are no longer awaiting payment (already raised, or outside your branches). Refresh the list.`,
      );

    // Every doctor must be payable.
    const problems = [];
    const seenDoctor = new Set();
    rows.forEach((r) => {
      const d = r.doctor;
      const key = String(d?._id || r.doctor);
      if (seenDoctor.has(key)) return;
      seenDoctor.add(key);
      if (!d) return problems.push(`${r.payoutId}: doctor record not found`);
      if (d.status !== "active")
        problems.push(
          `${d.name} (${d.panNumber}) is ${d.status} in the Doctor Master`,
        );
      if (!cfg.ACCOUNT_REGEX.test(d.accountNumber || ""))
        problems.push(
          `${d.name} (${d.panNumber}) has no valid bank account number`,
        );
      if (!cfg.IFSC_REGEX.test(d.ifscCode || ""))
        problems.push(`${d.name} (${d.panNumber}) has no valid IFSC`);
      // Optional rule (config): documents must be on file before paying.
      if (cfg.BLOCK_PAYMENT_IF_PROFILE_INCOMPLETE) {
        const profile = profileOf(d);
        if (!profile.complete)
          problems.push(
            `${d.name} (${d.panNumber}) — profile incomplete in the Doctor Master: ${profile.missing.join(", ")}`,
          );
      }
    });
    if (problems.length)
      return fail(res, 400, "These doctors cannot be paid yet", {
        errors: problems,
      });

    // ── group into payments ──
    const groups = new Map();
    rows.forEach((r) => {
      const key = consolidate
        ? `${r.doctor._id}|${r.branch}|${r.type}`
        : String(r._id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    const now = new Date();
    const created = await withSession(async (session) => {
      const made = [];
      for (const list of groups.values()) {
        const first = list[0];
        const d = first.doctor;
        const sum = (f) =>
          access.round2(list.reduce((s, r) => s + (r[f] || 0), 0));
        const payment = new DoctorPayment({
          type: first.type,
          branch: first.branch,
          doctor: d._id,
          panNumber: d.panNumber,
          doctorName: d.name,
          payouts: list.map((r) => r._id),
          payoutCount: list.length,
          settledAmount: sum("settledAmount"),
          basicAmount: sum("basicAmount"),
          tdsAmount: sum("tdsAmount"),
          amount: sum("payableAmount"),
          bank: bankOf(d),
          beneficiaryEmail: d.email || undefined,
          status: PS.RAISED,
          scheduledDate,
          remarks: remarks || undefined,
          raisedBy: req.user._id,
          raisedAt: now,
          history: [
            {
              action: "RAISED",
              by: req.user._id,
              at: now,
              remarks: remarks || undefined,
            },
          ],
        });
        await payment.save({ session });

        const upd = await DoctorPayout.updateMany(
          { _id: { $in: payment.payouts }, status: RS.APPROVED },
          {
            $set: {
              status: RS.RAISED,
              payment: payment._id,
              paymentRef: payment.paymentId,
            },
            $push: {
              history: {
                action: "PAYMENT_RAISED",
                by: req.user._id,
                at: now,
                remarks: payment.paymentId,
              },
            },
          },
          { session },
        );
        // Someone raised one of these rows in the same second.
        if (upd.modifiedCount !== list.length)
          throw conflict(
            "Some of these records were raised by someone else just now. Refresh and try again.",
          );
        made.push(payment);
      }
      return made;
    });

    await Promise.all(
      created.map((p) =>
        logAction({
          userId: req.user._id,
          action: "RAISE_DOCTOR_PAYMENT",
          module: "DoctorPayment",
          targetId: p._id,
          targetLabel: p.paymentId,
          branch: p.branch,
          statusFrom: RS.APPROVED,
          statusTo: PS.RAISED,
          amount: p.amount,
          newValue: {
            type: p.type,
            doctor: `${p.doctorName} (${p.panNumber})`,
            records: p.payoutCount,
          },
          req,
        }),
      ),
    );

    const total = access.round2(created.reduce((s, p) => s + p.amount, 0));
    res.status(201).json({
      message: `${created.length} payment${created.length === 1 ? "" : "s"} raised for ${rows.length} record${rows.length === 1 ? "" : "s"}`,
      payments: created.map((p) => ({
        _id: p._id,
        paymentId: p.paymentId,
        amount: p.amount,
      })),
      total,
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Doctor payment raise error:", err);
    fail(res, 500, "Could not raise the payments — nothing was changed");
  }
};

// ── POST /api/doctor-payments/bank-file ────────────────────
// Body: { paymentIds: [...], format: "fedone" | "enet", debitAccountId? }
// One id = individual download; many = bulk. All-or-nothing: a half-valid
// file uploaded to the bank is worse than a clear list of what to fix.
exports.bankFile = async (req, res) => {
  try {
    const format = req.body?.format === "enet" ? "enet" : "fedone";
    const valid = access.toObjectIds(
      Array.isArray(req.body?.paymentIds) ? req.body.paymentIds : [],
    );
    if (!valid.length) return fail(res, 400, "Select the payments");
    if (valid.length > cfg.MAX_BANK_FILE_PAYMENTS)
      return fail(
        res,
        400,
        `Put at most ${cfg.MAX_BANK_FILE_PAYMENTS} payments in one file`,
      );

    const query = { _id: { $in: valid }, status: { $in: OPEN } };
    const branchCond = access.branchCondition(req.user);
    if (branchCond !== undefined) query.branch = branchCond;

    const payments = await DoctorPayment.find(query)
      .populate("branch", "name code bankAccounts")
      .populate(
        "doctor",
        "name status accountNumber ifscCode bankName accountHolderName",
      )
      .sort({ paymentId: 1 });

    if (payments.length !== valid.length)
      return fail(
        res,
        409,
        `${valid.length - payments.length} of the selected payments can no longer go into a bank file (already paid, cancelled, or outside your branches). Refresh the list.`,
      );

    // The e-Net layout has no debit-account column: the bank debits the
    // account the file is uploaded under. A file holding two branches
    // would pay both from one account, so an e-Net file is one branch
    // only. (FedOne carries each line's own debit account — mixing is fine.)
    if (format === "enet") {
      const names = [
        ...new Map(
          payments.map((p) => [
            String(p.branch?._id || p.branch),
            p.branch?.name || "another branch",
          ]),
        ).values(),
      ];
      if (names.length > 1)
        return fail(
          res,
          400,
          `An e-Net file can hold one branch only, because the bank debits a single account for the whole file. These payments are from ${names.length} branches (${names.join(", ")}). Filter by branch and download one e-Net file per branch — or use FedOne, which pays each line from its own branch's account.`,
        );
    }

    const errors = payments.flatMap((p) =>
      validatePayment(p, format, req.body.debitAccountId),
    );
    if (errors.length)
      return fail(
        res,
        400,
        `${errors.length} problem${errors.length === 1 ? "" : "s"} — the bank file was not created`,
        { errors },
      );

    const now = new Date();
    const ids = payments.map((p) => p._id);
    const label = format === "enet" ? "e-Net CSV" : "FedOne Excel";
    const repeat = payments.filter((p) => p.status === PS.FILE_GENERATED);

    // Build first: if the builder throws, no status has moved.
    const output =
      format === "enet"
        ? buildEnet(payments)
        : await buildFedOne(
            payments,
            req.body.debitAccountId,
          ).xlsx.writeBuffer();

    await withSession(async (session) => {
      await DoctorPayment.updateMany(
        { _id: { $in: ids }, status: { $in: OPEN } },
        {
          $set: {
            status: PS.FILE_GENERATED,
            fileFormat: format,
            fileGeneratedAt: now,
            fileGeneratedBy: req.user._id,
          },
          $inc: { fileDownloads: 1 },
          $push: {
            history: {
              action: "BANK_FILE",
              by: req.user._id,
              at: now,
              remarks: `${label} downloaded`,
            },
          },
        },
        { session },
      );
      await DoctorPayout.updateMany(
        { payment: { $in: ids }, status: RS.RAISED },
        { $set: { status: RS.FILE_GENERATED } },
        { session },
      );
    });

    await logAction({
      userId: req.user._id,
      action: "GENERATE_DOCTOR_PAYMENT_FILE",
      module: "DoctorPayment",
      targetId: payments.length === 1 ? payments[0]._id : null,
      targetLabel:
        payments.length === 1
          ? payments[0].paymentId
          : `${payments.length} payments`,
      amount: access.round2(payments.reduce((s, p) => s + p.amount, 0)),
      statusTo: PS.FILE_GENERATED,
      reason: `${label}: ${payments
        .map((p) => p.paymentId)
        .join(
          ", ",
        )}${repeat.length ? ` (re-download of ${repeat.length})` : ""}`,
      req,
    });

    const kinds = [...new Set(payments.map((p) => p.type))];
    const tag =
      kinds.length === 1
        ? kinds[0] === cfg.TYPES.REFERRAL
          ? "DoctorReferral"
          : "SurgeonPayment"
        : "DoctorPayments";
    const stamp = access.istToday();
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    if (format === "enet") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="Enet_${tag}_${stamp}.csv"`,
      );
      return res.send(output);
    }
    res.setHeader("Content-Type", XLSX_MIME);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="FedOne_${tag}_${stamp}.xlsx"`,
    );
    res.send(Buffer.from(output));
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Doctor payment bank file error:", err);
    if (!res.headersSent) fail(res, 500, "Bank file generation failed");
  }
};

// ── core: put one UTR on one payment ───────────────────────
// Returns { ok, message, payment? }. Never throws for a business reason,
// so the bulk path can report row by row.
const applyUtr = async (
  paymentId,
  { utrNumber, paymentDate, user, allowDuplicateUtr, source },
) => {
  const utr = cleanUtr(utrNumber);
  if (!utr) return { ok: false, message: "UTR number is required" };
  if (!/^[A-Z0-9/-]{6,40}$/.test(utr))
    return {
      ok: false,
      message: "UTR should be 6–40 letters and digits",
    };
  const parsed = parsePaymentDate(paymentDate);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const current = await DoctorPayment.findById(paymentId);
  if (!current) return { ok: false, message: "Payment not found" };
  if (!access.inScope(user, current.branch))
    return { ok: false, message: "Payment belongs to another branch" };
  if (current.status === PS.PAID)
    return {
      ok: false,
      skipped: true,
      message: `${current.paymentId} already carries UTR ${current.utrNumber}`,
      payment: current,
    };
  if (!OPEN.includes(current.status))
    return {
      ok: false,
      skipped: true,
      message: `${current.paymentId} is ${current.status} — a UTR cannot be recorded`,
      payment: current,
    };

  // One bank transfer has one UTR; the same UTR on a second payment is
  // nearly always a paste into the wrong row.
  if (!allowDuplicateUtr) {
    const clash = await DoctorPayment.findOne({
      utrNumber: utr,
      status: PS.PAID,
      _id: { $ne: current._id },
    })
      .select("paymentId doctorName")
      .lean();
    if (clash)
      return {
        ok: false,
        code: "DUPLICATE_UTR",
        message: `UTR ${utr} is already recorded on ${clash.paymentId} (${clash.doctorName})`,
        payment: current,
      };
  }

  const now = new Date();
  const statusFrom = current.status;
  const saved = await withSession(async (session) => {
    const doc = await DoctorPayment.findOneAndUpdate(
      { _id: current._id, status: { $in: OPEN } },
      {
        $set: {
          status: PS.PAID,
          utrNumber: utr,
          paymentDate: parsed.date,
          utrRecordedAt: now,
          utrRecordedBy: user._id,
        },
        $push: {
          history: {
            action: "UTR_RECORDED",
            by: user._id,
            at: now,
            remarks: `UTR ${utr}${source === "bulk" ? " (bulk entry)" : ""}`,
          },
        },
      },
      { new: true, session },
    );
    if (!doc) return null; // paid or cancelled by someone else meanwhile
    await DoctorPayout.updateMany(
      { payment: doc._id },
      {
        $set: { status: RS.PAID, utrNumber: utr, paymentDate: parsed.date },
        $push: {
          history: {
            action: "PAID",
            by: user._id,
            at: now,
            remarks: `${doc.paymentId} · UTR ${utr}`,
          },
        },
      },
      { session },
    );
    return doc;
  });

  if (!saved)
    return {
      ok: false,
      skipped: true,
      message: `${current.paymentId} was changed by someone else just now`,
      payment: current,
    };
  return { ok: true, utr, statusFrom, payment: saved };
};

const auditUtr = (req, result, source) =>
  logAction({
    userId: req.user._id,
    action: "RECORD_DOCTOR_PAYMENT_UTR",
    module: "DoctorPayment",
    targetId: result.payment._id,
    targetLabel: result.payment.paymentId,
    branch: result.payment.branch,
    statusFrom: result.statusFrom,
    statusTo: PS.PAID,
    amount: result.payment.amount,
    newValue: {
      utrNumber: result.utr,
      paymentDate: result.payment.paymentDate,
      source,
    },
    req,
  });

// ── PATCH /api/doctor-payments/:id/utr ─────────────────────
// Body: { utrNumber, paymentDate, allowDuplicateUtr? }
exports.recordUtr = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return fail(res, 400, "Invalid payment id");
    const result = await applyUtr(req.params.id, {
      utrNumber: req.body?.utrNumber,
      paymentDate: req.body?.paymentDate,
      user: req.user,
      allowDuplicateUtr: req.body?.allowDuplicateUtr === true,
      source: "single",
    });
    if (!result.ok)
      return fail(
        res,
        result.code === "DUPLICATE_UTR" || result.skipped ? 409 : 400,
        result.message,
        result.code ? { code: result.code } : {},
      );
    await auditUtr(req, result, "single");
    res.json({
      message: `UTR ${result.utr} recorded on ${result.payment.paymentId}`,
      payment: result.payment,
    });
  } catch (err) {
    console.error("Doctor payment UTR error:", err);
    fail(res, 500, "Could not record the UTR");
  }
};

// ── PATCH /api/doctor-payments/bulk-utr ────────────────────
// Body: { entries: [{ _id, utrNumber, paymentDate? }], paymentDate? }
// Each row is applied on its own: a bad row is reported and the others
// still go through (a UTR already posted is a fact, never rolled back).
exports.bulkUtr = async (req, res) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length) return fail(res, 400, "No UTR entries provided");
    if (entries.length > cfg.MAX_BULK_UTR_ENTRIES)
      return fail(
        res,
        400,
        `Send at most ${cfg.MAX_BULK_UTR_ENTRIES} UTRs at a time`,
      );

    const results = [];
    const usedHere = new Map(); // UTR → payment label, within this request
    let updated = 0;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i] || {};
      const record = (status, message, payment) =>
        results.push({
          index: i,
          _id: entry._id || null,
          paymentId: payment?.paymentId || null,
          status,
          message,
        });

      if (!mongoose.isValidObjectId(entry._id)) {
        record("failed", "Payment reference missing");
        continue;
      }
      const utr = cleanUtr(entry.utrNumber);
      if (utr && usedHere.has(utr)) {
        record("failed", `UTR ${utr} is entered twice in this list`);
        continue;
      }

      try {
        const result = await applyUtr(entry._id, {
          utrNumber: entry.utrNumber,
          paymentDate: entry.paymentDate || req.body.paymentDate,
          user: req.user,
          allowDuplicateUtr: false,
          source: "bulk",
        });
        if (!result.ok) {
          record(
            result.skipped ? "skipped" : "failed",
            result.message,
            result.payment,
          );
          continue;
        }
        usedHere.set(result.utr, result.payment.paymentId);
        updated += 1;
        record("success", `UTR ${result.utr} recorded`, result.payment);
        await auditUtr(req, result, "bulk");
      } catch (err) {
        console.error("Doctor payment bulk UTR row error:", err);
        record("failed", "Could not record this UTR");
      }
    }

    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;
    res.json({
      message: `${updated} of ${entries.length} payment${entries.length === 1 ? "" : "s"} updated`,
      total: entries.length,
      updated,
      skipped,
      failed,
      results,
    });
  } catch (err) {
    console.error("Doctor payment bulk UTR error:", err);
    fail(res, 500, "Bulk UTR failed");
  }
};

// ── PATCH /api/doctor-payments/:id/utr/correct  (super admin) ──
// Body: { utrNumber, paymentDate, reason }
exports.correctUtr = async (req, res) => {
  try {
    const payment = await loadPayment(req, res);
    if (!payment) return;
    if (payment.status !== PS.PAID)
      return fail(res, 400, "Only a paid payment has a UTR to correct");
    const utr = cleanUtr(req.body?.utrNumber);
    if (!/^[A-Z0-9/-]{6,40}$/.test(utr))
      return fail(res, 400, "UTR should be 6–40 letters and digits");
    const parsed = parsePaymentDate(req.body?.paymentDate);
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const reason = String(req.body?.reason || "")
      .trim()
      .slice(0, 500);
    if (reason.length < 3)
      return fail(res, 400, "Give the reason for the correction");

    const before = {
      utrNumber: payment.utrNumber,
      paymentDate: payment.paymentDate,
    };
    const now = new Date();
    await withSession(async (session) => {
      payment.utrNumber = utr;
      payment.paymentDate = parsed.date;
      payment.history.push({
        action: "UTR_CORRECTED",
        by: req.user._id,
        at: now,
        remarks: `${before.utrNumber} → ${utr}. ${reason}`,
      });
      await payment.save({ session });
      await DoctorPayout.updateMany(
        { payment: payment._id },
        {
          $set: { utrNumber: utr, paymentDate: parsed.date },
          $push: {
            history: {
              action: "UTR_CORRECTED",
              by: req.user._id,
              at: now,
              remarks: `${before.utrNumber} → ${utr}`,
            },
          },
        },
        { session },
      );
    });

    await logAction({
      userId: req.user._id,
      action: "CORRECT_DOCTOR_PAYMENT_UTR",
      module: "DoctorPayment",
      targetId: payment._id,
      targetLabel: payment.paymentId,
      branch: payment.branch,
      amount: payment.amount,
      reason,
      oldValue: before,
      newValue: { utrNumber: utr, paymentDate: parsed.date },
      req,
    });
    res.json({ message: `UTR corrected on ${payment.paymentId}`, payment });
  } catch (err) {
    console.error("Doctor payment UTR correct error:", err);
    fail(res, 500, "Could not correct the UTR");
  }
};

// ── PATCH /api/doctor-payments/:id/cancel ──────────────────
// Body: { reason }. Only before a UTR. The rows return to "approved" and
// can be raised again (for example after a bank-detail correction).
exports.cancel = async (req, res) => {
  try {
    const payment = await loadPayment(req, res);
    if (!payment) return;
    if (!OPEN.includes(payment.status))
      return fail(
        res,
        400,
        payment.status === PS.PAID
          ? "A paid payment cannot be cancelled"
          : "This payment is already cancelled",
      );
    const reason = String(req.body?.reason || "")
      .trim()
      .slice(0, 500);
    if (reason.length < 3) return fail(res, 400, "Give a reason");

    const statusFrom = payment.status;
    const now = new Date();
    await withSession(async (session) => {
      const doc = await DoctorPayment.findOneAndUpdate(
        { _id: payment._id, status: { $in: OPEN } },
        {
          $set: {
            status: PS.CANCELLED,
            cancelledAt: now,
            cancelledBy: req.user._id,
            cancelReason: reason,
          },
          $push: {
            history: {
              action: "CANCELLED",
              by: req.user._id,
              at: now,
              remarks: reason,
            },
          },
        },
        { new: true, session },
      );
      if (!doc)
        throw conflict(
          "This payment was changed by someone else just now. Refresh and try again.",
        );
      await DoctorPayout.updateMany(
        {
          payment: payment._id,
          status: { $in: [RS.RAISED, RS.FILE_GENERATED] },
        },
        {
          $set: { status: RS.APPROVED },
          $unset: { payment: "", paymentRef: "" },
          $push: {
            history: {
              action: "PAYMENT_CANCELLED",
              by: req.user._id,
              at: now,
              remarks: `${payment.paymentId}: ${reason}`,
            },
          },
        },
        { session },
      );
    });

    await logAction({
      userId: req.user._id,
      action: "CANCEL_DOCTOR_PAYMENT",
      module: "DoctorPayment",
      targetId: payment._id,
      targetLabel: payment.paymentId,
      branch: payment.branch,
      statusFrom,
      statusTo: PS.CANCELLED,
      amount: payment.amount,
      reason,
      req,
    });
    res.json({
      message: `${payment.paymentId} cancelled — its ${payment.payoutCount} record${payment.payoutCount === 1 ? " is" : "s are"} back under "To raise"`,
      fileWasGenerated: statusFrom === PS.FILE_GENERATED,
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Doctor payment cancel error:", err);
    fail(res, 500, "Could not cancel the payment");
  }
};
