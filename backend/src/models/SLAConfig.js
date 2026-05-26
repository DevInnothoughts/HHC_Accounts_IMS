// ============================================================
// BACKEND: models/SLAConfig.js
// ============================================================
const mongoose = require("mongoose");

const slaConfigSchema = new mongoose.Schema(
  {
    stage: {
      type: String,
      enum: [
        "accounts",
        "partner",
        "cluster_head",
        "xml_generation",
        "director",
      ],
      required: true,
      unique: true,
    },
    stageLabel: { type: String, required: true },
    hoursAllowed: { type: Number, required: true }, // SLA window in hours
    escalateTo: {
      type: String,
      enum: ["cluster_head", "director", "super_admin", "accounts"],
    },
    reminderIntervalHours: { type: Number, default: 24 }, // remind every X hours
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("SLAConfig", slaConfigSchema);
