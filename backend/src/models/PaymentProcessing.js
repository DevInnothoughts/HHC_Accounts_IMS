const mongoose = require("mongoose");
const Counter = require("./Counter");

const approvalSchema = new mongoose.Schema({
  stage: { type: String },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  action: { type: String, enum: ["approved", "rejected"] },
  remarks: { type: String },
  actionAt: { type: Date, default: Date.now },
});

const rejectionSchema = new mongoose.Schema({
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  stage: { type: String },
  reason: { type: String, required: true },
  rejectedAt: { type: Date, default: Date.now },
});

// ✅ Track each individual payment installment
const paymentInstallmentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  utrNumber: { type: String, trim: true },
  utrRecordedAt: { type: Date },
  utrRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  paymentId: { type: String }, // PAY-000001-1, PAY-000001-2 etc
  status: {
    type: String,
    enum: ["Raised", "Approved", "Excel Generated", "Processed", "Rejected"],
    default: "Raised",
  },
  approvalHistory: [approvalSchema],
  rejectionHistory: [rejectionSchema],
  excelGeneratedAt: { type: Date },
  raisedAt: { type: Date, default: Date.now },
  raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  paymentRemarks: { type: String, trim: true },
  scheduledDate: { type: Date },
});

const paymentProcessingSchema = new mongoose.Schema(
  {
    paymentId: { type: String, unique: true },
    invoiceRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceRequest",
      required: true,
    },
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

    // ✅ Total invoice net payable
    totalAmount: { type: Number, required: true },

    // ✅ Total amount paid so far across all installments
    paidAmount: { type: Number, default: 0 },

    // ✅ Remaining balance
    remainingAmount: { type: Number },

    // ✅ Payment type
    paymentType: {
      type: String,
      enum: ["full", "partial"],
      default: "full",
    },

    // ✅ Overall payment status
    status: {
      type: String,
      enum: [
        "Payment Pending", // waiting for branch to raise
        "Payment Raised", // branch raised, awaiting accounts
        "Accounts Approved", // accounts approved
        "Excel Generated", // excel downloaded
        "Payment Processed", // UTR recorded
        "Partially Paid", // partial payment done, balance remaining
        "Fully Paid", // all payments cleared
        "Payment Rejected",
      ],
      default: "Payment Pending",
    },

    currentStage: { type: String, default: "branch" },

    // ✅ All payment installments
    installments: [paymentInstallmentSchema],

    // ✅ Legacy fields kept for backward compatibility
    paymentAmount: { type: Number },
    paymentRemarks: { type: String, trim: true },
    scheduledDate: { type: Date },
    approvalHistory: [approvalSchema],
    rejectionHistory: [rejectionSchema],
    excelGeneratedAt: { type: Date },
    utrNumber: { type: String, trim: true, default: null },
    utrRecordedAt: { type: Date, default: null },
    utrRecordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    raisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

paymentProcessingSchema.pre("save", async function (next) {
  if (!this.paymentId) {
    const seq = await Counter.next("paymentProcessing");
    this.paymentId = `PAY-${String(seq).padStart(6, "0")}`;
  }
  // Auto-update remaining amount
  this.remainingAmount = this.totalAmount - (this.paidAmount || 0);
  next();
});

module.exports = mongoose.model("PaymentProcessing", paymentProcessingSchema);
