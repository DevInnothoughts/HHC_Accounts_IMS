// ============================================================
// BACKEND: routes/budget.js
// ============================================================
const router = require("express").Router();
const ctrl = require("../controllers/budgetController");
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.use(authenticate);

router.get("/", ctrl.getBudgets);
router.post(
  "/",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  ctrl.createBudget,
);
router.put(
  "/:id",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  ctrl.updateBudget,
);
router.post("/check", ctrl.checkBudget);
router.get("/branch/:branchId/summary", ctrl.getBranchBudgetSummary);
router.post(
  "/:budgetId/recalculate",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  ctrl.recalculateBudgetUtilization,
);

module.exports = router;
