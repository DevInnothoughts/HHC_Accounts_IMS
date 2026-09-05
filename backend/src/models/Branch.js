const mongoose = require("mongoose");

// A branch's own bank account — the debit (source) side of a payment.
// These are company money-out accounts: only accounts/super_admin can
// read or write them (see branchController.getBranches).
const bankAccountSchema = new mongoose.Schema(
  {
    // Nickname, so a branch with several accounts is readable in dropdowns
    label: { type: String, trim: true, default: "" },
    bankName: { type: String, required: true, trim: true },
    accountHolderName: { type: String, trim: true, default: "" },
    accountNumber: {
      type: String,
      required: true,
      trim: true,
      match: [/^[0-9]{6,20}$/, "Account number must be 6–20 digits"],
    },
    ifscCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC (e.g. FDRL0001234)"],
    },
    // Amount at or above which a transfer goes RTGS instead of NEFT.
    // Per-account because it varies by the bank's own corporate limits.
    rtgsThreshold: { type: Number, default: 200000, min: 0 },
    // The account used for bank files when none is explicitly chosen.
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    location: { type: String, required: true },
    clusterHead: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    partner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    monthlyBudget: { type: Number, default: 0 },
    bankAccounts: { type: [bankAccountSchema], default: [] },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

// The account a bank file should debit: the explicit pick if it belongs to
// this branch and is active, else the default, else the only active one.
branchSchema.methods.resolveDebitAccount = function (preferredId) {
  const active = this.bankAccounts.filter((a) => a.status === "active");
  if (!active.length) return null;
  if (preferredId) {
    const chosen = active.find((a) => String(a._id) === String(preferredId));
    if (chosen) return chosen;
  }
  return (
    active.find((a) => a.isDefault) || (active.length === 1 ? active[0] : null)
  );
};

module.exports = mongoose.model("Branch", branchSchema);
