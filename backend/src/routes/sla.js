const router = require("express").Router();
const ctrl = require("../controllers/slaController");
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.use(authenticate);

// ✅ Accounts, cluster head, partner, super_admin can view SLA dashboard
router.get(
  "/configs",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  ctrl.getSLAConfigs,
);
router.post(
  "/configs",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  ctrl.upsertSLAConfig,
);
router.get(
  "/dashboard",
  roleGuard(
    ROLES.SUPER_ADMIN,
    ROLES.ACCOUNTS,
    ROLES.BRANCH_PARTNER,
    ROLES.CLUSTER_HEAD,
  ),
  ctrl.getSLADashboard,
);
router.get(
  "/invoice/:invoiceId",
  roleGuard(
    ROLES.SUPER_ADMIN,
    ROLES.ACCOUNTS,
    ROLES.BRANCH_PARTNER,
    ROLES.CLUSTER_HEAD,
    ROLES.BRANCH_USER,
  ),
  ctrl.getInvoiceSLAStatus,
);
router.post(
  "/trigger-check",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  ctrl.triggerSLACheck,
);

module.exports = router;
