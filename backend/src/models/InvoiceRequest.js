const mongoose = require("mongoose");
const Counter = require("./Counter");

const rejectionSchema = new mongoose.Schema({
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  stage: { type: String },
  reason: { type: String, required: true },
  rejectedAt: { type: Date, default: Date.now },
});

const approvalSchema = new mongoose.Schema({
  stage: { type: String },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  action: { type: String, enum: ["approved", "rejected"] },
  remarks: { type: String },
  actionAt: { type: Date, default: Date.now },
});

const attachmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  key: { type: String }, // ✅ disk path key for deletion
  type: { type: String, default: "other" }, // invoice, quotation, po, challan, other
  uploadedAt: { type: Date, default: Date.now },
});

const invoiceItemSchema = new mongoose.Schema(
  {
    description: { type: String, trim: true, default: "" },
    amount: { type: Number, required: true, min: 0 }, // item value (pre-GST)
    gstPercentage: { type: Number, required: true, min: 0, max: 100 },
    gstAmount: { type: Number, default: 0, min: 0 }, // amount * gstPercentage / 100
    total: { type: Number, default: 0, min: 0 }, // amount + gstAmount
  },
  { _id: false },
);

// Payment cycle. Both blocks are optional, so every existing invoice
// document stays valid and no migration is required.
// Oct 2026: enum WIDENED (old 7th/21st keys kept so existing documents
// still validate) and paymentEndDate added as an optional field.
const paymentCycleSnapshotSchema = new mongoose.Schema(
  {
    cycleKey: {
      type: String,
      enum: ["CYCLE_7", "CYCLE_21", "CYCLE_FIRST", "CYCLE_SECOND"],
    },
    cycleLabel: { type: String },
    cutoffDate: { type: Date },
    paymentDate: { type: Date }, // first day of the bank payment window
    paymentEndDate: { type: Date }, // last day of the bank payment window
    basisDate: { type: String }, // "YYYY-MM-DD" in IST
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const invoiceRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, unique: true },
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
    items: { type: [invoiceItemSchema], default: [] },
    amount: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, default: 0, min: 0 },
    tdsAmount: { type: Number, default: 0, min: 0 },
    roundOff: { type: Number, default: 0 }, // ± adjustment applied to base + GST
    netPayable: { type: Number, required: true, min: 0 },
    invoiceNumber: { type: String, required: true, trim: true },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date },
    description: { type: String, trim: true },
    priority: {
      type: String,
      enum: ["Normal", "Urgent", "Critical"],
      default: "Normal",
    },
    attachments: [attachmentSchema],
    status: {
      type: String,
      enum: [
        "Draft",
        "Submitted",
        "Partner Approved",
        "Accounts Approved",
        "Cluster Head Approved",
        "Rejected",
      ],
      default: "Draft",
    },
    currentStage: { type: String, default: "branch" },
    approvalHistory: [approvalSchema],
    rejectionHistory: [rejectionSchema],
    tdsPercentage: { type: Number, default: null }, // ✅ Set by accounts during invoice approval
    partnerSkipped: { type: Boolean, default: false }, // ✅ true when branch has no partner
    remarks: { type: String, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    paymentRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentProcessing",
      default: null,
    },

    // ── Payment cycle ──────────────────────────────────────
    paymentCycle: {
      // What the branch was shown when they submitted. Indicative
      // only — never used to decide when money moves.
      projected: { type: paymentCycleSnapshotSchema, default: undefined },
      // Fixed when the Cluster Head gives final approval. Authoritative.
      assigned: { type: paymentCycleSnapshotSchema, default: undefined },
    },

    // ── Credit notes — Oct 2026 ────────────────────────────
    // All optional. Written only when a credit note is APPROVED.
    // originalTotals: the invoice's figures before its first credit note,
    // so the original value is never lost. amount / gstAmount / tdsAmount /
    // netPayable on the invoice then hold the figures AFTER credit notes,
    // which is what payments, budgets and reports use.
    originalTotals: {
      type: {
        _id: false,
        amount: Number,
        gstAmount: Number,
        tdsAmount: Number,
        roundOff: Number,
        netPayable: Number,
      },
      default: undefined,
    },
    creditNoteTotal: { type: Number, default: undefined }, // sum of net reductions
    creditNoteRefundDue: { type: Number, default: undefined }, // vendor to refund outside PMS

    // ── Fixed (recurring) payments — Oct 2026 ──────────────
    // All optional: ordinary invoices never carry them.
    // source "fixed_payment" = created automatically from an approved
    // FixedPayment template, already at "Cluster Head Approved".
    source: { type: String, enum: ["fixed_payment"], default: undefined },
    fixedPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FixedPayment",
      default: undefined,
    },
    fixedPeriod: { type: String, default: undefined }, // "YYYY-MM"
    // Month-specific amount changes made by Accounts before payment.
    fixedAmountAdjustments: {
      type: [
        {
          _id: false,
          from: Number, // previous base amount
          to: Number, // new base amount
          by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          at: { type: Date, default: Date.now },
          reason: { type: String, trim: true },
        },
      ],
      default: undefined,
    },
  },
  { timestamps: true },
);

// One invoice per template per month is enforced by the unique partial
// index "uniq_fixed_payment_period", built by
// scripts/createFixedPaymentIndexes.js (kept out of the schema, like the
// other indexes, so autoIndex does not retry it on every boot).

// Supports the Accounts payment queue filtered by cycle. Sparse, so
// only invoices that have reached final approval enter the index.
invoiceRequestSchema.index(
  { "paymentCycle.assigned.paymentDate": 1, status: 1 },
  { sparse: true },
);

invoiceRequestSchema.pre("save", async function (next) {
  if (!this.requestId) {
    const seq = await Counter.next("invoiceRequest");
    this.requestId = `INV-${String(seq).padStart(6, "0")}`;
  }
  next();
});

module.exports = mongoose.model("InvoiceRequest", invoiceRequestSchema);
