// ============================================================
// BACKEND: src/controllers/primaryReportController.js — NEW FILE
// ------------------------------------------------------------
// The three PRIMARY reports the client asked for:
//   1. getInvoiceDelayReport   — stage-wise approval delays
//   2. getPaymentDelayReport   — stage-wise payment delays
//   3. getExpenseAnalysisReport— Revenue/Capital -> category, all
//                                branches and branch-wise
//
// Every figure is DERIVED at read time. No model is modified and no
// document is written. Safe to deploy against live data.
// ============================================================
const mongoose = require("mongoose");
const InvoiceRequest = require("../models/InvoiceRequest");
const PaymentProcessing = require("../models/PaymentProcessing");
const SLATracking = require("../models/SLATracking");
const SLAConfig = require("../models/SLAConfig");
const ExpenseCategory = require("../models/ExpenseCategory");
const {
  REPORT_TZ,
  INVOICE_STAGE_META,
  PAYMENT_STAGE_META,
  OVERDUE_BUCKETS,
  BRANCH_SCOPED_ROLES,
  EXPENSE_TYPE_SOURCE,
} = require("../config/reportConfig");

const HOUR_MS = 1000 * 60 * 60;

// ── Helpers ────────────────────────────────────────────────

const toId = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null;

const idList = (raw) =>
  String(raw || "")
    .split(",")
    .map((s) => toId(s.trim()))
    .filter(Boolean);

// Branch ids the caller may see, intersected with any ?branch= filter.
// Returns null when the caller is unrestricted AND no filter was sent.
const resolveBranchIds = (user, requested) => {
  const assigned = BRANCH_SCOPED_ROLES.includes(user.role)
    ? (user.branches || []).map((b) => b._id || b)
    : null;

  const asked = idList(requested);

  if (!assigned) return asked.length ? asked : null;
  if (!asked.length) return assigned;

  const allowed = new Set(assigned.map(String));
  const intersect = asked.filter((id) => allowed.has(String(id)));
  // An out-of-scope branch id yields an empty list, which correctly
  // returns zero rows rather than silently widening the scope.
  return intersect;
};

const parseFilters = (req) => {
  const { from, to, branch, expenseType, expenseCategory } = req.query;

  let dateRange = null;
  if (from || to) {
    dateRange = {};
    if (from) dateRange.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      dateRange.$lte = end;
    }
  }

  const categoryIds = idList(expenseCategory);

  return {
    dateRange,
    branchIds: resolveBranchIds(req.user, branch),
    expenseType: ["Revenue", "Capital"].includes(expenseType)
      ? expenseType
      : null,
    categoryIds: categoryIds.length ? categoryIds : null,
  };
};

// $switch expression placing a row into an overdue bucket.
const bucketExpr = (hoursField) => ({
  $switch: {
    branches: OVERDUE_BUCKETS.filter((b) => b.max !== null).map((b) => ({
      case: { $lt: [hoursField, b.max] },
      then: b.key,
    })),
    default: OVERDUE_BUCKETS[OVERDUE_BUCKETS.length - 1].key,
  },
});

const emptyBuckets = () =>
  OVERDUE_BUCKETS.reduce((acc, b) => ({ ...acc, [b.key]: 0 }), {});

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// ============================================================
// 1. INVOICE APPROVAL DELAY REPORT
//    Source: SLATracking (written by slaService on submit + each
//    approval). Breach is recomputed from the snapshotted deadlineAt
//    so that editing an SLAConfig never rewrites historical numbers.
// ============================================================
exports.getInvoiceDelayReport = async (req, res) => {
  try {
    const { dateRange, branchIds, expenseType, categoryIds } =
      parseFilters(req);
    const stageKeys = INVOICE_STAGE_META.map((s) => s.key);

    const invoiceFilter = {};
    if (branchIds) invoiceFilter["invoice.branch"] = { $in: branchIds };
    if (expenseType) invoiceFilter["invoice.expenseType"] = expenseType;
    if (categoryIds)
      invoiceFilter["invoice.expenseCategory"] = { $in: categoryIds };

    const base = [
      {
        $match: {
          stage: { $in: stageKeys },
          ...(dateRange ? { stageEnteredAt: dateRange } : {}),
        },
      },
      {
        $lookup: {
          from: "invoicerequests",
          // SLATracking.paymentRequest holds the INVOICE id despite the
          // field name — see the comment in slaService.startSLATracking.
          localField: "paymentRequest",
          foreignField: "_id",
          as: "invoice",
        },
      },
      { $unwind: "$invoice" },
      ...(Object.keys(invoiceFilter).length ? [{ $match: invoiceFilter }] : []),

      // A stage is still "open" while on_track / at_risk. Anything else
      // is closed; measure it to completedAt, otherwise to now.
      {
        $set: {
          isOpen: { $in: ["$status", ["on_track", "at_risk"]] },
          closedAt: { $ifNull: ["$completedAt", "$$NOW"] },
        },
      },
      {
        $set: {
          hoursTaken: {
            $divide: [{ $subtract: ["$closedAt", "$stageEnteredAt"] }, HOUR_MS],
          },
          overdueHours: {
            $max: [
              0,
              {
                $divide: [{ $subtract: ["$closedAt", "$deadlineAt"] }, HOUR_MS],
              },
            ],
          },
        },
      },
      { $set: { breached: { $gt: ["$overdueHours", 0] } } },
    ];

    const [result] = await SLATracking.aggregate([
      ...base,
      {
        $facet: {
          // ── Per stage, split into still-pending vs already-completed
          byStage: [
            {
              $group: {
                _id: { stage: "$stage", isOpen: "$isOpen" },
                count: { $sum: 1 },
                breached: { $sum: { $cond: ["$breached", 1, 0] } },
                atRisk: {
                  $sum: { $cond: [{ $eq: ["$status", "at_risk"] }, 1, 0] },
                },
                avgHours: { $avg: "$hoursTaken" },
                maxHours: { $max: "$hoursTaken" },
                slaHours: { $first: "$slaHours" },
                amount: { $sum: "$invoice.netPayable" },
                breachedAmount: {
                  $sum: { $cond: ["$breached", "$invoice.netPayable", 0] },
                },
              },
            },
          ],

          // ── Same, per branch
          byBranch: [
            {
              $group: {
                _id: { stage: "$stage", branch: "$invoice.branch" },
                count: { $sum: 1 },
                breached: { $sum: { $cond: ["$breached", 1, 0] } },
                pending: { $sum: { $cond: ["$isOpen", 1, 0] } },
                avgHours: { $avg: "$hoursTaken" },
                amount: { $sum: "$invoice.netPayable" },
              },
            },
            {
              $lookup: {
                from: "branches",
                localField: "_id.branch",
                foreignField: "_id",
                as: "branch",
              },
            },
            { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
            { $sort: { breached: -1, count: -1 } },
          ],

          // ── How badly late, for the breached rows only
          buckets: [
            { $match: { breached: true } },
            { $set: { bucket: bucketExpr("$overdueHours") } },
            {
              $group: {
                _id: { stage: "$stage", bucket: "$bucket" },
                count: { $sum: 1 },
              },
            },
          ],

          // ── Currently stuck and overdue, worst first
          worstOffenders: [
            { $match: { isOpen: true, breached: true } },
            { $sort: { overdueHours: -1 } },
            { $limit: 25 },
            {
              $lookup: {
                from: "branches",
                localField: "invoice.branch",
                foreignField: "_id",
                as: "branchDoc",
              },
            },
            {
              $lookup: {
                from: "vendors",
                localField: "invoice.vendor",
                foreignField: "_id",
                as: "vendorDoc",
              },
            },
            {
              $project: {
                _id: 0,
                invoiceId: "$invoice._id",
                requestId: "$invoice.requestId",
                invoiceNumber: "$invoice.invoiceNumber",
                netPayable: "$invoice.netPayable",
                expenseType: "$invoice.expenseType",
                status: "$invoice.status",
                stage: 1,
                slaHours: 1,
                stageEnteredAt: 1,
                deadlineAt: 1,
                overdueHours: 1,
                remindersSent: 1,
                escalatedAt: 1,
                branch: { $first: "$branchDoc.name" },
                vendor: { $first: "$vendorDoc.vendorName" },
              },
            },
          ],

          // ── Coverage: how many tracked invoices exist at all
          coverage: [
            { $group: { _id: "$paymentRequest" } },
            { $count: "trackedInvoices" },
          ],
        },
      },
    ]);

    // ── Reshape into a stage-ordered response ─────────────────
    const bucketMap = {};
    (result.buckets || []).forEach((b) => {
      bucketMap[b._id.stage] = bucketMap[b._id.stage] || emptyBuckets();
      bucketMap[b._id.stage][b._id.bucket] = b.count;
    });

    const stageRow = (key, isOpen) =>
      (result.byStage || []).find(
        (r) => r._id.stage === key && r._id.isOpen === isOpen,
      ) || {};

    const stages = INVOICE_STAGE_META.map(({ key, label }) => {
      const open = stageRow(key, true);
      const done = stageRow(key, false);
      const doneCount = done.count || 0;
      const doneBreached = done.breached || 0;

      return {
        stage: key,
        stageLabel: label,
        slaHours: open.slaHours || done.slaHours || null,
        pending: {
          count: open.count || 0,
          breached: open.breached || 0,
          atRisk: open.atRisk || 0,
          avgHoursWaiting: round1(open.avgHours),
          maxHoursWaiting: round1(open.maxHours),
          amount: open.amount || 0,
          breachedAmount: open.breachedAmount || 0,
        },
        completed: {
          count: doneCount,
          breached: doneBreached,
          onTimePct: doneCount
            ? round1(((doneCount - doneBreached) / doneCount) * 100)
            : null,
          avgHoursTaken: round1(done.avgHours),
          maxHoursTaken: round1(done.maxHours),
          amount: done.amount || 0,
        },
        overdueBuckets: bucketMap[key] || emptyBuckets(),
      };
    });

    // Rework loops: invoices sent back at least once. Counted from
    // rejectionHistory, which is already populated on every invoice.
    const reworkMatch = {
      "rejectionHistory.0": { $exists: true },
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(branchIds ? { branch: { $in: branchIds } } : {}),
      ...(expenseType ? { expenseType } : {}),
      ...(categoryIds ? { expenseCategory: { $in: categoryIds } } : {}),
    };
    const reworkedInvoices = await InvoiceRequest.countDocuments(reworkMatch);

    res.json({
      filters: { dateRange, expenseType },
      stages,
      byBranch: (result.byBranch || []).map((b) => ({
        stage: b._id.stage,
        branchId: b._id.branch,
        branchName: b.branch?.name || "Unknown",
        count: b.count,
        pending: b.pending,
        breached: b.breached,
        onTimePct: b.count
          ? round1(((b.count - b.breached) / b.count) * 100)
          : null,
        avgHours: round1(b.avgHours),
        amount: b.amount || 0,
      })),
      worstOffenders: (result.worstOffenders || []).map((w) => ({
        ...w,
        overdueHours: round1(w.overdueHours),
      })),
      meta: {
        reworkedInvoices,
        trackedInvoices: result.coverage?.[0]?.trackedInvoices || 0,
        bucketLabels: OVERDUE_BUCKETS,
      },
    });
  } catch (err) {
    console.error("getInvoiceDelayReport error:", err);
    res
      .status(500)
      .json({ message: "Could not build the invoice delay report" });
  }
};

// ============================================================
// 2. PAYMENT PROCESSING DELAY REPORT
//    No SLATracking rows exist for payment stages, so durations come
//    straight from the timestamps already stored on every payment.
//    This means the report covers ALL history from day one.
// ============================================================
exports.getPaymentDelayReport = async (req, res) => {
  try {
    const { dateRange, branchIds, expenseType, categoryIds } =
      parseFilters(req);

    // Prefer a real SLAConfig when one has been created for a payment
    // stage; otherwise fall back to reportConfig defaults.
    const configs = await SLAConfig.find({
      stage: { $in: PAYMENT_STAGE_META.map((s) => s.key) },
    }).lean();

    const thresholds = PAYMENT_STAGE_META.map((s) => ({
      ...s,
      hours: configs.find((c) => c.stage === s.key)?.hoursAllowed ?? s.hours,
    }));

    const thresholdSwitch = {
      $switch: {
        branches: thresholds.map((t) => ({
          case: { $eq: ["$seg.key", t.key] },
          then: t.hours,
        })),
        default: 24,
      },
    };

    const needsInvoiceJoin = Boolean(expenseType || categoryIds);

    const [result] = await PaymentProcessing.aggregate([
      {
        $match: {
          ...(dateRange ? { createdAt: dateRange } : {}),
          ...(branchIds ? { branch: { $in: branchIds } } : {}),
        },
      },

      ...(needsInvoiceJoin
        ? [
            {
              $lookup: {
                from: "invoicerequests",
                localField: "invoiceRequest",
                foreignField: "_id",
                as: "inv",
              },
            },
            { $unwind: "$inv" },
            {
              $match: {
                ...(expenseType ? { "inv.expenseType": expenseType } : {}),
                ...(categoryIds
                  ? { "inv.expenseCategory": { $in: categoryIds } }
                  : {}),
              },
            },
          ]
        : []),

      // Records predating the installments array still carry top-level
      // legacy fields. Build a synthetic single installment for them so
      // one pipeline covers both shapes.
      //
      // A "Payment Pending" record has genuinely never been raised, so
      // raisedAt stays null and the raise segment correctly stays open.
      // A legacy PROCESSED record has an unknown raise time, so it is
      // anchored to createdAt and flagged so it can be excluded.
      {
        $set: {
          hasInstallments: {
            $gt: [{ $size: { $ifNull: ["$installments", []] } }, 0],
          },
        },
      },
      {
        $set: {
          inst: {
            $cond: [
              "$hasInstallments",
              "$installments",
              [
                {
                  raisedAt: {
                    $cond: [
                      { $eq: ["$status", "Payment Pending"] },
                      null,
                      "$createdAt",
                    ],
                  },
                  approvalHistory: { $ifNull: ["$approvalHistory", []] },
                  rejectionHistory: { $ifNull: ["$rejectionHistory", []] },
                  excelGeneratedAt: "$excelGeneratedAt",
                  utrRecordedAt: "$utrRecordedAt",
                  paymentDate: "$paymentDate",
                  amount: { $ifNull: ["$paymentAmount", "$totalAmount"] },
                  status: "$status",
                },
              ],
            ],
          },
        },
      },
      { $unwind: { path: "$inst", includeArrayIndex: "instIndex" } },

      {
        $set: {
          approvedAt: {
            $min: {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ["$inst.approvalHistory", []] },
                    as: "a",
                    cond: { $eq: ["$$a.action", "approved"] },
                  },
                },
                as: "a",
                in: "$$a.actionAt",
              },
            },
          },
          rejectedAt: {
            $min: {
              $map: {
                input: { $ifNull: ["$inst.rejectionHistory", []] },
                as: "r",
                in: "$$r.rejectedAt",
              },
            },
          },
        },
      },

      // Four measurable segments. A segment with a null `from` never
      // started and is dropped; a null `to` is still running.
      {
        $set: {
          segments: [
            {
              key: "payment_raise",
              from: "$createdAt",
              to: "$inst.raisedAt",
            },
            {
              key: "payment_approval",
              from: "$inst.raisedAt",
              // A rejection closes the approval clock just as an
              // approval does — otherwise rejected installments would
              // sit "open" forever and dominate the breach count.
              to: { $ifNull: ["$approvedAt", "$rejectedAt"] },
            },
            {
              key: "excel_generation",
              from: "$approvedAt",
              to: "$inst.excelGeneratedAt",
            },
            {
              key: "utr_recording",
              from: "$inst.excelGeneratedAt",
              to: "$inst.utrRecordedAt",
            },
          ],
        },
      },
      { $unwind: { path: "$segments", includeArrayIndex: "segOrder" } },
      { $set: { seg: "$segments" } },
      { $match: { "seg.from": { $ne: null } } },

      {
        $set: {
          isOpen: { $eq: [{ $ifNull: ["$seg.to", null] }, null] },
          closedAt: { $ifNull: ["$seg.to", "$$NOW"] },
          isLegacy: { $eq: ["$hasInstallments", false] },
        },
      },
      {
        $set: {
          hoursTaken: {
            $divide: [{ $subtract: ["$closedAt", "$seg.from"] }, HOUR_MS],
          },
          thresholdHours: thresholdSwitch,
        },
      },
      {
        $set: {
          overdueHours: {
            $max: [0, { $subtract: ["$hoursTaken", "$thresholdHours"] }],
          },
        },
      },
      { $set: { breached: { $gt: ["$overdueHours", 0] } } },

      {
        $facet: {
          byStage: [
            {
              $group: {
                _id: { stage: "$seg.key", isOpen: "$isOpen" },
                count: { $sum: 1 },
                breached: { $sum: { $cond: ["$breached", 1, 0] } },
                avgHours: { $avg: "$hoursTaken" },
                maxHours: { $max: "$hoursTaken" },
                thresholdHours: { $first: "$thresholdHours" },
                amount: { $sum: { $ifNull: ["$inst.amount", 0] } },
                breachedAmount: {
                  $sum: {
                    $cond: ["$breached", { $ifNull: ["$inst.amount", 0] }, 0],
                  },
                },
              },
            },
          ],

          byBranch: [
            {
              $group: {
                _id: { stage: "$seg.key", branch: "$branch" },
                count: { $sum: 1 },
                pending: { $sum: { $cond: ["$isOpen", 1, 0] } },
                breached: { $sum: { $cond: ["$breached", 1, 0] } },
                avgHours: { $avg: "$hoursTaken" },
                amount: { $sum: { $ifNull: ["$inst.amount", 0] } },
              },
            },
            {
              $lookup: {
                from: "branches",
                localField: "_id.branch",
                foreignField: "_id",
                as: "branch",
              },
            },
            { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
            { $sort: { breached: -1 } },
          ],

          buckets: [
            { $match: { breached: true } },
            { $set: { bucket: bucketExpr("$overdueHours") } },
            {
              $group: {
                _id: { stage: "$seg.key", bucket: "$bucket" },
                count: { $sum: 1 },
              },
            },
          ],

          worstOffenders: [
            { $match: { isOpen: true, breached: true } },
            { $sort: { overdueHours: -1 } },
            { $limit: 25 },
            {
              $lookup: {
                from: "invoicerequests",
                localField: "invoiceRequest",
                foreignField: "_id",
                as: "invDoc",
              },
            },
            {
              $lookup: {
                from: "branches",
                localField: "branch",
                foreignField: "_id",
                as: "branchDoc",
              },
            },
            {
              $lookup: {
                from: "vendors",
                localField: "vendor",
                foreignField: "_id",
                as: "vendorDoc",
              },
            },
            {
              $project: {
                _id: 0,
                paymentId: 1,
                status: 1,
                stage: "$seg.key",
                installmentNo: { $add: ["$instIndex", 1] },
                amount: { $ifNull: ["$inst.amount", "$totalAmount"] },
                totalAmount: 1,
                paidAmount: 1,
                remainingAmount: 1,
                thresholdHours: 1,
                hoursTaken: 1,
                overdueHours: 1,
                stageEnteredAt: "$seg.from",
                requestId: { $first: "$invDoc.requestId" },
                dueDate: { $first: "$invDoc.dueDate" },
                branch: { $first: "$branchDoc.name" },
                vendor: { $first: "$vendorDoc.vendorName" },
              },
            },
          ],

          legacyCoverage: [
            { $match: { isLegacy: true } },
            { $group: { _id: "$_id" } },
            { $count: "records" },
          ],
        },
      },
    ]);

    const bucketMap = {};
    (result.buckets || []).forEach((b) => {
      bucketMap[b._id.stage] = bucketMap[b._id.stage] || emptyBuckets();
      bucketMap[b._id.stage][b._id.bucket] = b.count;
    });

    const stageRow = (key, isOpen) =>
      (result.byStage || []).find(
        (r) => r._id.stage === key && r._id.isOpen === isOpen,
      ) || {};

    const stages = thresholds.map(({ key, label, hours, help }) => {
      const open = stageRow(key, true);
      const done = stageRow(key, false);
      const doneCount = done.count || 0;
      const doneBreached = done.breached || 0;

      return {
        stage: key,
        stageLabel: label,
        help,
        slaHours: hours,
        configured: configs.some((c) => c.stage === key),
        pending: {
          count: open.count || 0,
          breached: open.breached || 0,
          avgHoursWaiting: round1(open.avgHours),
          maxHoursWaiting: round1(open.maxHours),
          amount: open.amount || 0,
          breachedAmount: open.breachedAmount || 0,
        },
        completed: {
          count: doneCount,
          breached: doneBreached,
          onTimePct: doneCount
            ? round1(((doneCount - doneBreached) / doneCount) * 100)
            : null,
          avgHoursTaken: round1(done.avgHours),
          maxHoursTaken: round1(done.maxHours),
          amount: done.amount || 0,
        },
        overdueBuckets: bucketMap[key] || emptyBuckets(),
      };
    });

    // Vendor due date is the metric the client will care about most,
    // but invoice.dueDate is optional — coverage is reported alongside
    // so nobody reads the number as complete.
    const dueDateAgg = await PaymentProcessing.aggregate([
      {
        $match: {
          ...(dateRange ? { createdAt: dateRange } : {}),
          ...(branchIds ? { branch: { $in: branchIds } } : {}),
        },
      },
      {
        $lookup: {
          from: "invoicerequests",
          localField: "invoiceRequest",
          foreignField: "_id",
          as: "inv",
        },
      },
      { $unwind: "$inv" },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withDueDate: {
            $sum: { $cond: [{ $ifNull: ["$inv.dueDate", false] }, 1, 0] },
          },
          paidLate: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ["$inv.dueDate", false] },
                    { $ifNull: ["$paymentDate", false] },
                    { $gt: ["$paymentDate", "$inv.dueDate"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          overdueUnpaid: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ["$inv.dueDate", false] },
                    { $gt: ["$$NOW", "$inv.dueDate"] },
                    { $ne: ["$status", "Fully Paid"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          outstanding: { $sum: { $ifNull: ["$remainingAmount", 0] } },
        },
      },
    ]);

    res.json({
      filters: { dateRange, expenseType },
      stages,
      byBranch: (result.byBranch || []).map((b) => ({
        stage: b._id.stage,
        branchId: b._id.branch,
        branchName: b.branch?.name || "Unknown",
        count: b.count,
        pending: b.pending,
        breached: b.breached,
        onTimePct: b.count
          ? round1(((b.count - b.breached) / b.count) * 100)
          : null,
        avgHours: round1(b.avgHours),
        amount: b.amount || 0,
      })),
      worstOffenders: (result.worstOffenders || []).map((w) => ({
        ...w,
        hoursTaken: round1(w.hoursTaken),
        overdueHours: round1(w.overdueHours),
      })),
      dueDatePerformance: dueDateAgg[0]
        ? {
            total: dueDateAgg[0].total,
            withDueDate: dueDateAgg[0].withDueDate,
            coveragePct: dueDateAgg[0].total
              ? round1((dueDateAgg[0].withDueDate / dueDateAgg[0].total) * 100)
              : 0,
            paidAfterDueDate: dueDateAgg[0].paidLate,
            overdueStillUnpaid: dueDateAgg[0].overdueUnpaid,
            outstandingAmount: dueDateAgg[0].outstanding,
          }
        : null,
      meta: {
        // Pre-installment records have no reliable raise timestamp.
        legacyRecords: result.legacyCoverage?.[0]?.records || 0,
        bucketLabels: OVERDUE_BUCKETS,
      },
    });
  } catch (err) {
    console.error("getPaymentDelayReport error:", err);
    res
      .status(500)
      .json({ message: "Could not build the payment delay report" });
  }
};

// ============================================================
// 3. EXPENSE CATEGORY ANALYSIS
//    Revenue / Capital -> ExpenseCategory, overall and branch-wise.
//    expenseType is taken from the CATEGORY document, not the copy
//    stored on the invoice, so the two-level totals always reconcile.
// ============================================================
exports.getExpenseAnalysisReport = async (req, res) => {
  try {
    const { dateRange, branchIds, expenseType, categoryIds } =
      parseFilters(req);
    const { status } = req.query;

    const match = {
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(branchIds ? { branch: { $in: branchIds } } : {}),
      ...(categoryIds ? { expenseCategory: { $in: categoryIds } } : {}),
      ...(status ? { status } : {}),
    };

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
      {
        $lookup: {
          from: "paymentprocessings",
          localField: "paymentRequest",
          foreignField: "_id",
          as: "payment",
        },
      },
      { $unwind: { path: "$payment", preserveNullAndEmptyArrays: true } },
      {
        $set: {
          // Category document wins. Falls back to the invoice copy only
          // when the category reference is broken or missing.
          catType:
            EXPENSE_TYPE_SOURCE === "invoice"
              ? { $ifNull: ["$expenseType", "$category.type"] }
              : { $ifNull: ["$category.type", "$expenseType"] },
          paid: { $ifNull: ["$payment.paidAmount", 0] },
        },
      },
      {
        $set: {
          outstanding: {
            $max: [
              0,
              { $subtract: [{ $ifNull: ["$netPayable", 0] }, "$paid"] },
            ],
          },
        },
      },
      ...(expenseType ? [{ $match: { catType: expenseType } }] : []),
    ];

    const money = {
      count: { $sum: 1 },
      amount: { $sum: { $ifNull: ["$amount", 0] } },
      gstAmount: { $sum: { $ifNull: ["$gstAmount", 0] } },
      tdsAmount: { $sum: { $ifNull: ["$tdsAmount", 0] } },
      netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
      paid: { $sum: "$paid" },
      outstanding: { $sum: "$outstanding" },
    };

    const [result] = await InvoiceRequest.aggregate([
      ...base,
      {
        $facet: {
          summary: [{ $group: { _id: "$catType", ...money } }],

          byCategory: [
            {
              $group: {
                _id: {
                  type: "$catType",
                  category: "$expenseCategory",
                  name: "$category.name",
                  code: "$category.code",
                  categoryStatus: "$category.status",
                },
                ...money,
              },
            },
            { $sort: { netPayable: -1 } },
          ],

          byBranchCategory: [
            {
              $group: {
                _id: {
                  branch: "$branch",
                  type: "$catType",
                  category: "$expenseCategory",
                  name: "$category.name",
                  code: "$category.code",
                },
                ...money,
              },
            },
            {
              $lookup: {
                from: "branches",
                localField: "_id.branch",
                foreignField: "_id",
                as: "branchDoc",
              },
            },
            {
              $unwind: {
                path: "$branchDoc",
                preserveNullAndEmptyArrays: true,
              },
            },
            { $sort: { netPayable: -1 } },
          ],

          byBranchType: [
            {
              $group: {
                _id: { branch: "$branch", type: "$catType" },
                ...money,
              },
            },
            {
              $lookup: {
                from: "branches",
                localField: "_id.branch",
                foreignField: "_id",
                as: "branchDoc",
              },
            },
            {
              $unwind: {
                path: "$branchDoc",
                preserveNullAndEmptyArrays: true,
              },
            },
          ],

          monthly: [
            {
              $group: {
                _id: {
                  // Bucketed in IST. $year/$month with an explicit
                  // timezone works on MongoDB 3.6+, unlike $dateTrunc.
                  y: { $year: { date: "$createdAt", timezone: REPORT_TZ } },
                  m: { $month: { date: "$createdAt", timezone: REPORT_TZ } },
                  type: "$catType",
                },
                count: { $sum: 1 },
                netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
              },
            },
            { $sort: { "_id.y": 1, "_id.m": 1 } },
          ],

          // Invoices whose stored expenseType disagrees with the
          // referenced category's type. Should be zero.
          drift: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: [{ $type: "$category" }, "missing"] },
                    { $ne: ["$expenseType", "$category.type"] },
                  ],
                },
              },
            },
            { $count: "count" },
          ],

          orphaned: [
            { $match: { $expr: { $eq: [{ $type: "$category" }, "missing"] } } },
            { $count: "count" },
          ],
        },
      },
    ]);

    const shapeMoney = (r) => ({
      count: r.count,
      amount: r.amount,
      gstAmount: r.gstAmount,
      tdsAmount: r.tdsAmount,
      netPayable: r.netPayable,
      paid: r.paid,
      outstanding: r.outstanding,
    });

    const summary = { Revenue: null, Capital: null };
    (result.summary || []).forEach((r) => {
      if (r._id) summary[r._id] = shapeMoney(r);
    });

    res.json({
      filters: { dateRange, expenseType, status: status || null },
      summary,
      byCategory: (result.byCategory || []).map((r) => ({
        expenseType: r._id.type,
        categoryId: r._id.category,
        categoryName: r._id.name || "Uncategorised",
        categoryCode: r._id.code || "—",
        categoryStatus: r._id.categoryStatus || "unknown",
        ...shapeMoney(r),
      })),
      byBranchCategory: (result.byBranchCategory || []).map((r) => ({
        branchId: r._id.branch,
        branchName: r.branchDoc?.name || "Unknown",
        expenseType: r._id.type,
        categoryId: r._id.category,
        categoryName: r._id.name || "Uncategorised",
        categoryCode: r._id.code || "—",
        ...shapeMoney(r),
      })),
      byBranchType: (result.byBranchType || []).map((r) => ({
        branchId: r._id.branch,
        branchName: r.branchDoc?.name || "Unknown",
        expenseType: r._id.type,
        ...shapeMoney(r),
      })),
      monthly: (result.monthly || []).map((r) => ({
        year: r._id.y,
        month: r._id.m,
        expenseType: r._id.type,
        count: r.count,
        netPayable: r.netPayable,
      })),
      dataQuality: {
        // Surface these in the UI. A non-zero drift count means the
        // Revenue/Capital split is wrong somewhere in the source data.
        typeMismatch: result.drift?.[0]?.count || 0,
        missingCategory: result.orphaned?.[0]?.count || 0,
      },
    });
  } catch (err) {
    console.error("getExpenseAnalysisReport error:", err);
    res
      .status(500)
      .json({ message: "Could not build the expense analysis report" });
  }
};

// ============================================================
// Filter options for the report screen. Unlike GET /expense-categories
// this returns INACTIVE categories too, so historical invoices filed
// under a retired category remain reachable.
// ============================================================
exports.getReportFilterOptions = async (req, res) => {
  try {
    const categories = await ExpenseCategory.find({})
      .select("name code type status")
      .sort({ type: 1, name: 1 })
      .lean();

    const Branch = require("../models/Branch");
    const branchIds = BRANCH_SCOPED_ROLES.includes(req.user.role)
      ? (req.user.branches || []).map((b) => b._id || b)
      : null;

    const branches = await Branch.find(
      branchIds ? { _id: { $in: branchIds } } : {},
    )
      .select("name")
      .sort({ name: 1 })
      .lean();

    res.json({ categories, branches });
  } catch (err) {
    console.error("getReportFilterOptions error:", err);
    res.status(500).json({ message: "Could not load report filters" });
  }
};
