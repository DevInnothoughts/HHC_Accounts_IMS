const Vendor = require("../models/Vendor");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");
const User = require("../models/User");
const { ROLES, VENDOR_TYPES } = require("../config/constants");

// ── Shared filter builder (used by getVendors + exportVendorsExcel) ──
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildVendorQuery = (req) => {
  const { branch, status, category, search, approvalStatus } = req.query;
  const query = {};

  const branchScopedRoles = [
    ROLES.BRANCH_USER,
    ROLES.BRANCH_PARTNER,
    ROLES.ACCOUNTS,
  ];
  if (branchScopedRoles.includes(req.user.role)) {
    const assigned = req.user.branches.map((b) => b._id.toString());
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
  if (typeof search === "string" && search.trim()) {
    const rx = escapeRegex(search.trim());
    query.$or = [
      { vendorName: { $regex: rx, $options: "i" } },
      { companyName: { $regex: rx, $options: "i" } },
      { panNumber: { $regex: rx, $options: "i" } },
      { gstNumber: { $regex: rx, $options: "i" } },
    ];
  }
  return query;
};

exports.getVendors = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const query = buildVendorQuery(req);

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
    // Only enforce PAN-uniqueness when a PAN is actually provided
    // (statutory/utility vendors may not have one).
    if (req.body.panNumber?.trim()) {
      const existing = await Vendor.findOne({
        branch: req.body.branch,
        panNumber: req.body.panNumber,
      });
      if (existing) {
        return res.status(400).json({
          message: "A vendor with this PAN already exists in this branch",
        });
      }
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
    const profile = VENDOR_TYPES[vendor.vendorType] || VENDOR_TYPES.standard;
    const REQUIRED_DOCS = [...profile.requiredDocs];
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
      "email name status",
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
    if (vendor.createdBy?.email && vendor.createdBy.status === "active") {
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
      "email name status",
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
    if (vendor.createdBy?.email && vendor.createdBy.status === "active") {
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

// ── GET /api/vendors/export/excel ─────────────────────────
const MAX_EXPORT_ROWS = 5000;

exports.exportVendorsExcel = async (req, res) => {
  try {
    const query = buildVendorQuery(req);

    const total = await Vendor.countDocuments(query);
    if (total > MAX_EXPORT_ROWS) {
      return res.status(400).json({
        message: `${total} vendors match — narrow the filters (max ${MAX_EXPORT_ROWS} per export).`,
      });
    }

    const vendors = await Vendor.find(query)
      .populate("branch", "name code")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name")
      .populate("rejectedBy", "name")
      .sort({ createdAt: -1 })
      .lean();

    // Full account numbers only for accounts / super_admin
    const seesFullBank = [ROLES.ACCOUNTS, ROLES.SUPER_ADMIN].includes(
      req.user.role,
    );
    const acct = (n) =>
      !n ? "—" : seesFullBank ? n : `****${String(n).slice(-4)}`;

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PMS — Healing Hands Clinic";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Vendors", {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true },
    });

    const COLUMNS = [
      { header: "Vendor Name", key: "vendorName", width: 24 },
      { header: "Company", key: "companyName", width: 22 },
      { header: "Category", key: "vendorCategory", width: 20 },
      { header: "Vendor Type", key: "vendorType", width: 14 },
      { header: "Branch", key: "branch", width: 20 },
      { header: "Contact Person", key: "contactPerson", width: 18 },
      { header: "Mobile", key: "mobile", width: 14 },
      { header: "Email", key: "email", width: 24 },
      { header: "PAN", key: "panNumber", width: 14 },
      { header: "GST", key: "gstNumber", width: 18 },
      { header: "MSME", key: "msmeNumber", width: 16 },
      { header: "Business Address", key: "businessAddress", width: 34 },
      { header: "Account Holder", key: "accountHolderName", width: 22 },
      { header: "Bank Name", key: "bankName", width: 18 },
      { header: "Account No.", key: "accountNumber", width: 20 },
      { header: "IFSC", key: "ifscCode", width: 14 },
      { header: "UPI ID", key: "upiId", width: 20 },
      { header: "Approval Status", key: "approvalStatus", width: 16 },
      { header: "Vendor Status", key: "status", width: 14 },
      { header: "Verified", key: "verified", width: 10 },
      { header: "Created By", key: "createdBy", width: 18 },
      { header: "Created On", key: "createdAt", width: 14 },
      { header: "Approved By", key: "approvedBy", width: 18 },
      { header: "Approved On", key: "approvedAt", width: 14 },
      { header: "Rejection Reason", key: "rejectionReason", width: 30 },
    ];
    sheet.columns = COLUMNS.map(({ key, width }) => ({ key, width }));

    const lastCol = sheet.getColumn(COLUMNS.length).letter;
    const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

    // Title
    sheet.mergeCells(`A1:${lastCol}1`);
    const title = sheet.getCell("A1");
    title.value = "HEALING HANDS CLINIC — VENDOR MASTER";
    title.font = { bold: true, size: 14, color: { argb: "FF1A3C6E" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;

    // Filter provenance — so the file explains itself later
    const applied = [
      req.query.search && `Search: "${req.query.search}"`,
      req.query.approvalStatus &&
        `Approval: ${req.query.approvalStatus.replace("_", " ")}`,
      req.query.status && `Status: ${req.query.status}`,
      req.query.category && `Category: ${req.query.category}`,
      query.branch && !query.branch.$in ? `Branch: filtered` : null,
    ].filter(Boolean);

    sheet.mergeCells(`A2:${lastCol}2`);
    const sub = sheet.getCell("A2");
    sub.value = `${vendors.length} vendor(s)  |  ${
      applied.length ? applied.join("  ·  ") : "No filters applied"
    }  |  Exported ${new Date().toLocaleString("en-GB")} by ${
      req.user.name || req.user.email
    }`;
    sub.font = { size: 10, color: { argb: "FF6B7280" } };
    sub.alignment = { horizontal: "center" };

    sheet.addRow([]);

    // Header row
    const headerRow = sheet.addRow(
      COLUMNS.reduce((a, c) => ({ ...a, [c.key]: c.header }), {}),
    );
    const thin = { style: "thin", color: { argb: "FFD1D5DB" } };
    const allBorders = { top: thin, left: thin, bottom: thin, right: thin };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1A3C6E" },
      };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
      cell.border = allBorders;
    });
    headerRow.height = 24;

    const headerRowNum = headerRow.number;

    vendors.forEach((v, i) => {
      const row = sheet.addRow({
        vendorName: v.vendorName || "—",
        companyName: v.companyName || "—",
        vendorCategory: v.vendorCategory || "—",
        vendorType: v.vendorType || "standard",
        branch: v.branch ? `${v.branch.name} (${v.branch.code})` : "—",
        contactPerson: v.contactPerson || "—",
        mobile: v.mobile || "—",
        email: v.email || "—",
        panNumber: v.panNumber || "—",
        gstNumber: v.gstNumber || "—",
        msmeNumber: v.msmeNumber || "—",
        businessAddress: v.businessAddress || "—",
        accountHolderName: v.accountHolderName || "—",
        bankName: v.bankName || "—",
        accountNumber: acct(v.accountNumber),
        ifscCode: v.ifscCode || "—",
        upiId: v.upiId || "—",
        approvalStatus: (v.approvalStatus || "").replace("_", " "),
        status: v.status || "—",
        verified: v.verifiedByAccounts ? "Yes" : "No",
        createdBy: v.createdBy?.name || "—",
        createdAt: fmtDate(v.createdAt),
        approvedBy: v.approvedBy?.name || "—",
        approvedAt: fmtDate(v.approvedAt),
        rejectionReason: v.rejectionReason || "—",
      });

      row.eachCell((cell) => {
        cell.border = allBorders;
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: i % 2 ? "FFF8FAFC" : "FFFFFFFF" },
        };
      });
      // Keep account/PAN/GST/IFSC as literal text, not coerced numbers
      ["accountNumber", "panNumber", "gstNumber", "ifscCode", "mobile"].forEach(
        (k) => {
          row.getCell(k).numFmt = "@";
          row.getCell(k).font = { name: "Consolas", size: 10 };
        },
      );
      row.height = 20;
    });

    sheet.autoFilter = {
      from: { row: headerRowNum, column: 1 },
      to: { row: headerRowNum + vendors.length, column: COLUMNS.length },
    };
    sheet.views = [{ state: "frozen", ySplit: headerRowNum }];

    await logAction({
      userId: req.user._id,
      action: "EXPORT_VENDORS_EXCEL",
      module: "Vendor",
      newValue: { count: vendors.length, filters: req.query, seesFullBank },
      req,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Vendors_${stamp}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Vendor Excel export error:", err);
    if (res.headersSent) return res.destroy();
    res.status(500).json({ message: "Failed to generate vendor export" });
  }
};
