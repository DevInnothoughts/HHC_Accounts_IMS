// ============================================================
// BACKEND: routes/users.js
// ============================================================
const router = require("express").Router();
const ctrl = require("../controllers/userController");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.get("/", roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS), ctrl.getUsers);
router.get(
  "/:id",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  ctrl.getUserById,
);
router.post("/", roleGuard(ROLES.SUPER_ADMIN), ctrl.createUser);
router.put("/:id", roleGuard(ROLES.SUPER_ADMIN), ctrl.updateUser);
router.patch(
  "/:id/toggle-status",
  roleGuard(ROLES.SUPER_ADMIN),
  ctrl.toggleUserStatus,
);

module.exports = router;
