// ============================================================
// BACKEND: src/utils/vendorAccess.js  —  NEW FILE
// ============================================================
// One place for "who may see / touch which vendor". Before this file
// the same branch-scoping rule was copy-pasted into buildVendorQuery
// and getVendorById, and missing entirely from updateVendor, the
// approve/reject handlers and the document upload endpoints.
// ============================================================
const { ROLES } = require("../config/constants");

// Roles whose vendor visibility is limited to their assigned branches.
// Identical to the list vendorController.buildVendorQuery has always used.
const BRANCH_SCOPED_ROLES = [
  ROLES.BRANCH_USER,
  ROLES.BRANCH_PARTNER,
  ROLES.ACCOUNTS,
];

// Requirement 6 — only these roles may edit master vendor details.
const MASTER_ADMIN_ROLES = [ROLES.ACCOUNTS, ROLES.SUPER_ADMIN];

// Roles that see a master unmasked even when none of their branches
// is linked to it (bank account, documents, contact details).
const MASTER_FULL_VIEW_ROLES = [
  ROLES.ACCOUNTS,
  ROLES.SUPER_ADMIN,
  ROLES.CLUSTER_HEAD,
  ROLES.DIRECTOR,
];

const idStr = (v) => {
  const id = v && v._id ? v._id : v;
  return id == null ? "" : String(id);
};

const userBranchIds = (req) => (req.user?.branches || []).map(idStr);

const isBranchScoped = (req) => BRANCH_SCOPED_ROLES.includes(req.user?.role);

const canAccessBranch = (req, branchId) =>
  !isBranchScoped(req) || userBranchIds(req).includes(idStr(branchId));

const canAccessVendor = (req, vendor) =>
  Boolean(vendor) && canAccessBranch(req, vendor.branch);

const isMasterAdmin = (req) => MASTER_ADMIN_ROLES.includes(req.user?.role);

const hasFullMasterView = (req) =>
  MASTER_FULL_VIEW_ROLES.includes(req.user?.role);

// Vendor Master scope (client decision, 19 Sep 2026): masters are GROUP-WIDE
// for accounts and super_admin, irrespective of assigned branches. Anything
// done through the Vendor Master — link, attach, create-with-branch, the
// linked-branches view — is open to them for every branch. Branch-level
// vendor screens (vendorController) keep the per-branch rule.
const canAccessBranchForMaster = (req, branchId) =>
  isMasterAdmin(req) || canAccessBranch(req, branchId);

// Branch-scoped for master purposes: branch_user / branch_partner only.
const isMasterScoped = (req) => isBranchScoped(req) && !isMasterAdmin(req);

const isSameUser = (a, b) => Boolean(a) && Boolean(b) && idStr(a) === idStr(b);

// Query-string values can arrive as objects (?status[$ne]=x is parsed by
// qs into { $ne: "x" }), which would be passed straight into a Mongo
// filter. Every query value used in a filter goes through this.
const qstr = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

module.exports = {
  BRANCH_SCOPED_ROLES,
  MASTER_ADMIN_ROLES,
  MASTER_FULL_VIEW_ROLES,
  idStr,
  userBranchIds,
  isBranchScoped,
  canAccessBranch,
  canAccessVendor,
  isMasterAdmin,
  hasFullMasterView,
  canAccessBranchForMaster,
  isMasterScoped,
  isSameUser,
  qstr,
};
