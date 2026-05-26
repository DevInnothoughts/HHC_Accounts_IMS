// ============================================================
// BACKEND: controllers/userController.js
// ============================================================
const User = require("../models/User");
const Branch = require("../models/Branch");
const { logAction } = require("../services/auditService");
const { ROLES } = require("../config/constants");

exports.getUsers = async (req, res) => {
  try {
    const { role, status, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (role) query.role = role;
    if (status) query.status = status;
    if (search)
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .populate("branches", "name code")
      .populate("clusterHead", "name email")
      .populate("partner", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      users,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate("branches", "name code location")
      .populate("clusterHead", "name email")
      .populate("partner", "name email")
      .populate("createdBy", "name email");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const existing = await User.findOne({
      email: req.body.email.toLowerCase(),
    });
    if (existing)
      return res.status(400).json({ message: "Email already registered" });

    const user = await User.create({ ...req.body, createdBy: req.user._id });
    await logAction({
      userId: req.user._id,
      action: "CREATE_USER",
      module: "User",
      targetId: user._id,
      req,
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("branches", "name code");
    if (!user) return res.status(404).json({ message: "User not found" });
    await logAction({
      userId: req.user._id,
      action: "UPDATE_USER",
      module: "User",
      targetId: user._id,
      req,
    });
    res.json(user);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.status = user.status === "active" ? "inactive" : "active";
    await user.save();
    await logAction({
      userId: req.user._id,
      action: `USER_${user.status.toUpperCase()}`,
      module: "User",
      targetId: user._id,
      req,
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
