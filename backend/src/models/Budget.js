// ============================================================
// BACKEND: models/Budget.js
// ============================================================
const mongoose = require("mongoose");

const budgetSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // 1-12
    totalBudget: { type: Number, required: true, default: 0 },
    expenseType: {
      type: String,
      enum: ["Revenue", "Capital", "All"],
      default: "All",
    },
    utilized: { type: Number, default: 0 },
    alertThreshold: { type: Number, default: 80 }, // percentage
    hardLimit: { type: Boolean, default: false }, // if true, block requests over budget
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

budgetSchema.index(
  { branch: 1, year: 1, month: 1, expenseType: 1 },
  { unique: true },
);

budgetSchema.virtual("remaining").get(function () {
  return Math.max(0, this.totalBudget - this.utilized);
});

budgetSchema.virtual("utilizationPercent").get(function () {
  if (this.totalBudget === 0) return 0;
  return Math.round((this.utilized / this.totalBudget) * 100);
});

module.exports = mongoose.model("Budget", budgetSchema);
