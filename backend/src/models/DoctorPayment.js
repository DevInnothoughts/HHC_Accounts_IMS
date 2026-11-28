// ============================================================
// BACKEND: src/models/DoctorPayment.js — NEW FILE
// ------------------------------------------------------------
// One bank transfer to one doctor (DRP-000001), raised by Accounts from
// approved payout rows. By default all of a doctor's approved rows for a
// branch and type go out as ONE transfer with ONE UTR; Accounts can
// instead raise one transfer per row.
//
//   raised → file_generated → paid          (cancelled before a UTR
//          ↘ cancelled ↙                     returns the rows to "approved")
//
// Kept apart from PaymentProcessing on purpose: that collection is tied
// to InvoiceRequest + Vendor (both required), and the rule is that the
// existing collections are not altered.
// ============================================================
const mongoose = require("mongoose");
const Counter = require("./Counter");
const { PAYMENT_STATUS, TYPES } = require("../config/doctorPayoutConfig");

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    remarks: { type: String, trim: true },
  },
  { _id: false },
);

const paymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, unique: true }, // DRP-000001

    type: { type: String, enum: Object.values(TYPES), required: true },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    panNumber: { type: String, required: true, uppercase: true },
    doctorName: { type: String, trim: true },

    payouts: [{ type: mongoose.Schema.Types.ObjectId, ref: "DoctorPayout" }],
    payoutCount: { type: Number, default: 0 },

    settledAmount: { type: Number, default: 0 },
    basicAmount: { type: Number, default: 0 },
    tdsAmount: { type: Number, default: 0 },
    amount: { type: Number, required: true }, // net payable = bank transfer

    // The Doctor Master account at the moment the payment was raised. The
    // bank file is built from this; if the master is changed afterwards
    // the file is refused until the payment is cancelled and raised again.
    bank: {
      accountNumber: { type: String, required: true },
      ifscCode: { type: String, required: true },
      bankName: { type: String },
      accountHolderName: { type: String },
    },
    beneficiaryEmail: { type: String },

    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.RAISED,
    },

    scheduledDate: { type: Date }, // value date for the bank file
    remarks: { type: String, trim: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    raisedAt: { type: Date, default: Date.now },

    fileFormat: { type: String, enum: ["fedone", "enet"] },
    fileGeneratedAt: { type: Date },
    fileGeneratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    fileDownloads: { type: Number, default: 0 },

    utrNumber: { type: String, trim: true, uppercase: true },
    paymentDate: { type: Date },
    utrRecordedAt: { type: Date },
    utrRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: { type: String, trim: true },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

paymentSchema.index({ status: 1, type: 1, branch: 1 });
paymentSchema.index({ doctor: 1, createdAt: -1 });
paymentSchema.index({ utrNumber: 1 });

paymentSchema.pre("save", async function (next) {
  if (!this.paymentId) {
    const seq = await Counter.next("doctorPayment");
    this.paymentId = `DRP-${String(seq).padStart(6, "0")}`;
  }
  next();
});

const DoctorPayment = mongoose.model("DoctorPayment", paymentSchema);
DoctorPayment.STATUS = PAYMENT_STATUS;
module.exports = DoctorPayment;
