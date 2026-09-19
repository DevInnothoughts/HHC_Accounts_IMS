// ============================================================
// BACKEND: routes/invoices.js  —  REPLACE WHOLE FILE (Vendor Master, Phase 5)
// ------------------------------------------------------------
//  • /duplicate-report moved ABOVE "/:id". It was registered after it, so
//    "duplicate-report" was treated as an invoice id and the report was
//    unreachable. Now role-guarded and branch-scoped.
//  • /check-duplicate: the caller must have access to the branch it asks
//    about (it reveals invoice numbers and amounts).
// ============================================================
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const {
  checkDuplicateInvoice,
  getDuplicateReport,
} = require("../services/duplicateInvoiceService");
const ctrl = require("../controllers/invoiceController");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");
const access = require("../utils/vendorAccess");
const mongoose = require("mongoose");

router.use(authenticate);

// Invoice visibility scope — the same role list getInvoices uses. Wider than
// the VENDOR scope in utils/vendorAccess: cluster heads see invoices of
// their assigned branches only.
const INVOICE_SCOPED_ROLES = [
  ROLES.BRANCH_USER,
  ROLES.BRANCH_PARTNER,
  ROLES.ACCOUNTS,
  ROLES.CLUSTER_HEAD,
];
const invoiceScoped = (req) => INVOICE_SCOPED_ROLES.includes(req.user?.role);
const canSeeBranchInvoices = (req, branchId) =>
  !invoiceScoped(req) || access.userBranchIds(req).includes(String(branchId));

// ── Static paths FIRST — "/:id" below would swallow them ──
// Invoice numbers used more than once by the same real vendor (same GSTIN),
// across branches. ?branchId= narrows to one branch; branch-scoped roles
// only ever see their own branches.
router.get(
  "/duplicate-report",
  roleGuard(
    ROLES.ACCOUNTS,
    ROLES.SUPER_ADMIN,
    ROLES.CLUSTER_HEAD,
    ROLES.DIRECTOR,
    ROLES.BRANCH_PARTNER,
  ),
  async (req, res) => {
    try {
      const branchId = access.qstr(req.query.branchId);
      if (branchId && !mongoose.isValidObjectId(branchId))
        return res.status(400).json({ message: "Invalid branch" });
      if (branchId && !canSeeBranchInvoices(req, branchId))
        return res.status(403).json({ message: "You do not have access to this branch" });
      const branchIds = branchId
        ? [branchId]
        : invoiceScoped(req)
          ? access.userBranchIds(req)
          : null;
      const report = await getDuplicateReport(
        branchIds,
        access.qstr(req.query.from),
        access.qstr(req.query.to),
      );
      res.json(report);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
);

router.get("/", ctrl.getInvoices);
router.get("/:id", ctrl.getInvoiceById);
router.post("/", roleGuard(ROLES.BRANCH_USER), ctrl.createInvoice);
router.put(
  "/:id",
  roleGuard(ROLES.BRANCH_USER, ROLES.ACCOUNTS, ROLES.SUPER_ADMIN),
  ctrl.updateInvoice,
);
router.patch("/:id/submit", roleGuard(ROLES.BRANCH_USER), ctrl.submitInvoice);
router.patch(
  "/:id/approve",
  roleGuard(ROLES.ACCOUNTS, ROLES.BRANCH_PARTNER, ROLES.CLUSTER_HEAD),
  ctrl.approveInvoice,
);
router.patch(
  "/:id/reject",
  roleGuard(ROLES.ACCOUNTS, ROLES.BRANCH_PARTNER, ROLES.CLUSTER_HEAD),
  ctrl.rejectInvoice,
);

router.post("/check-duplicate", async (req, res) => {
  try {
    const { branchId, vendorId, invoiceNumber, amount, excludeId } = req.body;
    if (!branchId || !vendorId || !invoiceNumber) {
      return res
        .status(400)
        .json({ message: "branchId, vendorId and invoiceNumber are required" });
    }
    if (!canSeeBranchInvoices(req, branchId)) {
      return res.status(403).json({ message: "You do not have access to this branch" });
    }
    const result = await checkDuplicateInvoice(
      branchId,
      vendorId,
      invoiceNumber,
      Number(amount),
      excludeId,
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


module.exports = router;
