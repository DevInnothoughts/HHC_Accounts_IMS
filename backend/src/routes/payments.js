const router = require("express").Router();
const ctrl = require("../controllers/paymentProcessingController");
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.use(authenticate);

router.get("/approved-invoices", ctrl.getApprovedInvoicesForPayment);
// Literal paths MUST stay above "/:id" — Express matches in order, and a
// dynamic segment will happily swallow "awaiting-utr" and try to cast it
// to an ObjectId. (Same trap that hid the /export/excel vendor route.)
router.get(
  "/awaiting-utr",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.getPaymentsAwaitingUTR,
);
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

router.post(
  "/:id/fedone-excel",
  roleGuard(ROLES.ACCOUNTS),
  ctrl.generateFedOneExcel,
);
router.post(
  "/bulk-fedone-excel",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.bulkGenerateFedOneExcel,
);
// e-Net "Master Vendor Payment" bank sheet — same rules as FedOne.
router.post(
  "/:id/enet-excel",
  roleGuard(ROLES.ACCOUNTS),
  ctrl.generateEnetExcel,
);
router.post(
  "/bulk-enet-excel",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.bulkGenerateEnetExcel,
);
// Invoice attachments, once the payment Excel exists. Read-only.
router.post(
  "/bulk-documents",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.bulkDownloadPaymentDocuments,
);
router.get(
  "/:id/documents",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.downloadPaymentDocuments,
);
// Bulk first, for the same ordering reason as above.
router.patch(
  "/bulk-utr",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.bulkRecordUTR,
);

router.patch(
  "/:id/utr",
  roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.recordUTR,
);
// Correct a wrongly entered UTR. Super admin only — Accounts records UTRs
// but cannot change one once it is on the record.
router.patch(
  "/:id/utr/correct",
  roleGuard(ROLES.SUPER_ADMIN),
  ctrl.correctUTR,
);

module.exports = router;
