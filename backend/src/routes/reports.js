// ============================================================
// BACKEND: src/routes/reports.js — REPLACE THE WHOLE FILE
// ------------------------------------------------------------
// Every existing route is unchanged. Four new PRIMARY report routes
// are appended below the existing block.
// Vendor analysis (vendor-wise / branch-wise payments): two routes
// appended at the end — /vendors and /vendors/detail.
// ============================================================
const router = require("express").Router();
const ctrl = require("../controllers/reportController");
const primary = require("../controllers/primaryReportController"); // ← NEW
const subtype = require("../controllers/expenseSubtypeController"); // ← NEW
const audit = require("../controllers/auditController"); // ← NEW
const vendorReport = require("../controllers/vendorReportController"); // ← Vendor analysis
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.use(authenticate);

// ── SECONDARY reports (existing — unchanged) ───────────────

// ✅ Dashboard stats — all roles
router.get("/dashboard-stats", ctrl.getDashboardStats);

// ✅ Financial report — all roles (controller filters by branch for branch roles)
router.get("/financial", ctrl.getFinancialReport);

// ✅ Excel exports — accounts and super_admin only
router.get(
  "/financial/export-excel",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.exportFinancialExcel,
);
// ── Audit trail (new controller; paths unchanged) ──────────
// Static paths first — "/audit-logs/filters" must not be read as a
// wildcard segment by a later route.
router.get(
  "/audit-logs/filters",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  audit.getAuditFilters,
);
router.get(
  "/audit-logs/trail",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  audit.getAuditTrail,
);
router.get(
  "/audit-logs/export-excel",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  audit.exportAuditExcel,
);

// ✅ Audit logs — accounts and super_admin only
router.get(
  "/audit-logs",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  audit.getAuditLogs,
);

// ── PRIMARY reports (new) ──────────────────────────────────
// Director and cluster_head are included: these are the roles that
// actually chase stuck approvals. Branch scoping is applied inside
// the controller, so a cluster head sees only their own branches.
const PRIMARY_REPORT_ROLES = [
  ROLES.ACCOUNTS,
  ROLES.SUPER_ADMIN,
  ROLES.DIRECTOR,
  ROLES.CLUSTER_HEAD,
];

router.get(
  "/filters",
  roleGuard(...PRIMARY_REPORT_ROLES),
  primary.getReportFilterOptions,
);

router.get(
  "/invoice-delays",
  roleGuard(...PRIMARY_REPORT_ROLES),
  primary.getInvoiceDelayReport,
);

router.get(
  "/payment-delays",
  roleGuard(...PRIMARY_REPORT_ROLES),
  primary.getPaymentDelayReport,
);

router.get(
  "/expense-analysis",
  roleGuard(...PRIMARY_REPORT_ROLES),
  primary.getExpenseAnalysisReport,
);

// ── Subtype report (accounts / audit) ──────────────────────
// The static path must be declared before the :categoryId route,
// or "export-excel" would be read as a category id.
router.get(
  "/expense-subtypes/export-excel",
  roleGuard(...PRIMARY_REPORT_ROLES),
  subtype.exportSubtypeExcel,
);
router.get(
  "/expense-subtypes",
  roleGuard(...PRIMARY_REPORT_ROLES),
  subtype.getSubtypeReport,
);
router.get(
  "/expense-subtypes/:categoryId/invoices",
  roleGuard(...PRIMARY_REPORT_ROLES),
  subtype.getSubtypeInvoices,
);

// ── Vendor analysis (management + accounts) ────────────────
// Static "/vendors/detail" first, so it is never read as a parameter.
router.get(
  "/vendors/detail",
  roleGuard(...PRIMARY_REPORT_ROLES),
  vendorReport.getVendorDetail,
);
router.get(
  "/vendors",
  roleGuard(...PRIMARY_REPORT_ROLES),
  vendorReport.getVendorReport,
);

module.exports = router;
