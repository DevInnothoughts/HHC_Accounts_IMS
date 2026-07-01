module.exports = {
  ROLES: {
    SUPER_ADMIN: "super_admin",
    BRANCH_USER: "branch_user",
    BRANCH_PARTNER: "branch_partner",
    CLUSTER_HEAD: "cluster_head",
    ACCOUNTS: "accounts",
    DIRECTOR: "director",
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
};
