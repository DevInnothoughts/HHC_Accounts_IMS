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
