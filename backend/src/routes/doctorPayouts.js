// ============================================================
// BACKEND: src/routes/doctorPayouts.js — NEW FILE
// Mounted at /api/doctor-payouts (see app.js)
// ============================================================
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const uploadExcel = require("../middleware/uploadExcel");
const { ROLES } = require("../config/constants");
const cfg = require("../config/doctorPayoutConfig");
const ctrl = require("../controllers/doctorPayoutController");

router.use(authenticate);

const VIEW = roleGuard(...cfg.VIEW_ROLES);
const UPLOAD = roleGuard(...cfg.UPLOAD_ROLES);
const APPROVE = roleGuard(...cfg.APPROVER_ROLES);
// The uploader, or Super Admin, may withdraw an unreviewed upload.
const WITHDRAW = roleGuard(...cfg.UPLOAD_ROLES, ROLES.SUPER_ADMIN);

// Literal paths first — keep them above anything with ":id".
router.get("/template", VIEW, ctrl.downloadTemplate);
// roleGuard before multer, so a forbidden caller's file is never buffered.
router.post("/preview", UPLOAD, uploadExcel("file"), ctrl.preview);

router.get("/batches", VIEW, ctrl.listBatches);
router.post("/batches", UPLOAD, uploadExcel("file"), ctrl.submit);
router.get("/batches/:id", VIEW, ctrl.getBatch);
router.patch("/batches/:id/approve", APPROVE, ctrl.approve);
router.patch("/batches/:id/reject", APPROVE, ctrl.reject);
router.patch("/batches/:id/withdraw", WITHDRAW, ctrl.withdraw);

// Row list (the "to raise" tab of Doctor Payments reads status=approved).
router.get("/", VIEW, ctrl.listRows);

module.exports = router;
