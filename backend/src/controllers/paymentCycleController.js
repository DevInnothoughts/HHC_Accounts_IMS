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
      rules: [
        {
          cycleLabel: CYCLES.CYCLE_7.label,
          cutoff: `${CYCLES.CYCLE_7.cutoffDay}th of every month`,
          action:
            "Accounts takes up all invoices finally approved by the Branch Partner and Cluster Head",
          bankPayment: `${CYCLES.CYCLE_7.paymentDay}th`,
        },
        {
          cycleLabel: CYCLES.CYCLE_21.label,
          cutoff: `${CYCLES.CYCLE_21.cutoffDay}th of every month`,
          action:
            "Accounts takes up all invoices finally approved by the Branch Partner and Cluster Head",
          bankPayment: `${CYCLES.CYCLE_21.paymentDay}st`,
        },
      ],
    });
  } catch (err) {
    // Generic message: err.message leakage is being cleaned up
    // elsewhere in this codebase, so no new instance is introduced.
    console.error("getCurrentCycle error:", err);
    res.status(500).json({ message: "Could not load the payment cycle" });
  }
};
