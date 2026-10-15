// ✅ VENDOR MASTER CHANGE: "VendorMaster" added to the targetModel enum.
// Without it every audit write for the new module fails enum validation,
// and logAction swallows the error — the entries would simply vanish.
// ============================================================
// BACKEND: src/models/AuditLog.js — REPLACE WHOLE FILE
// ------------------------------------------------------------
// Every new field is optional. Mongoose does not rewrite existing
// documents when a schema gains fields, so this deploys against live
// data with no migration. Old entries simply read `undefined` for the
// new fields, and the controller resolves those at read time.
// ============================================================
const mongoose = require("mongoose");

// ⚠ RETENTION — read this before shipping.
// 180 days is far below Indian statutory requirements. The Companies
// Act 2013 s.128 requires books and related records to be preserved
// for 8 financial years; GST rules require 72 months. An audit trail
// for a payment system is part of that record, and this TTL silently
// deletes it. Raise AUDIT_RETENTION_DAYS, or move expiry to an
// archival job that exports before deleting. Confirm the number with
// the client's auditor rather than guessing.
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

    // ── Added: what the entry is actually about ───────────
    // Mongoose can't populate targetId without knowing the model.
    // Storing the name enables refPath population and, more usefully,
    // lets the controller resolve targets in one query per module.
    targetModel: {
      type: String,
      enum: [
        "InvoiceRequest",
        "PaymentProcessing",
        "Vendor",
        "VendorMaster", // ✅ Vendor Master — required, see header
        "Branch",
        "Budget",
        "User",
        "ExpenseCategory",
        "SLAConfig",
        "FixedPayment",
        "CreditNote",
      ],
    },
    // Human reference captured at write time — "INV-000444", "PAY-0231".
    // Survives even if the target is later deleted, which is the whole
    // point of an audit trail.
    targetLabel: { type: String },

    // Branch the action related to, so logs can be scoped and filtered.
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" },

    // Point-in-time workflow transition. Cannot be recovered later:
    // the invoice has since moved on.
    statusFrom: { type: String },
    statusTo: { type: String },

    // Value involved, for materiality filtering during an audit.
    amount: { type: Number },

    // Rejection reason / approval remark — the single most useful
    // field in an approval trail, and currently not captured at all.
    reason: { type: String },
  },
  { timestamps: true, updatedAt: false },
);

// TTL, and it covers the default sort.
auditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUDIT_RETENTION_DAYS * 24 * 60 * 60 },
);

// Filtering and the entity trail.
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ module: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ branch: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
