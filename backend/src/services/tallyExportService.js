// ============================================================
// BACKEND: src/services/tallyExportService.js — NEW FILE (Nov 2026)
// ------------------------------------------------------------
// Builds TallyPrime import rows (Accounts team's own Excel layout) from
// Accounts-approved invoices and approved credit notes.
//
// Voucher rules agreed with Accounts:
//   • Pharmacy invoices          → "Purchase"   (one Purchase ledger per GST rate)
//     = Expense Type "MEDICAL CONSUMABLES" or "PHARMACY PURCHASE"
//   • All other invoices         → "Journal"    (expense ledger = expense category)
//   • Approved credit notes      → "Debit Note" (reverses the original booking)
//   Voucher Number   = PMS invoice ID (INV-000123) / credit note ID (CN-000045)
//   Voucher Ref No.  = vendor's invoice / credit note number
//   Invoice Date     = vendor's invoice / credit note date
//   Voucher Date     = date of Accounts approval (credit note: approval date)
//   GST ledgers      = "Input CGST 9%", "Input SGST 9%", "Input IGST 18%"
//   Purchase ledgers = "Purchase GST 12 %"
//   TDS ledger       = "TDS 194J Payable" — Cr on the invoice, Dr on a debit note
//   Special / Cash discount = separate Cr lines "Special Discount" / "Cash Discount"
//   Vendor ledger    = vendor name as in PMS; balancing Cr (Dr on a debit note)
//   Round off        = ignored (the vendor line is the balancing figure)
//
// Pure functions: nothing here reads or writes the database.
// ============================================================
const {
  GST_TYPES,
  resolveGstType,
  splitGstAmount,
  splitGstRate,
} = require("../utils/gst");

const TZ = "Asia/Kolkata";

// Expense categories (invoice "Expense Type") booked as Purchase vouchers.
// Matched on the exact category name, ignoring case and extra spaces.
// Everything else is Journal.
const PHARMACY_CATEGORIES = new Set([
  "MEDICAL CONSUMABLES",
  "PHARMACY PURCHASE",
]);
const normName = (s) =>
  String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

const LEDGERS = {
  SPECIAL_DISCOUNT: "Special Discount",
  CASH_DISCOUNT: "Cash Discount",
  TDS_UNKNOWN: "TDS Payable",
};

// Columns exactly as the Accounts team's sample (Tally_formate.xlsx).
const TALLY_COLUMNS = [
  "Voucher Date",
  "Voucher Type Name",
  "Voucher Number",
  "Voucher Ref Number",
  "Invoice Date",
  "Voucher Narration",
  "Buyer/Supplier - Pincode",
  "Ledger Name",
  "Ledger Amount",
  "Ledger Amount Dr/Cr",
  "Item Name",
  "Billed Quantity",
  "Item Rate",
  "Item Rate per",
  "Item Amount",
  "Change Mode ",
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 9 → "9", 2.5 → "2.5", 12.0 → "12"
const fmtRate = (n) => String(round2(n));

// "Rs." rather than "₹" in text that goes into Tally narrations.
const inr = (n) =>
  `Rs. ${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// dd/mm/yyyy in IST, as text (matches the sample sheet)
const fmtDate = (d) => {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(d));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("day")}/${get("month")}/${get("year")}`;
};

const purchaseLedger = (rate) => `Purchase GST ${fmtRate(rate)} %`;
const gstLedger = (kind, rate) => `Input ${kind} ${fmtRate(rate)}%`;
const tdsLedger = (section) =>
  section ? `TDS ${section} Payable` : LEDGERS.TDS_UNKNOWN;

const isPharmacy = (category) =>
  PHARMACY_CATEGORIES.has(normName(category?.name));

// ── TDS section ─────────────────────────────────────────────
// PMS stores only the TDS %, not the section. Same approach as the TDS
// WORKING report: the expense category name points to the nature, the
// rate confirms it. Anything unclear is flagged for Accounts to check.
const SECTION_HINTS = [
  [/rent|lease/i, "194I"],
  [/commission|brokerage/i, "194H"],
  [/interest/i, "194A"],
  [/professional|doctor|surgeon|visiting|consult|legal|audit|ca fee/i, "194J"],
  [/technical|software|\bit\b|website|digital/i, "194J"],
  [
    /advertis|marketing|promotion|hoarding|branding|maintenance|repair|amc|contract|housekeeping|security|manpower|labour|labor|catering|transport/i,
    "194C",
  ],
  [/salary|wages|stipend/i, "192B"],
];
const RATE_SECTION = {
  1: "194C",
  2: "194C",
  5: "194H",
  10: "194J",
  0.1: "194Q",
};
const RATE_UNAMBIGUOUS = new Set([1, 5, 0.1]); // 2% and 10% have two sections

const resolveTdsSection = (tdsPercentage, categoryName) => {
  const rate = round2(tdsPercentage);
  const hint = SECTION_HINTS.find(([rx]) => rx.test(categoryName || ""));
  if (hint) return { section: hint[1], sure: true };
  if (RATE_SECTION[rate])
    return { section: RATE_SECTION[rate], sure: RATE_UNAMBIGUOUS.has(rate) };
  return { section: null, sure: false };
};

// ── Figures ─────────────────────────────────────────────────
// The original booking is always exported at its ORIGINAL value; credit
// notes go out separately as Debit Notes. So when a credit note was
// approved before export, originalTotals is used.
const originalFigures = (inv) => {
  const ot = inv.originalTotals || {};
  const pick = (k) => (ot[k] !== undefined && ot[k] !== null ? ot[k] : inv[k]);
  return {
    amount: round2(pick("amount")),
    gstAmount: round2(pick("gstAmount")),
    tdsAmount: round2(pick("tdsAmount")),
    roundOff: round2(pick("roundOff")),
    specialDiscount: round2(pick("specialDiscount")),
    cashDiscount: round2(pick("cashDiscount")),
    netPayable: round2(pick("netPayable")),
  };
};

// Lines as { description, amount, gstPercentage, gstAmount }.
// Legacy invoices without items become one line at the effective rate.
const invoiceLines = (inv, fig) => {
  if (Array.isArray(inv.items) && inv.items.length) {
    return inv.items.map((it) => ({
      description: it.description || "",
      amount: round2(it.amount),
      gstPercentage: Number(it.gstPercentage) || 0,
      gstAmount: round2(it.gstAmount),
    }));
  }
  return [
    {
      description: inv.description || "",
      amount: fig.amount,
      gstPercentage:
        fig.amount > 0 ? round2((fig.gstAmount / fig.amount) * 100) : 0,
      gstAmount: fig.gstAmount,
    },
  ];
};

// Group lines by GST rate → { rate, base, cgst, sgst, igst }
const groupByRate = (lines, gstType) => {
  const map = new Map();
  for (const l of lines) {
    const key = round2(l.gstPercentage);
    const g = map.get(key) || { rate: key, base: 0, cgst: 0, sgst: 0, igst: 0 };
    const s = splitGstAmount(l.gstAmount, gstType);
    g.base = round2(g.base + l.amount);
    g.cgst = round2(g.cgst + s.cgstAmount);
    g.sgst = round2(g.sgst + s.sgstAmount);
    g.igst = round2(g.igst + s.igstAmount);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
};

const gstLinesFor = (groups, gstType, side) => {
  const out = [];
  for (const g of groups) {
    const r = splitGstRate(g.rate, gstType);
    if (gstType === GST_TYPES.INTRA) {
      if (g.cgst > 0)
        out.push({
          ledger: gstLedger("CGST", r.cgstRate),
          amount: g.cgst,
          side,
        });
      if (g.sgst > 0)
        out.push({
          ledger: gstLedger("SGST", r.sgstRate),
          amount: g.sgst,
          side,
        });
    } else if (g.igst > 0) {
      out.push({ ledger: gstLedger("IGST", r.igstRate), amount: g.igst, side });
    }
  }
  return out;
};

const lineText = (l, gstType) => {
  const rate = Number(l.gstPercentage) || 0;
  let gst = "GST nil";
  if (rate > 0) {
    const r = splitGstRate(rate, gstType);
    gst =
      gstType === GST_TYPES.INTRA
        ? `GST ${fmtRate(rate)}% (CGST ${fmtRate(r.cgstRate)}% + SGST ${fmtRate(r.sgstRate)}%)`
        : `IGST ${fmtRate(rate)}%`;
  }
  return `${l.description || "Item"} ${inr(l.amount)} + ${gst}`;
};

// Latest Accounts approval in the invoice's history (normal or the
// automatic one on fixed-payment invoices). Credit-note entries excluded.
const accountsApprovalDate = (inv) => {
  const hit = [...(inv.approvalHistory || [])]
    .reverse()
    .find(
      (h) =>
        h.action === "approved" && /^accounts approval/i.test(h.stage || ""),
    );
  return hit?.actionAt || null;
};

// ── Vouchers ────────────────────────────────────────────────
const finish = (v) => {
  const dr = round2(
    v.lines.filter((l) => l.side === "Dr").reduce((s, l) => s + l.amount, 0),
  );
  const cr = round2(
    v.lines.filter((l) => l.side === "Cr").reduce((s, l) => s + l.amount, 0),
  );
  if (Math.abs(dr - cr) > 0.009)
    v.warnings.push(`Voucher does not balance (Dr ${inr(dr)} / Cr ${inr(cr)})`);
  return { ...v, drTotal: dr, crTotal: cr };
};

// Part payments (Nov 2026): TDS is deducted part by part. The invoice
// voucher carries part 1's TDS; each later part's TDS goes out as its own
// journal (buildPartTdsVoucher), on the day Accounts approved that part.
const part1Of = (inv) =>
  inv.paymentPlan?.mode === "partial"
    ? (inv.paymentPlan.parts || []).find((p) => Number(p.partNo) === 1)
    : null;

const buildInvoiceVoucher = (inv) => {
  const warnings = [];
  const category = inv.expenseCategory || {};
  const vendorName = inv.vendor?.vendorName || "";
  const pharmacy = isPharmacy(category);
  const gstType = resolveGstType(inv);
  const fig = originalFigures(inv);
  const part1 = part1Of(inv);
  if (part1) {
    fig.tdsAmount = round2(part1.tdsAmount);
    inv = { ...inv, tdsPercentage: part1.tdsPercentage };
    warnings.push(
      "Part-payment invoice — TDS here is on Part 1 only; later parts' TDS go as separate journals",
    );
  }
  const lines = invoiceLines(inv, fig);
  const groups = groupByRate(lines, gstType);

  if (!vendorName) warnings.push("Vendor name missing");
  if (!category.name) warnings.push("Expense category missing");
  if (!inv.gstType && fig.gstAmount > 0)
    warnings.push("Saved before GST type existed — exported as IGST");

  const out = [];
  if (pharmacy) {
    for (const g of groups)
      if (g.base > 0)
        out.push({
          ledger: purchaseLedger(g.rate),
          amount: g.base,
          side: "Dr",
        });
  } else {
    const base = round2(groups.reduce((s, g) => s + g.base, 0));
    out.push({ ledger: category.name || "", amount: base, side: "Dr" });
  }
  out.push(...gstLinesFor(groups, gstType, "Dr"));

  if (fig.specialDiscount > 0)
    out.push({
      ledger: LEDGERS.SPECIAL_DISCOUNT,
      amount: fig.specialDiscount,
      side: "Cr",
    });
  if (fig.cashDiscount > 0)
    out.push({
      ledger: LEDGERS.CASH_DISCOUNT,
      amount: fig.cashDiscount,
      side: "Cr",
    });

  let tds = null;
  if (fig.tdsAmount > 0) {
    tds = resolveTdsSection(inv.tdsPercentage, category.name);
    if (!tds.section)
      warnings.push(
        `TDS section not identified (${fmtRate(inv.tdsPercentage)}%) — ledger "${LEDGERS.TDS_UNKNOWN}" used`,
      );
    else if (!tds.sure)
      warnings.push(
        `TDS section ${tds.section} assumed from ${fmtRate(inv.tdsPercentage)}% — please check`,
      );
    out.push({
      ledger: tdsLedger(tds.section),
      amount: fig.tdsAmount,
      side: "Cr",
    });
  }

  const dr = out
    .filter((l) => l.side === "Dr")
    .reduce((s, l) => s + l.amount, 0);
  const cr = out
    .filter((l) => l.side === "Cr")
    .reduce((s, l) => s + l.amount, 0);
  const vendorAmt = round2(dr - cr);
  if (vendorAmt <= 0) warnings.push("Vendor amount is zero or negative");
  out.push({ ledger: vendorName, amount: vendorAmt, side: "Cr" });

  if (fig.roundOff !== 0)
    warnings.push(
      `Round off ${inr(fig.roundOff)} ignored — vendor credit ${inr(vendorAmt)} vs PMS net ${inr(fig.netPayable)}`,
    );
  if (inv.originalTotals)
    warnings.push(
      "Credit note approved on this invoice — exported at original value; credit note goes as a Debit Note",
    );

  const approvedAt = accountsApprovalDate(inv);
  const narrParts = [
    `Being ${pharmacy ? `${category.name} purchased` : `${category.name || "expense"} booked`} — ${vendorName} inv ${inv.invoiceNumber} dt ${fmtDate(inv.invoiceDate)}`,
    lines.map((l) => lineText(l, gstType)).join("; "),
  ];
  if (fig.tdsAmount > 0)
    narrParts.push(
      `TDS ${tds?.section || ""} @ ${fmtRate(inv.tdsPercentage)}% ${inr(fig.tdsAmount)}`.replace(
        "  ",
        " ",
      ),
    );
  if (fig.specialDiscount > 0)
    narrParts.push(`Special discount ${inr(fig.specialDiscount)}`);
  if (fig.cashDiscount > 0)
    narrParts.push(`Cash discount ${inr(fig.cashDiscount)}`);
  narrParts.push(`PMS ${inv.requestId}`);

  return finish({
    kind: "invoice",
    sourceId: String(inv._id),
    voucherDate: approvedAt || inv.invoiceDate,
    voucherType: pharmacy ? "Purchase" : "Journal",
    voucherNumber: inv.requestId,
    refNumber: inv.invoiceNumber,
    refDate: inv.invoiceDate,
    narration: narrParts.join(" | "),
    vendorName,
    gstType,
    pmsNetPayable: fig.netPayable,
    lines: out,
    warnings,
    exportedAt: inv.tallyExport?.exportedAt || null,
  });
};

const buildDebitNoteVoucher = (cn) => {
  const inv = cn.invoice || {};
  const warnings = [];
  const category = inv.expenseCategory || {};
  const vendorName = inv.vendor?.vendorName || cn.vendor?.vendorName || "";
  const pharmacy = isPharmacy(category);
  const gstType = resolveGstType(cn.gstType ? cn : inv);
  const lines = (cn.lines || []).map((l) => ({
    description: l.description || "",
    amount: round2(l.amount),
    gstPercentage: Number(l.gstPercentage) || 0,
    gstAmount: round2(l.gstAmount),
  }));
  const groups = groupByRate(lines, gstType);

  const out = [];
  if (pharmacy) {
    for (const g of groups)
      if (g.base > 0)
        out.push({
          ledger: purchaseLedger(g.rate),
          amount: g.base,
          side: "Cr",
        });
  } else {
    const base = round2(groups.reduce((s, g) => s + g.base, 0));
    out.push({ ledger: category.name || "", amount: base, side: "Cr" });
  }
  out.push(...gstLinesFor(groups, gstType, "Cr"));

  const tdsRev = round2(cn.tdsReversal);
  let tds = null;
  if (tdsRev > 0) {
    tds = resolveTdsSection(inv.tdsPercentage, category.name);
    if (!tds.section || !tds.sure)
      warnings.push(
        `TDS section ${tds.section || "not identified"} — please check`,
      );
    out.push({ ledger: tdsLedger(tds.section), amount: tdsRev, side: "Dr" });
  }
  const cr = out
    .filter((l) => l.side === "Cr")
    .reduce((s, l) => s + l.amount, 0);
  const dr = out
    .filter((l) => l.side === "Dr")
    .reduce((s, l) => s + l.amount, 0);
  const vendorAmt = round2(cr - dr);
  out.unshift({ ledger: vendorName, amount: vendorAmt, side: "Dr" });
  if (Math.abs(vendorAmt - round2(cn.netReduction)) > 0.009)
    warnings.push(
      `Vendor debit ${inr(vendorAmt)} differs from PMS net reduction ${inr(cn.netReduction)}`,
    );

  const narration = [
    `Being goods/services returned — ${vendorName} credit note ${cn.vendorCreditNoteNumber} dt ${fmtDate(cn.creditNoteDate)} against inv ${inv.invoiceNumber || ""} (${inv.requestId || ""})`,
    lines.map((l) => lineText(l, gstType)).join("; "),
    tdsRev > 0 ? `TDS reversed ${inr(tdsRev)}` : null,
    cn.reason ? `Reason: ${cn.reason}` : null,
    `PMS ${cn.creditNoteId}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return finish({
    kind: "credit_note",
    sourceId: String(cn._id),
    voucherDate: cn.decidedAt || cn.creditNoteDate,
    voucherType: "Debit Note",
    voucherNumber: cn.creditNoteId,
    refNumber: cn.vendorCreditNoteNumber,
    refDate: cn.creditNoteDate,
    narration,
    vendorName,
    gstType,
    pmsNetPayable: round2(cn.netReduction),
    lines: out,
    warnings,
    exportedAt: cn.tallyExport?.exportedAt || null,
  });
};

// One sheet row per ledger line; voucher fields repeated on every row.
const toRows = (vouchers) => {
  const rows = [];
  for (const v of vouchers) {
    for (const l of v.lines) {
      rows.push([
        fmtDate(v.voucherDate),
        v.voucherType,
        v.voucherNumber,
        v.refNumber || "",
        fmtDate(v.refDate),
        v.narration,
        "",
        l.ledger,
        l.amount,
        l.side,
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
    }
  }
  return rows;
};

// ── Part TDS journal (Nov 2026) ────────────────────────────
// TDS on a later part of a part-payment invoice: Dr vendor / Cr TDS ledger.
const buildPartTdsVoucher = (inv, part) => {
  const warnings = [];
  const category = inv.expenseCategory || {};
  const vendorName = inv.vendor?.vendorName || "";
  const tdsAmt = round2(part.tdsAmount);
  const tds = resolveTdsSection(part.tdsPercentage, category.name);
  if (!vendorName) warnings.push("Vendor name missing");
  if (!tds.section)
    warnings.push(
      `TDS section not identified (${fmtRate(part.tdsPercentage)}%) — ledger "${LEDGERS.TDS_UNKNOWN}" used`,
    );
  else if (!tds.sure)
    warnings.push(
      `TDS section ${tds.section} assumed from ${fmtRate(part.tdsPercentage)}% — please check`,
    );
  if (part.status !== "Approved")
    warnings.push("Part not yet approved by the Cluster Head");
  const lines = [
    { ledger: vendorName, amount: tdsAmt, side: "Dr" },
    { ledger: tdsLedger(tds.section), amount: tdsAmt, side: "Cr" },
  ];
  return finish({
    kind: "invoice_part",
    sourceId: `${inv._id}:${part.partNo}`,
    invoiceId: String(inv._id),
    partNo: part.partNo,
    voucherDate: part.tdsAppliedAt,
    voucherType: "Journal",
    voucherNumber: `${inv.requestId}-P${part.partNo}`,
    refNumber: inv.invoiceNumber,
    refDate: inv.invoiceDate,
    narration: [
      `Being TDS ${tds.section || ""} @ ${fmtRate(part.tdsPercentage)}% deducted on part ${part.partNo} payment — ${vendorName} inv ${inv.invoiceNumber} dt ${fmtDate(inv.invoiceDate)}`.replace(
        "  ",
        " ",
      ),
      `Part ${inr(part.amount)} · taxable ${inr(part.taxableAmount)} · TDS ${inr(tdsAmt)}`,
      `PMS ${inv.requestId}`,
    ].join(" | "),
    vendorName,
    gstType: resolveGstType(inv),
    pmsNetPayable: round2(part.netAmount),
    lines,
    warnings,
    exportedAt: part.tallyExport?.exportedAt || null,
  });
};

module.exports = {
  TALLY_COLUMNS,
  buildPartTdsVoucher,
  PHARMACY_CATEGORIES,
  LEDGERS,
  buildInvoiceVoucher,
  buildDebitNoteVoucher,
  accountsApprovalDate,
  resolveTdsSection,
  toRows,
  fmtDate,
};
