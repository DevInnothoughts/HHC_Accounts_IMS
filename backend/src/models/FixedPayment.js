// ============================================================
// BACKEND: src/models/FixedPayment.js — NEW FILE
// ------------------------------------------------------------
// A recurring monthly payment for one branch to one vendor (rent, AMC,
// retainers...). Accounts sets it up, Super Admin approves it ONCE, and
// from then on the system creates that month's invoice on the fixed day,
// already fully approved, with its payment record in the Accounts queue.
//
// New collection — nothing existing is modified.
// ============================================================
const mongoose = require("mongoose");
const Counter = require("./Counter");

const FIXED_PAYMENT_STATUS = {
  PENDING: "pending_approval", // created or materially edited; not generating
  ACTIVE: "active", // generating every month
  PAUSED: "paused", // temporarily stopped; resume needs no re-approval
  REJECTED: "rejected", // Super Admin rejected; Accounts may edit + resubmit
  ENDED: "ended", // permanently stopped
};

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // CREATED, APPROVED, ...
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    remarks: { type: String, trim: true },
  },
  { _id: false },
);

const agreementSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    key: { type: String },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const fixedPaymentSchema = new mongoose.Schema(
  {
    templateId: { type: String, unique: true }, // FP-0001
    title: { type: String, required: true, trim: true }, // "Shop rent"

    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    expenseType: { type: String, enum: ["Revenue", "Capital"], required: true },
    expenseCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      required: true,
    },
    description: { type: String, trim: true },

    // Default monthly figures. Accounts can adjust an individual month's
    // amount before raising its payment; the template is not changed.
    amount: { type: Number, required: true, min: 0.01 }, // base, pre-GST
    gstPercentage: { type: Number, default: 0, min: 0, max: 100 },
    tdsPercentage: { type: Number, default: 0, min: 0, max: 100 },

    // Day of month the invoice is created (1–31). Months shorter than this
    // use their last day, so 31 means "month end".
    dayOfMonth: { type: Number, required: true, min: 1, max: 31 },
    startPeriod: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // YYYY-MM
    endPeriod: { type: String, match: /^\d{4}-\d{2}$/ }, // optional, inclusive

    agreement: { type: agreementSchema, default: undefined },

    status: {
      type: String,
      enum: Object.values(FIXED_PAYMENT_STATUS),
      default: FIXED_PAYMENT_STATUS.PENDING,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    rejectionReason: { type: String, trim: true },

    lastGeneratedPeriod: { type: String }, // YYYY-MM
    lastGeneratedInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceRequest",
    },
    // Why the last automatic run could not create the invoice (vendor
    // frozen, etc.). Cleared on the next successful run.
    lastError: {
      period: { type: String },
      message: { type: String },
      at: { type: Date },
    },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

// Index { status, lastGeneratedPeriod } is created by scripts/createFixedPaymentIndexes.js.

fixedPaymentSchema.pre("save", async function (next) {
  if (!this.templateId) {
    const seq = await Counter.next("fixedPayment");
    this.templateId = `FP-${String(seq).padStart(4, "0")}`;
  }
  next();
});

const FixedPayment = mongoose.model("FixedPayment", fixedPaymentSchema);
FixedPayment.STATUS = FIXED_PAYMENT_STATUS;
module.exports = FixedPayment;
