const router = require("express").Router();
const ctrl = require("../controllers/paymentProcessingController");
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.use(authenticate);

router.get("/approved-invoices", ctrl.getApprovedInvoicesForPayment);
router.get("/", ctrl.getPayments);
router.get("/:id", ctrl.getPaymentById);
router.post("/raise/:invoiceId", roleGuard(ROLES.ACCOUNTS), ctrl.raisePayment);
router.patch("/:id/approve", roleGuard(ROLES.ACCOUNTS), ctrl.approvePayment);
router.patch("/:id/reject", roleGuard(ROLES.ACCOUNTS), ctrl.rejectPayment);
router.post(
  "/:id/generate-excel",
  roleGuard(ROLES.ACCOUNTS),
  ctrl.generateExcel,
);
router.post(
  "/bulk-excel",
  require("../middleware/auth").authenticate,
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.bulkGenerateExcel,
);

router.patch(
  "/:id/utr",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.recordUTR,
);

module.exports = router;
