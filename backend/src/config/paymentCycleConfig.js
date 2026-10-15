// ============================================================
// BACKEND: src/config/paymentCycleConfig.js — REPLACE WHOLE FILE
// ------------------------------------------------------------
// Every payment-cycle rule and every word of the terms lives here.
// Accounts can change the days or the wording without any other
// file being touched.
//
// Oct 2026 revision — two payment WINDOWS instead of two fixed days.
//
// Cut-off is still measured on the date the invoice receives FINAL
// approval (Cluster Head Approved), not the date it was uploaded.
//
//   CH approval on day 1..7     -> First cycle  of the SAME month (pay 10–15)
//   CH approval on day 8..17    -> Second cycle of the SAME month (pay 21–25)
//   CH approval on day 18..EOM  -> First cycle  of the NEXT month
//
// "Before 7th midnight" = up to 23:59:59 IST on the 7th (inclusive).
//
// Processing lock:
//   8th–10th  Accounts processes the First cycle. Invoices finally
//             approved on/after the 8th are LOCKED (cannot be raised).
//   18th–21st Accounts processes the Second cycle. Invoices finally
//             approved on/after the 18th are LOCKED.
//   Outside these windows nothing is locked.
// ============================================================

const CYCLES = {
  FIRST: {
    key: "CYCLE_FIRST",
    order: 0, // position within a month, used for comparisons
    label: "First Payment Cycle",
    shortLabel: "1st Cycle",
    approvalCutoffDay: 7, // CH approval up to 23:59 IST on this day
    processingStartDay: 8, // Accounts processing window (inclusive)
    processingEndDay: 10,
    paymentStartDay: 10, // Bank payment window (inclusive)
    paymentEndDay: 15,
  },
  SECOND: {
    key: "CYCLE_SECOND",
    order: 1,
    label: "Second Payment Cycle",
    shortLabel: "2nd Cycle",
    approvalCutoffDay: 17,
    processingStartDay: 18,
    processingEndDay: 21,
    paymentStartDay: 21,
    paymentEndDay: 25,
  },
};

// Keys written by the previous (7th / 21st) rules. Kept so existing
// invoice documents stay valid; never assigned to new approvals.
const LEGACY_CYCLE_KEYS = ["CYCLE_7", "CYCLE_21"];

// Final approvals before this IST date were made under the old 7th/21st
// rules. Only affects invoices that have NO stored cycle (their cycle is
// derived at read time) and the processing lock (never applied to them).
// Override with PAYMENT_CYCLE_V2_FROM=YYYY-MM-DD in .env if go-live moves.
const RULES_EFFECTIVE_FROM =
  process.env.PAYMENT_CYCLE_V2_FROM || "2026-10-15";

// The invoice status that fixes the cycle. Must match
// constants.INVOICE_STATUS.CLUSTER_APPROVED exactly.
const CYCLE_ANCHOR_STATUS = "Cluster Head Approved";

// India Standard Time. The server may run UTC; day-of-month must not.
const IST_OFFSET_MINUTES = 330;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Shown in the pre-submit popup, the approval popup and on dashboards.
const PAYMENT_CYCLE_TERMS = [
  "The applicable payment cycle is determined by the date on which the invoice receives final approval from the Cluster Head, and not by the date on which it was uploaded by the branch.",
  "There are two payment cycles every month. First Payment Cycle: bank payments between the 10th and the 15th. Second Payment Cycle: bank payments between the 21st and the 25th.",
  "Invoices finally approved by the Cluster Head on or before the 7th (up to 11:59 PM) fall in that month's First Payment Cycle. Invoices finally approved between the 8th and the 17th (up to 11:59 PM) fall in that month's Second Payment Cycle. Invoices finally approved on or after the 18th are carried forward to the First Payment Cycle of the following month.",
  "The Accounts team processes First-cycle invoices between the 8th and the 10th, and Second-cycle invoices between the 18th and the 21st. Invoices approved by the Cluster Head after the respective cut-off remain locked for payment processing during that window.",
  "If any day in a payment window falls on a Sunday, a second or fourth Saturday, a public holiday, a bank holiday, or any other day on which the bank does not process transactions, payments due that day will be carried out on the next working day.",
  "Payment dates displayed in the system are indicative. Actual credit to the vendor's account is subject to bank processing timelines and may take one to two additional working days after the payment run is executed.",
  "An invoice that is still awaiting any approval on the cut-off date will automatically move to the next available cycle. No cycle is reserved or held on the basis of the upload date.",
  "An invoice that is rejected at any stage and subsequently resubmitted will be re-assessed afresh, from the date of its new final approval.",
  "The Accounts team may revise the cycle dates for statutory, banking, audit or operational reasons. Any such revision will apply prospectively and will be communicated to all branches in advance.",
];

module.exports = {
  CYCLES,
  LEGACY_CYCLE_KEYS,
  RULES_EFFECTIVE_FROM,
  CYCLE_ANCHOR_STATUS,
  IST_OFFSET_MINUTES,
  MONTH_NAMES,
  PAYMENT_CYCLE_TERMS,
};
