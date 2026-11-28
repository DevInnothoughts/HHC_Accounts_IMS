// ============================================================
// BACKEND: src/services/doctorTallyService.js — NEW FILE
// ------------------------------------------------------------
// TallyPrime vouchers for doctor payments, in the SAME import layout as
// the invoice export (tallyExportService: TALLY_COLUMNS / toRows), so the
// file opens in Tally exactly like the one Accounts already use.
//
// One Journal per approved record:
//   Dr  expense ledger (per type — config TALLY.EXPENSE_LEDGER)   Basic
//   Cr  doctor (name as in the Doctor Master)                     Basic − TDS
//   Cr  TDS <section> Payable                                     TDS
//
//   Voucher Number  = PMS record id (DPO-000123)
//   Voucher Ref No. = upload id (DPB-0007)
//   Invoice Date    = the Date typed in the payout sheet
//   Voucher Date    = the day the Cluster / Department Head approved it
//   TDS ledger      = same rule as invoices (resolveTdsSection): section
//                     from the nature where it is clear, otherwise from
//                     the %, and flagged for Accounts when it is a guess
//
// Pure functions: nothing here reads or writes the database.
// ============================================================
const cfg = require("../config/doctorPayoutConfig");
const { resolveTdsSection, fmtDate, LEDGERS } = require("./tallyExportService");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtRate = (n) => String(round2(n));
// "Rs." rather than "₹" in text that goes into Tally narrations.
const inr = (n) =>
  `Rs. ${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Same naming as the invoice export.
const tdsLedger = (section) =>
  section ? `TDS ${section} Payable` : LEDGERS.TDS_UNKNOWN;

// payout: a DoctorPayout (lean) with doctor { name, panNumber } and
// batch { batchId } populated.
const buildDoctorVoucher = (payout) => {
  const warnings = [];
  const type = payout.type;
  const doctorName = payout.doctor?.name || payout.doctorName || "";
  const basic = round2(payout.basicAmount);
  const tds = round2(payout.tdsAmount);
  const credit = round2(basic - tds); // balancing figure
  const payable = round2(payout.payableAmount);
  const ratePct = basic > 0 ? round2((tds / basic) * 100) : 0;
  const expenseLedger = cfg.TALLY.EXPENSE_LEDGER[type] || "";

  if (!doctorName) warnings.push("Doctor name missing");
  if (!expenseLedger) warnings.push("Expense ledger not set for this type");
  if (Math.abs(credit - payable) > 0.009)
    warnings.push(
      `Payable in PMS is ${inr(payable)}; Basic − TDS is ${inr(credit)} (rounding in the sheet) — doctor credited ${inr(credit)}`,
    );

  const lines = [
    { ledger: expenseLedger, amount: basic, side: "Dr" },
    { ledger: doctorName, amount: credit, side: "Cr" },
  ];

  let section = null;
  if (tds > 0) {
    const hit = resolveTdsSection(ratePct, cfg.TALLY.TDS_SECTION_HINT[type]);
    section = hit.section;
    if (!hit.section)
      warnings.push(
        `TDS section not identified (${fmtRate(ratePct)}%) — ledger "${LEDGERS.TDS_UNKNOWN}" used`,
      );
    else if (!hit.sure)
      warnings.push(
        `TDS section ${hit.section} assumed from ${fmtRate(ratePct)}% — please check`,
      );
    lines.push({ ledger: tdsLedger(section), amount: tds, side: "Cr" });
  } else {
    warnings.push("No TDS deducted");
  }

  const dr = round2(
    lines.filter((l) => l.side === "Dr").reduce((s, l) => s + l.amount, 0),
  );
  const cr = round2(
    lines.filter((l) => l.side === "Cr").reduce((s, l) => s + l.amount, 0),
  );
  if (Math.abs(dr - cr) > 0.009)
    warnings.push(`Voucher does not balance (Dr ${inr(dr)} / Cr ${inr(cr)})`);

  const what =
    type === cfg.TYPES.REFERRAL
      ? `doctor referral fee — ${doctorName} — patient ${payout.patientName || "—"}`
      : `surgeon / anaesthetist fee — ${doctorName} — ${payout.noOfSurgeries} surger${payout.noOfSurgeries === 1 ? "y" : "ies"}`;
  const narration = [
    `Being ${what} dt ${fmtDate(payout.date)}`,
    [
      `Basic ${inr(basic)}`,
      tds > 0
        ? `TDS ${section || ""} @ ${fmtRate(ratePct)}% ${inr(tds)}`.replace(
            "  ",
            " ",
          )
        : "TDS nil",
      `Net ${inr(credit)}`,
    ].join(" · "),
    `PMS ${payout.payoutId}${payout.batch?.batchId ? ` / ${payout.batch.batchId}` : ""}`,
  ].join(" | ");

  return {
    kind: "doctor_payout",
    sourceId: String(payout._id),
    payoutType: type,
    voucherDate: payout.approvedAt || payout.date,
    voucherType: "Journal",
    voucherNumber: payout.payoutId,
    refNumber: payout.batch?.batchId || "",
    refDate: payout.date,
    narration,
    vendorName: doctorName, // the party column of the preview
    panNumber: payout.panNumber,
    pmsNetPayable: payable,
    lines,
    drTotal: dr,
    crTotal: cr,
    warnings,
    exportedAt: payout.tallyExport?.exportedAt || null,
  };
};

module.exports = { buildDoctorVoucher };
