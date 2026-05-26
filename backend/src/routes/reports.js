const router = require("express").Router();
const ctrl = require("../controllers/reportController");
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.use(authenticate);

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
router.get(
  "/audit-logs/export-excel",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.exportAuditExcel,
);

// ✅ Audit logs — accounts and super_admin only
router.get(
  "/audit-logs",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.getAuditLogs,
);

module.exports = router;
