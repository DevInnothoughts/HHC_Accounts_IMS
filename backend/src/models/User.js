const mongoose = require("mongoose");
const { ROLES, DESIGNATIONS } = require("../config/constants");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    mobile: { type: String, required: true },
    role: { type: String, enum: Object.values(ROLES), required: true },
    // Display label for cluster_head users only ("Department Head" or
    // "Cluster Head"). Optional — existing users without it are Cluster
    // Heads. Never used for permissions.
    designation: {
      type: String,
      enum: Object.values(DESIGNATIONS),
      default: undefined,
    },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Branch" }],
    clusterHead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    lastLogin: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
