const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
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

module.exports = router;
