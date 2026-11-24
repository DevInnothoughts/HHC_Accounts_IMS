// ============================================================
// BACKEND: src/services/enetExcelService.js
// ------------------------------------------------------------
// "Master Vendor Payment" e-Net bulk upload file — CSV.
// (File name kept so existing imports don't change.)
//
// Layout copied from Master_Vendor_Payment_Enet_Sample.xlsx and
// machine-parsed by the bank, so it is FIXED: 28 columns (A–AB),
// header on line 1, one payment per line from line 2. The
// "Blank" columns are part of the format — header kept, cells empty.
//
//   A  Transaction Type - N      always "N"
//   C  Beneficiary Account Number
//   D  Instrument Amount
//   E  Beneficiary Name
//   M  Narration to Vendor       } same text as FedOne Credit / Debit
//   N  Narration to Own          } Remarks ("Category / Invoice No")
//   W  DATE - DD/MM/YYYY         same value date as FedOne
//   Y  IFC Code                  (header spelt as in the bank sample)
//   AB Beneficiary email id
// ============================================================
const {
  buildBankRemark,
  clean,
  resolveAmount,
  formatValueDate,
  MAX,
} = require("./fedOneExcelService");

// Column letters A..AB and header text exactly as in the sample.
// (Widths are unused in CSV; kept as a record of the sample layout.)
const ENET_COLUMNS = [
  { header: "Transaction Type - N", key: "txnType", width: 19.89 },
  { header: "Blank", key: "b1", width: 15.11 },
  { header: "Beneficiary Account Number", key: "beneAccount", width: 27.44 },
  { header: "Instrument Amount", key: "amount", width: 18.44 },
  { header: "Beneficiary Name", key: "beneName", width: 17.44 },
  { header: "Blank", key: "b2", width: 6.11 }, // F
  { header: "Blank", key: "b3" }, // G
  { header: "Blank", key: "b4" }, // H
  { header: "Blank", key: "b5" }, // I
  { header: "Blank", key: "b6" }, // J
  { header: "Blank", key: "b7" }, // K
  { header: "Blank", key: "b8" }, // L
  { header: "Narration to Vendor", key: "narrationVendor", width: 16.55 },
  { header: "Narration to Own", key: "narrationOwn", width: 19 },
  { header: "Blank", key: "b9", width: 6.11 }, // O
  { header: "Blank", key: "b10" }, // P
  { header: "Blank", key: "b11" }, // Q
  { header: "Blank", key: "b12" }, // R
  { header: "Blank", key: "b13" }, // S
  { header: "Blank", key: "b14" }, // T
  { header: "Blank", key: "b15" }, // U
  { header: "Blank", key: "b16" }, // V
  { header: "DATE - DD/MM/YYYY", key: "valueDate", width: 19.33 },
  { header: "Blank", key: "b17", width: 6.11 }, // X
  { header: "IFC Code", key: "ifsc", width: 9.33 },
  { header: "Blank", key: "b18", width: 6.11 }, // Z
  { header: "Blank", key: "b19" }, // AA
  { header: "Beneficiary email id", key: "beneEmail", width: 19.55 },
];

// CSV has no cell types, so every value goes out as plain text exactly as
// built below — account numbers keep their leading zeros in the file.
// (Opening and re-saving the file in Excel will strip them; upload the
// downloaded file as-is.)

const validateForEnet = (payment) => {
  const errors = [];
  const vendor = payment.vendor || payment.invoiceRequest?.vendor;
  const label = payment.paymentId || String(payment._id);

  if (resolveAmount(payment) <= 0)
    errors.push(`${label}: transaction amount is zero or missing`);
  if (!String(vendor?.accountNumber || "").trim())
    errors.push(`${label}: vendor has no bank account number`);
  if (
    !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(vendor?.ifscCode || "").toUpperCase())
  )
    errors.push(`${label}: vendor IFSC is missing or malformed`);
  if (!clean(vendor?.accountHolderName || vendor?.vendorName, MAX.beneName))
    errors.push(`${label}: vendor has no usable beneficiary name`);

  return errors;
};

const buildEnetRow = (payment) => {
  const invoice = payment.invoiceRequest;
  const vendor = payment.vendor || invoice?.vendor;
  // Identical to the FedOne Credit/Debit Remarks
  const remark = buildBankRemark(invoice, payment.paymentId);

  return {
    txnType: "N",
    beneAccount: String(vendor?.accountNumber || "").trim(),
    amount: resolveAmount(payment),
    beneName: clean(
      vendor?.accountHolderName || vendor?.vendorName,
      MAX.beneName,
    ),
    narrationVendor: remark,
    narrationOwn: remark,
    valueDate: formatValueDate(payment.scheduledDate),
    ifsc: String(vendor?.ifscCode || "").toUpperCase(),
    beneEmail: String(vendor?.email || "")
      .trim()
      .slice(0, MAX.email),
  };
};

// RFC 4180 quoting: wrap in quotes only when the value holds a comma,
// quote or line break; inner quotes are doubled. Values here are already
// cleaned to [A-Za-z0-9 ./-], so in practice nothing gets quoted.
const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Header row + one row per payment, CRLF line endings, no BOM
// (a BOM would land in the bank parser's first header cell).
const buildEnetCsv = (payments) => {
  const lines = [ENET_COLUMNS.map((c) => csvCell(c.header)).join(",")];

  payments.forEach((payment) => {
    const row = buildEnetRow(payment);
    // "Blank" columns have no value in the row object -> empty cell.
    // Amount is a plain number (6785 / 6785.5) — no separators or symbol.
    lines.push(ENET_COLUMNS.map((c) => csvCell(row[c.key])).join(","));
  });

  return lines.join("\r\n") + "\r\n";
};

module.exports = {
  buildEnetCsv,
  validateForEnet,
  ENET_COLUMNS,
};
