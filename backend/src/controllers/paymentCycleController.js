// ============================================================
// BACKEND: src/controllers/paymentCycleController.js — NEW FILE
// ------------------------------------------------------------
// One endpoint feeds both the pre-submit popup and the dashboard
// card, so the rule is never reimplemented on the frontend.
//
// Read only. No document is created or modified.
// ============================================================
const {
  resolvePaymentCycle,
  PAYMENT_CYCLE_TERMS,
} = require("../utils/paymentCycle");
const { CYCLES } = require("../config/paymentCycleConfig");

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// GET /api/payment-cycle/current
//   ?date=YYYY-MM-DD   optional, for previewing another date
//
// Returns the cycle an invoice falls into if it is finally approved
// on that date, plus the standing terms and conditions.
exports.getCurrentCycle = async (req, res) => {
  try {
    const { date } = req.query;

    let basis = new Date();
    if (date) {
      // Parsed as IST midnight, not server-local midnight.
      basis = new Date(`${date}T00:00:00+05:30`);
      if (Number.isNaN(basis.getTime())) {
        return res
          .status(400)
          .json({ message: "Invalid date. Expected format YYYY-MM-DD." });
      }
    }

    const cycle = resolvePaymentCycle(basis, { projection: true });

    res.json({
      ...cycle,
      terms: PAYMENT_CYCLE_TERMS,
      // The rule table, so the UI can render it without hardcoding.
      rules: [CYCLES.FIRST, CYCLES.SECOND].map((c) => ({
        cycleKey: c.key,
        cycleLabel: c.label,
        cutoff: `Cluster Head approval by ${ordinal(c.approvalCutoffDay)}, 11:59 PM`,
        processing: `${ordinal(c.processingStartDay)}–${ordinal(c.processingEndDay)}`,
        bankPayment: `${ordinal(c.paymentStartDay)}–${ordinal(c.paymentEndDay)}`,
        action:
          "Accounts processes all invoices finally approved by the Cluster Head on or before the cut-off",
      })),
    });
  } catch (err) {
    // Generic message: err.message leakage is being cleaned up
    // elsewhere in this codebase, so no new instance is introduced.
    console.error("getCurrentCycle error:", err);
    res.status(500).json({ message: "Could not load the payment cycle" });
  }
};
