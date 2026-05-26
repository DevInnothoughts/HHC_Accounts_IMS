// ============================================================
// BACKEND: jobs/slaScheduler.js — Cron job for SLA checks
// ============================================================
const cron = require("node-cron");
const { runSLAChecks } = require("../services/slaService");

const initSLAScheduler = async () => {
  // Seed default SLA configurations on startup and wait for completion
  try {
    await seedDefaultSLAConfigs();
  } catch (err) {
    console.error("Failed to seed default SLA configs:", err);
  }

  // Run every hour
  cron.schedule("0 * * * *", async () => {
    try {
      await runSLAChecks();
    } catch (err) {
      console.error("SLA scheduler error:", err.message);
    }
  });

  console.log("SLA Scheduler initialized — runs every hour");
};

const seedDefaultSLAConfigs = async () => {
  const SLAConfig = require("../models/SLAConfig");

  const defaults = [
    {
      stage: "accounts",
      stageLabel: "Accounts Verification",
      hoursAllowed: 24,
      escalateTo: "super_admin",
      reminderIntervalHours: 8,
    },
    {
      stage: "partner",
      stageLabel: "Partner Approval",
      hoursAllowed: 48,
      escalateTo: "cluster_head",
      reminderIntervalHours: 12,
    },
    {
      stage: "cluster_head",
      stageLabel: "Cluster Head Approval",
      hoursAllowed: 48,
      escalateTo: "director",
      reminderIntervalHours: 12,
    },
    {
      stage: "xml_generation",
      stageLabel: "XML Generation",
      hoursAllowed: 12,
      escalateTo: "super_admin",
      reminderIntervalHours: 4,
    },
    {
      stage: "director",
      stageLabel: "Director Approval",
      hoursAllowed: 72,
      escalateTo: "super_admin",
      reminderIntervalHours: 24,
    },
  ];

  for (const cfg of defaults) {
    await SLAConfig.findOneAndUpdate({ stage: cfg.stage }, cfg, {
      upsert: true,
      setDefaultsOnInsert: true,
    });
  }

  console.log("Default SLA configs seeded");
};

module.exports = { initSLAScheduler };
