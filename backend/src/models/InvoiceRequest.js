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
  },
  { timestamps: true },
);

invoiceRequestSchema.pre("save", async function (next) {
  if (!this.requestId) {
    const seq = await Counter.next("invoiceRequest");
    this.requestId = `INV-${String(seq).padStart(6, "0")}`;
  }
  next();
});

module.exports = mongoose.model("InvoiceRequest", invoiceRequestSchema);
