// ============================================================
// BACKEND: src/controllers/auditController.js — NEW FILE
// ------------------------------------------------------------
//   getAuditLogs     — paginated feed, every row resolved to a real
//                      entity and a readable sentence
//   getAuditTrail    — full chronological story for one invoice or
//                      payment, audit logs merged with workflow history
//   getAuditFilters  — dropdown options
//   exportAuditExcel — workbook matching the on-screen columns
//
// Historical entries have no targetLabel — they predate the schema
// change. Rather than migrate, targets are resolved at read time from
// targetId, one query per module per page. Every existing log becomes
// readable immediately.
// ============================================================
const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");

const toId = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null;

// ── What each module points at ─────────────────────────────
const TARGETS = {
  Invoice: {
    model: () => require("../models/InvoiceRequest"),
    select:
      "requestId invoiceNumber netPayable status branch vendor approvalHistory rejectionHistory",
    label: (d) => d.requestId,
    amount: (d) => d.netPayable,
    route: (id) => `/invoices/${id}`,
    noun: "invoice",
  },
  Payment: {
    model: () => require("../models/PaymentProcessing"),
    select: "paymentId totalAmount paidAmount status branch vendor",
    label: (d) => d.paymentId,
    amount: (d) => d.totalAmount,
    route: (id) => `/payments/${id}`,
    noun: "payment",
  },
  Vendor: {
    model: () => require("../models/Vendor"),
    select: "vendorName companyName approvalStatus",
    label: (d) => d.vendorName,
    route: (id) => `/vendors/${id}`,
    noun: "vendor",
  },
  Branch: {
    model: () => require("../models/Branch"),
    select: "name code status",
    label: (d) => `${d.name}${d.code ? ` (${d.code})` : ""}`,
    route: () => `/branches`,
    noun: "branch",
  },
  Budget: {
    model: () => require("../models/Budget"),
    select: "branch year month expenseType allocatedAmount",
    label: (d) =>
      `${d.expenseType || "Budget"} ${d.month || ""}/${d.year || ""}`.trim(),
    route: () => `/budgets`,
    noun: "budget",
  },
  User: {
    model: () => require("../models/User"),
    select: "name email role",
    label: (d) => d.name || d.email,
    route: () => `/users`,
    noun: "user",
  },
  ExpenseCategory: {
    model: () => require("../models/ExpenseCategory"),
    select: "name code type",
    label: (d) => `${d.code || ""} ${d.name || ""}`.trim(),
    route: () => `/expense-categories`,
    noun: "expense category",
  },
  SLA: {
    model: () => require("../models/SLAConfig"),
    select: "stage stageLabel hoursAllowed",
    label: (d) => d.stageLabel || d.stage,
    route: () => `/sla`,
    noun: "SLA config",
  },
};

// Action string → past-tense verb, so a row reads as a sentence.
const VERBS = {
  CREATE_INVOICE: "created",
  UPDATE_INVOICE: "edited",
  SUBMIT_INVOICE: "submitted",
  APPROVE_INVOICE: "approved",
  REJECT_INVOICE: "rejected",
  DELETE_INVOICE: "deleted",
  RAISE_PAYMENT: "raised payment for",
  APPROVE_PAYMENT: "approved",
  REJECT_PAYMENT: "rejected",
  GENERATE_PAYMENT_EXCEL: "generated the bank file for",
  RECORD_UTR: "recorded the UTR for",
  BULK_RECORD_UTR: "recorded UTRs in bulk",
  CREATE_VENDOR: "added",
  UPDATE_VENDOR: "edited",
  APPROVE_VENDOR: "approved",
  REJECT_VENDOR: "rejected",
  DELETE_VENDOR: "deleted",
  CREATE_BRANCH: "created",
  UPDATE_BRANCH: "edited",
  CREATE_BUDGET: "created",
  UPDATE_BUDGET: "edited",
  CREATE_USER: "created",
  UPDATE_USER: "edited",
  UPDATE_SLA_CONFIG: "changed",
  LOGIN: "signed in",
  LOGOUT: "signed out",
};

const TONE = {
  approved: "positive",
  rejected: "negative",
  created: "neutral",
  edited: "warning",
  deleted: "negative",
};

const verbFor = (action) =>
  VERBS[action] ||
  String(action || "")
    .toLowerCase()
    .replace(/_/g, " ");

const toneFor = (action) => {
  if (/REJECT|DELETE|FAIL/.test(action)) return "negative";
  if (/APPROVE|GENERATE|RECORD/.test(action)) return "positive";
  if (/UPDATE|EDIT/.test(action)) return "warning";
  return "neutral";
};

const buildQuery = (req) => {
  const { module: mod, action, from, to, user, branch, q } = req.query;
  const query = {};

  if (mod) query.module = mod;
  if (action) query.action = action;
  if (user) {
    const u = toId(user);
    if (u) query.user = u;
  }
  if (branch) {
    const b = toId(branch);
    if (b) query.branch = b;
  }
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to)
      query.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
  }
  // Free text hits the stored label; targetId search is handled by the
  // trail endpoint, which is the right tool for "show me INV-000444".
  if (q) query.targetLabel = { $regex: String(q).trim(), $options: "i" };

  return query;
};

// ── Resolve targets for a page of logs ─────────────────────
// One query per module rather than one per row.
const resolveTargets = async (logs) => {
  const byModule = {};
  logs.forEach((l) => {
    if (!l.targetId || !TARGETS[l.module]) return;
    (byModule[l.module] = byModule[l.module] || new Set()).add(
      String(l.targetId),
    );
  });

  const resolved = {};
  await Promise.all(
    Object.entries(byModule).map(async ([mod, ids]) => {
      const cfg = TARGETS[mod];
      try {
        const docs = await cfg
          .model()
          .find({ _id: { $in: [...ids].map(toId).filter(Boolean) } })
          .select(cfg.select)
          .populate("branch", "name")
          .populate("vendor", "vendorName")
          .lean();
        docs.forEach((d) => {
          resolved[`${mod}|${d._id}`] = d;
        });
      } catch {
        /* a missing model shouldn't break the feed */
      }
    }),
  );
  return resolved;
};

// For older invoice/payment logs the stage and remark weren't stored.
// They can be recovered by matching the log timestamp against the
// entry the same action wrote into approvalHistory / rejectionHistory.
const TOLERANCE_MS = 5000;

const recoverStageDetail = (log, doc) => {
  if (!doc) return {};
  const t = new Date(log.createdAt).getTime();
  const near = (d) => Math.abs(new Date(d).getTime() - t) <= TOLERANCE_MS;

  const rej = (doc.rejectionHistory || []).find((r) => near(r.rejectedAt));
  if (rej) return { stage: rej.stage, reason: rej.reason };

  const app = (doc.approvalHistory || []).find((a) => near(a.actionAt));
  if (app) return { stage: app.stage, reason: app.remarks };

  return {};
};

const shape = (log, resolved) => {
  const cfg = TARGETS[log.module];
  const doc = resolved[`${log.module}|${log.targetId}`];
  const recovered = ["Invoice", "Payment"].includes(log.module)
    ? recoverStageDetail(log, doc)
    : {};

  const label = log.targetLabel || (doc && cfg?.label(doc)) || null;
  const verb = verbFor(log.action);
  const noun = cfg?.noun || "";
  const actor = log.user?.name || log.user?.email || "System";

  return {
    _id: log._id,
    at: log.createdAt,
    action: log.action,
    module: log.module || "—",
    tone: toneFor(log.action),

    actor: {
      id: log.user?._id || null,
      name: actor,
      email: log.user?.email || null,
      role: log.user?.role || null,
    },

    target: label
      ? {
          id: log.targetId,
          label,
          noun,
          // Deleted targets keep their stored label but lose the link.
          link: doc && cfg?.route ? cfg.route(log.targetId) : null,
          exists: Boolean(doc),
          status: doc?.status || doc?.approvalStatus || null,
        }
      : null,

    // One readable line — the thing the old page was missing.
    summary: label ? `${actor} ${verb} ${noun} ${label}` : `${actor} ${verb}`,

    branch: doc?.branch?.name || null,
    vendor: doc?.vendor?.vendorName || null,
    amount: log.amount ?? (doc && cfg?.amount ? cfg.amount(doc) : null),
    stage: log.statusTo ? null : recovered.stage || null,
    statusFrom: log.statusFrom || null,
    statusTo: log.statusTo || null,
    reason: log.reason || recovered.reason || null,

    changes:
      log.oldValue || log.newValue
        ? { old: log.oldValue, new: log.newValue }
        : null,
    ipAddress: log.ipAddress || null,
    deviceInfo: log.deviceInfo || null,
  };
};

// ============================================================
exports.getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const query = buildQuery(req);

    const [total, logs, moduleStats, actionStats] = await Promise.all([
      AuditLog.countDocuments(query),
      AuditLog.find(query)
        .populate("user", "name email role")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: "$module", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ]),
    ]);

    const resolved = await resolveTargets(logs);

    res.json({
      logs: logs.map((l) => shape(l, resolved)),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      moduleStats,
      actionStats,
    });
  } catch (err) {
    console.error("getAuditLogs error:", err);
    res.status(500).json({ message: "Could not load the audit log" });
  }
};

// ============================================================
// Full story for one entity. Audit logs alone have gaps — submit is
// never logged, for instance — so workflow history is merged in.
// ============================================================
exports.getAuditTrail = async (req, res) => {
  try {
    const { type = "Invoice", id, ref } = req.query;
    const cfg = TARGETS[type];
    if (!cfg) return res.status(400).json({ message: "Unknown entity type" });

    const Model = cfg.model();
    let doc = null;

    if (id && toId(id)) {
      doc = await Model.findById(id)
        .populate("branch", "name")
        .populate("vendor", "vendorName")
        .populate("createdBy", "name role")
        .lean();
    } else if (ref) {
      const field = type === "Payment" ? "paymentId" : "requestId";
      doc = await Model.findOne({ [field]: String(ref).trim().toUpperCase() })
        .populate("branch", "name")
        .populate("vendor", "vendorName")
        .populate("createdBy", "name role")
        .lean();
    }

    if (!doc)
      return res
        .status(404)
        .json({ message: `No ${cfg.noun} found for that reference` });

    const logs = await AuditLog.find({ targetId: doc._id })
      .populate("user", "name email role")
      .sort({ createdAt: 1 })
      .lean();

    const resolved = { [`${type}|${doc._id}`]: doc };
    const events = logs.map((l) => ({
      ...shape(l, resolved),
      source: "audit",
    }));

    // Workflow entries the audit log never captured.
    const actorIds = new Set();
    (doc.approvalHistory || []).forEach(
      (a) => a.approvedBy && actorIds.add(String(a.approvedBy)),
    );
    (doc.rejectionHistory || []).forEach(
      (r) => r.rejectedBy && actorIds.add(String(r.rejectedBy)),
    );
    const actors = await User.find({ _id: { $in: [...actorIds] } })
      .select("name role")
      .lean();
    const actorMap = Object.fromEntries(actors.map((u) => [String(u._id), u]));

    (doc.approvalHistory || []).forEach((a) => {
      const t = new Date(a.actionAt).getTime();
      // Skip anything already covered by an audit entry.
      if (
        events.some(
          (e) => Math.abs(new Date(e.at).getTime() - t) <= TOLERANCE_MS,
        )
      )
        return;
      const u = actorMap[String(a.approvedBy)] || {};
      events.push({
        _id: `wf-${t}`,
        at: a.actionAt,
        action: a.action === "rejected" ? "REJECT_INVOICE" : "APPROVE_INVOICE",
        module: type,
        tone: a.action === "rejected" ? "negative" : "positive",
        actor: { name: u.name || "Unknown", role: u.role || null },
        target: { label: cfg.label(doc), noun: cfg.noun, id: doc._id },
        summary: `${u.name || "Unknown"} ${a.action === "rejected" ? "rejected" : "approved"} at ${a.stage}`,
        stage: a.stage,
        reason: a.remarks || null,
        source: "workflow",
      });
    });

    events.sort((a, b) => new Date(a.at) - new Date(b.at));

    res.json({
      entity: {
        type,
        id: doc._id,
        label: cfg.label(doc),
        status: doc.status || doc.approvalStatus || null,
        branch: doc.branch?.name || null,
        vendor: doc.vendor?.vendorName || null,
        amount: cfg.amount ? cfg.amount(doc) : null,
        createdBy: doc.createdBy?.name || null,
        createdAt: doc.createdAt,
        link: cfg.route(doc._id),
      },
      events,
    });
  } catch (err) {
    console.error("getAuditTrail error:", err);
    res.status(500).json({ message: "Could not load the trail" });
  }
};

// ============================================================
exports.getAuditFilters = async (req, res) => {
  try {
    const Branch = require("../models/Branch");
    const [modules, actions, userIds, branches] = await Promise.all([
      AuditLog.distinct("module"),
      AuditLog.distinct("action"),
      AuditLog.distinct("user"),
      Branch.find({}).select("name").sort({ name: 1 }).lean(),
    ]);

    const users = await User.find({ _id: { $in: userIds.filter(Boolean) } })
      .select("name email role")
      .sort({ name: 1 })
      .lean();

    res.json({
      modules: modules.filter(Boolean).sort(),
      actions: actions.filter(Boolean).sort(),
      users,
      branches,
    });
  } catch (err) {
    console.error("getAuditFilters error:", err);
    res.status(500).json({ message: "Could not load filter options" });
  }
};

// ============================================================
exports.exportAuditExcel = async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const query = buildQuery(req);

    const logs = await AuditLog.find(query)
      .populate("user", "name email role")
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean();

    const resolved = await resolveTargets(logs);
    const rows = logs.map((l) => shape(l, resolved));

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Audit Trail");
    sheet.columns = [
      { header: "Timestamp", key: "at", width: 20 },
      { header: "User", key: "user", width: 22 },
      { header: "Role", key: "role", width: 16 },
      { header: "Action", key: "action", width: 24 },
      { header: "Module", key: "module", width: 14 },
      { header: "Reference", key: "ref", width: 16 },
      { header: "Branch", key: "branch", width: 20 },
      { header: "Vendor", key: "vendor", width: 24 },
      { header: "Amount", key: "amount", width: 15 },
      { header: "Stage", key: "stage", width: 26 },
      { header: "Status change", key: "status", width: 30 },
      { header: "Reason / remarks", key: "reason", width: 44 },
      { header: "What happened", key: "summary", width: 52 },
      { header: "IP", key: "ip", width: 15 },
    ];

    rows.forEach((r) =>
      sheet.addRow({
        at: new Date(r.at).toLocaleString("en-GB"),
        user: r.actor.name,
        role: (r.actor.role || "").replace(/_/g, " "),
        action: r.action,
        module: r.module,
        ref: r.target?.label || "",
        branch: r.branch || "",
        vendor: r.vendor || "",
        amount: r.amount || "",
        stage: r.stage || "",
        status:
          r.statusFrom || r.statusTo
            ? `${r.statusFrom || "?"} → ${r.statusTo || "?"}`
            : "",
        reason: r.reason || "",
        summary: r.summary,
        ip: r.ipAddress || "",
      }),
    );

    const h = sheet.getRow(1);
    h.eachCell((c) => {
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1A3C6E" },
      };
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      c.alignment = { vertical: "middle" };
    });
    h.height = 24;
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: { row: 1, column: 14 } };
    sheet.getColumn("amount").numFmt = "#,##0.00";

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Audit_Trail_${stamp}.xlsx`,
    );
    res.send(await wb.xlsx.writeBuffer());
  } catch (err) {
    console.error("exportAuditExcel error:", err);
    res.status(500).json({ message: "Could not build the workbook" });
  }
};
