const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");
const upload = require("../middleware/upload");
const ctrl = require("../controllers/uploadController");

router.use(authenticate);

// Payment request attachments
router.post(
  "/payment/:id/attachment",
  upload.single("file"),
  ctrl.uploadPaymentAttachment,
);
router.delete(
  "/payment/:id/attachment/:attachmentId",
  ctrl.deletePaymentAttachment,
);

// Vendor documents
router.post(
  "/vendor/:id/document",
  upload.single("file"),
  ctrl.uploadVendorDocument,
);
router.delete("/vendor/:id/document/:docType", ctrl.deleteVendorDocument);

// Parse cheque using Google Vision
router.post(
  "/parse-cheque",
  roleGuard(ROLES.BRANCH_USER, ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  upload.single("file"),
  ctrl.parseCheque,
);

module.exports = router;
