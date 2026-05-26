const SLATracking = require("../models/SLATracking");
const SLAConfig = require("../models/SLAConfig");
const InvoiceRequest = require("../models/InvoiceRequest");
const User = require("../models/User");
const { sendNotificationEmail } = require("./emailService");
const { ROLES } = require("../config/constants");

// ✅ New flow: partner first, then accounts, then cluster_head
// ✅ New flow: partner → accounts → cluster_head
const STATUS_TO_STAGE = {
  Submitted: "partner",
  "Partner Approved": "accounts",
  "Accounts Approved": "cluster_head",
};
const startSLATracking = async (invoiceId, status) => {
  try {
    const stage = STATUS_TO_STAGE[status];
    if (!stage) return;

    const config = await SLAConfig.findOne({ stage, isActive: true });
    if (!config) return;

    const now = new Date();
    const deadlineAt = new Date(
      now.getTime() + config.hoursAllowed * 60 * 60 * 1000,
    );

    // Mark previous open trackings as completed
    await SLATracking.updateMany(
      { paymentRequest: invoiceId, status: { $in: ["on_track", "at_risk"] } },
      { status: "completed", completedAt: now },
    );

    await SLATracking.create({
      paymentRequest: invoiceId, // reusing field name for backward compat
      stage,
      stageEnteredAt: now,
      deadlineAt,
      slaHours: config.hoursAllowed,
      status: "on_track",
    });
  } catch (err) {
    console.error("SLA tracking start error:", err.message);
  }
};

const completeSLATracking = async (invoiceId) => {
  try {
    await SLATracking.updateMany(
      { paymentRequest: invoiceId, status: { $in: ["on_track", "at_risk"] } },
      { status: "completed", completedAt: new Date() },
    );
  } catch (err) {
    console.error("SLA tracking complete error:", err.message);
  }
};

const runSLAChecks = async () => {
  console.log("[SLA] Running checks at", new Date().toISOString());
  const now = new Date();

  const activeTrackings = await SLATracking.find({
    status: { $in: ["on_track", "at_risk"] },
  }).populate({
    path: "paymentRequest", // this is actually invoiceId
    model: "InvoiceRequest", // ✅ explicitly use InvoiceRequest model
    populate: [
      { path: "branch", select: "name" },
      { path: "createdBy", select: "name email" },
    ],
  });

  for (const tracking of activeTrackings) {
    const invoice = tracking.paymentRequest;

    // Skip if invoice no longer active
    if (
      !invoice ||
      ["Cluster Head Approved", "Rejected"].includes(invoice?.status)
    ) {
      tracking.status = "completed";
      tracking.completedAt = now;
      await tracking.save();
      continue;
    }

    const hoursRemaining = (tracking.deadlineAt - now) / (1000 * 60 * 60);
    const atRiskThreshold = tracking.slaHours * 0.25;

    if (now > tracking.deadlineAt) {
      if (tracking.status !== "breached") {
        tracking.status = "breached";
        await tracking.save();
        await handleSLABreach(tracking, invoice);
      }
    } else if (hoursRemaining <= atRiskThreshold) {
      tracking.status = "at_risk";
      const config = await SLAConfig.findOne({ stage: tracking.stage });
      const reminderInterval = config?.reminderIntervalHours || 24;
      const shouldRemind =
        !tracking.lastReminderAt ||
        (now - tracking.lastReminderAt) / (1000 * 60 * 60) >= reminderInterval;

      if (shouldRemind) {
        await sendSLAReminder(tracking, invoice, hoursRemaining);
        tracking.remindersSent += 1;
        tracking.lastReminderAt = now;
      }
      await tracking.save();
    }
  }

  console.log(`[SLA] Checked ${activeTrackings.length} trackings`);
};

const handleSLABreach = async (tracking, invoice) => {
  try {
    const config = await SLAConfig.findOne({ stage: tracking.stage });
    const escalateToRole = config?.escalateTo || ROLES.SUPER_ADMIN;
    const escalationUser = await User.findOne({
      role: escalateToRole,
      status: "active",
    });

    if (escalationUser) {
      tracking.escalatedAt = new Date();
      tracking.escalatedTo = escalationUser._id;
      await tracking.save();
    }

    const stageRoleMap = {
      accounts: ROLES.ACCOUNTS,
      partner: ROLES.BRANCH_PARTNER,
      cluster_head: ROLES.CLUSTER_HEAD,
    };

    const targetRole = stageRoleMap[tracking.stage];
    const approvers = await User.find({ role: targetRole, status: "active" });
    const notifyList = [
      ...approvers,
      ...(escalationUser ? [escalationUser] : []),
    ];

    for (const u of notifyList) {
      await sendNotificationEmail(
        u.email,
        `🚨 SLA BREACHED: Invoice ${invoice.requestId}`,
        `
          <p style="color:#dc2626;font-weight:bold;">⚠️ SLA has been breached for invoice <strong>${invoice.requestId}</strong></p>
          <table style="width:100%;border-collapse:collapse;margin-top:12px;">
            <tr><td style="padding:6px;color:#666;">Invoice ID</td><td style="padding:6px;font-weight:600;">${invoice.requestId}</td></tr>
            <tr><td style="padding:6px;color:#666;">Branch</td><td style="padding:6px;font-weight:600;">${invoice.branch?.name}</td></tr>
            <tr><td style="padding:6px;color:#666;">Stage</td><td style="padding:6px;font-weight:600;">${tracking.stage.replace(/_/g, " ").toUpperCase()}</td></tr>
            <tr><td style="padding:6px;color:#666;">SLA Window</td><td style="padding:6px;font-weight:600;">${tracking.slaHours} hours</td></tr>
            <tr><td style="padding:6px;color:#666;">Deadline</td><td style="padding:6px;font-weight:600;color:#dc2626;">${new Date(tracking.deadlineAt).toLocaleString()}</td></tr>
          </table>
          <p style="margin-top:16px;">Please take immediate action.</p>
        `,
      ).catch(console.error);
    }
  } catch (err) {
    console.error("SLA breach handling error:", err.message);
  }
};

const sendSLAReminder = async (tracking, invoice, hoursRemaining) => {
  try {
    const stageRoleMap = {
      accounts: ROLES.ACCOUNTS,
      partner: ROLES.BRANCH_PARTNER,
      cluster_head: ROLES.CLUSTER_HEAD,
    };

    const targetRole = stageRoleMap[tracking.stage];
    const approvers = await User.find({ role: targetRole, status: "active" });

    for (const u of approvers) {
      await sendNotificationEmail(
        u.email,
        `⏰ SLA Reminder: Invoice ${invoice.requestId} needs attention`,
        `
          <p>Invoice <strong>${invoice.requestId}</strong> is approaching its SLA deadline.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:12px;">
            <tr><td style="padding:6px;color:#666;">Invoice ID</td><td style="padding:6px;font-weight:600;">${invoice.requestId}</td></tr>
            <tr><td style="padding:6px;color:#666;">Branch</td><td style="padding:6px;font-weight:600;">${invoice.branch?.name}</td></tr>
            <tr><td style="padding:6px;color:#666;">Stage</td><td style="padding:6px;font-weight:600;">${tracking.stage.replace(/_/g, " ").toUpperCase()}</td></tr>
            <tr><td style="padding:6px;color:#666;color:#d97706;font-weight:600;">Time Remaining</td><td style="padding:6px;font-weight:600;color:#d97706;">${Math.round(hoursRemaining)} hours</td></tr>
            <tr><td style="padding:6px;color:#666;">Deadline</td><td style="padding:6px;font-weight:600;">${new Date(tracking.deadlineAt).toLocaleString()}</td></tr>
          </table>
          <p style="margin-top:16px;">Please review and take action to avoid SLA breach.</p>
        `,
      ).catch(console.error);
    }
  } catch (err) {
    console.error("SLA reminder error:", err.message);
  }
};

const getSLAStatus = async (invoiceId) => {
  const trackings = await SLATracking.find({ paymentRequest: invoiceId }).sort({
    createdAt: -1,
  });

  return trackings.map((t) => ({
    stage: t.stage,
    status: t.status,
    stageEnteredAt: t.stageEnteredAt,
    deadlineAt: t.deadlineAt,
    slaHours: t.slaHours,
    remindersSent: t.remindersSent,
    escalatedAt: t.escalatedAt,
    completedAt: t.completedAt,
    hoursElapsed: Math.round(
      (new Date() - t.stageEnteredAt) / (1000 * 60 * 60),
    ),
    hoursRemaining: Math.max(
      0,
      Math.round((t.deadlineAt - new Date()) / (1000 * 60 * 60)),
    ),
  }));
};

module.exports = {
  startSLATracking,
  completeSLATracking,
  runSLAChecks,
  getSLAStatus,
};
