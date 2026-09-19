// ============================================================
// BACKEND: src/controllers/vendorMasterController.js  —  NEW FILE
// Revision 19 Sep: GSTIN is per branch. The master keeps a primary GSTIN
// (editable here) and gstins[], the list of every branch GSTIN.
// ============================================================
//   lookupByPan        GET    /api/vendor-masters/lookup?pan=
//   getMasters         GET    /api/vendor-masters
//   exportMastersExcel GET    /api/vendor-masters/export/excel
//   getMasterById      GET    /api/vendor-masters/:id
//   getMasterBranches  GET    /api/vendor-masters/:id/branches
//   createMaster       POST   /api/vendor-masters
//   updateMaster       PUT    /api/vendor-masters/:id          (req 6; creator only while draft/rejected)
//   submitMaster       PATCH  /api/vendor-masters/:id/submit
//   approveMaster      PATCH  /api/vendor-masters/:id/approve
//   rejectMaster       PATCH  /api/vendor-masters/:id/reject
//   updateMasterStatus PATCH  /api/vendor-masters/:id/status
//   linkMaster         POST   /api/vendor-masters/:id/link     (req 4)
//   attachLocalVendor  POST   /api/vendor-masters/:id/attach
//
// Master documents are uploaded through uploadController
// (/api/uploads/vendor-master/:id/document), next to the existing
// vendor document handlers.
// ============================================================
const mongoose = require("mongoose");
const VendorMaster = require("../models/VendorMaster");
const Vendor = require("../models/Vendor");
const User = require("../models/User");
const { logAction } = require("../services/auditService");
const { sendNotificationEmail } = require("../services/emailService");
const {
  ROLES,
  VENDOR_MASTER,
  MASTER_OWNED_FIELDS,
  GST_STATE_CODES,
} = require("../config/constants");
const svc = require("../services/vendorMasterService");
const access = require("../utils/vendorAccess");

// ── Small helpers ──────────────────────────────────────────
// gstNumber here is the master's PRIMARY GSTIN; branch vendors keep their own.
const EDITABLE_FIELDS = [...MASTER_OWNED_FIELDS, "vendorCategory", "gstNumber"];
const APPROVAL_STATES = ["draft", "pending_approval", "approved", "rejected"];
const MASTER_STATUSES = ["active", "inactive", "blacklisted", "frozen"];

const validId = (v) => mongoose.isValidObjectId(v);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Whitelist copy. Nothing outside `keys` can reach the model — no
// approvalStatus, approvedBy, linkedBranchCount, createdByScript, etc.
const pick = (src, keys) => {
  const out = {};
  for (const k of keys) {
    if (src && src[k] !== undefined) out[k] = src[k];
  }
  return out;
};

const sendError = (res, err, context) => {
  if (err?.name === "ValidationError") {
    return res.status(400).json({
      message: Object.values(err.errors)
        .map((e) => e.message)
        .join(", "),
    });
  }
  if (err?.name === "CastError") {
    return res.status(400).json({ message: `Invalid value for ${err.path}` });
  }
  if (err?.code === 11000) {
    return res.status(409).json({
      code: "DUPLICATE",
      message:
        "A vendor master with this PAN, or a link to this branch, already exists.",
    });
  }
  console.error(`[VendorMaster] ${context}:`, err);
  return res.status(500).json({ message: err?.message || context });
};

// Email the active accounts users for the given branches. With no branch
// ids (a master nobody has linked yet) every active accounts user is told.
const notifyAccounts = async (branchIds, subject, html) => {
  const filter = { role: ROLES.ACCOUNTS, status: "active" };
  if (branchIds && branchIds.length) filter.branches = { $in: branchIds };
  const users = await User.find(filter).select("email").lean();
  for (const u of users) {
    if (!u.email) continue;
    await sendNotificationEmail(u.email, subject, html).catch(console.error);
  }
};

// Email the master's creator, only if still active (the recurring
// "inactive user email leak" issue — do not repeat it here).
const notifyCreator = async (master, subject, html) => {
  const creator =
    master.createdBy && master.createdBy.email
      ? master.createdBy
      : await User.findById(master.createdBy).select("email status").lean();
  if (creator?.email && creator.status === "active") {
    await sendNotificationEmail(creator.email, subject, html).catch(
      console.error,
    );
  }
};

const cannotLinkReason = (master, req) => {
  if (!master) return null;
  if (master.status !== "active")
    return `This vendor is ${master.status} at group level and cannot be added to a branch. Contact the accounts team.`;
  if (master.approvalStatus === "draft")
    return req && access.isSameUser(master.createdBy, req.user._id)
      ? "You registered this PAN and it is still a draft. Finish and submit it from your branch's vendor list; once submitted it can be added to other branches."
      : "This PAN is being registered by another user and has not been submitted for approval yet. Contact the accounts team.";
  if (master.approvalStatus === "rejected")
    return `This vendor was rejected by the accounts team${
      master.rejectionReason ? `: ${master.rejectionReason}` : ""
    }. Contact the accounts team.`;
  return null;
};

// ════════════════════════════════════════════════════════════
// LOOKUP — the PAN-first gate (requirement 4)
// ════════════════════════════════════════════════════════════
exports.lookupByPan = async (req, res) => {
  try {
    const pan = VendorMaster.normalizePan(req.query.pan);
    if (!VENDOR_MASTER.PAN_REGEX.test(pan)) {
      return res
        .status(400)
        .json({ message: "Enter a valid PAN (e.g. ABCDE1234F)" });
    }

    // Accounts / super_admin see every branch's links and legacy records
    // (masters are group-wide for them); branch users see their own.
    const scoped = access.isMasterScoped(req);
    const myBranchIds = scoped ? access.userBranchIds(req) : null;

    const master = await VendorMaster.findOne({ panNumber: pan });

    // Branch-level (pre-master) records with this PAN in my branches.
    // { vendorMaster: null } also matches documents where the field is
    // absent, i.e. every legacy row.
    const localFilter = { vendorMaster: null, panNumber: pan };
    if (scoped) localFilter.branch = { $in: myBranchIds };
    const localRows = await Vendor.find(localFilter)
      .select("_id branch vendorName approvalStatus status")
      .populate("branch", "name code")
      .lean();

    let myLinks = [];
    if (master) {
      const linkFilter = { vendorMaster: master._id };
      if (scoped) linkFilter.branch = { $in: myBranchIds };
      myLinks = await Vendor.find(linkFilter)
        .select("_id branch approvalStatus status")
        .populate("branch", "name code")
        .lean();
    }

    const fullView =
      access.hasFullMasterView(req) ||
      myLinks.length > 0 ||
      (master && access.isSameUser(master.createdBy, req.user._id));

    const reason = cannotLinkReason(master, req);

    // Every lookup is audited: the endpoint answers "is this PAN one of
    // our vendors?" for anyone with a login, so probing must be visible.
    await logAction({
      userId: req.user._id,
      action: "LOOKUP_VENDOR_MASTER",
      module: "VendorMaster",
      targetId: master?._id,
      targetLabel: master?.vendorName || pan,
      newValue: { pan, found: Boolean(master) },
      req,
    });

    res.json({
      pan,
      found: Boolean(master),
      masked: master ? !fullView : false,
      master: master
        ? fullView
          ? { ...master.toObject(), masked: false }
          : svc.maskedView(master)
        : null,
      canLink: Boolean(master) && !reason,
      cannotLinkReason: reason,
      // True when linking would make the branch vendor usable immediately.
      autoApproveOnLink:
        Boolean(master) &&
        master.approvalStatus === "approved" &&
        VENDOR_MASTER.autoApproveLinkToApprovedMaster,
      myLinks,
      localRows,
    });
  } catch (err) {
    sendError(res, err, "PAN lookup failed");
  }
};

// ════════════════════════════════════════════════════════════
// LIST / DETAIL
// ════════════════════════════════════════════════════════════
const buildMasterQuery = (req) => {
  const q = {};
  const search = access.qstr(req.query.search);
  const approvalStatus = access.qstr(req.query.approvalStatus);
  const status = access.qstr(req.query.status);
  const vendorType = access.qstr(req.query.vendorType);
  const category = access.qstr(req.query.category);
  const linked = access.qstr(req.query.linked);

  if (APPROVAL_STATES.includes(approvalStatus))
    q.approvalStatus = approvalStatus;
  if (MASTER_STATUSES.includes(status)) q.status = status;
  if (["standard", "statutory"].includes(vendorType)) q.vendorType = vendorType;
  if (category) q.vendorCategory = category;
  if (linked === "yes") q.linkedBranchCount = { $gt: 0 };
  if (linked === "no") q.linkedBranchCount = { $lte: 0 };
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    q.$or = [
      { vendorName: rx },
      { companyName: rx },
      { panNumber: rx },
      { gstNumber: rx },
    ];
  }
  return q;
};

exports.getMasters = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20),
    );
    const query = buildMasterQuery(req);

    const [total, masters] = await Promise.all([
      VendorMaster.countDocuments(query),
      VendorMaster.find(query)
        .select("-documents")
        .populate("createdBy", "name")
        .populate("approvedBy", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    res.json({ masters, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    sendError(res, err, "Failed to load vendor masters");
  }
};

exports.getMasterById = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor master id" });

    const master = await VendorMaster.findById(req.params.id)
      .populate("createdBy", "name email")
      .populate("approvedBy", "name")
      .populate("rejectedBy", "name");
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });

    let full = access.hasFullMasterView(req);
    if (!full && access.isSameUser(master.createdBy, req.user._id)) full = true;
    if (!full) {
      const linked = await Vendor.exists({
        vendorMaster: master._id,
        branch: { $in: access.userBranchIds(req) },
      });
      full = Boolean(linked);
    }

    res.json(
      full ? { ...master.toObject(), masked: false } : svc.maskedView(master),
    );
  } catch (err) {
    sendError(res, err, "Failed to load vendor master");
  }
};

// Requirement 8 — the master <-> branch mapping, as a view.
exports.getMasterBranches = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor master id" });

    const master = await VendorMaster.findById(req.params.id).lean();
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });

    const links = await Vendor.find({ vendorMaster: master._id })
      .select(
        "branch vendorCategory gstNumber approvalStatus status sourceOfTruth rejectionReason createdAt approvedAt createdBy approvedBy",
      )
      .populate("branch", "name code")
      .populate("createdBy", "name")
      .populate("approvedBy", "name")
      .sort({ createdAt: 1 })
      .lean();

    // Invoice count per link — shows which branches actually trade with it.
    const InvoiceRequest = require("../models/InvoiceRequest");
    const counts = links.length
      ? await InvoiceRequest.aggregate([
          { $match: { vendor: { $in: links.map((l) => l._id) } } },
          { $group: { _id: "$vendor", count: { $sum: 1 } } },
        ])
      : [];
    const countMap = Object.fromEntries(
      counts.map((c) => [String(c._id), c.count]),
    );

    // Branch-level records with the same PAN that are not linked to any
    // master yet — candidates for "Attach". Each carries the fields where
    // it disagrees with the master, so accounts sees a bank-account change
    // BEFORE confirming it.
    let candidates = [];
    if (master.panNumber) {
      const rows = await Vendor.find({
        vendorMaster: null,
        panNumber: master.panNumber,
      })
        .select(
          `branch approvalStatus status createdAt gstNumber ${MASTER_OWNED_FIELDS.join(" ")}`,
        )
        .populate("branch", "name code")
        .lean();
      candidates = rows.map((r) => {
        const d = svc.diffFromMaster(r, master);
        // Outside the caller's branches: say WHICH fields differ, not the
        // values (getVendorById would refuse this caller the row itself).
        const showValues = access.canAccessBranchForMaster(req, r.branch);
        return {
          _id: r._id,
          branch: r.branch,
          vendorName: r.vendorName,
          gstNumber: r.gstNumber || null, // kept by the branch when attached
          approvalStatus: r.approvalStatus,
          status: r.status,
          createdAt: r.createdAt,
          canAttach: showValues,
          differences: d.changed.map((f) => ({
            field: f,
            branchValue: !showValues
              ? null
              : f === "accountNumber"
                ? svc.maskAccount(r[f])
                : (r[f] ?? null),
            masterValue: !showValues
              ? null
              : f === "accountNumber"
                ? svc.maskAccount(master[f])
                : (master[f] ?? null),
          })),
          bankDiffers: d.changed.some((f) =>
            ["accountNumber", "ifscCode", "accountHolderName"].includes(f),
          ),
        };
      });
    }

    res.json({
      links: links.map((l) => ({
        ...l,
        invoiceCount: countMap[String(l._id)] || 0,
        // A GSTIN whose characters 3–12 are not this PAN is a data error.
        gstinMismatch: Boolean(
          l.gstNumber && !svc.gstMatchesPan(l.gstNumber, master.panNumber),
        ),
      })),
      candidates,
    });
  } catch (err) {
    sendError(res, err, "Failed to load linked branches");
  }
};

// ════════════════════════════════════════════════════════════
// CREATE — a brand-new PAN (requirement 5 enforced here + unique index)
// ════════════════════════════════════════════════════════════
// Optional body.branch: also creates that branch's mapping row in the
// same request. Phase 4's PAN gate uses this; accounts creating a master
// from the admin screen usually leaves it out.
exports.createMaster = async (req, res) => {
  try {
    const data = svc.blankEnumsToUndefined(pick(req.body, EDITABLE_FIELDS));
    const pan = VendorMaster.normalizePan(data.panNumber);

    // A master is keyed on PAN. Payees with no PAN (electricity boards,
    // challans) stay branch-level records and are added from Vendors.
    if (!pan) {
      return res.status(400).json({
        message:
          "PAN is required for the Vendor Master. Payees without a PAN are added as branch vendors.",
      });
    }
    if (!VENDOR_MASTER.PAN_REGEX.test(pan)) {
      return res.status(400).json({ message: "Invalid PAN (e.g. ABCDE1234F)" });
    }
    data.panNumber = pan;

    const gstErr = svc.gstError(data.gstNumber, pan);
    if (gstErr) return res.status(400).json({ message: gstErr });

    const existing = await VendorMaster.findOne({ panNumber: pan })
      .select("_id vendorName")
      .lean();
    if (existing) {
      return res.status(409).json({
        code: "PAN_EXISTS",
        masterId: existing._id,
        message: `${existing.vendorName} (PAN ${pan}) is already in the Vendor Master.`,
      });
    }

    const branchId = access.qstr(req.body.branch);
    // A branch user registers a vendor FOR their branch. Without one the
    // master would be an orphan draft nobody else can reach or submit.
    if (!branchId && !access.isMasterAdmin(req)) {
      return res
        .status(400)
        .json({ message: "Select the branch this vendor is being added for" });
    }
    if (branchId) {
      if (!validId(branchId))
        return res.status(400).json({ message: "Invalid branch" });
      if (!access.canAccessBranchForMaster(req, branchId))
        return res
          .status(403)
          .json({ message: "You can only add vendors to your own branch" });

      const local = await Vendor.findOne({
        vendorMaster: null,
        branch: branchId,
        panNumber: pan,
      })
        .select("_id vendorName")
        .lean();
      if (local) {
        return res.status(409).json({
          code: "LOCAL_EXISTS",
          vendorId: local._id,
          message: `This branch already has ${local.vendorName} (PAN ${pan}) as a branch-level vendor. Ask the accounts team to move it into the Vendor Master instead of adding it again.`,
        });
      }
    }

    const master = await VendorMaster.create({
      ...data,
      approvalStatus: "draft",
      status: "active",
      createdBy: req.user._id,
      linkedBranchCount: 0,
    });

    let branchVendor = null;
    if (branchId) {
      try {
        branchVendor = await Vendor.create(
          svc.buildBranchRow(master, {
            branch: branchId,
            vendorCategory: data.vendorCategory,
            createdBy: req.user._id,
            approvalStatus: "draft",
          }),
        );
      } catch (e) {
        // Compensate rather than leave a master nobody can reach.
        await VendorMaster.deleteOne({ _id: master._id }).catch(() => {});
        throw e;
      }
      await svc.recountLinks(master._id);
    }

    await logAction({
      userId: req.user._id,
      action: "CREATE_VENDOR_MASTER",
      module: "VendorMaster",
      targetDoc: master,
      statusTo: "draft",
      req,
    });
    if (branchVendor) {
      await logAction({
        userId: req.user._id,
        action: "CREATE_VENDOR",
        module: "Vendor",
        targetDoc: branchVendor,
        statusTo: "draft",
        reason: "Created together with a new vendor master",
        req,
      });
    }
    await svc.refreshMasterGstins(master._id);

    // Tell the caller about pre-master records with this PAN, so accounts
    // can attach them from the master page rather than leave duplicates.
    const unlinkedLocalCount = await Vendor.countDocuments({
      vendorMaster: null,
      panNumber: pan,
    });

    res.status(201).json({ master, branchVendor, unlinkedLocalCount });
  } catch (err) {
    sendError(res, err, "Failed to create vendor master");
  }
};

// ════════════════════════════════════════════════════════════
// UPDATE — accounts / super_admin only (requirement 6), then fan out
// ════════════════════════════════════════════════════════════
exports.updateMaster = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor master id" });
    const master = await VendorMaster.findById(req.params.id);
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });

    // Requirement 6: the accounts team and super admin edit vendor masters.
    // The one exception is the person who registered a NEW PAN, who may
    // correct their own record until it is submitted, and again if accounts
    // sends it back rejected. Once submitted or approved it is accounts-only.
    if (!access.isMasterAdmin(req)) {
      const ownDraft =
        access.isSameUser(master.createdBy, req.user._id) &&
        ["draft", "rejected"].includes(master.approvalStatus);
      if (!ownDraft) {
        return res.status(403).json({
          message:
            "Vendor master details can only be changed by the accounts team.",
        });
      }
    }

    const data = svc.blankEnumsToUndefined(pick(req.body, EDITABLE_FIELDS));

    if (data.panNumber !== undefined) {
      const pan = VendorMaster.normalizePan(data.panNumber);
      if (pan !== master.panNumber) {
        if (!VENDOR_MASTER.PAN_REGEX.test(pan))
          return res
            .status(400)
            .json({ message: "Invalid PAN (e.g. ABCDE1234F)" });
        // Changing the identity key of a live, approved vendor is a
        // super_admin decision, not a routine accounts edit.
        if (
          master.approvalStatus === "approved" &&
          req.user.role !== ROLES.SUPER_ADMIN
        ) {
          return res.status(403).json({
            message:
              "Only a super admin can change the PAN of an approved vendor master.",
          });
        }
        const clash = await VendorMaster.exists({
          panNumber: pan,
          _id: { $ne: master._id },
        });
        if (clash)
          return res.status(409).json({
            code: "PAN_EXISTS",
            masterId: clash._id,
            message: `PAN ${pan} already belongs to another vendor master.`,
          });
      }
      data.panNumber = pan;
    }

    if (data.gstNumber !== undefined || data.panNumber !== undefined) {
      const gstErr = svc.gstError(
        data.gstNumber !== undefined ? data.gstNumber : master.gstNumber,
        data.panNumber || master.panNumber,
      );
      if (gstErr) return res.status(400).json({ message: gstErr });
    }

    const before = pick(master.toObject(), EDITABLE_FIELDS);
    Object.assign(master, data);
    await master.save();

    const sync = await svc.syncMasterToBranchVendors(
      master,
      req,
      "Vendor master details updated",
    );

    await logAction({
      userId: req.user._id,
      action: "UPDATE_VENDOR_MASTER",
      module: "VendorMaster",
      targetDoc: master,
      oldValue: before,
      newValue: pick(master.toObject(), EDITABLE_FIELDS),
      req,
    });

    res.json({ master, branchRowsUpdated: sync.modified });
  } catch (err) {
    sendError(res, err, "Failed to update vendor master");
  }
};

// ════════════════════════════════════════════════════════════
// SUBMIT — draft / rejected → pending_approval
// ════════════════════════════════════════════════════════════
exports.submitMaster = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor master id" });
    const master = await VendorMaster.findById(req.params.id);
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });

    const isOwner = access.isSameUser(master.createdBy, req.user._id);
    if (!isOwner && !access.isMasterAdmin(req)) {
      return res
        .status(403)
        .json({ message: "Not authorized to submit this vendor master" });
    }
    if (!["draft", "rejected"].includes(master.approvalStatus)) {
      return res.status(400).json({
        message: `Vendor master is already ${master.approvalStatus.replace("_", " ")}`,
      });
    }

    const missing = svc.missingDocsFor(master);
    if (missing.length) {
      return res.status(400).json({
        message: `Upload required documents before submitting: ${svc.docLabels(missing)}`,
        missing,
      });
    }

    const from = master.approvalStatus;
    const masterRejectedAt = master.rejectedAt;
    master.approvalStatus = "pending_approval";
    await master.save();

    // The branch rows created with this master go up for approval with it:
    // drafts, and rows that were rejected BY the master rejection (same
    // timestamp, set in rejectMaster). A branch link accounts rejected on
    // its own stays rejected — resubmitting the master must not undo it.
    const revive = [{ approvalStatus: "draft" }];
    if (masterRejectedAt) {
      revive.push({ approvalStatus: "rejected", rejectedAt: masterRejectedAt });
    }
    const rows = await Vendor.find({
      vendorMaster: master._id,
      $or: revive,
    })
      .select("_id branch approvalStatus")
      .lean();
    if (rows.length) {
      await Vendor.updateMany(
        { _id: { $in: rows.map((r) => r._id) } },
        { $set: { approvalStatus: "pending_approval" } },
      );
      await Promise.all(
        rows.map((r) =>
          logAction({
            userId: req.user._id,
            action: "SUBMIT_VENDOR",
            module: "Vendor",
            targetId: r._id,
            targetLabel: master.vendorName,
            branch: r.branch,
            statusFrom: r.approvalStatus,
            statusTo: "pending_approval",
            reason: "Submitted with its vendor master",
            req,
          }),
        ),
      );
    }

    await logAction({
      userId: req.user._id,
      action: "SUBMIT_VENDOR_MASTER",
      module: "VendorMaster",
      targetDoc: master,
      statusFrom: from,
      statusTo: "pending_approval",
      req,
    });

    const branchIds = (
      await Vendor.distinct("branch", { vendorMaster: master._id })
    ).map(String);
    await notifyAccounts(
      branchIds,
      `🆕 Vendor Master Pending Approval: ${master.vendorName}`,
      `<p>Vendor master <strong>${escapeHtml(master.vendorName)}</strong> (PAN ${escapeHtml(
        master.panNumber,
      )}) has been submitted and is awaiting accounts approval.</p>`,
    );

    res.json(master);
  } catch (err) {
    sendError(res, err, "Failed to submit vendor master");
  }
};

// ════════════════════════════════════════════════════════════
// APPROVE — the one-time KYC approval
// ════════════════════════════════════════════════════════════
exports.approveMaster = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor master id" });
    const master = await VendorMaster.findById(req.params.id).populate(
      "createdBy",
      "email name status",
    );
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });

    if (master.approvalStatus === "approved")
      return res
        .status(400)
        .json({ message: "Vendor master is already approved" });
    if (master.approvalStatus !== "pending_approval")
      return res.status(400).json({
        message:
          "Only a submitted vendor master can be approved. Submit it first.",
      });

    // Documents can be deleted after submission — check again.
    const missing = svc.missingDocsFor(master);
    if (missing.length) {
      return res.status(400).json({
        message: `Cannot approve — required documents are missing: ${svc.docLabels(missing)}`,
        missing,
      });
    }

    const now = new Date();
    master.approvalStatus = "approved";
    master.verifiedByAccounts = true;
    master.approvedBy = req.user._id;
    master.approvedAt = now;
    master.rejectionReason = null;
    master.rejectedBy = null;
    master.rejectedAt = null;
    await master.save();

    // Make sure every mirror row holds the approved values.
    await svc.syncMasterToBranchVendors(master, req, "Vendor master approved");

    // Branch rows waiting on this master. With auto-approve on (the
    // decided default) every waiting link is approved with it; with it
    // off, only the originating branch's row is — other branches' links
    // stay in the queue for individual approval.
    const rowFilter = {
      vendorMaster: master._id,
      approvalStatus: { $in: ["draft", "pending_approval"] },
    };
    if (!VENDOR_MASTER.autoApproveLinkToApprovedMaster) {
      rowFilter.createdBy = master.createdBy?._id || master.createdBy;
    }
    const rows = await Vendor.find(rowFilter)
      .select("_id branch approvalStatus")
      .lean();
    if (rows.length) {
      await Vendor.updateMany(
        { _id: { $in: rows.map((r) => r._id) } },
        {
          $set: {
            approvalStatus: "approved",
            verifiedByAccounts: true,
            approvedBy: req.user._id,
            approvedAt: now,
            rejectionReason: null,
            rejectedBy: null,
            rejectedAt: null,
          },
        },
      );
      await Promise.all(
        rows.map((r) =>
          logAction({
            userId: req.user._id,
            action: "APPROVE_VENDOR",
            module: "Vendor",
            targetId: r._id,
            targetLabel: master.vendorName,
            branch: r.branch,
            statusFrom: r.approvalStatus,
            statusTo: "approved",
            reason: "Approved with its vendor master",
            req,
          }),
        ),
      );
    }

    await logAction({
      userId: req.user._id,
      action: "APPROVE_VENDOR_MASTER",
      module: "VendorMaster",
      targetDoc: master,
      statusFrom: "pending_approval",
      statusTo: "approved",
      req,
    });

    await notifyCreator(
      master,
      `✅ Vendor Approved: ${master.vendorName}`,
      `<p>Vendor <strong>${escapeHtml(master.vendorName)}</strong> (PAN ${escapeHtml(
        master.panNumber,
      )}) has been approved by the accounts team. You can now create payment requests for this vendor.</p>`,
    );

    res.json({ master, branchRowsApproved: rows.length });
  } catch (err) {
    sendError(res, err, "Failed to approve vendor master");
  }
};

// ════════════════════════════════════════════════════════════
// REJECT
// ════════════════════════════════════════════════════════════
exports.rejectMaster = async (req, res) => {
  try {
    const reason =
      typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (!reason)
      return res.status(400).json({ message: "Rejection reason is required" });
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor master id" });

    const master = await VendorMaster.findById(req.params.id).populate(
      "createdBy",
      "email name status",
    );
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });

    // Rejecting a live vendor would strand every branch that uses it.
    if (master.approvalStatus === "approved") {
      return res.status(400).json({
        message:
          "An approved vendor master cannot be rejected. Change its status to frozen or blacklisted instead.",
      });
    }
    if (master.approvalStatus === "rejected")
      return res
        .status(400)
        .json({ message: "Vendor master is already rejected" });

    const from = master.approvalStatus;
    const now = new Date();
    master.approvalStatus = "rejected";
    master.verifiedByAccounts = false;
    master.rejectionReason = reason;
    master.rejectedBy = req.user._id;
    master.rejectedAt = now;
    master.approvedBy = null;
    master.approvedAt = null;
    await master.save();

    const rows = await Vendor.find({
      vendorMaster: master._id,
      approvalStatus: { $in: ["draft", "pending_approval"] },
    })
      .select("_id branch approvalStatus")
      .lean();
    if (rows.length) {
      await Vendor.updateMany(
        { _id: { $in: rows.map((r) => r._id) } },
        {
          $set: {
            approvalStatus: "rejected",
            verifiedByAccounts: false,
            rejectionReason: reason,
            rejectedBy: req.user._id,
            rejectedAt: now,
          },
        },
      );
      await Promise.all(
        rows.map((r) =>
          logAction({
            userId: req.user._id,
            action: "REJECT_VENDOR",
            module: "Vendor",
            targetId: r._id,
            targetLabel: master.vendorName,
            branch: r.branch,
            statusFrom: r.approvalStatus,
            statusTo: "rejected",
            reason: `Vendor master rejected: ${reason}`,
            req,
          }),
        ),
      );
    }

    await logAction({
      userId: req.user._id,
      action: "REJECT_VENDOR_MASTER",
      module: "VendorMaster",
      targetDoc: master,
      statusFrom: from,
      statusTo: "rejected",
      reason,
      req,
    });

    await notifyCreator(
      master,
      `❌ Vendor Rejected: ${master.vendorName}`,
      `<p>Vendor <strong>${escapeHtml(master.vendorName)}</strong> has been rejected by the accounts team.</p>
       <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-top:12px;">
         <strong style="color:#dc2626;">Rejection Reason:</strong>
         <p style="color:#7f1d1d;margin-top:4px;">${escapeHtml(reason)}</p>
       </div>
       <p style="margin-top:12px;">Please correct the details or documents and resubmit.</p>`,
    );

    res.json(master);
  } catch (err) {
    sendError(res, err, "Failed to reject vendor master");
  }
};

// ════════════════════════════════════════════════════════════
// STATUS — freeze / blacklist across every branch at once
// ════════════════════════════════════════════════════════════
exports.updateMasterStatus = async (req, res) => {
  try {
    const status = access.qstr(req.body.status);
    if (!MASTER_STATUSES.includes(status))
      return res.status(400).json({ message: "Invalid status" });
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor master id" });

    const master = await VendorMaster.findById(req.params.id);
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });

    const reason =
      typeof req.body.blacklistReason === "string"
        ? req.body.blacklistReason.trim()
        : "";
    if (status === "blacklisted" && !reason)
      return res
        .status(400)
        .json({ message: "A reason is required to blacklist a vendor" });

    const from = master.status;
    master.status = status;
    master.blacklistReason = status === "blacklisted" ? reason : undefined;
    await master.save();

    const affectedBranches = await Vendor.countDocuments({
      vendorMaster: master._id,
    });

    await logAction({
      userId: req.user._id,
      action: `VENDOR_MASTER_STATUS_${status.toUpperCase()}`,
      module: "VendorMaster",
      targetDoc: master,
      statusFrom: from,
      statusTo: status,
      reason: reason || undefined,
      newValue: { affectedBranches },
      req,
    });

    res.json({ master, affectedBranches });
  } catch (err) {
    sendError(res, err, "Failed to update vendor master status");
  }
};

// ════════════════════════════════════════════════════════════
// LINK — "Add to my branch" (requirement 4)
// ════════════════════════════════════════════════════════════
exports.linkMaster = async (req, res) => {
  try {
    if (!validId(req.params.id))
      return res.status(400).json({ message: "Invalid vendor master id" });
    const branchId = access.qstr(req.body.branch);
    if (!branchId || !validId(branchId))
      return res.status(400).json({ message: "Select a branch" });
    // Branch users: own branches only. Accounts / super_admin: any branch.
    if (!access.canAccessBranchForMaster(req, branchId))
      return res
        .status(403)
        .json({ message: "You can only add vendors to your own branch" });

    const master = await VendorMaster.findById(req.params.id);
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });

    const reason = cannotLinkReason(master, req);
    if (reason)
      return res.status(409).json({ code: "CANNOT_LINK", message: reason });

    // GST is per state: the branch gives the GSTIN it is invoiced under.
    // Absent → start from the master's primary GSTIN; "" → none.
    const branchGst =
      typeof req.body.gstNumber === "string" ? req.body.gstNumber : undefined;
    const gstErr = svc.gstError(branchGst, master.panNumber);
    if (gstErr) return res.status(400).json({ message: gstErr });

    const already = await Vendor.findOne({
      vendorMaster: master._id,
      branch: branchId,
    })
      .select("_id")
      .lean();
    if (already) {
      return res.status(409).json({
        code: "ALREADY_LINKED",
        vendorId: already._id,
        message: "This vendor is already in this branch's vendor list.",
      });
    }

    const local = await Vendor.findOne({
      vendorMaster: null,
      branch: branchId,
      panNumber: master.panNumber,
    })
      .select("_id vendorName")
      .lean();
    if (local) {
      return res.status(409).json({
        code: "LOCAL_EXISTS",
        vendorId: local._id,
        message: `This branch already has ${local.vendorName} as a branch-level vendor. Ask the accounts team to attach it to the Vendor Master instead of adding it again.`,
      });
    }

    // Decided: a link to an ALREADY-APPROVED master needs no second
    // approval. The KYC review happened once, at master level.
    const auto =
      master.approvalStatus === "approved" &&
      VENDOR_MASTER.autoApproveLinkToApprovedMaster;
    const now = new Date();

    let vendor;
    try {
      vendor = await Vendor.create(
        svc.buildBranchRow(master, {
          branch: branchId,
          vendorCategory: access.qstr(req.body.vendorCategory),
          createdBy: req.user._id,
          approvalStatus: auto ? "approved" : "pending_approval",
          // Credit the approval to whoever approved the KYC, not to the
          // branch user who clicked "Add to my branch".
          approvedBy: auto ? master.approvedBy : null,
          approvedAt: auto ? now : null,
          verifiedByAccounts: auto,
          gstNumber: branchGst,
        }),
      );
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(409).json({
          code: "ALREADY_LINKED",
          message: "This vendor is already in this branch's vendor list.",
        });
      }
      throw e;
    }
    await svc.recountLinks(master._id);
    // Closes the window where the master was edited between our read and
    // Vendor.create: the new row converges on the master's current values.
    await svc.syncMasterToBranchVendors(master._id, req, "Linked to branch");

    await logAction({
      userId: req.user._id,
      action: "LINK_VENDOR_MASTER",
      module: "VendorMaster",
      targetDoc: master,
      branch: branchId,
      newValue: { branchVendorId: vendor._id, autoApproved: auto },
      req,
    });
    await logAction({
      userId: req.user._id,
      action: "CREATE_VENDOR",
      module: "Vendor",
      targetDoc: vendor,
      statusTo: vendor.approvalStatus,
      reason: auto
        ? "Linked from an approved vendor master — auto-approved"
        : "Linked from vendor master — awaiting accounts approval",
      req,
    });

    if (!auto) {
      await notifyAccounts(
        [branchId],
        `🆕 Vendor Pending Approval: ${master.vendorName}`,
        `<p>A branch has added <strong>${escapeHtml(master.vendorName)}</strong> (PAN ${escapeHtml(
          master.panNumber,
        )}) from the Vendor Master and it is awaiting your approval.</p>`,
      );
    }

    res.status(201).json({ vendor, autoApproved: auto });
  } catch (err) {
    sendError(res, err, "Failed to add vendor to branch");
  }
};

// ════════════════════════════════════════════════════════════
// ATTACH — convert an existing branch-level record into a mirror of
// this master. How accounts resolves duplicates the backfill skipped.
// ════════════════════════════════════════════════════════════
exports.attachLocalVendor = async (req, res) => {
  try {
    const vendorId = access.qstr(req.body.vendorId);
    if (!validId(req.params.id) || !vendorId || !validId(vendorId))
      return res.status(400).json({ message: "Invalid id" });

    const [master, vendor] = await Promise.all([
      VendorMaster.findById(req.params.id),
      Vendor.findById(vendorId),
    ]);
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    // Attaching rewrites this branch's bank details. Masters are group-wide
    // for accounts / super_admin (the only roles this route admits), so any
    // branch is allowed; the helper keeps the rule explicit if roles change.
    if (!access.canAccessBranchForMaster(req, vendor.branch))
      return res
        .status(403)
        .json({ message: "You do not have access to this branch's vendor" });

    if (vendor.vendorMaster)
      return res.status(409).json({
        message: "This branch vendor is already linked to a vendor master.",
      });
    if (VendorMaster.normalizePan(vendor.panNumber) !== master.panNumber)
      return res.status(400).json({
        message:
          "PAN does not match — only records with the same PAN can be attached.",
      });
    if (master.approvalStatus !== "approved")
      return res.status(409).json({
        message:
          "Approve the vendor master before attaching branch records to it.",
      });

    const sameBranch = await Vendor.findOne({
      vendorMaster: master._id,
      branch: vendor.branch,
    })
      .select("_id")
      .lean();
    if (sameBranch) {
      return res.status(409).json({
        code: "BRANCH_ALREADY_LINKED",
        vendorId: sameBranch._id,
        message:
          "This branch is already linked to the master through another record. Deactivate this duplicate instead of attaching it.",
      });
    }

    // Attaching overwrites the record's bank details with the master's.
    // Never do that silently.
    const diff = svc.diffFromMaster(vendor.toObject(), master);
    const bankFields = ["accountNumber", "ifscCode", "accountHolderName"];
    const bankChanges = diff.changed.filter((f) => bankFields.includes(f));
    if (bankChanges.length && req.body.confirmBankChange !== true) {
      return res.status(409).json({
        code: "CONFIRM_BANK_CHANGE",
        message:
          "This branch record has different bank details from the master. Attaching will pay the master's account for all future payments from this branch.",
        differences: bankChanges.map((f) => ({
          field: f,
          branchValue:
            f === "accountNumber" ? svc.maskAccount(vendor[f]) : vendor[f],
          masterValue:
            f === "accountNumber" ? svc.maskAccount(master[f]) : master[f],
        })),
      });
    }

    Object.assign(vendor, svc.pickMasterFields(master));
    vendor.vendorMaster = master._id;
    vendor.sourceOfTruth = "master";
    // vendor.documents are left in place on purpose — they are removed
    // by scripts/reclaimVendorDocuments.js in Phase 6, never here.
    try {
      // validateModifiedOnly: legacy rows may predate today's validators
      // (e.g. a blank category); only the fields we copy are re-checked.
      await vendor.save({ validateModifiedOnly: true });
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(409).json({
          code: "BRANCH_ALREADY_LINKED",
          message: "This branch is already linked to the master.",
        });
      }
      throw e;
    }
    await svc.recountLinks(master._id);
    await svc.syncMasterToBranchVendors(master._id, req, "Attached to master");

    await logAction({
      userId: req.user._id,
      action: "ATTACH_VENDOR_TO_MASTER",
      module: "Vendor",
      targetDoc: vendor,
      reason: `Attached to vendor master ${master.vendorName} (PAN ${master.panNumber})`,
      oldValue: diff.oldValue,
      newValue: diff.newValue,
      req,
    });
    await logAction({
      userId: req.user._id,
      action: "ATTACH_VENDOR_TO_MASTER",
      module: "VendorMaster",
      targetDoc: master,
      branch: vendor.branch,
      newValue: { branchVendorId: vendor._id, fieldsChanged: diff.changed },
      req,
    });

    res.json({ vendor, fieldsChanged: diff.changed });
  } catch (err) {
    sendError(res, err, "Failed to attach branch vendor");
  }
};

// ════════════════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════════════════
const MAX_EXPORT_ROWS = 5000;

exports.exportMastersExcel = async (req, res) => {
  try {
    const query = buildMasterQuery(req);
    const total = await VendorMaster.countDocuments(query);
    if (total > MAX_EXPORT_ROWS) {
      return res.status(400).json({
        message: `${total} vendor masters match — narrow the filters (max ${MAX_EXPORT_ROWS} per export).`,
      });
    }

    const masters = await VendorMaster.find(query)
      .select("-documents")
      .populate("createdBy", "name")
      .populate("approvedBy", "name")
      .sort({ vendorName: 1 })
      .lean();

    // Requirement 8 in the export: which branches use each master.
    const links = await Vendor.find({
      vendorMaster: { $in: masters.map((m) => m._id) },
    })
      .select("vendorMaster branch approvalStatus")
      .populate("branch", "name code")
      .lean();
    const branchesByMaster = {};
    for (const l of links) {
      const k = String(l.vendorMaster);
      (branchesByMaster[k] = branchesByMaster[k] || []).push(
        `${l.branch?.name || "?"}${l.approvalStatus !== "approved" ? ` (${l.approvalStatus.replace("_", " ")})` : ""}`,
      );
    }

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PMS — Healing Hands Clinic";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Vendor Master", {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true },
    });

    const COLUMNS = [
      { header: "Vendor Name", key: "vendorName", width: 26 },
      { header: "Company", key: "companyName", width: 22 },
      { header: "PAN", key: "panNumber", width: 14 },
      { header: "Primary GSTIN", key: "gstNumber", width: 18 },
      { header: "All GSTINs (state)", key: "gstins", width: 40 },
      { header: "MSME", key: "msmeNumber", width: 18 },
      { header: "Vendor Type", key: "vendorType", width: 12 },
      { header: "Default Category", key: "vendorCategory", width: 20 },
      { header: "Contact Person", key: "contactPerson", width: 18 },
      { header: "Mobile", key: "mobile", width: 14 },
      { header: "Email", key: "email", width: 24 },
      { header: "Business Address", key: "businessAddress", width: 34 },
      { header: "Account Holder", key: "accountHolderName", width: 22 },
      { header: "Bank Name", key: "bankName", width: 18 },
      { header: "Account No.", key: "accountNumber", width: 20 },
      { header: "IFSC", key: "ifscCode", width: 14 },
      { header: "UPI ID", key: "upiId", width: 20 },
      { header: "Approval Status", key: "approvalStatus", width: 16 },
      { header: "Status", key: "status", width: 12 },
      { header: "Linked Branches", key: "linkedCount", width: 10 },
      { header: "Branches", key: "branches", width: 40 },
      { header: "Created By", key: "createdBy", width: 18 },
      { header: "Created On", key: "createdAt", width: 14 },
      { header: "Approved By", key: "approvedBy", width: 18 },
      { header: "Approved On", key: "approvedAt", width: 14 },
    ];
    sheet.columns = COLUMNS.map(({ key, width }) => ({ key, width }));
    const lastCol = sheet.getColumn(COLUMNS.length).letter;
    const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

    sheet.mergeCells(`A1:${lastCol}1`);
    const title = sheet.getCell("A1");
    title.value = "HEALING HANDS CLINIC — VENDOR MASTER (GROUP)";
    title.font = { bold: true, size: 14, color: { argb: "FF1A3C6E" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;

    sheet.mergeCells(`A2:${lastCol}2`);
    const sub = sheet.getCell("A2");
    sub.value = `${masters.length} vendor master(s)  |  Exported ${new Date().toLocaleString(
      "en-GB",
    )} by ${req.user.name || req.user.email}`;
    sub.font = { size: 10, color: { argb: "FF6B7280" } };
    sub.alignment = { horizontal: "center" };
    sheet.addRow([]);

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

    masters.forEach((m, i) => {
      const branches = branchesByMaster[String(m._id)] || [];
      const row = sheet.addRow({
        vendorName: m.vendorName || "—",
        companyName: m.companyName || "—",
        panNumber: m.panNumber || "—",
        gstNumber: m.gstNumber || "—",
        gstins:
          (m.gstins || [])
            .map(
              (g) =>
                `${g.gstNumber} (${GST_STATE_CODES[g.stateCode] || g.stateCode})`,
            )
            .join(", ") || "—",
        msmeNumber: m.msmeNumber || "—",
        vendorType: m.vendorType || "standard",
        vendorCategory: m.vendorCategory || "—",
        contactPerson: m.contactPerson || "—",
        mobile: m.mobile || "—",
        email: m.email || "—",
        businessAddress: m.businessAddress || "—",
        accountHolderName: m.accountHolderName || "—",
        bankName: m.bankName || "—",
        accountNumber: m.accountNumber || "—",
        ifscCode: m.ifscCode || "—",
        upiId: m.upiId || "—",
        approvalStatus: (m.approvalStatus || "").replace("_", " "),
        status: m.status || "—",
        linkedCount: branches.length,
        branches: branches.join(", ") || "—",
        createdBy: m.createdBy?.name || "—",
        createdAt: fmtDate(m.createdAt),
        approvedBy: m.approvedBy?.name || "—",
        approvedAt: fmtDate(m.approvedAt),
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
      to: { row: headerRowNum + masters.length, column: COLUMNS.length },
    };
    sheet.views = [{ state: "frozen", ySplit: headerRowNum }];

    await logAction({
      userId: req.user._id,
      action: "EXPORT_VENDOR_MASTER_EXCEL",
      module: "VendorMaster",
      newValue: { count: masters.length, filters: req.query },
      req,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Vendor_Master_${stamp}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Vendor master Excel export error:", err);
    if (res.headersSent) return res.destroy();
    res
      .status(500)
      .json({ message: "Failed to generate vendor master export" });
  }
};
