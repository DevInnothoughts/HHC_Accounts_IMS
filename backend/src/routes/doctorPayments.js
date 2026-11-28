// ============================================================
// BACKEND: src/routes/doctorPayments.js — NEW FILE
// Mounted at /api/doctor-payments (see app.js)
// ============================================================
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");
const cfg = require("../config/doctorPayoutConfig");
const ctrl = require("../controllers/doctorPaymentController");

router.use(authenticate);

const VIEW = roleGuard(...cfg.VIEW_ROLES);
const PAY = roleGuard(...cfg.PAYMENT_ROLES);
// Same split as vendor payments: Accounts and Super Admin record UTRs,
// only Super Admin corrects one.
const UTR = roleGuard(...cfg.PAYMENT_ROLES, ROLES.SUPER_ADMIN);
const UTR_CORRECT = roleGuard(...cfg.UTR_CORRECT_ROLES);

// Literal paths MUST stay above "/:id".
router.get("/summary", VIEW, ctrl.summary);
router.post("/raise", PAY, ctrl.raise);
router.post("/bank-file", PAY, ctrl.bankFile);
router.patch("/bulk-utr", UTR, ctrl.bulkUtr);

router.get("/", VIEW, ctrl.list);
router.get("/:id", VIEW, ctrl.getOne);
router.patch("/:id/utr", UTR, ctrl.recordUtr);
router.patch("/:id/utr/correct", UTR_CORRECT, ctrl.correctUtr);
router.patch("/:id/cancel", PAY, ctrl.cancel);

module.exports = router;
