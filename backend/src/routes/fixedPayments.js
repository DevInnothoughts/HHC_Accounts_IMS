// ============================================================
// BACKEND: src/routes/fixedPayments.js — NEW FILE
// ============================================================
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const upload = require("../middleware/upload");
const { ROLES } = require("../config/constants");
const ctrl = require("../controllers/fixedPaymentController");

router.use(authenticate);

const VIEW = roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN);
const ACCOUNTS = roleGuard(ROLES.ACCOUNTS);
const ADMIN = roleGuard(ROLES.SUPER_ADMIN);

// Literal paths first — "/:id" would swallow "invoices".
router.patch("/invoices/:invoiceId/amount", ACCOUNTS, ctrl.adjustInvoiceAmount);

router.get("/", VIEW, ctrl.list);
router.post("/", ACCOUNTS, ctrl.create);
router.get("/:id", VIEW, ctrl.getOne);
router.put("/:id", ACCOUNTS, ctrl.update);
// roleGuard before multer so a forbidden caller's file is never buffered.
router.post(
  "/:id/agreement",
  ACCOUNTS,
  upload.single("file"),
  ctrl.uploadAgreement,
);
router.patch("/:id/approve", ADMIN, ctrl.approve);
router.patch("/:id/reject", ADMIN, ctrl.reject);
router.patch("/:id/pause", VIEW, ctrl.pause);
router.patch("/:id/resume", VIEW, ctrl.resume);
router.patch("/:id/end", VIEW, ctrl.end);
router.post("/:id/generate", VIEW, ctrl.generateNow);

module.exports = router;
