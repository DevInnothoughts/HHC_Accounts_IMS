// ============================================================
// BACKEND: src/controllers/doctorPayoutController.js — NEW FILE
// ------------------------------------------------------------
// Doctor Referral + Surgeon payouts: Excel upload and approval.
//
//   Accounts            — download template, PREVIEW an Excel, SUBMIT it,
//                         withdraw a batch nobody has reviewed yet
//   Cluster / Dept Head — approve or reject the rows of their branches
//   Super Admin, Director — read only
//
// Preview and submit both read the uploaded FILE on the server. The
// browser never sends rows back, so nothing shown in the preview can be
// altered between "preview" and "submit" — it is validated again from
// scratch, against the Doctor Master as it is at that moment.
// ============================================================
const crypto = require("crypto");
const mongoose = require("mongoose");
const Branch = require("../models/Branch");
const User = require("../models/User");
const Doctor = require("../models/Doctor");
const DoctorPayout = require("../models/DoctorPayout");
const DoctorPayoutBatch = require("../models/DoctorPayoutBatch");
const cfg = require("../config/doctorPayoutConfig");
const { ROLES } = require("../config/constants");
const { logAction } = require("../services/auditService");
const {
  readWorkbook,
  buildTemplate,
} = require("../services/doctorPayoutSheetService");
const {
  normaliseRows,
  assessRows,
  compareBank,
  bankOf,
  accountKey,
} = require("../services/doctorPayoutValidation");
const {
  notifyApprovers,
  notifyUploader,
} = require("../services/doctorPayoutNotifier");
const access = require("../utils/doctorAccess");

const S = cfg.PAYOUT_STATUS;
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ message, ...extra });

// ── shared: read + validate an uploaded workbook ───────────
// Used by BOTH preview and submit. Writes nothing.
const analyse = async (user, file, decisions) => {
  const buffer = file.buffer;
  // .xlsx is a zip: it must start with "PK". Catches a renamed .xls/.csv.
  if (
    !buffer ||
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b
  ) {
    const e = new Error(
      "This is not an .xlsx workbook. Open it in Excel and use Save As → Excel Workbook (.xlsx).",
    );
    e.status = 400;
    throw e;
  }
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

  const book = await readWorkbook(buffer);
  const branches = await Branch.find({}).select("name code status").lean();
  const allowedBranchIds = access.isScoped(user)
    ? access.branchIdsOf(user)
    : null;

  const normalised = normaliseRows({
    sheets: book.sheets,
    branches,
    allowedBranchIds,
    today: access.istToday(),
  });
  const { rows } = normalised;

  const pans = [
    ...new Set(
      rows
        .map((r) => r.values.panNumber)
        .filter((p) => p && cfg.PAN_REGEX.test(p)),
    ),
  ];
  const accountNumbers = [
    ...new Set(rows.map((r) => r.values.accountNumber).filter(Boolean)),
  ];
  const fingerprints = [
    ...new Set(rows.map((r) => r.fingerprint).filter(Boolean)),
  ];
  const branchIds = [
    ...new Set(rows.map((r) => r.values.branchId).filter(Boolean)),
  ];

  const [doctors, accountHolders, existing, priorBatch, heads] =
    await Promise.all([
      pans.length ? Doctor.find({ panNumber: { $in: pans } }).lean() : [],
      accountNumbers.length
        ? Doctor.find({ accountNumber: { $in: accountNumbers } })
            .select("name panNumber accountNumber ifscCode")
            .lean()
        : [],
      fingerprints.length
        ? DoctorPayout.find({
            fingerprint: { $in: fingerprints },
            status: { $nin: [S.REJECTED, S.WITHDRAWN] },
          })
            .select("payoutId fingerprint status batch")
            .populate("batch", "batchId")
            .lean()
        : [],
      DoctorPayoutBatch.findOne({ fileHash, state: "ready" })
        .sort({ createdAt: -1 })
        .select("batchId createdAt")
        .lean(),
      branchIds.length
        ? User.find({
            role: { $in: cfg.APPROVER_ROLES },
            status: "active",
            branches: { $in: branchIds },
          })
            .select("branches")
            .lean()
        : [],
    ]);

  const doctorsByPan = {};
  doctors.forEach((d) => (doctorsByPan[d.panNumber] = d));

  const doctorsByAccount = {};
  accountHolders.forEach((d) => {
    const key = accountKey(d);
    if (!key) return;
    (doctorsByAccount[key] = doctorsByAccount[key] || []).push({
      panNumber: d.panNumber,
      name: d.name,
    });
  });

  const existingByFingerprint = {};
  existing.forEach((p) => {
    existingByFingerprint[p.fingerprint] = {
      payoutId: p.payoutId,
      batchId: p.batch?.batchId || null,
      status: p.status,
    };
  });

  const fileWarnings = [...book.fileWarnings, ...normalised.fileWarnings];
  if (priorBatch)
    fileWarnings.unshift(
      `This exact file was already uploaded as ${priorBatch.batchId} on ${new Date(
        priorBatch.createdAt,
      ).toLocaleDateString(
        "en-GB",
      )}. Rows already in PMS are marked as duplicates below.`,
    );

  // A branch nobody can approve for would sit in the queue for ever.
  const covered = new Set(
    heads.flatMap((h) => (h.branches || []).map((b) => String(b))),
  );
  const branchName = (id) =>
    branches.find((b) => String(b._id) === String(id))?.name || id;
  branchIds
    .filter((id) => !covered.has(String(id)))
    .forEach((id) =>
      fileWarnings.push(
        `No active Cluster / Department Head is assigned to ${branchName(id)} — its records cannot be approved until one is`,
      ),
    );

  const assessed = assessRows({
    rows,
    doctorsByPan,
    doctorsByAccount,
    existingByFingerprint,
    decisions,
    fileErrors: [...book.fileErrors, ...normalised.fileErrors],
  });

  return {
    fileName: file.originalname,
    fileHash,
    sheets: book.sheets.map((s) => ({
      type: s.type,
      sheetName: s.sheetName,
      headerRow: s.headerRow,
      rows: s.rows.length,
    })),
    fileWarnings,
    ...assessed,
    doctorsByPan, // internal — removed before the response is sent
  };
};

const toResponse = ({ doctorsByPan, ...preview }) => preview;

const parseDecisions = (raw) => {
  let d = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      d = JSON.parse(raw);
    } catch {
      d = {};
    }
  }
  if (!d || typeof d !== "object") d = {};
  const bank = {};
  if (d.bank && typeof d.bank === "object")
    Object.entries(d.bank).forEach(([pan, choice]) => {
      if (["keep", "update"].includes(choice))
        bank[String(pan).toUpperCase()] = choice;
    });
  return {
    bank,
    allowDuplicates: d.allowDuplicates === true || d.allowDuplicates === "true",
  };
};

// ── GET /api/doctor-payouts/template ───────────────────────
exports.downloadTemplate = async (req, res) => {
  try {
    const query = { status: "active" };
    if (access.isScoped(req.user))
      query._id = { $in: access.branchIdsOf(req.user) };
    const branches = await Branch.find(query).select("name").sort({ name: 1 });
    const workbook = buildTemplate({
      branchNames: branches.map((b) => b.name),
    });
    res.setHeader("Content-Type", XLSX_MIME);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Doctor_Payout_Template.xlsx"',
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Doctor payout template error:", err);
    if (!res.headersSent) fail(res, 500, "Could not build the template");
  }
};

// ── POST /api/doctor-payouts/preview   (multipart: file) ───
// Nothing is saved. Returns every row with its problems and flags.
exports.preview = async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, "Choose the Excel file to upload");
    const result = await analyse(
      req.user,
      req.file,
      parseDecisions(req.body?.decisions),
    );
    res.json(toResponse(result));
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Doctor payout preview error:", err);
    fail(res, 500, "Could not read the file");
  }
};

// ── POST /api/doctor-payouts/batches   (multipart: file, decisions, fileHash)
// Validates the file again and, only if nothing blocks it, saves the
// batch: new doctors → Doctor Master, every row → pending approval.
exports.submit = async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, "Choose the Excel file to upload");
    const decisions = parseDecisions(req.body?.decisions);
    const result = await analyse(req.user, req.file, decisions);

    // The file sent now must be the one that was previewed.
    const previewed = access.qstr(req.body?.fileHash);
    if (previewed && previewed !== result.fileHash)
      return fail(
        res,
        409,
        "This is not the file you previewed. Preview it again before submitting.",
        { preview: toResponse(result) },
      );

    if (!result.canSubmit)
      return fail(
        res,
        422,
        "The file cannot be submitted yet — see the points below.",
        { preview: toResponse(result) },
      );

    const { rows, doctors, summary, doctorsByPan } = result;
    const now = new Date();
    const payoutIds = await DoctorPayout.reserveIds(rows.length);
    const entryByPan = new Map(doctors.map((d) => [d.panNumber, d]));

    let batch;
    let createdDoctors = [];
    const session = await mongoose.startSession();
    try {
      // withTransaction may run this more than once, so everything it
      // builds is created inside it.
      await session.withTransaction(async () => {
        createdDoctors = [];
        batch = new DoctorPayoutBatch({
          fileName: String(req.file.originalname || "upload.xlsx").slice(
            0,
            200,
          ),
          fileHash: result.fileHash,
          uploadedBy: req.user._id,
          branches: summary.byBranch.map((b) => b.branchId),
          types: Object.keys(summary.byType),
          rowCount: rows.length,
          totals: summary.totals,
          byType: summary.byType,
          newDoctorCount: summary.newDoctors,
          bankChangeCount: doctors.filter(
            (d) => d.mismatch && d.decision === "update",
          ).length,
          duplicateCount: summary.duplicateRows,
          state: "processing",
          history: [
            {
              action: "UPLOADED",
              by: req.user._id,
              at: now,
              rows: rows.length,
              amount: summary.totals.payable,
            },
          ],
        });
        await batch.save({ session });

        // New PANs → Doctor Master.
        const doctorIdByPan = new Map();
        for (const d of doctors) {
          if (!d.isNew) {
            doctorIdByPan.set(d.panNumber, d.doctorId);
            continue;
          }
          const first = rows.find((r) => r.values.panNumber === d.panNumber);
          const contact = rows.filter(
            (r) => r.values.panNumber === d.panNumber,
          );
          const doc = new Doctor({
            name: d.name,
            panNumber: d.panNumber,
            mobile: contact.find((r) => r.values.mobile)?.values.mobile,
            email: contact.find((r) => r.values.email)?.values.email,
            ...bankOf(d.sheetBank || first.values),
            createdBy: req.user._id,
            createdViaBatch: batch._id,
            createdVia: "upload",
          });
          await doc.save({ session });
          createdDoctors.push(doc);
          doctorIdByPan.set(d.panNumber, String(doc._id));
        }

        // Existing doctors: fill in a mobile / e-mail the master lacks.
        // Never overwrites one that is already there.
        for (const d of doctors) {
          if (d.isNew) continue;
          const master = doctorsByPan[d.panNumber];
          const mine = rows.filter((r) => r.values.panNumber === d.panNumber);
          const set = {};
          const mobile = mine.find((r) => r.values.mobile)?.values.mobile;
          const email = mine.find((r) => r.values.email)?.values.email;
          if (!master.mobile && mobile) set.mobile = mobile;
          if (!master.email && email) set.email = email;
          if (Object.keys(set).length)
            await Doctor.updateOne(
              { _id: master._id },
              { $set: set },
              { session },
            );
        }

        const docs = rows.map((r, i) => {
          const v = r.values;
          const entry = entryByPan.get(v.panNumber);
          const wantsUpdate = entry?.mismatch && entry.decision === "update";
          return {
            payoutId: payoutIds[i],
            batch: batch._id,
            type: r.type,
            branch: v.branchId,
            doctor: doctorIdByPan.get(v.panNumber),
            panNumber: v.panNumber,
            sheetName: r.sheetName,
            rowNumber: r.rowNumber,
            doctorName: v.doctorName,
            date: access.isoToDate(v.date),
            patientName: v.patientName || undefined,
            noOfSurgeries: v.noOfSurgeries ?? undefined,
            settledAmount: v.settledAmount,
            basicAmount: v.basicAmount,
            tdsAmount: v.tdsAmount,
            payableAmount: v.payableAmount,
            sheetBank: bankOf(v),
            bankChange: wantsUpdate
              ? {
                  requested: true,
                  from: entry.storedBank,
                  to: entry.sheetBank,
                }
              : { requested: false },
            flags: {
              newDoctor: r.flags.newDoctor,
              bankMismatchKept:
                entry?.mismatch?.severity === "critical" &&
                entry.decision === "keep",
              duplicate: Boolean(r.flags.duplicate),
              duplicateOf: r.flags.duplicate
                ? r.flags.duplicateRef?.payoutId ||
                  `${r.flags.duplicateRef?.sheetName || "sheet"} row ${r.flags.duplicateRef?.rowNumber}`
                : undefined,
              sharedBank: r.flags.sharedBank,
            },
            warnings: r.warnings.map((w) => w.message),
            fingerprint: r.fingerprint,
            status: S.PENDING,
            uploadedBy: req.user._id,
            history: [{ action: "UPLOADED", by: req.user._id, at: now }],
          };
        });
        await DoctorPayout.insertMany(docs, { session });

        batch.state = "ready";
        await batch.save({ session });
      });
    } catch (err) {
      // Someone else created one of these PANs between preview and submit.
      if (err?.code === 11000)
        return fail(
          res,
          409,
          "One of these doctors was added to the Doctor Master a moment ago by another upload. Preview the file again.",
        );
      throw err;
    } finally {
      await session.endSession();
    }

    // ── audit (after the commit, never inside it) ──
    await logAction({
      userId: req.user._id,
      action: "UPLOAD_DOCTOR_PAYOUTS",
      module: "DoctorPayout",
      targetId: batch._id,
      targetLabel: batch.batchId,
      amount: summary.totals.payable,
      statusTo: S.PENDING,
      newValue: {
        fileName: batch.fileName,
        rows: rows.length,
        byType: summary.byType,
        newDoctors: summary.newDoctors,
        bankChangesRequested: batch.bankChangeCount,
        duplicatesConfirmed: summary.duplicateRows,
      },
      req,
    });
    await Promise.all(
      createdDoctors.map((d) =>
        logAction({
          userId: req.user._id,
          action: "CREATE_DOCTOR",
          module: "Doctor",
          targetId: d._id,
          targetLabel: `${d.name} (${d.panNumber})`,
          reason: `Created by upload ${batch.batchId}`,
          newValue: {
            doctorCode: d.doctorCode,
            panNumber: d.panNumber,
            ...bankOf(d),
          },
          req,
        }),
      ),
    );

    notifyApprovers(batch, summary.byBranch, req.user); // not awaited

    res.status(201).json({
      message: `${batch.batchId} submitted — ${rows.length} record${rows.length === 1 ? "" : "s"} sent for approval`,
      batch: {
        _id: batch._id,
        batchId: batch.batchId,
        rowCount: batch.rowCount,
        totals: batch.totals,
        newDoctorCount: batch.newDoctorCount,
        bankChangeCount: batch.bankChangeCount,
      },
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Doctor payout submit error:", err);
    fail(res, 500, "Could not save the upload. Nothing was saved — try again.");
  }
};

// ── batch progress, counted from its rows ──────────────────
const EMPTY_COUNTS = () => ({
  total: 0,
  payable: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  withdrawn: 0,
  inPayment: 0,
  paid: 0,
  referral: 0,
  surgeon: 0,
  pendingAmount: 0,
});

const deriveStatus = (c) => {
  if (!c.total) return "empty";
  const live = c.total - c.rejected - c.withdrawn;
  if (c.pending === c.total) return "pending_approval";
  if (c.pending > 0) return "partially_reviewed";
  if (live === 0) return c.rejected ? "rejected" : "withdrawn";
  if (c.paid === live) return "paid";
  if (c.inPayment + c.paid > 0) return "in_payment";
  return "approved";
};

// counts per batch, limited to the branches the viewer may see
const countsFor = async (batchIds, branchCond) => {
  const match = { batch: { $in: batchIds } };
  if (branchCond !== undefined) match.branch = branchCond;
  const sum = (statuses) => ({
    $sum: { $cond: [{ $in: ["$status", statuses] }, 1, 0] },
  });
  const agg = await DoctorPayout.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$batch",
        total: { $sum: 1 },
        payable: { $sum: "$payableAmount" },
        pending: sum([S.PENDING]),
        approved: sum([S.APPROVED]),
        rejected: sum([S.REJECTED]),
        withdrawn: sum([S.WITHDRAWN]),
        inPayment: sum([S.RAISED, S.FILE_GENERATED]),
        paid: sum([S.PAID]),
        referral: {
          $sum: { $cond: [{ $eq: ["$type", cfg.TYPES.REFERRAL] }, 1, 0] },
        },
        surgeon: {
          $sum: { $cond: [{ $eq: ["$type", cfg.TYPES.SURGEON] }, 1, 0] },
        },
        pendingAmount: {
          $sum: {
            $cond: [{ $eq: ["$status", S.PENDING] }, "$payableAmount", 0],
          },
        },
      },
    },
  ]);
  const map = new Map();
  agg.forEach((a) =>
    map.set(String(a._id), {
      ...a,
      payable: access.round2(a.payable),
      pendingAmount: access.round2(a.pendingAmount),
    }),
  );
  return map;
};

// ── GET /api/doctor-payouts/batches ────────────────────────
// ?view=pending  → only batches with rows still awaiting approval
exports.listBatches = async (req, res) => {
  try {
    const { page, limit, skip } = access.paging(req.query, 20, 100);
    const branchCond = access.branchCondition(req.user, req.query.branch);
    const query = { state: "ready" };
    if (branchCond !== undefined) query.branches = branchCond;

    const search = access.qstr(req.query.search);
    if (search) {
      const rx = { $regex: access.escapeRx(search), $options: "i" };
      query.$or = [{ batchId: rx }, { fileName: rx }];
    }
    if (req.query.view === "pending") {
      const match = { status: S.PENDING };
      if (branchCond !== undefined) match.branch = branchCond;
      query._id = { $in: await DoctorPayout.distinct("batch", match) };
    }

    const [total, batches, pendingMatch] = await Promise.all([
      DoctorPayoutBatch.countDocuments(query),
      DoctorPayoutBatch.find(query)
        .select("-history")
        .populate("uploadedBy", "name email")
        .populate("branches", "name code")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      // badge: rows awaiting approval in the viewer's branches
      DoctorPayout.countDocuments({
        status: S.PENDING,
        ...(branchCond !== undefined ? { branch: branchCond } : {}),
      }),
    ]);

    const counts = await countsFor(
      batches.map((b) => b._id),
      branchCond,
    );
    res.json({
      batches: batches.map((b) => {
        const c = counts.get(String(b._id)) || EMPTY_COUNTS();
        return { ...b, counts: c, status: deriveStatus(c) };
      }),
      total,
      page,
      limit,
      pendingRows: pendingMatch,
    });
  } catch (err) {
    console.error("Doctor payout batch list error:", err);
    fail(res, 500, "Could not load the uploads");
  }
};

const loadBatch = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    fail(res, 400, "Invalid batch id");
    return null;
  }
  const batch = await DoctorPayoutBatch.findOne({
    _id: req.params.id,
    state: "ready",
  });
  if (!batch) {
    fail(res, 404, "Upload not found");
    return null;
  }
  if (
    access.isScoped(req.user) &&
    !batch.branches.some((b) => access.inScope(req.user, b))
  ) {
    fail(res, 403, "This upload has no records for your branches");
    return null;
  }
  return batch;
};

// ── GET /api/doctor-payouts/batches/:id ────────────────────
// Header + every row the viewer may see.
exports.getBatch = async (req, res) => {
  try {
    const batch = await loadBatch(req, res);
    if (!batch) return;
    const branchCond = access.branchCondition(req.user);
    const rowQuery = { batch: batch._id };
    if (branchCond !== undefined) rowQuery.branch = branchCond;

    const [header, rows, counts] = await Promise.all([
      DoctorPayoutBatch.findById(batch._id)
        .populate("uploadedBy", "name email")
        .populate("branches", "name code")
        .populate("history.by", "name role designation")
        .lean(),
      DoctorPayout.find(rowQuery)
        .select("-history -fingerprint")
        .populate("branch", "name code")
        .populate(
          "doctor",
          "doctorCode name status verifiedAt accountNumber ifscCode bankName accountHolderName",
        )
        .populate("approvedBy", "name")
        .populate("rejectedBy", "name")
        .sort({ type: 1, rowNumber: 1 })
        .lean(),
      countsFor([batch._id], branchCond),
    ]);
    const c = counts.get(String(batch._id)) || EMPTY_COUNTS();
    res.json({
      batch: { ...header, counts: c, status: deriveStatus(c) },
      rows,
      // true when the batch also holds rows of branches the viewer cannot see
      partialView: rows.length < batch.rowCount,
    });
  } catch (err) {
    console.error("Doctor payout batch get error:", err);
    fail(res, 500, "Could not open the upload");
  }
};

// Rows of this batch the caller may act on, in the given status.
// payoutIds omitted / all:true → every such row.
const pickRows = async (req, batch, status) => {
  const branchCond = access.branchCondition(req.user);
  const query = { batch: batch._id, status };
  if (branchCond !== undefined) query.branch = branchCond;
  const ids = Array.isArray(req.body?.payoutIds) ? req.body.payoutIds : null;
  if (ids && !req.body.all) {
    const valid = access.toObjectIds(ids);
    if (!valid.length) return { rows: [], asked: ids.length };
    query._id = { $in: valid };
  }
  const rows = await DoctorPayout.find(query).lean();
  return { rows, asked: ids && !req.body.all ? ids.length : rows.length };
};

const sumPayable = (rows) =>
  access.round2(rows.reduce((s, r) => s + (r.payableAmount || 0), 0));

// ── PATCH /api/doctor-payouts/batches/:id/approve ──────────
// Body: { payoutIds?: [...], all?: true, remarks? }
// Approving a row also (a) applies a bank-detail change the uploader
// asked for, and (b) marks the doctor as verified.
exports.approve = async (req, res) => {
  try {
    const batch = await loadBatch(req, res);
    if (!batch) return;
    if (String(batch.uploadedBy) === String(req.user._id))
      return fail(res, 403, "You cannot approve an upload you made yourself");

    const { rows, asked } = await pickRows(req, batch, S.PENDING);
    if (!rows.length)
      return fail(
        res,
        400,
        "None of the selected records are awaiting your approval",
      );
    const remarks = String(req.body?.remarks || "")
      .trim()
      .slice(0, 500);
    const now = new Date();

    // ── bank changes riding on these rows, one per doctor ──
    const changeByDoctor = new Map();
    rows.forEach((r) => {
      if (r.bankChange?.requested && !r.bankChange.appliedAt)
        changeByDoctor.set(String(r.doctor), r);
    });
    const doctorIds = [...new Set(rows.map((r) => String(r.doctor)))];
    const doctorDocs = await Doctor.find({ _id: { $in: doctorIds } });
    const doctorById = new Map(doctorDocs.map((d) => [String(d._id), d]));

    const blocked = doctorDocs.filter((d) => d.status !== "active");
    if (blocked.length)
      return fail(
        res,
        409,
        `These doctors are no longer active in the Doctor Master: ${blocked
          .map((d) => `${d.name} (${d.panNumber})`)
          .join(", ")}. Reject their records or activate the doctor first.`,
      );

    // The master must still be what the uploader saw. If it was edited in
    // between, applying this change would silently undo that edit.
    const stale = [];
    const toApply = [];
    changeByDoctor.forEach((row, doctorId) => {
      const doctor = doctorById.get(doctorId);
      if (!doctor) return;
      const current = bankOf(doctor);
      if (!compareBank(current, row.bankChange.to)) return; // already there
      if (compareBank(current, row.bankChange.from))
        stale.push(`${doctor.name} (${doctor.panNumber})`);
      else toApply.push({ doctor, row });
    });
    if (stale.length)
      return fail(
        res,
        409,
        `The Doctor Master bank details were changed after this file was uploaded for: ${stale.join(
          ", ",
        )}. Reject those records and ask Accounts to upload them again.`,
      );

    const rowIds = rows.map((r) => r._id);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const upd = await DoctorPayout.updateMany(
          { _id: { $in: rowIds }, status: S.PENDING },
          {
            $set: {
              status: S.APPROVED,
              approvedBy: req.user._id,
              approvedAt: now,
              ...(remarks ? { approvalRemarks: remarks } : {}),
            },
            $push: {
              history: {
                action: "APPROVED",
                by: req.user._id,
                at: now,
                ...(remarks ? { remarks } : {}),
              },
            },
          },
          { session },
        );
        if (upd.modifiedCount !== rowIds.length) {
          const e = new Error(
            "Some of these records were changed by someone else just now. Refresh and try again.",
          );
          e.status = 409;
          throw e;
        }

        for (const { doctor, row } of toApply) {
          const fresh = await Doctor.findById(doctor._id).session(session);
          // Nothing to keep when the master had no bank details yet.
          if (fresh.accountNumber)
            fresh.bankHistory.push({
              ...bankOf(fresh),
              replacedAt: now,
              replacedBy: req.user._id,
              source: "upload",
              batch: batch._id,
              requestedBy: batch.uploadedBy,
              reason: `Changed through upload ${batch.batchId}`,
            });
          Object.assign(fresh, bankOf(row.bankChange.to));
          await fresh.save({ session });
          await DoctorPayout.updateMany(
            {
              batch: batch._id,
              doctor: doctor._id,
              "bankChange.requested": true,
            },
            {
              $set: {
                "bankChange.appliedAt": now,
                "bankChange.appliedBy": req.user._id,
              },
            },
            { session },
          );
        }

        await Doctor.updateMany(
          { _id: { $in: doctorIds }, verifiedAt: { $exists: false } },
          { $set: { verifiedAt: now, verifiedBy: req.user._id } },
          { session },
        );

        await DoctorPayoutBatch.updateOne(
          { _id: batch._id },
          {
            $push: {
              history: {
                action: "APPROVED",
                by: req.user._id,
                at: now,
                ...(remarks ? { remarks } : {}),
                rows: rows.length,
                amount: sumPayable(rows),
              },
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    const amount = sumPayable(rows);
    await logAction({
      userId: req.user._id,
      action: "APPROVE_DOCTOR_PAYOUTS",
      module: "DoctorPayout",
      targetId: batch._id,
      targetLabel: batch.batchId,
      statusFrom: S.PENDING,
      statusTo: S.APPROVED,
      amount,
      reason: remarks || undefined,
      newValue: {
        rows: rows.length,
        payoutIds: rows.slice(0, 200).map((r) => r.payoutId),
        bankChangesApplied: toApply.length,
      },
      req,
    });
    await Promise.all(
      toApply.map(({ doctor, row }) =>
        logAction({
          userId: req.user._id,
          action: "UPDATE_DOCTOR_BANK",
          module: "Doctor",
          targetId: doctor._id,
          targetLabel: `${doctor.name} (${doctor.panNumber})`,
          reason: `Approved through upload ${batch.batchId}`,
          oldValue: row.bankChange.from,
          newValue: row.bankChange.to,
          req,
        }),
      ),
    );
    notifyUploader(batch, {
      action: "approved",
      rows: rows.length,
      amount,
      by: req.user,
    });

    res.json({
      message: `${rows.length} record${rows.length === 1 ? "" : "s"} approved`,
      approved: rows.length,
      skipped: Math.max(0, asked - rows.length),
      bankChangesApplied: toApply.length,
    });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("Doctor payout approve error:", err);
    fail(res, 500, "Approval failed — nothing was changed");
  }
};

// Shared by reject (approver) and withdraw (uploader).
const closeRows = async (req, res, { toStatus, action, audit, who }) => {
  const batch = await loadBatch(req, res);
  if (!batch) return;
  if (who === "uploader") {
    const own = String(batch.uploadedBy) === String(req.user._id);
    if (!own && req.user.role !== ROLES.SUPER_ADMIN)
      return fail(res, 403, "Only the person who uploaded it can withdraw it");
  }
  const reason = String(req.body?.reason || "")
    .trim()
    .slice(0, 500);
  if (reason.length < 3) return fail(res, 400, "Give a reason");

  const { rows, asked } = await pickRows(req, batch, S.PENDING);
  if (!rows.length)
    return fail(res, 400, "None of the selected records are awaiting approval");

  const now = new Date();
  const set =
    toStatus === S.REJECTED
      ? {
          status: toStatus,
          rejectedBy: req.user._id,
          rejectedAt: now,
          rejectionReason: reason,
        }
      : { status: toStatus };
  const rowIds = rows.map((r) => r._id);
  const upd = await DoctorPayout.updateMany(
    { _id: { $in: rowIds }, status: S.PENDING },
    {
      $set: set,
      $push: {
        history: { action, by: req.user._id, at: now, remarks: reason },
      },
    },
  );
  const amount = sumPayable(rows);
  await DoctorPayoutBatch.updateOne(
    { _id: batch._id },
    {
      $push: {
        history: {
          action,
          by: req.user._id,
          at: now,
          remarks: reason,
          rows: upd.modifiedCount,
          amount,
        },
      },
    },
  );
  await logAction({
    userId: req.user._id,
    action: audit,
    module: "DoctorPayout",
    targetId: batch._id,
    targetLabel: batch.batchId,
    statusFrom: S.PENDING,
    statusTo: toStatus,
    amount,
    reason,
    newValue: {
      rows: upd.modifiedCount,
      payoutIds: rows.slice(0, 200).map((r) => r.payoutId),
    },
    req,
  });
  if (toStatus === S.REJECTED)
    notifyUploader(batch, {
      action: "rejected",
      rows: upd.modifiedCount,
      amount,
      by: req.user,
      reason,
    });

  const verb = toStatus === S.REJECTED ? "rejected" : "withdrawn";
  res.json({
    message: `${upd.modifiedCount} record${upd.modifiedCount === 1 ? "" : "s"} ${verb}`,
    [verb]: upd.modifiedCount,
    skipped: Math.max(0, asked - upd.modifiedCount),
  });
};

// ── PATCH /api/doctor-payouts/batches/:id/reject ───────────
// Body: { payoutIds?: [...], all?: true, reason }
exports.reject = async (req, res) => {
  try {
    await closeRows(req, res, {
      toStatus: S.REJECTED,
      action: "REJECTED",
      audit: "REJECT_DOCTOR_PAYOUTS",
      who: "approver",
    });
  } catch (err) {
    console.error("Doctor payout reject error:", err);
    fail(res, 500, "Rejection failed");
  }
};

// ── PATCH /api/doctor-payouts/batches/:id/withdraw ─────────
// Uploader pulls back rows nobody has reviewed yet (wrong file).
exports.withdraw = async (req, res) => {
  try {
    await closeRows(req, res, {
      toStatus: S.WITHDRAWN,
      action: "WITHDRAWN",
      audit: "WITHDRAW_DOCTOR_PAYOUTS",
      who: "uploader",
    });
  } catch (err) {
    console.error("Doctor payout withdraw error:", err);
    fail(res, 500, "Could not withdraw the upload");
  }
};

// ── GET /api/doctor-payouts ────────────────────────────────
// Row list. ?type=&status=a,b&branch=&batch=&doctor=&search=&from=&to=
// The Doctor Payments "to raise" tab uses status=approved.
exports.listRows = async (req, res) => {
  try {
    const { page, limit, skip } = access.paging(req.query, 50, 1000);
    const query = {};
    const branchCond = access.branchCondition(req.user, req.query.branch);
    if (branchCond !== undefined) query.branch = branchCond;

    const type = access.qstr(req.query.type);
    if (type && Object.values(cfg.TYPES).includes(type)) query.type = type;

    const statuses = (access.qstr(req.query.status) || "")
      .split(",")
      .filter((s) => Object.values(S).includes(s));
    if (statuses.length) query.status = { $in: statuses };

    ["batch", "doctor"].forEach((k) => {
      if (mongoose.isValidObjectId(req.query[k]))
        query[k] = new mongoose.Types.ObjectId(String(req.query[k]));
    });

    const from = access.isoToDate(access.qstr(req.query.from));
    const to = access.isoToDate(access.qstr(req.query.to));
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = from;
      if (to) query.date.$lte = to;
    }

    const search = access.qstr(req.query.search);
    if (search) {
      const rx = { $regex: access.escapeRx(search), $options: "i" };
      query.$or = [
        { doctorName: rx },
        { panNumber: rx },
        { patientName: rx },
        { payoutId: rx },
        { paymentRef: rx },
      ];
    }

    const [total, rows, sums] = await Promise.all([
      DoctorPayout.countDocuments(query),
      DoctorPayout.find(query)
        .select("-history -fingerprint -sheetBank")
        .populate("branch", "name code")
        .populate(
          "doctor",
          "doctorCode name status accountNumber ifscCode bankName accountHolderName",
        )
        .populate("batch", "batchId")
        .populate("approvedBy", "name")
        .sort({ date: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DoctorPayout.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            basic: { $sum: "$basicAmount" },
            tds: { $sum: "$tdsAmount" },
            payable: { $sum: "$payableAmount" },
          },
        },
      ]),
    ]);

    res.json({
      rows,
      total,
      page,
      limit,
      totals: {
        basic: access.round2(sums[0]?.basic),
        tds: access.round2(sums[0]?.tds),
        payable: access.round2(sums[0]?.payable),
      },
    });
  } catch (err) {
    console.error("Doctor payout row list error:", err);
    fail(res, 500, "Could not load the records");
  }
};
