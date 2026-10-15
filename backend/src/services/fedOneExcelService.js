// ============================================================
// FedOne (Federal Bank) bulk payment upload sheet.
//
// This file is machine-parsed by the bank portal. The layout is
// FIXED: one sheet, 12 columns, header on row 1, data from row 2.
// Do NOT add title rows, merged cells, totals or currency symbols
// — the upload will be rejected.
// ============================================================
const ExcelJS = require("exceljs");

// Column order and widths taken verbatim from bank_letter_format_fedone.xlsx
const FEDONE_COLUMNS = [
  { header: "Transaction Type", key: "transactionType", width: 23.86 },
  { header: "Debit Account Number", key: "debitAccount", width: 22.71 },
  { header: "Transaction Amount", key: "amount", width: 20.29 },
  { header: "Value Date", key: "valueDate", width: 16.86 },
  { header: "Beneficiary Account Number", key: "beneAccount", width: 28.43 },
  { header: "Beneficiary Name", key: "beneName", width: 28 },
  { header: "IFSC Code", key: "ifsc", width: 18.71 },
  { header: "Beneficiary Email ID", key: "beneEmail", width: 24.29 },
  { header: "Beneficiary ID", key: "beneId", width: 17.71 },
  { header: "Credit Remarks", key: "creditRemarks", width: 26.43 },
  { header: "Debit Remarks", key: "debitRemarks", width: 26.43 },
  { header: "Unique Customer Reference Number", key: "urn", width: 36.43 },
];

// Columns the bank reads as strings. Account numbers especially:
// as numbers, leading zeros vanish and long ones go scientific.
const TEXT_KEYS = ["debitAccount", "valueDate", "beneAccount", "beneId", "urn"];

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF00B0F0" },
};
const HEADER_FONT = { name: "Calibri", size: 11, bold: true };
const THIN = { style: "thin" };
const HEADER_BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

// Field caps enforced by the FedNet parser.
const MAX = { beneName: 40, remarks: 40, email: 50, urn: 20 };

// The bank rejects most punctuation in free-text fields.
const clean = (value, max) =>
  String(value ?? "")
    .replace(/[^A-Za-z0-9 ./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// URN must be alphanumeric only. PAY-000001-2 -> PAY0000012
const cleanRef = (value) =>
  String(value ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, MAX.urn);

// Bank remark fields: "Expense Category / Invoice Number".
// The field is capped at 30 characters and the invoice number is what
// reconciliation keys on, so it is kept whole and the category is trimmed
// to whatever room is left.
const buildBankRemark = (invoice, fallbackRef) => {
  const category = clean(
    invoice?.expenseCategory?.name || invoice?.expenseCategory?.code || "",
    MAX.remarks,
  );
  const number = clean(
    invoice?.invoiceNumber || fallbackRef || "",
    MAX.remarks,
  );

  if (!category) return number;
  if (!number) return category;

  const sep = " / ";
  const room = MAX.remarks - number.length - sep.length;
  if (room < 3) return number; // no useful room for a category
  return `${category.slice(0, room).trim()}${sep}${number}`;
};

const toMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

// DD/MM/YYYY. A value date in the past is rejected on upload, so a
// stale scheduledDate silently falls forward to today.
const formatValueDate = (date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let d = date ? new Date(date) : today;
  if (isNaN(d.getTime()) || d < today) d = today;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// The debit account comes from the branch record. An explicit pick wins,
// but only for the branch that owns it — a mixed-branch bulk file falls
// back to each branch's own default.
const resolveDebitAccount = (branch, preferredId) => {
  const active = (branch?.bankAccounts || []).filter(
    (a) => a.status === "active",
  );
  if (!active.length) return null;
  if (preferredId) {
    const chosen = active.find((a) => String(a._id) === String(preferredId));
    if (chosen) return chosen;
  }
  return (
    active.find((a) => a.isDefault) || (active.length === 1 ? active[0] : null)
  );
};

// Same bank on both sides means an internal transfer, which clears
// instantly and free. FedOne's code for that is "IFT" (Internal Fund
// Transfer). Otherwise the account's own RTGS threshold decides.
const resolveTransactionType = (amount, beneIfsc, debitAccount) => {
  const bene = String(beneIfsc || "").toUpperCase();
  const debit = String(debitAccount?.ifscCode || "").toUpperCase();
  if (debit && bene.slice(0, 4) === debit.slice(0, 4)) return "IFT";
  const threshold = Number(debitAccount?.rtgsThreshold ?? 200000);
  return toMoney(amount) >= threshold ? "RTGS" : "NEFT";
};

// One transaction = one installment. The last installment is the one
// currently awaiting release, and its id is the natural unique reference.
const resolveReference = (payment) => {
  const last = payment.installments?.length
    ? payment.installments[payment.installments.length - 1]
    : null;
  return cleanRef(last?.paymentId || payment.paymentId);
};

const resolveAmount = (payment) => {
  const last = payment.installments?.length
    ? payment.installments[payment.installments.length - 1]
    : null;
  return toMoney(
    payment.paymentAmount ?? last?.amount ?? payment.remainingAmount,
  );
};

const validateForFedOne = (payment, preferredAccountId) => {
  const errors = [];
  const vendor = payment.vendor || payment.invoiceRequest?.vendor;
  const branch = payment.branch || payment.invoiceRequest?.branch;
  const label = payment.paymentId || String(payment._id);
  const branchLabel = branch?.code || branch?.name || "—";

  const debitAccount = resolveDebitAccount(branch, preferredAccountId);
  if (!debitAccount) {
    const active = (branch?.bankAccounts || []).filter(
      (a) => a.status === "active",
    );
    errors.push(
      active.length
        ? `${label}: branch ${branchLabel} has several bank accounts and no default — set one in Branch Management`
        : `${label}: branch ${branchLabel} has no active bank account — add one in Branch Management`,
    );
  }
  if (resolveAmount(payment) <= 0)
    errors.push(`${label}: transaction amount is zero or missing`);
  if (!vendor?.accountNumber)
    errors.push(`${label}: vendor has no bank account number`);
  if (
    !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(vendor?.ifscCode || "").toUpperCase())
  )
    errors.push(`${label}: vendor IFSC is missing or malformed`);
  if (!clean(vendor?.accountHolderName || vendor?.vendorName, MAX.beneName))
    errors.push(`${label}: vendor has no usable beneficiary name`);

  return errors;
};

const buildRow = (payment, preferredAccountId) => {
  const invoice = payment.invoiceRequest;
  const vendor = payment.vendor || invoice?.vendor;
  const branch = payment.branch || invoice?.branch;
  const debitAccount = resolveDebitAccount(branch, preferredAccountId);
  const amount = resolveAmount(payment);
  const ifsc = String(vendor?.ifscCode || "").toUpperCase();
  // Accounts want the same "Category / Invoice" string on both sides.
  const remark = buildBankRemark(invoice, payment.paymentId);

  return {
    transactionType: resolveTransactionType(amount, ifsc, debitAccount),
    debitAccount: String(debitAccount?.accountNumber || "").trim(),
    amount,
    valueDate: formatValueDate(payment.scheduledDate),
    beneAccount: String(vendor?.accountNumber || "").trim(),
    beneName: clean(
      vendor?.accountHolderName || vendor?.vendorName,
      MAX.beneName,
    ),
    ifsc,
    beneEmail: String(vendor?.email || "")
      .trim()
      .slice(0, MAX.email),
    beneId: "",
    creditRemarks: remark,
    debitRemarks: remark,
    urn: resolveReference(payment),
  };
};

const buildFedOneWorkbook = (payments, preferredAccountId) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PMS — Healing Hands Clinic";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Sheet1");
  sheet.columns = FEDONE_COLUMNS;

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = HEADER_BORDER;
  });

  payments.forEach((payment) => {
    const row = sheet.addRow(buildRow(payment, preferredAccountId));
    row.font = { name: "Calibri", size: 11 };
    TEXT_KEYS.forEach((key) => {
      row.getCell(key).numFmt = "@";
    });
    row.getCell("amount").numFmt = "0.00";
  });

  return workbook;
};

module.exports = {
  buildFedOneWorkbook,
  validateForFedOne,
  resolveReference,
  buildBankRemark, // also names downloaded attachments (paymentDocumentService)
  FEDONE_COLUMNS,
  // shared with the e-Net sheet (enetExcelService) so both bank files
  // clean text, pick the amount and date the value the same way
  clean,
  resolveAmount,
  formatValueDate,
  MAX,
};
