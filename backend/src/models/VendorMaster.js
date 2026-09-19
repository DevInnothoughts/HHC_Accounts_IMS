// ============================================================
// BACKEND: src/models/VendorMaster.js  —  REPLACE WHOLE FILE
// Revision 19 Sep: gstins[] added (every GSTIN this PAN uses, per state).
// ============================================================
// The PAN-keyed master vendor record. Owns identity, statutory
// numbers, bank details and KYC documents exactly once for the
// whole group.
//
// The existing Vendor collection is NOT replaced by this. It stays
// as the branch <-> master mapping row that InvoiceRequest.vendor
// and PaymentProcessing.vendor keep pointing at, and it keeps a
// synced copy of the scalar fields below so that every existing
// .populate("vendor", "...") call site continues to work untouched.
// ============================================================

const mongoose = require("mongoose");

// Same shape as the embedded documentSchema in models/Vendor.js.
// Deliberately duplicated rather than shared, so Vendor.js needs
// no structural edit — only the two additive fields.
const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  key: { type: String }, // disk path key, used for deletion
  type: { type: String, required: true }, // pan, gst, cheque, agreement, msme, other
  uploadedAt: { type: Date, default: Date.now },
});

// Mirrors the rule already used in models/Vendor.js: bank details and
// PAN are mandatory for standard vendors, optional for utility / tax /
// statutory payees (electricity boards, govt challans, etc.).
const requiredForStandard = function () {
  return this.vendorType !== "statutory";
};

// One GST registration of this PAN, and the branches invoiced under it.
// Rebuilt automatically from the linked branch vendors by
// vendorMasterService.refreshMasterGstins() — never edited by hand.
const gstinSchema = new mongoose.Schema(
  {
    gstNumber: { type: String, required: true, uppercase: true, trim: true },
    stateCode: { type: String }, // characters 1–2 of the GSTIN
    isPrimary: { type: Boolean, default: false },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Branch" }],
  },
  { _id: false },
);

const vendorMasterSchema = new mongoose.Schema(
  {
    // ── Identity ────────────────────────────────────────────
    vendorName: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    mobile: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    companyName: { type: String, trim: true },

    // ── Statutory ───────────────────────────────────────────
    // PAN is the identity key for the whole master collection.
    // Uniqueness is enforced by a PARTIAL UNIQUE INDEX created in
    // scripts/createVendorMasterIndexes.js — see the index note below.
    panNumber: {
      type: String,
      required: requiredForStandard,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN (e.g. ABCDE1234F)"],
    },
    // PRIMARY GSTIN (usually the head-office registration). Each branch
    // vendor keeps its own GSTIN for its state — see gstins below.
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
      match: [
        /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Z][A-Z\d]$/,
        "Invalid GST format",
      ],
    },
    msmeNumber: { type: String, trim: true, default: null },
    businessAddress: { type: String, trim: true },

    // Every GSTIN of this PAN in use across the group, with its state and
    // the branches that use it. Kept for GST / state-wise reporting.
    gstins: { type: [gstinSchema], default: [] },

    vendorType: {
      type: String,
      enum: ["standard", "statutory"],
      default: "standard",
    },

    // Default category suggested when a branch links this master.
    // The branch Vendor row keeps its own vendorCategory and may
    // differ — this field is intentionally NOT in MASTER_OWNED_FIELDS,
    // so the master->branch sync never overwrites a branch's choice.
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

    // ── Bank details — single source of truth for payments ───
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
      // Same regex fedOneExcelService.js validates against before
      // building a bank file, and the same one Branch.js uses.
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC (e.g. SBIN0001234)"],
    },
    upiId: { type: String, trim: true },

    // ── KYC documents — stored ONCE, here ───────────────────
    // Files live under uploads/vendor-masters/<_id>/documents/.
    // Branch Vendor rows with sourceOfTruth === "master" carry an
    // empty documents[] and read through to this array.
    documents: [documentSchema],

    // ── Master approval lifecycle ───────────────────────────
    approvalStatus: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected"],
      default: "draft",
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

    // ── Master-level status — applies across every branch ───
    // Anything but "active": the vendor drops out of every branch's
    // active-vendor list (vendorController.buildVendorQuery) and no new
    // invoice can be raised against it (invoiceController.createInvoice).
    // Payments for invoices ALREADY approved are not stopped by this —
    // hold those individually.
    status: {
      type: String,
      enum: ["active", "inactive", "blacklisted", "frozen"],
      default: "active",
    },
    blacklistReason: { type: String },

    // ── Denormalised link counter ───────────────────────────
    // Maintained on link / unlink so the master list can show reach
    // without an aggregation, and so deletion can be guarded.
    // Treat as a hint, not as truth: the authoritative count is
    // Vendor.countDocuments({ vendorMaster: _id }).
    linkedBranchCount: { type: Number, default: 0, min: 0 },

    // ── Provenance ──────────────────────────────────────────
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Set by scripts/buildVendorMaster.js so that ROLLBACK=1 can
    // identify and remove exactly the masters the backfill created,
    // without touching anything entered by a human afterwards.
    createdByScript: { type: Boolean, default: false },

    // The branch Vendor._id whose details/documents seeded this master
    // during the backfill. Audit breadcrumb only; never read at runtime.
    sourceVendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
  },
  { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────
// The UNIQUE PAN index is deliberately NOT declared here. It must be a
// PARTIAL index (only documents with a string PAN are indexed), and it is
// created by scripts/createVendorMasterIndexes.js — run it in Phase 2,
// before any master exists — following the createReportIndexes.js
// convention of keeping unique/partial indexes out of autoIndex.
// Note on what is NOT indexed: the master list search uses the same
// case-insensitive unanchored $regex pattern as buildVendorQuery() in
// vendorController.js. An unanchored /x/i regex cannot use a b-tree index,
// so single-field indexes on vendorName / companyName / gstNumber would
// cost writes and buy nothing. If master search ever gets slow, the fix is
// a text index or an anchored prefix search, not these.
vendorMasterSchema.index({ approvalStatus: 1, status: 1 });
vendorMasterSchema.index({ createdAt: -1 });

// Normalise the identity key on every write path. Mongoose's
// `uppercase: true` already handles .create()/.save(); this guards
// findOneAndUpdate and keeps lookups case-insensitive by construction.
vendorMasterSchema.pre("findOneAndUpdate", function (next) {
  const u = this.getUpdate() || {};
  const target = u.$set || u;
  if (typeof target.panNumber === "string") {
    target.panNumber = target.panNumber.trim().toUpperCase();
  }
  if (typeof target.ifscCode === "string") {
    target.ifscCode = target.ifscCode.trim().toUpperCase();
  }
  next();
});

// Convenience: the canonical form used for every PAN comparison in
// the app. Use this instead of ad-hoc .trim().toUpperCase() calls so
// lookup, create and backfill can never disagree.
vendorMasterSchema.statics.normalizePan = function (pan) {
  return typeof pan === "string" ? pan.trim().toUpperCase() : "";
};

// A master is usable for new invoices only when accounts has approved
// it AND it has not been frozen/blacklisted at group level.
vendorMasterSchema.methods.isUsable = function () {
  return this.approvalStatus === "approved" && this.status === "active";
};

module.exports = mongoose.model("VendorMaster", vendorMasterSchema);
