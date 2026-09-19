// ============================================================
// BACKEND: src/routes/vendorMasters.js  —  NEW FILE
// Mounted in app.js at /api/vendor-masters
// ============================================================
const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/vendorMasterController");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

const { SUPER_ADMIN, ACCOUNTS, BRANCH_USER, CLUSTER_HEAD, DIRECTOR } = ROLES;

// The PAN lookup tells any logged-in user whether a PAN is one of the
// group's vendors. Keyed per user (not per IP — the whole clinic can
// share one IP), 60 lookups per 15 minutes is far above genuine use.
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => `pan-lookup:${req.user._id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many PAN lookups. Please try again in a few minutes." },
});

// ── Static paths FIRST ────────────────────────────────────
// "/lookup" and "/export/excel" would otherwise be swallowed by "/:id".
// Same trap that hid the vendor Excel export and the duplicate report.
router.get("/lookup", lookupLimiter, ctrl.lookupByPan);
router.get(
  "/export/excel",
  roleGuard(ACCOUNTS, SUPER_ADMIN),
  ctrl.exportMastersExcel,
);
router.get(
  "/",
  roleGuard(ACCOUNTS, SUPER_ADMIN, CLUSTER_HEAD, DIRECTOR),
  ctrl.getMasters,
);
router.post(
  "/",
  roleGuard(BRANCH_USER, ACCOUNTS, SUPER_ADMIN),
  ctrl.createMaster,
);

// ── Param routes ──────────────────────────────────────────
// Detail is open to any authenticated role; the controller masks it for
// branch users whose branches do not use this vendor.
router.get("/:id", ctrl.getMasterById);
router.get(
  "/:id/branches",
  roleGuard(ACCOUNTS, SUPER_ADMIN, CLUSTER_HEAD, DIRECTOR),
  ctrl.getMasterBranches,
);

// Requirement 6: only super admin and the accounts team edit the master.
// BRANCH_USER passes the guard only so the controller can let the creator
// fix their own DRAFT / REJECTED record; everything else is refused there.
router.put(
  "/:id",
  roleGuard(BRANCH_USER, ACCOUNTS, SUPER_ADMIN),
  ctrl.updateMaster,
);

router.patch(
  "/:id/submit",
  roleGuard(BRANCH_USER, ACCOUNTS, SUPER_ADMIN),
  ctrl.submitMaster,
);
router.patch(
  "/:id/approve",
  roleGuard(ACCOUNTS, SUPER_ADMIN),
  ctrl.approveMaster,
);
router.patch(
  "/:id/reject",
  roleGuard(ACCOUNTS, SUPER_ADMIN),
  ctrl.rejectMaster,
);
router.patch(
  "/:id/status",
  roleGuard(ACCOUNTS, SUPER_ADMIN),
  ctrl.updateMasterStatus,
);

// Requirement 4: "Add this vendor to my branch".
router.post(
  "/:id/link",
  roleGuard(BRANCH_USER, ACCOUNTS, SUPER_ADMIN),
  ctrl.linkMaster,
);
router.post(
  "/:id/attach",
  roleGuard(ACCOUNTS, SUPER_ADMIN),
  ctrl.attachLocalVendor,
);

module.exports = router;
