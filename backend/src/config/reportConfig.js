// ============================================================
// BACKEND: src/config/reportConfig.js  — NEW FILE
// ------------------------------------------------------------
// Config for the PRIMARY reports. Nothing here changes existing
// behaviour: it is read-only metadata used by
// controllers/primaryReportController.js.
// ============================================================

// All aggregation date bucketing runs in IST. Without this Mongo
// buckets in UTC and every invoice created after 6:30 PM IST lands
// in the wrong day / month.
const REPORT_TZ = "Asia/Kolkata";

// Invoice approval stages, in workflow order.
// `key` matches SLATracking.stage exactly (written by slaService.js).
const INVOICE_STAGE_META = [
  { key: "partner", label: "Partner Approval" },
  { key: "accounts", label: "Accounts Approval" },
  { key: "cluster_head", label: "Cluster Head Approval" },
];

// Payment stages, derived from raw timestamps (no SLATracking rows
// exist for these yet). `hours` is the fallback threshold used when
// no matching SLAConfig document is present — the controller prefers
// SLAConfig when one exists, so these become editable from the SLA
// screen the moment someone creates the configs.
const PAYMENT_STAGE_META = [
  {
    key: "payment_raise",
    label: "Raise Payment",
    hours: 72,
    help: "Cluster Head approval to payment raised",
  },
  {
    key: "payment_approval",
    label: "Accounts Approval",
    hours: 24,
    help: "Payment raised to accounts approval",
  },
  {
    key: "excel_generation",
    label: "Excel Generation",
    hours: 12,
    help: "Accounts approval to bank file generated",
  },
  {
    key: "utr_recording",
    label: "UTR Recording",
    hours: 48,
    help: "Bank file generated to UTR recorded",
  },
];

// Which field decides Revenue vs Capital.
//   "category" — the ExpenseCategory document's type (consistent, but
//                shows nothing under Capital until Capital categories exist)
//   "invoice"  — the copy stored on the invoice (preserves what the user
//                picked, but a Revenue category can appear under Capital)
const EXPENSE_TYPE_SOURCE = "category";

// Overdue buckets, in hours. Upper bound is exclusive; the final
// bucket is open-ended.
const OVERDUE_BUCKETS = [
  { key: "0-24h", label: "Up to 1 day late", max: 24 },
  { key: "24-72h", label: "1-3 days late", max: 72 },
  { key: "72-168h", label: "3-7 days late", max: 168 },
  { key: "168h+", label: "Over a week late", max: null },
];

// Roles whose reports are limited to their assigned branches.
// NOTE: cluster_head IS included here, matching getDashboardStats().
// The existing reportController.buildReportBranchScope() omits it, so
// cluster heads currently see all branches on /reports but only their
// own on /dashboard. These new endpoints use the stricter, correct
// behaviour. If the client wants cluster heads to keep seeing every
// branch in reports, remove it from this list.
const BRANCH_SCOPED_ROLES = [
  "branch_user",
  "branch_partner",
  "accounts",
  "cluster_head",
  "director",
];

module.exports = {
  REPORT_TZ,
  INVOICE_STAGE_META,
  PAYMENT_STAGE_META,
  OVERDUE_BUCKETS,
  BRANCH_SCOPED_ROLES,
  EXPENSE_TYPE_SOURCE,
};
