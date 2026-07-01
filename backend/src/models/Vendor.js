const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  key: { type: String }, // ✅ disk path key for deletion
  type: { type: String, required: true }, // pan, gst, cheque, agreement, other
  uploadedAt: { type: Date, default: Date.now },
});

// Bank details + PAN are mandatory for standard vendors, optional for
// utility/tax/statutory payees (electricity boards, govt challans, etc.).
// Works on create and edit because both paths use .create()/.save().
const requiredForStandard = function () {
  return this.vendorType !== "statutory";
};

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
    panNumber: {
      type: String,
      required: requiredForStandard,
      trim: true,
      uppercase: true,
    },
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
    vendorType: {
      type: String,
      enum: ["standard", "statutory"],
      default: "standard",
    },
    msmeNumber: { type: String, trim: true, default: null },
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
    },
    upiId: { type: String, trim: true },
    documents: [documentSchema],
    approvalStatus: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected"], // ✅ added "draft"
      default: "draft", // ✅ was "pending_approval"
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
