const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    location: { type: String, required: true },
    clusterHead: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    partner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    monthlyBudget: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Branch", branchSchema);
