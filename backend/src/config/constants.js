// ============================================================
// BACKEND: src/config/constants.js  —  REPLACE WHOLE FILE
// ============================================================
// Change vs previous version: VENDOR_MASTER, MASTER_OWNED_FIELDS and
// GST_STATE_CODES appended at the end. Everything above them is unchanged.
// Revision 19 Sep: gstNumber is BRANCH-level (one GSTIN per state), not
// master-owned; the master keeps a primary GSTIN plus the full list.
// ============================================================

module.exports = {
  ROLES: {
    SUPER_ADMIN: "super_admin",
    BRANCH_USER: "branch_user",
    BRANCH_PARTNER: "branch_partner",
    CLUSTER_HEAD: "cluster_head",
    ACCOUNTS: "accounts",
    DIRECTOR: "director",
  },

  // ── Designations (display labels only) ───────────────────
  // "Department Head" is a Cluster Head under another title: the role
  // stored on the user stays "cluster_head", so every permission, approval
  // step, branch scope and notification is identical. Only the label shown
  // in the UI and audit trail differs. No designation = "Cluster Head".
  DESIGNATIONS: {
    CLUSTER_HEAD: "Cluster Head",
    DEPARTMENT_HEAD: "Department Head",
  },

  // ── Invoice Processing Statuses ──────────────────────────
  INVOICE_STATUS: {
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    PARTNER_APPROVED: "Partner Approved",
    ACCOUNTS_APPROVED: "Accounts Approved",
    CLUSTER_APPROVED: "Cluster Head Approved",
    REJECTED: "Rejected",
  },

  // ── Payment Processing Statuses ──────────────────────────
  PAYMENT_STATUS: {
    PENDING: "Payment Pending",
    RAISED: "Payment Raised",
    ACCOUNTS_APPROVED: "Accounts Approved",
    EXCEL_GENERATED: "Excel Generated",
    PROCESSED: "Payment Processed",
    PARTIALLY_PAID: "Partially Paid",
    FULLY_PAID: "Fully Paid",
    REJECTED: "Payment Rejected",
    CLOSED_BY_CREDIT_NOTE: "Closed by Credit Note",
  },

  INVOICE_WORKFLOW: [
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
  ],

  INVOICE_STAGES: [
    { key: "Draft", label: "Draft" },
    { key: "Submitted", label: "Submitted" },
    { key: "Partner Approved", label: "Partner Verified" },
    { key: "Accounts Approved", label: "Accounts Approved" },
    { key: "Cluster Head Approved", label: "Cluster Approved" },
  ],

  // ── Payment Workflow ─────────────────────────────────────
  PAYMENT_WORKFLOW: [
    {
      status: "Payment Raised",
      actingRole: "accounts",
      label: "Accounts Final Approval",
      nextStatus: "Accounts Approved",
      nextStage: "excel",
    },
  ],

  PRIORITY: {
    NORMAL: "Normal",
    URGENT: "Urgent",
    CRITICAL: "Critical",
  },

  EXPENSE_TYPES: {
    REVENUE: "Revenue",
    CAPITAL: "Capital",
  },

  VENDOR_CATEGORIES: [
    "Service Vendors",
    "Equipment Vendors",
    "Utility Vendors",
    "Consultant Vendors",
    "Medical Suppliers",
    "Miscellaneous Vendors",
  ],

  OTP_EXPIRY_MINUTES: 5,
  OTP_MAX_ATTEMPTS: 5,
  VENDOR_TYPES: {
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
  },

  // ── VENDOR MASTER ────────────────────────────────────────
  // Behaviour flags for the PAN-keyed VendorMaster collection.
  VENDOR_MASTER: {
    // true  = linking a branch to an ALREADY-APPROVED master creates the
    //         branch Vendor row as "approved" straight away. The KYC review
    //         that matters happened once, at master level.
    // false = every branch link waits in the accounts queue (the stricter
    //         reading of requirement 7).
    // A brand-new PAN ALWAYS goes to accounts for approval either way.
    autoApproveLinkToApprovedMaster: true,

    // Folder under uploads/ where master KYC documents are stored once.
    // Branch rows with sourceOfTruth === "master" hold no files of their own.
    documentFolder: "vendor-masters",

    // Document types a master must carry before it can be submitted.
    // "gst" is appended at runtime when the master has a GST number,
    // mirroring the existing rule in vendorController.submitVendor.
    requiredDocsByType: {
      standard: ["pan", "cheque"],
      statutory: [],
    },

    // Canonical identity-key formats. Kept here so lookup, create and the
    // backfill script can never disagree about what a valid PAN looks like.
    PAN_REGEX: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    IFSC_REGEX: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    GST_REGEX: /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Z][A-Z\d]$/,
  },

  // Fields each BRANCH vendor keeps for itself even when it is linked to a
  // master. The sync never overwrites them.
  //   vendorCategory — each branch may classify the vendor differently
  //   gstNumber      — GST is registered per STATE: one PAN can hold a
  //                    Maharashtra GSTIN (27…) for Pune and a Gujarat GSTIN
  //                    (24…) for Ahmedabad. Overwriting it would put the
  //                    wrong GSTIN on a branch's input-tax-credit records.
  // The master keeps a primary GSTIN plus the list of every GSTIN its
  // branches use (VendorMaster.gstins), for reporting.
  BRANCH_LEVEL_FIELDS: ["vendorCategory", "gstNumber"],

  // GSTIN characters 1–2 = state code.
  GST_STATE_CODES: {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam",
  "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
  "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory",
},

  // Fields a VendorMaster owns outright. On the branch Vendor row these are
  // a synced COPY: written when the branch links to the master, and rewritten
  // across every linked row whenever the master is edited.
  //
  // Two consumers, and both matter:
  //   1. syncMasterToBranchVendors() builds its $set from this list.
  //   2. updateVendor() strips these keys from req.body when the row is
  //      master-owned and the caller is not accounts/super_admin (req 6).
  //
  // vendorCategory and gstNumber are deliberately ABSENT — see
  // BRANCH_LEVEL_FIELDS above.
  MASTER_OWNED_FIELDS: [
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
  ],
};
