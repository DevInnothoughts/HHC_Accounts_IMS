const router = require("express").Router();
const ctrl = require("../controllers/vendorController");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.get("/", ctrl.getVendors);
router.get("/:id", ctrl.getVendorById);
router.post(
  "/",
  roleGuard(ROLES.BRANCH_USER, ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.createVendor,
);

router.patch(
  "/:id/submit",
  roleGuard(ROLES.BRANCH_USER, ROLES.SUPER_ADMIN),
  ctrl.submitVendor,
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
