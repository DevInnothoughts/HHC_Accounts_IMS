// ============================================================
// BACKEND: src/controllers/doctorController.js — NEW FILE
// ------------------------------------------------------------
// Doctor Master — one record per PAN.
//   Accounts, Super Admin  — add a doctor, import the doctor list, complete
//                            the profile (details, bank account, documents),
//                            change status
//   Cluster / Dept Head, Director — view (including the documents)
// Doctors also arrive through the payout Excel upload. They are never
// deleted, and the PAN can never be changed (it is the key the payment
// history hangs on).
// ============================================================
const mongoose = require("mongoose");
const Doctor = require("../models/Doctor");
const DoctorPayout = require("../models/DoctorPayout");
const cfg = require("../config/doctorPayoutConfig");
const { logAction } = require("../services/auditService");
const { compareBank, bankOf } = require("../services/doctorPayoutValidation");
const {
  readDoctorList,
  normaliseDoctorRows,
  planDoctorImport,
  buildDoctorListTemplate,
} = require("../services/doctorListService");
const {
  savePrivateFile,
  openPrivateFile,
} = require("../services/privateStorageService");
const { profileOf, incompleteFilter } = require("../utils/doctorProfile");
const access = require("../utils/doctorAccess");

const RS = cfg.PAYOUT_STATUS;
const LIVE = [RS.PENDING, RS.APPROVED, RS.RAISED, RS.FILE_GENERATED, RS.PAID];
const HISTORY_LIMIT = 1000;

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ message, ...extra });

// Indian financial year of a date: Apr 2026 – Mar 2027 → "2026-27".
const fyOf = (date) => {
  const d = new Date(date);
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

// Paid / outstanding per doctor, within the viewer's branches.
const totalsByDoctor = async (doctorIds, branchCond) => {
  const match = { doctor: { $in: doctorIds }, status: { $in: LIVE } };
  if (branchCond !== undefined) match.branch = branchCond;
  const agg = await DoctorPayout.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$doctor",
        records: { $sum: 1 },
        paid: {
          $sum: { $cond: [{ $eq: ["$status", RS.PAID] }, "$payableAmount", 0] },
        },
        outstanding: {
          $sum: { $cond: [{ $ne: ["$status", RS.PAID] }, "$payableAmount", 0] },
        },
        lastPaidOn: { $max: "$paymentDate" },
      },
    },
  ]);
  const map = new Map();
  agg.forEach((a) =>
    map.set(String(a._id), {
      records: a.records,
      paid: access.round2(a.paid),
      outstanding: access.round2(a.outstanding),
      lastPaidOn: a.lastPaidOn || null,
    }),
  );
  return map;
};

// ── GET /api/doctors ───────────────────────────────────────
// ?search=&status=&page=&limit=
exports.list = async (req, res) => {
  try {
    const { page, limit, skip } = access.paging(req.query, 25, 200);
    const query = {};
    const status = access.qstr(req.query.status);
    if (status === "unverified") query.verifiedAt = { $exists: false };
    else if (status === "incomplete") Object.assign(query, incompleteFilter());
    else if (status && Object.values(Doctor.STATUS).includes(status))
      query.status = status;

    const search = access.qstr(req.query.search);
    if (search) {
      const rx = { $regex: access.escapeRx(search), $options: "i" };
      const any = [
        { name: rx },
        { panNumber: rx },
        { doctorCode: rx },
        { mobile: rx },
        { accountNumber: rx },
        { hospitalName: rx },
        { city: rx },
      ];
      // "incomplete" already uses $or — keep both conditions.
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: any }];
        delete query.$or;
      } else query.$or = any;
    }

    const [total, doctors, statusCounts, unverified, incomplete] =
      await Promise.all([
        Doctor.countDocuments(query),
        Doctor.find(query)
          .select("-bankHistory")
          .sort({ name: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Doctor.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
        Doctor.countDocuments({ verifiedAt: { $exists: false } }),
        Doctor.countDocuments(incompleteFilter()),
      ]);

    const totals = await totalsByDoctor(
      doctors.map((d) => d._id),
      access.branchCondition(req.user),
    );
    res.json({
      doctors: doctors.map(({ documents, ...d }) => ({
        ...d,
        profile: profileOf({ ...d, documents }),
        documentCount: (documents || []).filter((x) => !x.removedAt).length,
        totals: totals.get(String(d._id)) || {
          records: 0,
          paid: 0,
          outstanding: 0,
          lastPaidOn: null,
        },
      })),
      total,
      page,
      limit,
      counts: {
        ...statusCounts.reduce((a, c) => ({ ...a, [c._id]: c.n }), {}),
        unverified,
        incomplete,
      },
    });
  } catch (err) {
    console.error("Doctor list error:", err);
    fail(res, 500, "Could not load the doctors");
  }
};

// ── GET /api/doctors/:id ───────────────────────────────────
// Doctor + bank-change history + PAYMENT HISTORY (every payout row
// against this PAN, newest first) + totals per financial year.
exports.getOne = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return fail(res, 400, "Invalid doctor id");
    const doctor = await Doctor.findById(req.params.id)
      .populate("createdBy", "name")
      .populate("verifiedBy", "name")
      .populate("createdViaBatch", "batchId")
      .populate("bankHistory.replacedBy", "name")
      .populate("bankHistory.requestedBy", "name")
      .populate("bankHistory.batch", "batchId")
      .populate("documents.uploadedBy", "name")
      .lean();
    if (!doctor) return fail(res, 404, "Doctor not found");
    const profile = profileOf(doctor);
    // Live documents only, and never the storage path.
    doctor.documents = (doctor.documents || [])
      .filter((d) => !d.removedAt)
      .map(({ key, ...d }) => d);

    const branchCond = access.branchCondition(req.user);
    const query = { doctor: doctor._id };
    if (branchCond !== undefined) query.branch = branchCond;

    const [payouts, count] = await Promise.all([
      DoctorPayout.find(query)
        .select(
          "payoutId type branch date patientName noOfSurgeries settledAmount basicAmount tdsAmount payableAmount status paymentRef utrNumber paymentDate batch rejectionReason",
        )
        .populate("branch", "name code")
        .populate("batch", "batchId")
        .sort({ date: -1, _id: -1 })
        .limit(HISTORY_LIMIT)
        .lean(),
      DoctorPayout.countDocuments(query),
    ]);

    // Financial-year totals over ALL live rows (not just the page above).
    const live = await DoctorPayout.find({ ...query, status: { $in: LIVE } })
      .select("type date basicAmount tdsAmount payableAmount status")
      .lean();
    const years = new Map();
    live.forEach((p) => {
      const fy = fyOf(p.date);
      const y =
        years.get(fy) ||
        years
          .set(fy, {
            fy,
            records: 0,
            basic: 0,
            tds: 0,
            payable: 0,
            paid: 0,
            referral: 0,
            surgeon: 0,
          })
          .get(fy);
      y.records += 1;
      y.basic += p.basicAmount || 0;
      y.tds += p.tdsAmount || 0;
      y.payable += p.payableAmount || 0;
      if (p.status === RS.PAID) y.paid += p.payableAmount || 0;
      y[p.type] += p.payableAmount || 0;
    });
    const fyTotals = [...years.values()]
      .map((y) => ({
        ...y,
        basic: access.round2(y.basic),
        tds: access.round2(y.tds),
        payable: access.round2(y.payable),
        paid: access.round2(y.paid),
        referral: access.round2(y.referral),
        surgeon: access.round2(y.surgeon),
      }))
      .sort((a, b) => (a.fy < b.fy ? 1 : -1));

    res.json({
      doctor,
      profile,
      documentTypes: cfg.DOCUMENT_TYPES,
      requiredDocumentTypes: cfg.REQUIRED_DOCUMENT_TYPES,
      doctorTypes: cfg.DOCTOR_TYPES,
      payouts,
      payoutCount: count,
      historyTruncated: count > payouts.length,
      fyTotals,
      // history is limited to the viewer's branches for branch-bound roles
      scoped: access.isScoped(req.user),
    });
  } catch (err) {
    console.error("Doctor get error:", err);
    fail(res, 500, "Could not open the doctor");
  }
};

// ── shared: read the profile fields out of a request body ──
// Returns { values } or { error }. Only keys present in the body are
// returned, so the same reader serves "create" and "edit".
const TEXT_LIMITS = {
  specialisation: 120,
  registrationNumber: 60,
  hospitalName: 120,
  city: 80,
  address: 300,
};
const clean = (v) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();

const readProfile = (body) => {
  const values = {};
  if (body.name !== undefined) {
    const name = clean(body.name).slice(0, 120);
    if (!name) return { error: "Doctor name is required" };
    values.name = name;
  }
  if (body.mobile !== undefined) {
    let mobile = String(body.mobile).replace(/\D/g, "");
    if (mobile.length === 12 && mobile.startsWith("91"))
      mobile = mobile.slice(2);
    if (mobile && !cfg.MOBILE_REGEX.test(mobile))
      return { error: "Mobile must be a 10-digit number" };
    values.mobile = mobile;
  }
  if (body.email !== undefined) {
    const email = clean(body.email).toLowerCase();
    if (email && !cfg.EMAIL_REGEX.test(email))
      return { error: "Email is not valid" };
    values.email = email;
  }
  if (body.doctorType !== undefined) {
    if (body.doctorType && !cfg.DOCTOR_TYPES[body.doctorType])
      return { error: "Invalid doctor type" };
    values.doctorType = body.doctorType || "";
  }
  Object.entries(TEXT_LIMITS).forEach(([field, max]) => {
    if (body[field] !== undefined)
      values[field] = clean(body[field]).slice(0, max);
  });
  return { values };
};

// → { bank } (all four, valid), { bank: null } (all blank) or { error }
const readBank = (raw) => {
  const bank = {
    accountNumber: String(raw?.accountNumber ?? "").replace(/[\s-]/g, ""),
    ifscCode: String(raw?.ifscCode ?? "")
      .replace(/\s/g, "")
      .toUpperCase(),
    bankName: clean(raw?.bankName).slice(0, 80),
    accountHolderName: clean(raw?.accountHolderName).slice(0, 120),
  };
  if (!Object.values(bank).some(Boolean)) return { bank: null };
  if (!cfg.ACCOUNT_REGEX.test(bank.accountNumber))
    return { error: "Bank account number must be 6–20 digits" };
  if (!cfg.IFSC_REGEX.test(bank.ifscCode))
    return { error: "IFSC is not valid (e.g. HDFC0001234)" };
  if (!bank.bankName) return { error: "Bank name is required" };
  if (!bank.accountHolderName) return { error: "Name as per bank is required" };
  return { bank };
};

// Blank strings are stored as "not set", so "is it filled in?" stays simple.
const assign = (doc, values) =>
  Object.entries(values).forEach(([k, v]) => {
    doc[k] = v === "" ? undefined : v;
  });

// A doctor as sent to the browser: live documents only, and never the
// path of a file inside the private store.
const publicDoctor = (doc) => {
  const d = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  d.documents = (d.documents || [])
    .filter((x) => !x.removedAt)
    .map(({ key, ...x }) => x);
  return d;
};

const snapshot = (d) => ({
  name: d.name,
  mobile: d.mobile || "",
  email: d.email || "",
  status: d.status,
  doctorType: d.doctorType || "",
  specialisation: d.specialisation || "",
  registrationNumber: d.registrationNumber || "",
  hospitalName: d.hospitalName || "",
  city: d.city || "",
  address: d.address || "",
  ...bankOf(d),
});

// ── POST /api/doctors   (accounts, super admin) ────────────
// Add one doctor by hand. Body: { name, panNumber, …profile, bank? }.
// Name and PAN are compulsory; bank details may follow later.
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const panNumber = String(body.panNumber || "")
      .replace(/\s/g, "")
      .toUpperCase();
    if (!cfg.PAN_REGEX.test(panNumber))
      return fail(res, 400, "PAN is not valid (e.g. ABCDE1234F)");
    const profile = readProfile({ ...body, name: body.name ?? "" });
    if (profile.error) return fail(res, 400, profile.error);
    const bank = readBank(body.bank);
    if (bank.error) return fail(res, 400, bank.error);

    const existing = await Doctor.findOne({ panNumber })
      .select("name doctorCode")
      .lean();
    if (existing)
      return fail(
        res,
        409,
        `PAN ${panNumber} is already in the Doctor Master as ${existing.name} (${existing.doctorCode})`,
        { doctorId: existing._id },
      );

    const doctor = new Doctor({
      panNumber,
      createdBy: req.user._id,
      createdVia: "manual",
    });
    assign(doctor, profile.values);
    if (bank.bank) assign(doctor, bank.bank);
    try {
      await doctor.save();
    } catch (err) {
      if (err?.code === 11000)
        return fail(
          res,
          409,
          `PAN ${panNumber} was added a moment ago by someone else`,
        );
      throw err;
    }

    await logAction({
      userId: req.user._id,
      action: "CREATE_DOCTOR",
      module: "Doctor",
      targetId: doctor._id,
      targetLabel: `${doctor.name} (${doctor.panNumber})`,
      reason: "Added in the Doctor Master",
      newValue: { doctorCode: doctor.doctorCode, ...snapshot(doctor) },
      req,
    });
    res.status(201).json({
      message: `${doctor.name} added (${doctor.doctorCode})`,
      doctor: publicDoctor(doctor),
      profile: profileOf(doctor),
    });
  } catch (err) {
    console.error("Doctor create error:", err);
    fail(res, 500, "Could not add the doctor");
  }
};

// ── PUT /api/doctors/:id   (accounts, super admin) ─────────
// Body: { name?, mobile?, email?, doctorType?, specialisation?,
//         registrationNumber?, hospitalName?, city?, address?,
//         status?, bank?: { accountNumber, ifscCode, bankName,
//         accountHolderName }, reason? }
// A reason is required to CHANGE an existing bank account or the status.
// Adding bank details to a doctor who has none needs no reason — that is
// completing the profile, not redirecting a payment. PAN is never editable.
exports.update = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return fail(res, 400, "Invalid doctor id");
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) return fail(res, 404, "Doctor not found");

    const body = req.body || {};
    if (
      body.panNumber !== undefined &&
      String(body.panNumber).trim().toUpperCase() !== doctor.panNumber
    )
      return fail(
        res,
        400,
        "PAN cannot be changed. If it was entered wrongly, make this doctor inactive and add the correct PAN.",
      );

    const before = snapshot(doctor);
    const reason = String(body.reason || "")
      .trim()
      .slice(0, 500);

    const profile = readProfile(body);
    if (profile.error) return fail(res, 400, profile.error);
    assign(doctor, profile.values);

    let statusChanged = false;
    if (body.status !== undefined && body.status !== doctor.status) {
      if (!Object.values(Doctor.STATUS).includes(body.status))
        return fail(res, 400, "Invalid status");
      if (reason.length < 3)
        return fail(res, 400, "Give a reason for the status change");
      doctor.status = body.status;
      doctor.statusReason = reason;
      statusChanged = true;
    }

    let bankChanged = false;
    let bankAdded = false;
    if (body.bank && typeof body.bank === "object") {
      const next = readBank(body.bank);
      if (next.error) return fail(res, 400, next.error);
      const hadBank = Boolean(doctor.accountNumber);
      if (!next.bank) {
        if (hadBank)
          return fail(
            res,
            400,
            "Bank details cannot be cleared — enter the new details",
          );
      } else if (compareBank(bankOf(doctor), next.bank)) {
        if (hadBank) {
          if (reason.length < 3)
            return fail(res, 400, "Give a reason for the bank detail change");
          doctor.bankHistory.push({
            ...bankOf(doctor),
            replacedAt: new Date(),
            replacedBy: req.user._id,
            source: "manual",
            reason,
          });
          bankChanged = true;
        } else bankAdded = true;
        Object.assign(doctor, next.bank);
      }
    }

    if (!doctor.isModified()) return fail(res, 400, "Nothing has changed");
    await doctor.save();

    await logAction({
      userId: req.user._id,
      action: bankChanged || bankAdded ? "UPDATE_DOCTOR_BANK" : "UPDATE_DOCTOR",
      module: "Doctor",
      targetId: doctor._id,
      targetLabel: `${doctor.name} (${doctor.panNumber})`,
      statusFrom: statusChanged ? before.status : undefined,
      statusTo: statusChanged ? doctor.status : undefined,
      reason:
        reason || (bankAdded ? "Bank details added to the profile" : undefined),
      oldValue: before,
      newValue: snapshot(doctor),
      req,
    });

    // Payments already raised still point at the old account.
    let openPayments = 0;
    if (bankChanged) {
      const DoctorPayment = require("../models/DoctorPayment");
      openPayments = await DoctorPayment.countDocuments({
        doctor: doctor._id,
        status: {
          $in: [cfg.PAYMENT_STATUS.RAISED, cfg.PAYMENT_STATUS.FILE_GENERATED],
        },
      });
    }
    res.json({
      message: bankChanged
        ? "Doctor updated — bank details changed"
        : bankAdded
          ? "Doctor updated — bank details added"
          : "Doctor updated",
      doctor: publicDoctor(doctor),
      profile: profileOf(doctor),
      openPayments,
    });
  } catch (err) {
    console.error("Doctor update error:", err);
    fail(res, 500, "Could not save the doctor");
  }
};

// ════════════════════════════════════════════════════════════
// Doctor list import
// ════════════════════════════════════════════════════════════

// ── GET /api/doctors/import/template ───────────────────────
exports.importTemplate = async (req, res) => {
  try {
    const workbook = buildDoctorListTemplate();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Doctor_List_Template.xlsx"',
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Doctor list template error:", err);
    if (!res.headersSent) fail(res, 500, "Could not build the template");
  }
};

// ── POST /api/doctors/import   (multipart: file; ?dryRun=1) ─
// dryRun=1 → what each row WOULD do; nothing is saved.
// Otherwise → creates the new doctors and fills blank details of existing
// ones. Rows with errors are skipped and reported; the rest go through.
exports.importList = async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, "Choose the doctor list (.xlsx)");
    const buffer = req.file.buffer;
    if (
      !buffer ||
      buffer.length < 4 ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b
    )
      return fail(
        res,
        400,
        "This is not an .xlsx workbook. Open it in Excel and use Save As → Excel Workbook (.xlsx).",
      );
    const dryRun = ["1", "true"].includes(String(req.query.dryRun || ""));

    const list = await readDoctorList(buffer);
    const rows = normaliseDoctorRows(list.rows);
    const pans = [
      ...new Set(
        rows
          .map((r) => r.values.panNumber)
          .filter((p) => p && cfg.PAN_REGEX.test(p)),
      ),
    ];
    const masters = pans.length
      ? await Doctor.find({ panNumber: { $in: pans } })
          .select("-documents -bankHistory")
          .lean()
      : [];
    const doctorsByPan = {};
    masters.forEach((d) => (doctorsByPan[d.panNumber] = d));
    const plan = planDoctorImport(rows, doctorsByPan);

    const report = {
      fileName: req.file.originalname,
      sheetName: list.sheetName,
      fileErrors: list.fileErrors,
      ...plan,
      canImport:
        !list.fileErrors.length &&
        plan.summary.create + plan.summary.update > 0,
    };
    if (dryRun) return res.json(report);
    if (list.fileErrors.length)
      return fail(res, 422, list.fileErrors[0], { report });
    if (!report.canImport)
      return fail(res, 422, "There is nothing to import in this list", {
        report,
      });

    // Row by row: one bad row never undoes the others.
    const done = { created: [], updated: [], failed: [] };
    for (const r of plan.rows) {
      const v = r.values;
      try {
        if (r.action === "create") {
          const doctor = new Doctor({
            ...v,
            createdBy: req.user._id,
            createdVia: "list",
          });
          await doctor.save();
          done.created.push(`${doctor.name} (${doctor.panNumber})`);
        } else if (r.action === "update") {
          // Fill only what is STILL blank at this moment.
          const fresh = await Doctor.findById(r.doctor._id);
          const set = {};
          Object.entries(r.fills).forEach(([k, val]) => {
            if (!fresh[k]) set[k] = val;
          });
          if (Object.keys(set).length) {
            Object.assign(fresh, set);
            await fresh.save();
            done.updated.push(`${fresh.name} (${fresh.panNumber})`);
          }
        }
      } catch (err) {
        done.failed.push({
          rowNumber: r.rowNumber,
          panNumber: v.panNumber,
          message:
            err?.code === 11000
              ? "This PAN was added a moment ago by someone else"
              : "Could not be saved",
        });
        if (err?.code !== 11000)
          console.error("Doctor import row error:", err.message);
      }
    }

    await logAction({
      userId: req.user._id,
      action: "IMPORT_DOCTOR_LIST",
      module: "Doctor",
      targetLabel: String(req.file.originalname || "doctor list").slice(0, 120),
      newValue: {
        rows: plan.summary.rows,
        created: done.created.length,
        updated: done.updated.length,
        skippedWithErrors: plan.summary.errors,
        failed: done.failed.length,
        createdDoctors: done.created.slice(0, 300),
        updatedDoctors: done.updated.slice(0, 300),
      },
      req,
    });

    res.status(201).json({
      message: `${done.created.length} doctor${done.created.length === 1 ? "" : "s"} added, ${done.updated.length} updated${
        plan.summary.errors
          ? `, ${plan.summary.errors} row${plan.summary.errors === 1 ? "" : "s"} skipped (errors)`
          : ""
      }${done.failed.length ? `, ${done.failed.length} could not be saved` : ""}`,
      created: done.created.length,
      updated: done.updated.length,
      skipped: plan.summary.errors,
      failed: done.failed,
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Doctor list import error:", err);
    fail(res, 500, "Could not import the doctor list");
  }
};

// ════════════════════════════════════════════════════════════
// Documents (PAN card, cancelled cheque, …)
// ════════════════════════════════════════════════════════════

// ── POST /api/doctors/:id/documents   (multipart: file, type) ──
exports.uploadDocument = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return fail(res, 400, "Invalid doctor id");
    const type = String(req.body?.type || "");
    if (!cfg.DOCUMENT_TYPES[type])
      return fail(res, 400, "Choose what kind of document this is");
    if (!req.file) return fail(res, 400, "Choose a file (PDF, JPG or PNG)");

    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) return fail(res, 404, "Doctor not found");

    const saved = await savePrivateFile(
      req.file.buffer,
      `doctors/${doctor._id}`,
    );
    doctor.documents.push({
      type,
      name: String(req.file.originalname || "document").slice(0, 160),
      key: saved.key,
      mimeType: saved.mime,
      size: saved.size,
      uploadedAt: new Date(),
      uploadedBy: req.user._id,
    });
    await doctor.save();

    await logAction({
      userId: req.user._id,
      action: "UPLOAD_DOCTOR_DOCUMENT",
      module: "Doctor",
      targetId: doctor._id,
      targetLabel: `${doctor.name} (${doctor.panNumber})`,
      newValue: { type: cfg.DOCUMENT_TYPES[type], file: req.file.originalname },
      req,
    });
    res.status(201).json({
      message: `${cfg.DOCUMENT_TYPES[type]} uploaded`,
      profile: profileOf(doctor),
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Doctor document upload error:", err);
    fail(res, 500, "Could not upload the document");
  }
};

const findDocument = async (req, res) => {
  if (
    !mongoose.isValidObjectId(req.params.id) ||
    !mongoose.isValidObjectId(req.params.docId)
  ) {
    fail(res, 400, "Invalid document reference");
    return {};
  }
  const doctor = await Doctor.findById(req.params.id);
  const document = doctor?.documents.find(
    (d) => String(d._id) === String(req.params.docId) && !d.removedAt,
  );
  if (!document) {
    fail(res, 404, "Document not found");
    return {};
  }
  return { doctor, document };
};

// ── GET /api/doctors/:id/documents/:docId ──────────────────
// The ONLY way a doctor document leaves the server: login and role are
// checked by the route, then the file is streamed. No public URL exists.
exports.viewDocument = async (req, res) => {
  try {
    const { doctor, document } = await findDocument(req, res);
    if (!document) return;
    const stream = openPrivateFile(document.key);
    if (!stream) return fail(res, 404, "The file is no longer on the server");

    await logAction({
      userId: req.user._id,
      action: "VIEW_DOCTOR_DOCUMENT",
      module: "Doctor",
      targetId: doctor._id,
      targetLabel: `${doctor.name} (${doctor.panNumber})`,
      newValue: { type: cfg.DOCUMENT_TYPES[document.type] || document.type },
      req,
    });

    const safeName = String(document.name || "document").replace(
      /[^\w.\- ]+/g,
      "_",
    );
    res.setHeader(
      "Content-Type",
      document.mimeType || "application/octet-stream",
    );
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    stream.on("error", () => {
      if (!res.headersSent) fail(res, 500, "Could not read the file");
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    console.error("Doctor document view error:", err);
    if (!res.headersSent) fail(res, 500, "Could not open the document");
  }
};

// ── DELETE /api/doctors/:id/documents/:docId ───────────────
// Takes the document off the profile. The file itself is kept (nothing is
// ever deleted) and the removal is recorded with who and when.
exports.removeDocument = async (req, res) => {
  try {
    const { doctor, document } = await findDocument(req, res);
    if (!document) return;
    document.removedAt = new Date();
    document.removedBy = req.user._id;
    await doctor.save();

    await logAction({
      userId: req.user._id,
      action: "REMOVE_DOCTOR_DOCUMENT",
      module: "Doctor",
      targetId: doctor._id,
      targetLabel: `${doctor.name} (${doctor.panNumber})`,
      oldValue: {
        type: cfg.DOCUMENT_TYPES[document.type] || document.type,
        file: document.name,
      },
      req,
    });
    res.json({ message: "Document removed", profile: profileOf(doctor) });
  } catch (err) {
    console.error("Doctor document remove error:", err);
    fail(res, 500, "Could not remove the document");
  }
};
