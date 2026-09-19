// ============================================================
// BACKEND: src/controllers/vendorController.js  —  REPLACE WHOLE FILE
// ============================================================
// Vendor Master, Phase 2. Branch Vendor rows can now be master-owned
// (sourceOfTruth === "master"). Changes vs the previous version:
//
//  • buildVendorQuery   async; masterLink filter; rows whose MASTER is
//                       frozen/blacklisted drop out of status=active lists
//                       (this is what the payment-request dropdown asks for)
//  • getVendors         populates vendorMaster summary
//  • getVendorById      master-owned rows return the MASTER's documents
//  • createVendor       field whitelist; branch access check; 409 when the
//                       PAN already exists in the Vendor Master (req 5)
//  • updateVendor       field whitelist; branch access check; master-owned
//                       fields cannot be edited on a branch row (req 6)
//  • submitVendor       master-owned rows check the master's documents
//  • approveVendor      master-owned rows need an approved, active master
//  • reject / delete / status   branch access check, audit statusFrom/To
//  • export             Source / Master columns
//  • Phase 4: createVendor accepts ONLY payees without a PAN. Any vendor
//    with a PAN is registered through the Vendor Master (requirement 5),
//    so the same PAN can never be entered twice as separate branch records.
//  • getVendorById also returns `branchDocuments` — the files a linked
//    branch still holds itself (kept permanently; nothing is ever deleted),
//    e.g. the GST certificate of its own state registration. Read-only.
//  • Revision 19 Sep: GSTIN is kept PER BRANCH (GST is per state), also on
//    master-linked rows; it must belong to the vendor's PAN, and the
//    master's GSTIN list is refreshed when a linked branch changes it.
//
// ⚠ SECURITY FIXES carried in this file (pre-existing, not new):
//  1. createVendor and updateVendor spread req.body straight into the
//     model. A branch user could PUT { approvalStatus: "approved" } on
//     their own draft vendor and approve it themselves, or set
//     verifiedByAccounts / approvedBy. Both now whitelist fields.
//  2. updateVendor, approveVendor, rejectVendor, deleteVendor and
//     updateVendorStatus never checked the caller's branch. getVendorById
//     did. They now all use the same check.
//  3. Query-string values were passed into Mongo filters unchecked
//     (?status[$ne]=x arrives as an object). Now string-only.
// ============================================================
const Vendor = require("../models/Vendor");
const VendorMaster = require("../models/VendorMaster");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");
const User = require("../models/User");
const {
  ROLES,
  VENDOR_TYPES,
  VENDOR_MASTER,
  MASTER_OWNED_FIELDS,
} = require("../config/constants");
const svc = require("../services/vendorMasterService");
const access = require("../utils/vendorAccess");
const mongoose = require("mongoose");

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const validId = (v) => mongoose.isValidObjectId(v);
const VENDOR_STATUSES = ["active", "inactive", "blacklisted", "frozen"];
const APPROVAL_STATES = ["draft", "pending_approval", "approved", "rejected"];

// Fields a caller may set on a branch vendor. Everything else —
// approvalStatus, approvedBy, verifiedByAccounts, status, createdBy,
// documents, vendorMaster, sourceOfTruth — is set only by the server.
// gstNumber is listed explicitly: it is no longer master-owned (GST is per
// state), but every branch vendor still needs to be able to set it.
const WRITABLE_FIELDS = [
  "branch",
  "vendorCategory",
  "gstNumber",
  ...MASTER_OWNED_FIELDS,
];

const pick = (src, keys) => {
  const out = {};
  for (const k of keys) {
    if (src && src[k] !== undefined) out[k] = src[k];
  }
  return out;
};

// Compare the way the form round-trips values: null / undefined / "" are
// equal, strings trimmed, identifiers compared case-insensitively.
const CASE_INSENSITIVE = ["panNumber", "ifscCode", "gstNumber", "email"];
const sameValue = (field, a, b) => {
  const na = svc.normVal(a);
  const nb = svc.normVal(b);
  return CASE_INSENSITIVE.includes(field)
    ? na.toUpperCase() === nb.toUpperCase()
    : na === nb;
};

// Characters 3–12 of a GSTIN are the holder's PAN (or a TAN, for
// government departments). A "no-PAN" payee whose GSTIN carries a PAN in
// fact has one, and must go through the Vendor Master like any other.
const panInsideGstin = (gst) => {
  const embedded = svc.normVal(gst).toUpperCase().slice(2, 12);
  return VENDOR_MASTER.PAN_REGEX.test(embedded) ? embedded : null;
};

const USE_MASTER = {
  code: "USE_VENDOR_MASTER",
  message:
    "Vendors with a PAN are registered through the Vendor Master. Use Add Vendor, which checks the PAN first.",
};

const forbidden = (res) =>
  res.status(403).json({ message: "You do not have access to this vendor" });

// ── Shared filter builder (used by getVendors + exportVendorsExcel) ──
const buildVendorQuery = async (req) => {
  const branch = access.qstr(req.query.branch);
  const status = access.qstr(req.query.status);
  const category = access.qstr(req.query.category);
  const search = access.qstr(req.query.search);
  const approvalStatus = access.qstr(req.query.approvalStatus);
  const masterLink = access.qstr(req.query.masterLink);
  const query = {};

  if (access.isBranchScoped(req)) {
    const assigned = access.userBranchIds(req);
    if (branch && assigned.includes(branch)) {
      query.branch = branch;
    } else {
      query.branch = { $in: req.user.branches.map((b) => b._id) };
    }
  } else if (branch && validId(branch)) {
    query.branch = branch;
  }

  if (status && VENDOR_STATUSES.includes(status)) query.status = status;
  if (category) query.vendorCategory = category;
  if (approvalStatus && APPROVAL_STATES.includes(approvalStatus))
    query.approvalStatus = approvalStatus;

  // "linked" = mirrors a Vendor Master; "local" = branch-level record
  if (masterLink === "linked") query.vendorMaster = { $ne: null };
  if (masterLink === "local") query.vendorMaster = null;

  // A vendor frozen / blacklisted at MASTER level must disappear from
  // every "active vendors" list — in particular the payment-request
  // dropdown, which requests status=active&approvalStatus=approved.
  // $nin also matches rows with no vendorMaster, so local rows are kept.
  if (status === "active" && masterLink !== "local") {
    const blocked = await svc.blockedMasterIds();
    if (blocked.length) {
      query.vendorMaster = { ...(query.vendorMaster || {}), $nin: blocked };
    }
  }

  if (search) {
    const rx = escapeRegex(search);
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
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      500,
      Math.max(1, parseInt(req.query.limit, 10) || 20),
    );
    const query = await buildVendorQuery(req);

    const total = await Vendor.countDocuments(query);
    const vendors = await Vendor.find(query)
      .populate("branch", "name code")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email")
      .populate("rejectedBy", "name email")
      .populate(
        "vendorMaster",
        "vendorName panNumber approvalStatus status linkedBranchCount",
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      vendors,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getVendorById = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor id" });
    const vendor = await Vendor.findById(req.params.id)
      .populate("branch", "name code")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email")
      .populate("rejectedBy", "name email")
      .populate(
        "vendorMaster",
        "vendorName panNumber gstNumber approvalStatus status linkedBranchCount documents approvedBy approvedAt createdBy rejectionReason",
      );
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor)) return forbidden(res);

    const out = vendor.toObject();
    // Master-owned rows hold no files; the KYC documents live once on
    // the master. Existing screens keep rendering `documents` unchanged.
    if (vendor.isMasterOwned() && vendor.vendorMaster) {
      // Files this branch record still holds itself (uploaded before it was
      // linked). They are kept permanently and shown read-only.
      out.branchDocuments = out.documents || [];
      out.documents = vendor.vendorMaster.documents || [];
      out.documentsSource = "master";
      delete out.vendorMaster.documents;
    } else {
      out.documentsSource = "branch";
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createVendor = async (req, res) => {
  try {
    // blankEnums: VendorForm sends vendorCategory "" when none is chosen,
    // which fails enum validation — that already broke "optional" category.
    const data = svc.blankEnumsToUndefined(pick(req.body, WRITABLE_FIELDS));

    if (!data.branch || !validId(data.branch))
      return res.status(400).json({ message: "Branch is required" });
    if (!access.canAccessBranch(req, data.branch))
      return res
        .status(403)
        .json({ message: "You can only add vendors to your own branch" });

    // Only enforce PAN rules when a PAN is actually provided
    // (statutory/utility vendors may not have one).
    const pan = VendorMaster.normalizePan(data.panNumber);
    if (pan) {
      data.panNumber = pan;

      const gstErr = svc.gstError(data.gstNumber, pan);
      if (gstErr) return res.status(400).json({ message: gstErr });

      // Requirement 5: a PAN that exists in the Vendor Master cannot be
      // registered again. The client uses masterId to offer "Add to my
      // branch" instead.
      const master = await VendorMaster.findOne({ panNumber: pan })
        .select("_id vendorName approvalStatus status")
        .lean();
      if (master) {
        return res.status(409).json({
          code: "PAN_IN_MASTER",
          masterId: master._id,
          masterName: master.vendorName,
          message: `${master.vendorName} (PAN ${pan}) is already in the Vendor Master. Add it to your branch from there instead of creating it again.`,
        });
      }
      // Phase 4: a NEW PAN is registered as a Vendor Master (POST
      // /api/vendor-masters with `branch`), never as a stand-alone branch
      // record — that is what stops the duplicates coming back.
      return res.status(409).json(USE_MASTER);
    }

    // No PAN given — but a GSTIN that embeds a PAN gives it away.
    const hiddenPan = panInsideGstin(data.gstNumber);
    if (hiddenPan) {
      const master = await VendorMaster.findOne({ panNumber: hiddenPan })
        .select("_id vendorName")
        .lean();
      return res.status(409).json(
        master
          ? {
              code: "PAN_IN_MASTER",
              masterId: master._id,
              masterName: master.vendorName,
              message: `This GSTIN belongs to ${master.vendorName} (PAN ${hiddenPan}), already in the Vendor Master. Add it to your branch from there.`,
            }
          : {
              ...USE_MASTER,
              message: `This GSTIN contains PAN ${hiddenPan}. Register the vendor with that PAN through Add Vendor.`,
            },
      );
    }

    const vendor = await Vendor.create({
      ...data,
      approvalStatus: "draft", // ✅ always start as draft
      status: "active",
      vendorMaster: null,
      sourceOfTruth: "local",
      createdBy: req.user._id,
    });

    await logAction({
      userId: req.user._id,
      action: "CREATE_VENDOR",
      module: "Vendor",
      targetDoc: vendor,
      statusTo: "draft",
      req,
    });
    res.status(201).json(vendor);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.submitVendor = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor id" });
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor)) return forbidden(res);

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

    const labels = {
      pan: "PAN Card",
      gst: "GST Certificate",
      cheque: "Cancelled Cheque",
    };

    if (vendor.isMasterOwned()) {
      // Documents live on the master; the master must be submitted first.
      const master = await VendorMaster.findById(vendor.vendorMaster);
      if (!master)
        return res
          .status(409)
          .json({ message: "Linked vendor master not found" });
      if (["draft", "rejected"].includes(master.approvalStatus)) {
        return res.status(409).json({
          code: "SUBMIT_MASTER_FIRST",
          masterId: master._id,
          message:
            "Submit the vendor master for approval first — this branch vendor is submitted together with it.",
        });
      }
      const missing = svc.missingDocsFor(master);
      if (missing.length) {
        return res.status(400).json({
          message: `Upload required documents before submitting: ${svc.docLabels(missing)}`,
        });
      }
    } else {
      // ✅ PAN + cheque always required; GST cert required only if a GST number exists
      const profile = VENDOR_TYPES[vendor.vendorType] || VENDOR_TYPES.standard;
      const REQUIRED_DOCS = [...profile.requiredDocs];
      if (vendor.gstNumber?.trim()) REQUIRED_DOCS.push("gst");

      const uploadedTypes = (vendor.documents || []).map((d) => d.type);
      const missing = REQUIRED_DOCS.filter((t) => !uploadedTypes.includes(t));
      if (missing.length) {
        return res.status(400).json({
          message: `Upload required documents before submitting: ${missing.map((t) => labels[t]).join(", ")}`,
        });
      }
    }

    const from = vendor.approvalStatus;
    vendor.approvalStatus = "pending_approval";
    await vendor.save();

    await logAction({
      userId: req.user._id,
      action: "SUBMIT_VENDOR",
      module: "Vendor",
      targetDoc: vendor,
      statusFrom: from,
      statusTo: "pending_approval",
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
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor id" });
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor)) return forbidden(res);

    // ✅ Approved vendors can only be edited by accounts / super_admin
    const canEditApproved = [ROLES.ACCOUNTS, ROLES.SUPER_ADMIN].includes(
      req.user.role,
    );
    if (vendor.approvalStatus === "approved" && !canEditApproved) {
      return res.status(403).json({
        message: "Approved vendors can only be edited by the accounts team.",
      });
    }

    const data = svc.blankEnumsToUndefined(pick(req.body, WRITABLE_FIELDS));

    if (vendor.isMasterOwned()) {
      // Requirement 6. These fields are a copy of the master. Editing them
      // here would be overwritten by the next master sync, or worse, make
      // this branch pay a different account from every other branch.
      // The edit form sends every field back, so unchanged values are
      // dropped silently and only a real change is refused.
      const changed = MASTER_OWNED_FIELDS.filter(
        (f) => f in data && !sameValue(f, data[f], vendor[f]),
      );
      if (changed.length) {
        return res.status(409).json({
          code: "MASTER_OWNED_FIELDS",
          masterId: vendor.vendorMaster,
          fields: changed,
          message: `These details are managed in the Vendor Master and can only be changed there by the accounts team: ${changed.join(", ")}`,
        });
      }
      MASTER_OWNED_FIELDS.forEach((f) => delete data[f]);

      if (data.branch && String(data.branch) !== String(vendor.branch)) {
        return res.status(400).json({
          message:
            "A branch vendor linked to the Vendor Master cannot be moved to another branch. Add the vendor to the other branch from the master instead.",
        });
      }
      delete data.branch;
    } else {
      if (data.branch && String(data.branch) !== String(vendor.branch)) {
        if (!validId(data.branch) || !access.canAccessBranch(req, data.branch))
          return res
            .status(403)
            .json({ message: "You can only move vendors to your own branch" });
      }
      if (data.panNumber !== undefined) {
        const pan = VendorMaster.normalizePan(data.panNumber);
        data.panNumber = pan;
        // Editing a local record onto a PAN the master already holds would
        // sidestep requirement 5.
        if (pan && pan !== vendor.panNumber) {
          const master = await VendorMaster.findOne({ panNumber: pan })
            .select("_id vendorName")
            .lean();
          if (master) {
            return res.status(409).json({
              code: "PAN_IN_MASTER",
              masterId: master._id,
              message: `PAN ${pan} belongs to ${master.vendorName} in the Vendor Master.`,
            });
          }
          // A branch user may not give a local record a NEW PAN: that is a
          // new PAN vendor, which goes through the Vendor Master. Accounts
          // may, to correct a mistyped PAN on a legacy record.
          if (!access.isMasterAdmin(req)) {
            return res.status(409).json(USE_MASTER);
          }
        }
      }
    }

    // GSTIN — the branch's own registration, also on master-linked rows.
    // Validated only when it actually changes, so legacy records with an
    // old mismatched GSTIN can still be edited for other fields.
    const gstChanged =
      data.gstNumber !== undefined &&
      !sameValue("gstNumber", data.gstNumber, vendor.gstNumber);
    if (gstChanged) {
      // Same rule for a PAN-less record: a GSTIN carrying a PAN makes it a
      // PAN vendor, which belongs in the Vendor Master.
      if (
        !(data.panNumber || vendor.panNumber) &&
        panInsideGstin(data.gstNumber) &&
        !access.isMasterAdmin(req)
      ) {
        return res.status(409).json({
          ...USE_MASTER,
          message: `This GSTIN contains PAN ${panInsideGstin(data.gstNumber)}. Register the vendor with that PAN through Add Vendor.`,
        });
      }
      const gstErr = svc.gstError(
        data.gstNumber,
        data.panNumber || vendor.panNumber,
      );
      if (gstErr) return res.status(400).json({ message: gstErr });
      data.gstNumber = svc.normVal(data.gstNumber).toUpperCase() || undefined;
    }

    const before = pick(vendor.toObject(), Object.keys(data));
    Object.assign(vendor, data);
    await vendor.save();

    // Keep the master's list of GSTINs in step with its branches.
    if (gstChanged && vendor.isMasterOwned()) {
      await svc.refreshMasterGstins(vendor.vendorMaster);
    }

    await logAction({
      userId: req.user._id,
      action: "UPDATE_VENDOR",
      module: "Vendor",
      targetDoc: vendor,
      oldValue: before,
      newValue: pick(vendor.toObject(), Object.keys(data)),
      req,
    });

    res.json(vendor);
  } catch (err) {
    const status = err?.name === "ValidationError" ? 400 : 500;
    res.status(status).json({ message: err.message });
  }
};

// ✅ REQ 1: Approve vendor — accounts only
exports.approveVendor = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor id" });
    const vendor = await Vendor.findById(req.params.id).populate(
      "createdBy",
      "email name status",
    );
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor)) return forbidden(res);

    if (vendor.approvalStatus === "approved") {
      return res.status(400).json({ message: "Vendor is already approved" });
    }

    if (vendor.isMasterOwned()) {
      const master = await VendorMaster.findById(vendor.vendorMaster);
      if (!master)
        return res
          .status(409)
          .json({ message: "Linked vendor master not found" });
      if (!master.isUsable()) {
        return res.status(409).json({
          code: "MASTER_NOT_USABLE",
          masterId: master._id,
          message:
            master.approvalStatus !== "approved"
              ? "Approve the vendor master first — this branch vendor depends on it."
              : `The vendor master is ${master.status}; it cannot be approved for a branch.`,
        });
      }
      // Approve with the current, approved master values.
      Object.assign(vendor, svc.pickMasterFields(master));
    }

    const from = vendor.approvalStatus;
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
      targetDoc: vendor,
      statusFrom: from,
      statusTo: "approved",
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
    const reason =
      typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor id" });

    const vendor = await Vendor.findById(req.params.id).populate(
      "createdBy",
      "email name status",
    );
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor)) return forbidden(res);

    const from = vendor.approvalStatus;
    vendor.approvalStatus = "rejected";
    vendor.verifiedByAccounts = false;
    vendor.rejectionReason = reason;
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
      targetDoc: vendor,
      statusFrom: from,
      statusTo: "rejected",
      reason,
      req,
    });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteVendor = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor id" });
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor)) return forbidden(res);

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

    const masterId = vendor.vendorMaster;
    await vendor.deleteOne();
    // Only the master's link counter changes. Files the deleted row held
    // itself stay on disk, as before for every vendor delete.
    if (masterId) await svc.recountLinks(masterId);

    await logAction({
      userId: req.user._id,
      action: "DELETE_VENDOR",
      module: "Vendor",
      targetId: req.params.id,
      targetLabel: vendor.vendorName,
      branch: vendor.branch,
      req,
    });
    res.json({ message: "Vendor deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateVendorStatus = async (req, res) => {
  try {
    const status = access.qstr(req.body.status);
    if (!VENDOR_STATUSES.includes(status))
      return res.status(400).json({ message: "Invalid status" });
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor id" });

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor)) return forbidden(res);

    const from = vendor.status;
    vendor.status = status;
    if (status === "blacklisted")
      vendor.blacklistReason =
        typeof req.body.blacklistReason === "string"
          ? req.body.blacklistReason.trim()
          : undefined;
    // The original used findByIdAndUpdate (no validation at all). A full
    // save() would re-validate every field and refuse to freeze a legacy
    // row that predates today's rules. Validate only what changed.
    await vendor.save({ validateModifiedOnly: true });

    await logAction({
      userId: req.user._id,
      action: `VENDOR_STATUS_${status.toUpperCase()}`,
      module: "Vendor",
      targetDoc: vendor,
      statusFrom: from,
      statusTo: status,
      reason: status === "blacklisted" ? vendor.blacklistReason : undefined,
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
    const query = await buildVendorQuery(req);

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
      .populate("vendorMaster", "panNumber approvalStatus status")
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
      { header: "Source", key: "source", width: 12 },
      { header: "Master Approval", key: "masterApproval", width: 16 },
      { header: "Master Status", key: "masterStatus", width: 14 },
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
      req.query.masterLink &&
        `Source: ${req.query.masterLink === "linked" ? "Vendor Master" : "Branch only"}`,
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
        source: v.vendorMaster ? "Vendor Master" : "Branch",
        masterApproval: v.vendorMaster
          ? (v.vendorMaster.approvalStatus || "").replace("_", " ")
          : "—",
        masterStatus: v.vendorMaster ? v.vendorMaster.status || "—" : "—",
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
