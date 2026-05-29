// ============================================================
// BACKEND: models/SLATracking.js
// ============================================================
const mongoose = require("mongoose");

const slaTrackingSchema = new mongoose.Schema(
  {
    paymentRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceRequest",
      required: true,
    },
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
    },
    stageEnteredAt: { type: Date, default: Date.now },
    deadlineAt: { type: Date, required: true },
    slaHours: { type: Number, required: true },
    status: {
      type: String,
      enum: ["on_track", "at_risk", "breached", "completed"],
      default: "on_track",
    },
    completedAt: { type: Date },
    escalatedAt: { type: Date },
    escalatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    remindersSent: { type: Number, default: 0 },
    lastReminderAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("SLATracking", slaTrackingSchema);
