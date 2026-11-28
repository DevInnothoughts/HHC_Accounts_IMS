// ============================================================
// BACKEND: src/routes/doctors.js — NEW FILE
// Mounted at /api/doctors (see app.js)
// ============================================================
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const uploadExcel = require("../middleware/uploadExcel");
const uploadDoctorDocument = require("../middleware/uploadDoctorDocument");
const cfg = require("../config/doctorPayoutConfig");
const ctrl = require("../controllers/doctorController");

router.use(authenticate);

const VIEW = roleGuard(...cfg.VIEW_ROLES);
const EDIT = roleGuard(...cfg.DOCTOR_ADMIN_ROLES);

// Literal paths MUST stay above "/:id".
router.get("/import/template", EDIT, ctrl.importTemplate);
// roleGuard before multer, so a forbidden caller's file is never buffered.
router.post("/import", EDIT, uploadExcel("file"), ctrl.importList);

router.get("/", VIEW, ctrl.list);
router.post("/", EDIT, ctrl.create);
router.get("/:id", VIEW, ctrl.getOne);
router.put("/:id", EDIT, ctrl.update);

// Documents — private store; viewed only through this authenticated route.
router.post(
  "/:id/documents",
  EDIT,
  uploadDoctorDocument("file"),
  ctrl.uploadDocument,
);
router.get("/:id/documents/:docId", VIEW, ctrl.viewDocument);
router.delete("/:id/documents/:docId", EDIT, ctrl.removeDocument);

module.exports = router;
