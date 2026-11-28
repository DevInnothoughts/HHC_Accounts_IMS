// ============================================================
// BACKEND: src/models/Doctor.js — NEW FILE
// ------------------------------------------------------------
// Doctor Master: one record per PAN for every doctor HHC pays — referring
// doctors and operating surgeons / anaesthetists alike. Holds the basic
// details, the PAN and the bank account payments go to.
//
// Records are created by the payout Excel upload (a PAN not seen before),
// by the doctor-list import, or by hand; Accounts then complete the
// profile (remaining details + documents). Never deleted — a doctor is
// made inactive / blocked instead.
//
// New collection: nothing existing is modified.
// ============================================================
const mongoose = require("mongoose");
const Counter = require("./Counter");

const DOCTOR_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  BLOCKED: "blocked", // payments must not be made (dispute, wrong details…)
};

// The details that were REPLACED, kept so a bank change can always be
// traced: who changed it, when, through which upload, and why.
const bankHistorySchema = new mongoose.Schema(
  {
    accountNumber: { type: String },
    ifscCode: { type: String },
    bankName: { type: String },
    accountHolderName: { type: String },
    replacedAt: { type: Date, default: Date.now },
    replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // "upload" = approved through a payout batch, "manual" = edited in
    // the Doctor Master screen.
    source: { type: String, enum: ["upload", "manual"], required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorPayoutBatch" },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reason: { type: String, trim: true },
  },
  { _id: false },
);

// KYC / supporting documents. Files live in the PRIVATE store
// (services/privateStorageService.js) and are only ever sent through an
// authenticated API call — never under /files. A document is not deleted:
// "remove" marks it removed and keeps the file.
const doctorDocumentSchema = new mongoose.Schema({
  type: { type: String, required: true }, // pan | cheque | registration | other
  name: { type: String, required: true }, // original file name
  key: { type: String, required: true }, // path inside the private store
  mimeType: { type: String },
  size: { type: Number },
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  removedAt: { type: Date },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

const doctorSchema = new mongoose.Schema(
  {
    doctorCode: { type: String, unique: true }, // DR-00001
    name: { type: String, required: true, trim: true },

    // PAN is the identity key — exactly one Doctor per PAN.
    panNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN (e.g. ABCDE1234F)"],
    },

    mobile: { type: String, trim: true }, // optional
    email: { type: String, trim: true, lowercase: true }, // optional

    // ── Remaining profile details (all optional) ──
    doctorType: {
      type: String,
      enum: ["referring", "surgeon", "anaesthetist", "other"],
      default: undefined,
    },
    specialisation: { type: String, trim: true },
    registrationNumber: { type: String, trim: true }, // medical council no.
    hospitalName: { type: String, trim: true }, // doctor's own clinic / hospital
    city: { type: String, trim: true },
    address: { type: String, trim: true },

    // ── Bank account payments go to ──
    // Optional at creation: a doctor added from the doctor list may get
    // the bank details later (in the master, or from the first payout
    // Excel). No payment can be raised until they are present and valid.
    accountNumber: { type: String, trim: true },
    ifscCode: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC (e.g. HDFC0001234)"],
    },
    bankName: { type: String, trim: true },
    accountHolderName: { type: String, trim: true },
    bankHistory: { type: [bankHistorySchema], default: [] },

    documents: { type: [doctorDocumentSchema], default: [] },

    status: {
      type: String,
      enum: Object.values(DOCTOR_STATUS),
      default: DOCTOR_STATUS.ACTIVE,
    },
    statusReason: { type: String, trim: true },

    // Set the first time a Cluster / Department Head approves a payout for
    // this doctor. Until then the record came from an Excel nobody has
    // reviewed, and the master shows it as "Unverified".
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdViaBatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorPayoutBatch",
    },
    // "upload" = payout Excel, "list" = doctor list import, "manual" = form
    createdVia: { type: String, enum: ["upload", "list", "manual"] },
  },
  { timestamps: true },
);

// "Who else is paid into this account?" (shared-account warning).
doctorSchema.index({ accountNumber: 1, ifscCode: 1 });
doctorSchema.index({ name: 1 });

doctorSchema.pre("save", async function (next) {
  if (!this.doctorCode) {
    const seq = await Counter.next("doctor");
    this.doctorCode = `DR-${String(seq).padStart(5, "0")}`;
  }
  next();
});

const Doctor = mongoose.model("Doctor", doctorSchema);
Doctor.STATUS = DOCTOR_STATUS;
module.exports = Doctor;
