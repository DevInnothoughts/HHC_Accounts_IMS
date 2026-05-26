// ============================================================
// BACKEND: routes/branches.js (updated)
// ============================================================
const router = require("express").Router();
const ctrl = require("../controllers/branchController");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.get("/", ctrl.getBranches);
router.post("/", roleGuard(ROLES.SUPER_ADMIN), ctrl.createBranch);
router.put("/:id", roleGuard(ROLES.SUPER_ADMIN), ctrl.updateBranch);
router.patch(
  "/:id/toggle-status",
  roleGuard(ROLES.SUPER_ADMIN),
  ctrl.toggleBranchStatus,
);

module.exports = router;
