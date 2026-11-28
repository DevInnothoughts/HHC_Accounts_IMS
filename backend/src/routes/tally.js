// ============================================================
// BACKEND: src/routes/tally.js — NEW FILE (Nov 2026)
// TallyPrime import file — Accounts and Super Admin only.
// ============================================================
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");
const ctrl = require("../controllers/tallyExportController");

router.use(authenticate);
const TALLY_ROLES = roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN);

router.get("/preview", TALLY_ROLES, ctrl.preview);
router.post("/export", TALLY_ROLES, ctrl.exportExcel);

// Doctor payments (Nov 2026) — separate option, same layout and roles.
const doctorCtrl = require("../controllers/doctorTallyController");
router.get("/doctors/preview", TALLY_ROLES, doctorCtrl.preview);
router.post("/doctors/export", TALLY_ROLES, doctorCtrl.exportExcel);

module.exports = router;
