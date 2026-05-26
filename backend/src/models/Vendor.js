const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  key: { type: String }, // ✅ disk path key for deletion
  type: { type: String, required: true }, // pan, gst, cheque, agreement, other
  uploadedAt: { type: Date, default: Date.now },
});

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
    panNumber: { type: String, required: true, trim: true, uppercase: true },
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
    msmeNumber: { type: String, trim: true, default: null },
    accountHolderName: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    ifscCode: { type: String, required: true, trim: true, uppercase: true },
    upiId: { type: String, trim: true },
    documents: [documentSchema],
    approvalStatus: {
      type: String,
      enum: ["pending_approval", "approved", "rejected"],
      default: "pending_approval",
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
  },
  { timestamps: true },
);

vendorSchema.index({ branch: 1, panNumber: 1 });

module.exports = mongoose.model("Vendor", vendorSchema);
