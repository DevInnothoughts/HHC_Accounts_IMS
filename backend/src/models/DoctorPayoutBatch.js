// ============================================================
// BACKEND: src/models/DoctorPayoutBatch.js — NEW FILE
// ------------------------------------------------------------
// One uploaded Excel = one batch (DPB-0001). The rows themselves are
// DoctorPayout documents; this is the header the Cluster / Department
// Head opens to review "the records of that upload".
//
// The batch has no approval status of its own: a file can hold several
// branches, each with its own approver, so approval is per ROW and the
// batch's progress is counted from its rows at read time.
//
// New collection: nothing existing is modified.
// ============================================================
const mongoose = require("mongoose");
const Counter = require("./Counter");

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // UPLOADED, APPROVED, REJECTED, WITHDRAWN
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    remarks: { type: String, trim: true },
    rows: { type: Number },
    amount: { type: Number },
  },
  { _id: false },
);

const typeTotalSchema = new mongoose.Schema(
  { rows: { type: Number, default: 0 }, payable: { type: Number, default: 0 } },
  { _id: false },
);

const batchSchema = new mongoose.Schema(
  {
    batchId: { type: String, unique: true }, // DPB-0001

    // The file is NOT stored (uploads/ is served without a login, and this
    // sheet carries PANs and bank accounts). Its name and SHA-256 are kept
    // so a second upload of the very same file can be recognised.
    fileName: { type: String, required: true },
    fileHash: { type: String, required: true },

    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Branch" }],
    types: [{ type: String, enum: ["referral", "surgeon"] }],

    rowCount: { type: Number, default: 0 },
    totals: {
      settled: { type: Number, default: 0 },
      basic: { type: Number, default: 0 },
      tds: { type: Number, default: 0 },
      payable: { type: Number, default: 0 },
    },
    byType: {
      referral: { type: typeTotalSchema, default: () => ({}) },
      surgeon: { type: typeTotalSchema, default: () => ({}) },
    },
    newDoctorCount: { type: Number, default: 0 },
    bankChangeCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },

    // "processing" while the rows are being written; a batch left in that
    // state by a crash is hidden from every list.
    state: {
      type: String,
      enum: ["processing", "ready"],
      default: "processing",
    },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

batchSchema.index({ fileHash: 1 });
batchSchema.index({ branches: 1, createdAt: -1 });

batchSchema.pre("save", async function (next) {
  if (!this.batchId) {
    const seq = await Counter.next("doctorPayoutBatch");
    this.batchId = `DPB-${String(seq).padStart(4, "0")}`;
  }
  next();
});

module.exports = mongoose.model("DoctorPayoutBatch", batchSchema);
