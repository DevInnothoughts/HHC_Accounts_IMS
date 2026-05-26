const mongoose = require("mongoose");
const { EXPENSE_TYPES } = require("../config/constants");

const expenseCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    type: { type: String, enum: Object.values(EXPENSE_TYPES), required: true },
    description: { type: String },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ExpenseCategory", expenseCategorySchema);
