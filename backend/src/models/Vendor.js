// ============================================================
// BACKEND: src/models/Vendor.js  —  REPLACE WHOLE FILE
// ============================================================
// Change vs previous version: TWO new optional fields only
// (vendorMaster, sourceOfTruth) + one new index. Every existing
// field, validator, default and the existing index are byte-for-byte
// unchanged, so every document already in the collection stays valid
// and nothing needs rewriting.
// ============================================================

const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  key: { type: String }, // ✅ disk path key for deletion
  type: { type: String, required: true }, // pan, gst, cheque, agreement, other
  uploadedAt: { type: Date, default: Date.now },
});

// Bank details + PAN are mandatory for standard vendors, optional for
// utility/tax/statutory payees (electricity boards, govt challans, etc.).
// Works on create and edit because both paths use .create()/.save().
const requiredForStandard = function () {
  return this.vendorType !== "statutory";
};

const vendorSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    vendorName: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    mobile: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    companyName: { type: String, trim: true },
    gstNumber: { type: String, trim: true },
    panNumber: {
      type: String,
      required: requiredForStandard,
      trim: true,
      uppercase: true,
    },
    businessAddress: { type: String, trim: true },
    vendorCategory: {
      type: String,
      enum: [
        "Service Vendors",
        "Equipment Vendors",
        "Utility Vendors",
        "Consultant Vendors",
        "Medical Suppliers",
        "Miscellaneous Vendors",
      ],
      required: false,
    },
    vendorType: {
      type: String,
      enum: ["standard", "statutory"],
      default: "standard",
    },
    msmeNumber: { type: String, trim: true, default: null },
    accountHolderName: {
      type: String,
      required: requiredForStandard,
      trim: true,
    },
    bankName: { type: String, required: requiredForStandard, trim: true },
    accountNumber: { type: String, required: requiredForStandard, trim: true },
    ifscCode: {
      type: String,
      required: requiredForStandard,
      trim: true,
      uppercase: true,
    },
    upiId: { type: String, trim: true },
    documents: [documentSchema],
    approvalStatus: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected"], // ✅ added "draft"
      default: "draft", // ✅ was "pending_approval"
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectedAt: { type: Date, default: null },
    verifiedByAccounts: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["active", "inactive", "blacklisted", "frozen"],
      default: "active",
    },
    blacklistReason: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // ────────────────────────────────────────────────────────
    // ✅ VENDOR MASTER — additive only. Everything above is untouched.
    // ────────────────────────────────────────────────────────

    // When set, this row is the branch <-> master mapping for that
    // VendorMaster. InvoiceRequest.vendor and PaymentProcessing.vendor
    // still point HERE, not at the master — nothing is repointed.
    // null on every pre-existing row, and on statutory payees that have
    // no PAN to key a master on.
    vendorMaster: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VendorMaster",
      default: null,
    },

    // "local"  = legacy / standalone row. Fields below are authoritative
    //            and editable at branch level, exactly as before.
    // "master" = fields listed in constants.MASTER_OWNED_FIELDS are a
    //            synced COPY of the master and must not be edited here;
    //            documents[] is empty and the master's are shown instead.
    //
    // Defaults to "local", so every existing document reads back
    // correctly without being written to.
    sourceOfTruth: {
      type: String,
      enum: ["local", "master"],
      default: "local",
    },
  },
  { timestamps: true },
);

vendorSchema.index({ branch: 1, panNumber: 1 });

// ✅ NO index on vendorMaster is declared here, on purpose.
// scripts/createVendorMasterIndexes.js creates ONE index that does both
// jobs — enforces "a master may be linked to a branch only once" and
// serves lookups by master:
//
//   { vendorMaster: 1, branch: 1 }
//   unique, partialFilterExpression: { vendorMaster: { $type: "objectId" } }
//
// It is built there rather than here for the same reason
// createReportIndexes.js exists: autoIndex would try to rebuild it on
// every app boot against a large live collection. The partial filter is
// what lets the thousands of legacy rows with vendorMaster: null coexist
// under a unique index.

// True when this row's core fields are owned by a VendorMaster and must
// not be edited at branch level (requirement 6).
vendorSchema.methods.isMasterOwned = function () {
  return this.sourceOfTruth === "master" && Boolean(this.vendorMaster);
};

module.exports = mongoose.model("Vendor", vendorSchema);
