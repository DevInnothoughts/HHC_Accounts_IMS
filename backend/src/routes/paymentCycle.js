// ============================================================
// BACKEND: src/routes/paymentCycle.js — NEW FILE
// ============================================================
const router = require("express").Router();
const ctrl = require("../controllers/paymentCycleController");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// No roleGuard: the cycle calendar is identical for every role and
// carries no branch, vendor or financial data.
router.get("/current", ctrl.getCurrentCycle);

module.exports = router;
