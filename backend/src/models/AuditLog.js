const mongoose = require("mongoose");

const AUDIT_RETENTION_DAYS = parseInt(
  process.env.AUDIT_RETENTION_DAYS || "180",
  10,
);

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true },
    module: { type: String },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    ipAddress: { type: String },
    deviceInfo: { type: String },
  },
  { timestamps: true, updatedAt: false },
);

// ✅ Auto-delete logs older than the retention window; also covers the sort.
auditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUDIT_RETENTION_DAYS * 24 * 60 * 60 },
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
