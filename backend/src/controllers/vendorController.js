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

    const branchScopedRoles = [
      ROLES.BRANCH_USER,
      ROLES.BRANCH_PARTNER,
      ROLES.ACCOUNTS,
    ];
    if (branchScopedRoles.includes(req.user.role)) {
      const assigned = req.user.branches.map((b) => b._id.toString());
      // Restrict to assigned branches; honor ?branch only if it's one of theirs
      if (branch && assigned.includes(branch.toString())) {
        query.branch = branch;
      } else {
        query.branch = { $in: req.user.branches.map((b) => b._id) };
      }
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
    const branchScopedRoles = [
      ROLES.BRANCH_USER,
      ROLES.BRANCH_PARTNER,
      ROLES.ACCOUNTS,
    ];
    if (branchScopedRoles.includes(req.user.role)) {
      const allowed = req.user.branches.map((b) => b._id.toString());
      const vendorBranch = (vendor.branch?._id || vendor.branch)?.toString();
      if (!allowed.includes(vendorBranch)) {
        return res
          .status(403)
          .json({ message: "You do not have access to this vendor" });
      }
    }
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
      approvalStatus: "draft", // ✅ always start as draft
      createdBy: req.user._id,
    });

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

exports.submitVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const isOwner = vendor.createdBy?.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== ROLES.SUPER_ADMIN) {
      return res
        .status(403)
        .json({ message: "Not authorized to submit this vendor" });
    }
    if (!["draft", "rejected"].includes(vendor.approvalStatus)) {
      return res.status(400).json({
        message: `Vendor is already ${vendor.approvalStatus.replace("_", " ")}`,
      });
    }

    // ✅ PAN + cheque always required; GST cert required only if a GST number exists
    const REQUIRED_DOCS = ["pan", "cheque"];
    if (vendor.gstNumber?.trim()) REQUIRED_DOCS.push("gst");

    const uploadedTypes = (vendor.documents || []).map((d) => d.type);
    const missing = REQUIRED_DOCS.filter((t) => !uploadedTypes.includes(t));
    if (missing.length) {
      const labels = {
        pan: "PAN Card",
        gst: "GST Certificate",
        cheque: "Cancelled Cheque",
      };
      return res.status(400).json({
        message: `${"Upload required documents before submitting"}: ${missing.map((t) => labels[t]).join(", ")}`,
      });
    }

    vendor.approvalStatus = "pending_approval";
    await vendor.save();

    await logAction({
      userId: req.user._id,
      action: "SUBMIT_VENDOR",
      module: "Vendor",
      targetId: vendor._id,
      req,
    });

    // Notify accounts — branch-scoped (moved here from createVendor)
    const accountsUsers = await User.find({
      role: ROLES.ACCOUNTS,
      status: "active",
      branches: vendor.branch,
    });
    for (const u of accountsUsers) {
      await sendNotificationEmail(
        u.email,
        `🆕 Vendor Pending Approval: ${vendor.vendorName}`,
        `<p>Vendor <strong>${vendor.vendorName}</strong> has been submitted and is awaiting your approval.</p>`,
      ).catch(console.error);
    }

    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    // ✅ Approved vendors can only be edited by accounts / super_admin
    const canEditApproved = [ROLES.ACCOUNTS, ROLES.SUPER_ADMIN].includes(
      req.user.role,
    );
    if (vendor.approvalStatus === "approved" && !canEditApproved) {
      return res.status(403).json({
        message: "Approved vendors can only be edited by the accounts team.",
      });
    }

    Object.assign(vendor, req.body);
    await vendor.save();

    await logAction({
      userId: req.user._id,
      action: "UPDATE_VENDOR",
      module: "Vendor",
      targetId: vendor._id,
      req,
    });

    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
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
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    // ✅ Block delete if the vendor is referenced by invoices or payments
    const InvoiceRequest = require("../models/InvoiceRequest");
    const PaymentProcessing = require("../models/PaymentProcessing");
    const [invCount, payCount] = await Promise.all([
      InvoiceRequest.countDocuments({ vendor: vendor._id }),
      PaymentProcessing.countDocuments({ vendor: vendor._id }),
    ]);
    if (invCount > 0 || payCount > 0) {
      return res.status(400).json({
        message: `Cannot delete — this vendor is linked to ${invCount} invoice(s) and ${payCount} payment(s). Deactivate it instead.`,
      });
    }

    await vendor.deleteOne();
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
