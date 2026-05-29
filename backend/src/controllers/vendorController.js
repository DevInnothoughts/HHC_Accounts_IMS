const Vendor = require("../models/Vendor");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");
const User = require("../models/User");
const { ROLES } = require("../config/constants");

exports.getVendors = async (req, res) => {
  try {
    const {
      branch,
      status,
      category,
      search,
      approvalStatus,
      page = 1,
      limit = 20,
    } = req.query;
    const query = {};

    if (
      req.user.role === ROLES.BRANCH_USER ||
      req.user.role === ROLES.BRANCH_PARTNER
    ) {
      query.branch = { $in: req.user.branches.map((b) => b._id) };
    } else if (branch) {
      query.branch = branch;
    }

    if (status) query.status = status;
    if (category) query.vendorCategory = category;
    if (approvalStatus) query.approvalStatus = approvalStatus;
    if (search) {
      query.$or = [
        { vendorName: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { panNumber: { $regex: search, $options: "i" } },
        { gstNumber: { $regex: search, $options: "i" } },
      ];
    }

    const total = await Vendor.countDocuments(query);
    const vendors = await Vendor.find(query)
      .populate("branch", "name code")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email")
      .populate("rejectedBy", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      vendors,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getVendorById = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id)
      .populate("branch", "name code")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email")
      .populate("rejectedBy", "name email");
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createVendor = async (req, res) => {
  try {
    const existing = await Vendor.findOne({
      branch: req.body.branch,
      panNumber: req.body.panNumber,
    });
    if (existing) {
      return res.status(400).json({
        message: "A vendor with this PAN already exists in this branch",
      });
    }

    // ✅ REQ 1: Always starts as pending_approval
    const vendor = await Vendor.create({
      ...req.body,
      createdBy: req.user._id,
      approvalStatus: "pending_approval",
      verifiedByAccounts: false,
    });

    // Notify accounts team about new vendor pending approval
    const accountsUsers = await User.find({
      role: ROLES.ACCOUNTS,
      status: "active",
    });
    for (const u of accountsUsers) {
      await sendNotificationEmail(
        u.email,
        `🏢 New Vendor Pending Approval: ${vendor.vendorName}`,
        `
          <p>A new vendor has been added by a branch user and requires your approval.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:12px;">
            <tr><td style="padding:6px;color:#666;">Vendor Name</td><td style="padding:6px;font-weight:600;">${vendor.vendorName}</td></tr>
            <tr><td style="padding:6px;color:#666;">Company</td><td style="padding:6px;font-weight:600;">${vendor.companyName || "—"}</td></tr>
            <tr><td style="padding:6px;color:#666;">Category</td><td style="padding:6px;font-weight:600;">${vendor.vendorCategory}</td></tr>
            <tr><td style="padding:6px;color:#666;">PAN Number</td><td style="padding:6px;font-weight:600;">${vendor.panNumber}</td></tr>
          </table>
          <p style="margin-top:12px;">Please log in to review and approve or reject this vendor.</p>
        `,
      ).catch(console.error);
    }

    await logAction({
      userId: req.user._id,
      action: "CREATE_VENDOR",
      module: "Vendor",
      targetId: vendor._id,
      req,
    });
    res.status(201).json(vendor);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    // ✅ REQ 1: If branch edits a rejected vendor, reset to pending_approval
    const isRejected = vendor.approvalStatus === "rejected";
    const isBranchUser = req.user.role === ROLES.BRANCH_USER;

    const updateData = { ...req.body };

    if (isRejected && isBranchUser) {
      // Branch is resubmitting after rejection — reset approval
      updateData.approvalStatus = "pending_approval";
      updateData.rejectionReason = null;
      updateData.rejectedBy = null;
      updateData.rejectedAt = null;
      updateData.verifiedByAccounts = false;

      // Notify accounts team again
      const accountsUsers = await User.find({
        role: ROLES.ACCOUNTS,
        status: "active",
      });
      for (const u of accountsUsers) {
        await sendNotificationEmail(
          u.email,
          `🔄 Vendor Resubmitted for Approval: ${vendor.vendorName}`,
          `<p>Vendor <strong>${vendor.vendorName}</strong> has been updated and resubmitted for approval after rejection.</p>`,
        ).catch(console.error);
      }
    }

    const updated = await Vendor.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });
    await logAction({
      userId: req.user._id,
      action: "UPDATE_VENDOR",
      module: "Vendor",
      targetId: vendor._id,
      req,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ✅ REQ 1: Approve vendor — accounts only
exports.approveVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).populate(
      "createdBy",
      "email name",
    );
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    if (vendor.approvalStatus === "approved") {
      return res.status(400).json({ message: "Vendor is already approved" });
    }

    vendor.approvalStatus = "approved";
    vendor.verifiedByAccounts = true;
    vendor.approvedBy = req.user._id;
    vendor.approvedAt = new Date();
    vendor.rejectionReason = null;
    await vendor.save();

    // Notify branch user
    if (vendor.createdBy?.email) {
      await sendNotificationEmail(
        vendor.createdBy.email,
        `✅ Vendor Approved: ${vendor.vendorName}`,
        `<p>Your vendor <strong>${vendor.vendorName}</strong> has been approved by the accounts team. You can now create payment requests for this vendor.</p>`,
      ).catch(console.error);
    }

    await logAction({
      userId: req.user._id,
      action: "APPROVE_VENDOR",
      module: "Vendor",
      targetId: vendor._id,
      req,
    });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ✅ REQ 1: Reject vendor — accounts only
exports.rejectVendor = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    const vendor = await Vendor.findById(req.params.id).populate(
      "createdBy",
      "email name",
    );
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.approvalStatus = "rejected";
    vendor.verifiedByAccounts = false;
    vendor.rejectionReason = reason.trim();
    vendor.rejectedBy = req.user._id;
    vendor.rejectedAt = new Date();
    vendor.approvedBy = null;
    vendor.approvedAt = null;
    await vendor.save();

    // Notify branch user
    if (vendor.createdBy?.email) {
      await sendNotificationEmail(
        vendor.createdBy.email,
        `❌ Vendor Rejected: ${vendor.vendorName}`,
        `
          <p>Your vendor <strong>${vendor.vendorName}</strong> has been rejected by the accounts team.</p>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-top:12px;">
            <strong style="color:#dc2626;">Rejection Reason:</strong>
            <p style="color:#7f1d1d;margin-top:4px;">${reason}</p>
          </div>
          <p style="margin-top:12px;">Please update the vendor details and resubmit for approval.</p>
        `,
      ).catch(console.error);
    }

    await logAction({
      userId: req.user._id,
      action: "REJECT_VENDOR",
      module: "Vendor",
      targetId: vendor._id,
      req,
    });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    await logAction({
      userId: req.user._id,
      action: "DELETE_VENDOR",
      module: "Vendor",
      targetId: req.params.id,
      req,
    });
    res.json({ message: "Vendor deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateVendorStatus = async (req, res) => {
  try {
    const { status, blacklistReason } = req.body;
    const update = { status };
    if (status === "blacklisted") update.blacklistReason = blacklistReason;
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    await logAction({
      userId: req.user._id,
      action: `VENDOR_STATUS_${status.toUpperCase()}`,
      module: "Vendor",
      targetId: vendor._id,
      req,
    });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
