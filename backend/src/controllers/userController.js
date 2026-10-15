// ============================================================
// BACKEND: controllers/userController.js
// ============================================================
const mongoose = require("mongoose");
const User = require("../models/User");
const Branch = require("../models/Branch");
const { logAction } = require("../services/auditService");
const { ROLES, DESIGNATIONS } = require("../config/constants");

// "department_head" is accepted from the UI as a convenience, but it is
// stored as role cluster_head + designation "Department Head", so all
// Cluster Head rights apply unchanged. A designation is only kept for
// cluster_head users. Returns the update to apply.
const normalizeRoleAndDesignation = (body) => {
  const out = { ...body };
  if (out.role === "department_head") {
    out.role = ROLES.CLUSTER_HEAD;
    out.designation = DESIGNATIONS.DEPARTMENT_HEAD;
  }
  if (out.role === undefined) {
    // Role not being changed: only accept a valid designation, if any.
    if (out.designation !== undefined &&
        !Object.values(DESIGNATIONS).includes(out.designation)) {
      delete out.designation;
    }
    return { set: out, unset: false };
  }
  if (out.role === ROLES.CLUSTER_HEAD) {
    if (!Object.values(DESIGNATIONS).includes(out.designation)) {
      out.designation = DESIGNATIONS.CLUSTER_HEAD;
    }
    return { set: out, unset: false };
  }
  delete out.designation;
  return { set: out, unset: true }; // not a cluster head: drop any label
};

exports.getUsers = async (req, res) => {
  try {
    const { role, status, search, branch, page = 1, limit = 20 } = req.query;
    const query = {};
    // role=cluster_head still returns EVERY cluster head (both labels), so
    // any caller that means "all approvers of that level" keeps working.
    // role=department_head, or ?designation=, narrows by label.
    if (role === "department_head") {
      query.role = ROLES.CLUSTER_HEAD;
      query.designation = DESIGNATIONS.DEPARTMENT_HEAD;
    } else if (role) {
      query.role = role;
    }
    if (req.query.designation === DESIGNATIONS.CLUSTER_HEAD) {
      query.designation = { $ne: DESIGNATIONS.DEPARTMENT_HEAD };
    }
    if (status) query.status = status;

    // `branches` is an array on User, so an equality match on the field
    // means "this branch is one of the user's assignments".
    if (branch) {
      if (!mongoose.isValidObjectId(branch))
        return res.status(400).json({ message: "Invalid branch" });
      query.branches = branch;
    }

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

    const { set } = normalizeRoleAndDesignation(req.body);
    const user = await User.create({ ...set, createdBy: req.user._id });
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
    const { set, unset } = normalizeRoleAndDesignation(req.body);
    const update = unset ? { ...set, $unset: { designation: 1 } } : set;
    const user = await User.findByIdAndUpdate(req.params.id, update, {
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
