const router = require("express").Router();
const ctrl = require("../controllers/vendorController");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");
const { authenticate } = require("../middleware/auth");
router.use(authenticate);

// ── Static paths first: anything below "/:id" that is a single
// segment would be swallowed by it. Keep new literal routes here.
router.get("/", ctrl.getVendors);
router.get(
  "/export/excel",
  roleGuard(
    ROLES.BRANCH_USER,
    ROLES.BRANCH_PARTNER,
    ROLES.ACCOUNTS,
    ROLES.CLUSTER_HEAD,
    ROLES.SUPER_ADMIN,
  ),
  ctrl.exportVendorsExcel,
);

// ── Param routes ──────────────────────────────────────────
router.get("/:id", ctrl.getVendorById);

router.post(
  "/",
  roleGuard(ROLES.BRANCH_USER, ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.createVendor,
);
router.put(
  "/:id",
  roleGuard(ROLES.BRANCH_USER, ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.updateVendor,
);
router.delete(
  "/:id",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  ctrl.deleteVendor,
);

router.patch(
  "/:id/submit",
  roleGuard(ROLES.BRANCH_USER, ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.submitVendor,
);
router.patch(
  "/:id/status",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.updateVendorStatus,
);

// ✅ REQ 1: Vendor approval routes — accounts only
router.patch(
  "/:id/approve",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.approveVendor,
);
router.patch(
  "/:id/reject",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.rejectVendor,
);

module.exports = router;
