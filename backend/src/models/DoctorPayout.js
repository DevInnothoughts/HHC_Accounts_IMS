// ============================================================
// BACKEND: src/models/DoctorPayout.js — NEW FILE
// ------------------------------------------------------------
// One row of an uploaded payout sheet (DPO-000001): one referral, or one
// surgeon / anaesthetist incentive line. This is what the Cluster /
// Department Head approves and what the doctor's payment history is
// built from.
//
//   pending_approval → approved → raised → file_generated → paid
//                    ↘ rejected            (cancelling a payment puts its
//                    ↘ withdrawn            rows back to "approved")
//
// New collection: nothing existing is modified.
// ============================================================
const mongoose = require("mongoose");
const Counter = require("./Counter");
const { PAYOUT_STATUS, TYPES } = require("../config/doctorPayoutConfig");

const bankSchema = new mongoose.Schema(
  {
    accountNumber: { type: String },
    ifscCode: { type: String },
    bankName: { type: String },
    accountHolderName: { type: String },
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    remarks: { type: String, trim: true },
  },
  { _id: false },
);

const payoutSchema = new mongoose.Schema(
  {
    payoutId: { type: String, unique: true }, // DPO-000001

    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorPayoutBatch",
      required: true,
    },
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
    // Copied from the doctor so history by PAN needs no join.
    panNumber: { type: String, required: true, uppercase: true },

    // ── as uploaded ──
    sheetName: { type: String },
    rowNumber: { type: Number },
    doctorName: { type: String, trim: true }, // as typed in the sheet
    date: { type: Date, required: true }, // UTC midnight of the sheet date
    patientName: { type: String, trim: true }, // referral only
    noOfSurgeries: { type: Number }, // surgeon only

    settledAmount: { type: Number, required: true },
    basicAmount: { type: Number, required: true },
    tdsAmount: { type: Number, required: true, default: 0 },
    payableAmount: { type: Number, required: true },

    // Bank details exactly as they were in the sheet (audit only — the
    // payment always goes to the Doctor Master account).
    sheetBank: { type: bankSchema },

    // Sheet bank details differed from the master and the uploader asked
    // for the master to be UPDATED. Applied when this row is approved.
    bankChange: {
      requested: { type: Boolean, default: false },
      from: { type: bankSchema },
      to: { type: bankSchema },
      appliedAt: { type: Date },
      appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },

    // What the approver should look at twice.
    flags: {
      newDoctor: { type: Boolean, default: false },
      // sheet differed from master, uploader chose to keep the master
      bankMismatchKept: { type: Boolean, default: false },
      // possible duplicate the uploader confirmed as genuine
      duplicate: { type: Boolean, default: false },
      duplicateOf: { type: String }, // payoutId or "row N"
      sharedBank: { type: Boolean, default: false },
    },
    warnings: [{ type: String }],

    // Identity of the line, used to spot the same row uploaded twice.
    fingerprint: { type: String },

    status: {
      type: String,
      enum: Object.values(PAYOUT_STATUS),
      default: PAYOUT_STATUS.PENDING,
    },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    approvalRemarks: { type: String, trim: true },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true },

    // ── payment (filled as the row moves through Accounts) ──
    payment: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorPayment" },
    paymentRef: { type: String }, // DRP-000012
    utrNumber: { type: String },
    paymentDate: { type: Date },

    // Set when the record has gone out in a Tally import file
    // (controllers/doctorTallyController.js). Skipped next time unless
    // "Include already exported" is ticked.
    tallyExport: {
      exportedAt: { type: Date },
      exportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      batchId: { type: String },
      count: { type: Number },
    },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

payoutSchema.index({ batch: 1, rowNumber: 1 });
payoutSchema.index({ branch: 1, approvedAt: 1 }); // Tally / TDS by approval date
payoutSchema.index({ doctor: 1, date: -1 });
payoutSchema.index({ status: 1, type: 1, branch: 1 });
payoutSchema.index({ fingerprint: 1 });
payoutSchema.index({ payment: 1 });

// insertMany() does not run save middleware, so the upload reserves a
// block of ids in ONE counter step and assigns them in file order.
payoutSchema.statics.reserveIds = async function (count) {
  const n = Math.max(1, Number(count) || 1);
  const doc = await Counter.findByIdAndUpdate(
    "doctorPayout",
    { $inc: { seq: n } },
    { new: true, upsert: true },
  );
  const first = doc.seq - n + 1;
  return Array.from(
    { length: n },
    (_, i) => `DPO-${String(first + i).padStart(6, "0")}`,
  );
};

payoutSchema.pre("save", async function (next) {
  if (!this.payoutId) [this.payoutId] = await this.constructor.reserveIds(1);
  next();
});

const DoctorPayout = mongoose.model("DoctorPayout", payoutSchema);
DoctorPayout.STATUS = PAYOUT_STATUS;
module.exports = DoctorPayout;
