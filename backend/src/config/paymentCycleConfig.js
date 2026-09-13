// ============================================================
// BACKEND: src/config/paymentCycleConfig.js — NEW FILE
// ------------------------------------------------------------
// Every payment-cycle rule and every word of the terms lives here.
// Accounts can change the cut-off days or the wording without any
// other file being touched.
// ============================================================

// Cut-off is measured on the date the invoice receives FINAL approval
// (Cluster Head Approved), not the date it was uploaded.
//
//   Final approval on day 1..4    -> 7th  of the SAME month
//   Final approval on day 5..18   -> 21st of the SAME month
//   Final approval on day 19..EOM -> 7th  of the NEXT month
const CYCLES = {
  CYCLE_7: { key: "CYCLE_7", label: "7th Cycle", cutoffDay: 4, paymentDay: 7 },
  CYCLE_21: {
    key: "CYCLE_21",
    label: "21st Cycle",
    cutoffDay: 18,
    paymentDay: 21,
  },
};

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

// Shown in the pre-submit popup and on every dashboard.
const PAYMENT_CYCLE_TERMS = [
  "The applicable payment cycle is determined by the date on which the invoice receives final approval from the Cluster Head, and not by the date on which it was uploaded by the branch.",
  "Invoices finally approved on or before the 4th of a month are taken up by the Accounts team in that month's 7th cycle. Invoices finally approved between the 5th and the 18th are taken up in that month's 21st cycle. Invoices finally approved on or after the 19th are carried forward to the 7th cycle of the following month.",
  "If the scheduled payment date, being the 7th or the 21st, falls on a Sunday, a second or fourth Saturday, a public holiday, a bank holiday, or any other day on which the bank does not process transactions, the payment run will be carried out on the immediately following working day.",
  "Payment dates displayed in the system are indicative. Actual credit to the vendor's account is subject to bank processing timelines and may take one to two additional working days after the payment run is executed.",
  "An invoice that is still awaiting any approval on the cut-off date will automatically move to the next available cycle. No cycle is reserved or held on the basis of the upload date.",
  "An invoice that is rejected at any stage and subsequently resubmitted will be re-assessed afresh, from the date of its new final approval.",
  "The Accounts team may revise the cycle dates for statutory, banking, audit or operational reasons. Any such revision will apply prospectively and will be communicated to all branches in advance.",
];

module.exports = {
  CYCLES,
  CYCLE_ANCHOR_STATUS,
  IST_OFFSET_MINUTES,
  MONTH_NAMES,
  PAYMENT_CYCLE_TERMS,
};
