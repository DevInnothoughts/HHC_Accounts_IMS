// ============================================================
// BACKEND: src/routes/creditNotes.js — NEW FILE
// ============================================================
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const roleGuard = require("../middleware/roleGaurd");
const upload = require("../middleware/upload");
const { ROLES } = require("../config/constants");
const ctrl = require("../controllers/creditNoteController");

router.use(authenticate);

// Record / preview / cancel own: branch users, Accounts, Super Admin.
const MANAGE = roleGuard(ROLES.BRANCH_USER, ROLES.ACCOUNTS, ROLES.SUPER_ADMIN);
// Approve / reject: Accounts (own branches) and Super Admin.
const APPROVE = roleGuard(ROLES.ACCOUNTS, ROLES.SUPER_ADMIN);

// Read: anyone who can see the invoice (branch-scoped in the controller),
// so the credit notes show on the invoice page for every role.
router.get("/", ctrl.list);
router.post("/preview", MANAGE, ctrl.preview);
// roleGuard before multer so a forbidden caller's file is never buffered.
router.post("/", MANAGE, upload.single("file"), ctrl.create);
router.patch("/:id/approve", APPROVE, ctrl.approve);
router.patch("/:id/reject", APPROVE, ctrl.reject);
router.patch("/:id/cancel", MANAGE, ctrl.cancel);

module.exports = router;
