// ============================================================
// BACKEND: routes/invoices.js — Duplicate Invoice Check
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

router.use(authenticate);

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

router.get("/duplicate-report", async (req, res) => {
  try {
    const { branchId, from, to } = req.query;
    const report = await getDuplicateReport(branchId, from, to);
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
