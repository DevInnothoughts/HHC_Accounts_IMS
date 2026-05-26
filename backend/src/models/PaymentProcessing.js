const mongoose = require("mongoose");

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
    paymentAmount: { type: Number, required: true, min: 0 },

    paymentRemarks: { type: String, trim: true },
    scheduledDate: { type: Date },
    status: {
      type: String,
      enum: [
        "Payment Pending",
        "Payment Raised",
        "Accounts Approved",
        "Excel Generated",
        "Payment Rejected",
      ],
      default: "Payment Pending",
    },
    currentStage: { type: String, default: "branch" },
    approvalHistory: [approvalSchema],
    rejectionHistory: [rejectionSchema],
    excelGeneratedAt: { type: Date },
    raisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

paymentProcessingSchema.pre("save", async function (next) {
  if (!this.paymentId) {
    const count = await mongoose.model("PaymentProcessing").countDocuments();
    this.paymentId = `PAY-${String(count + 1).padStart(6, "0")}`;
  }
  next();
});

module.exports = mongoose.model("PaymentProcessing", paymentProcessingSchema);
