// ============================================================
// BACKEND: controllers/branchController.js
// ============================================================
const Branch = require("../models/Branch");
const { logAction } = require("../services/auditService");

exports.getBranches = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search)
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];

    const total = await Branch.countDocuments(query);
    const branches = await Branch.find(query)
      .populate("clusterHead", "name email")
      .populate("partner", "name email")
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      branches,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
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
