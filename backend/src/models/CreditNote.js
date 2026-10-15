// ============================================================
// BACKEND: src/models/CreditNote.js — NEW FILE
// ------------------------------------------------------------
// A vendor credit note against a fully approved invoice (goods returned
// by the branch). A branch user, Accounts or Super Admin records it line
// by line with the vendor's credit-note document; Accounts or a Super
// Admin (not the creator) approves it, and only then are the invoice and its payment reduced.
//
// New collection — nothing existing is modified until approval, and an
// invoice's original figures are kept in InvoiceRequest.originalTotals.
// ============================================================
const mongoose = require("mongoose");
const Counter = require("./Counter");

const CREDIT_NOTE_STATUS = {
  PENDING: "pending_approval",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

const lineSchema = new mongoose.Schema(
  {
    itemIndex: { type: Number, required: true }, // index in invoice.items
    description: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0.01 }, // returned value, pre-GST
    gstPercentage: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false },
);

const creditNoteSchema = new mongoose.Schema(
  {
    creditNoteId: { type: String, unique: true }, // CN-000001

    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceRequest",
      required: true,
    },
    // Copied from the invoice for branch scoping and listing.
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

    vendorCreditNoteNumber: { type: String, required: true, trim: true },
    creditNoteDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },

    lines: { type: [lineSchema], default: [] },

    // Figures as calculated when the credit note was recorded. Recomputed
    // and frozen again on approval (another credit note may have been
    // approved in between, which can move TDS rounding by a rupee).
    baseAmount: { type: Number, required: true }, // sum of line amounts
    gstAmount: { type: Number, default: 0 },
    tdsReversal: { type: Number, default: 0 }, // TDS no longer deducted
    netReduction: { type: Number, required: true }, // cut in net payable

    // Set on approval.
    applied: {
      _id: false,
      netPayableBefore: Number,
      netPayableAfter: Number,
      paidAmountAtApproval: Number,
      // Already paid more than the new net payable — vendor must refund
      // this outside PMS. Recorded only; no money moves in the system.
      refundDue: { type: Number, default: 0 },
      paymentStatusBefore: String,
      paymentStatusAfter: String,
    },

    document: {
      _id: false,
      name: String,
      url: String,
      key: String,
      uploadedAt: Date,
    },

    status: {
      type: String,
      enum: Object.values(CREDIT_NOTE_STATUS),
      default: CREDIT_NOTE_STATUS.PENDING,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    decisionRemarks: { type: String, trim: true },
  },
  { timestamps: true },
);

// Indexes { invoice, status } and { status, branch } are created by
// scripts/createCreditNoteIndexes.js (kept out of the schema, like the
// project's other indexes).

creditNoteSchema.pre("save", async function (next) {
  if (!this.creditNoteId) {
    const seq = await Counter.next("creditNote");
    this.creditNoteId = `CN-${String(seq).padStart(6, "0")}`;
  }
  next();
});

const CreditNote = mongoose.model("CreditNote", creditNoteSchema);
CreditNote.STATUS = CREDIT_NOTE_STATUS;
module.exports = CreditNote;
