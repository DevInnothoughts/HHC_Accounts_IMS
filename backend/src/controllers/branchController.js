// ============================================================
// BACKEND: controllers/branchController.js
// ============================================================
const Branch = require("../models/Branch");
const { logAction } = require("../services/auditService");

exports.getBranches = async (req, res) => {
  try {
    const query = {};

    // ✅ Only filter by user's branches for non-admin roles
    if (req.user.role !== "super_admin" && req.user.role !== "accounts") {
      query._id = { $in: req.user.branches };
    }

    const branches = await Branch.find(query).sort({ name: 1 });
    res.json(branches);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const existing = await Branch.findOne({
      code: req.body.code?.toUpperCase(),
    });
    if (existing)
      return res.status(400).json({ message: "Branch code already exists" });
    const branch = await Branch.create({
      ...req.body,
      code: req.body.code?.toUpperCase(),
    });
    await logAction({
      userId: req.user._id,
      action: "CREATE_BRANCH",
      module: "Branch",
      targetId: branch._id,
      req,
    });
    res.status(201).json(branch);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const branch = await Branch.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate("clusterHead", "name email")
      .populate("partner", "name email");
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    await logAction({
      userId: req.user._id,
      action: "UPDATE_BRANCH",
      module: "Branch",
      targetId: branch._id,
      req,
    });
    res.json(branch);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.toggleBranchStatus = async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    branch.status = branch.status === "active" ? "inactive" : "active";
    await branch.save();
    res.json(branch);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
