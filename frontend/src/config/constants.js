// ============================================================
// FRONTEND: src/config/constants.js  —  REPLACE WHOLE FILE
// ============================================================
// Change vs previous version: VENDOR_MASTER, MASTER_OWNED_FIELDS and
// the approval/status label maps appended at the end. Everything above
// is unchanged.
// ============================================================

export const ROLES = {
  SUPER_ADMIN: "super_admin",
  BRANCH_USER: "branch_user",
  BRANCH_PARTNER: "branch_partner",
  CLUSTER_HEAD: "cluster_head",
  ACCOUNTS: "accounts",
  DIRECTOR: "director",
};

export const INVOICE_STATUS = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PARTNER_APPROVED: "Partner Approved",
  ACCOUNTS_APPROVED: "Accounts Approved",
  CLUSTER_APPROVED: "Cluster Head Approved",
  REJECTED: "Rejected",
};

export const PAYMENT_STATUS = {
  PENDING: "Payment Pending",
  RAISED: "Payment Raised",
  ACCOUNTS_APPROVED: "Accounts Approved",
  EXCEL_GENERATED: "Excel Generated",
  PROCESSED: "Payment Processed",
  PARTIALLY_PAID: "Partially Paid",
  FULLY_PAID: "Fully Paid",
  REJECTED: "Payment Rejected",
};

// ✅ New flow: branch submits → partner verifies → accounts approves → cluster head approves
export const INVOICE_WORKFLOW = [
  {
    status: "Submitted",
    actingRole: "branch_partner",
    label: "Partner Verification",
    nextStatus: "Partner Approved",
    nextStage: "accounts",
  },
  {
    status: "Partner Approved",
    actingRole: "accounts",
    label: "Accounts Approval",
    nextStatus: "Accounts Approved",
    nextStage: "cluster_head",
  },
  {
    status: "Accounts Approved",
    actingRole: "cluster_head",
    label: "Cluster Head Approval",
    nextStatus: "Cluster Head Approved",
    nextStage: "completed",
  },
];

// ✅ Progress bar — includes Draft as starting point
export const INVOICE_STAGES = [
  { key: "Draft", label: "Draft" },
  { key: "Submitted", label: "Submitted" },
  { key: "Partner Approved", label: "Partner Verified" },
  { key: "Accounts Approved", label: "Accounts Approved" },
  { key: "Cluster Head Approved", label: "Cluster Approved" },
];

export const PAYMENT_STAGES = [
  { key: "Payment Raised", label: "Payment Raised", role: "branch_user" },
  { key: "Accounts Approved", label: "Accounts Approved", role: "accounts" },
  { key: "Excel Generated", label: "Excel Generated", role: "accounts" },
];

export const PAYMENT_WORKFLOW = [
  { status: "Payment Raised", actingRole: "accounts" },
];

export const VENDOR_TYPES = {
  standard: {
    label: "Standard (bank transfer)",
    requireBank: true,
    requirePAN: true,
    requiredDocs: ["pan", "cheque"],
  },
  statutory: {
    label: "Utility / Tax / Statutory",
    requireBank: false,
    requirePAN: false,
    requiredDocs: [],
  },
};

export const VENDOR_TYPE_OPTIONS = Object.entries(VENDOR_TYPES).map(
  ([value, cfg]) => ({ value, label: cfg.label }),
);

// ── VENDOR MASTER ──────────────────────────────────────────
// Mirrors backend/src/config/constants.js. Keep the two in step.
export const VENDOR_MASTER = {
  // true = linking to an already-approved master needs no accounts approval.
  // Used by the UI only to decide what to TELL the user after linking —
  // the backend is the one that actually decides the row's status.
  autoApproveLinkToApprovedMaster: true,

  PAN_REGEX: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  IFSC_REGEX: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  GST_REGEX: /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Z][A-Z\d]$/,
};

// GSTIN is NOT in this list: it is kept per branch (GST registration is
// per state). The master holds a primary GSTIN and the full list.
// Fields owned by the master. The branch vendor form renders these
// read-only when the row is master-linked and the user is not
// accounts / super_admin (requirement 6).
export const MASTER_OWNED_FIELDS = [
  "vendorName",
  "contactPerson",
  "mobile",
  "email",
  "companyName",
  "panNumber",
  "msmeNumber",
  "businessAddress",
  "vendorType",
  "accountHolderName",
  "bankName",
  "accountNumber",
  "ifscCode",
  "upiId",
];

// GSTIN characters 1–2 = state code.
export const GST_STATE_CODES = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  10: "Bihar",
  11: "Sikkim",
  12: "Arunachal Pradesh",
  13: "Nagaland",
  14: "Manipur",
  15: "Mizoram",
  16: "Tripura",
  17: "Meghalaya",
  18: "Assam",
  19: "West Bengal",
  20: "Jharkhand",
  21: "Odisha",
  22: "Chhattisgarh",
  23: "Madhya Pradesh",
  24: "Gujarat",
  26: "Dadra & Nagar Haveli and Daman & Diu",
  27: "Maharashtra",
  29: "Karnataka",
  30: "Goa",
  31: "Lakshadweep",
  32: "Kerala",
  33: "Tamil Nadu",
  34: "Puducherry",
  35: "Andaman & Nicobar Islands",
  36: "Telangana",
  37: "Andhra Pradesh",
  38: "Ladakh",
  97: "Other Territory",
};

export const gstState = (gstin) =>
  GST_STATE_CODES[String(gstin || "").slice(0, 2)] || "";

// A GSTIN belongs to a PAN when characters 3–12 are that PAN.
export const gstMatchesPan = (gstin, pan) =>
  String(gstin || "")
    .toUpperCase()
    .slice(2, 12) === String(pan || "").toUpperCase();

// Shared badge vocabulary, so Vendors.jsx, VendorDetail.jsx,
// VendorMasters.jsx and VendorMasterDetail.jsx cannot drift apart.
export const APPROVAL_STATUS_STYLES = {
  draft: { bg: "#f8fafc", color: "#64748b", label: "Draft" },
  pending_approval: {
    bg: "#fffbeb",
    color: "#d97706",
    label: "\u23f3 Pending",
  },
  approved: { bg: "#f0fdf4", color: "#16a34a", label: "\u2713 Approved" },
  rejected: { bg: "#fef2f2", color: "#dc2626", label: "\u2717 Rejected" },
};

export const VENDOR_STATUS_STYLES = {
  active: { bg: "#f0fdf4", color: "#16a34a", label: "Active" },
  inactive: { bg: "#f8fafc", color: "#64748b", label: "Inactive" },
  blacklisted: { bg: "#fef2f2", color: "#dc2626", label: "Blacklisted" },
  frozen: { bg: "#eff6ff", color: "#2563eb", label: "Frozen" },
};
