// ============================================================
// BACKEND: src/services/doctorPayoutSheetService.js — NEW FILE
// ------------------------------------------------------------
// The only place that touches the Excel library for doctor payouts.
//
//   readWorkbook(buffer)   .xlsx → plain cells for doctorPayoutValidation
//   buildTemplate(...)     the downloadable blank template
//
// Layout rules (see config/doctorPayoutConfig.js):
//   - the heading row is found anywhere in the first 15 rows (the client's
//     template has it on row 2, starting in column B)
//   - columns are matched by HEADING TEXT, not position, so moving or
//     inserting a column does not break an upload
//   - "Dr Ref" → referral, "Dr Sur And Anesthetic" → surgeon; any other
//     tab (notes, instructions, pivots) is ignored
// ============================================================
const ExcelJS = require("exceljs");
const cfg = require("../config/doctorPayoutConfig");
const { norm } = require("./doctorPayoutValidation");

const { TYPES, TYPE_LABELS, SHEETS, COLUMN_ALIASES, FIELD_LABELS } = cfg;

// heading (normalised) → field
const ALIAS_TO_FIELD = Object.entries(COLUMN_ALIASES).reduce(
  (map, [field, aliases]) => {
    aliases.forEach((a) => map.set(a, field));
    return map;
  },
  new Map(),
);

const SCAN_LIMIT = 20000; // rows read below the heading, at most

const richToText = (rich) => (rich || []).map((r) => r?.text ?? "").join("");

// ExcelJS cell → { kind, raw }
const readCell = (cell) => {
  let v = cell?.value;
  if (v === null || v === undefined) return { kind: "empty" };

  if (typeof v === "object" && !(v instanceof Date)) {
    if (v.error) return { kind: "error", raw: String(v.error) };
    if (Array.isArray(v.richText)) v = richToText(v.richText);
    else if (v.formula !== undefined || v.sharedFormula !== undefined) {
      v = v.result; // cached value; undefined if the file was never calculated
      if (v === null || v === undefined) return { kind: "empty" };
      if (typeof v === "object" && !(v instanceof Date)) {
        if (v.error) return { kind: "error", raw: String(v.error) };
        v = Array.isArray(v.richText) ? richToText(v.richText) : String(v);
      }
    } else if (v.text !== undefined) {
      // hyperlink cell (typed e-mail addresses become these)
      v = typeof v.text === "object" ? richToText(v.text?.richText) : v.text;
    } else {
      return { kind: "empty" };
    }
  }

  if (v instanceof Date)
    return isNaN(v.getTime())
      ? { kind: "error", raw: "date" }
      : { kind: "date", raw: v };
  if (typeof v === "number") return { kind: "number", raw: v };
  if (typeof v === "boolean") return { kind: "string", raw: String(v) };

  const s = String(v).replace(/[ ​]/g, " ").trim();
  return s ? { kind: "string", raw: s } : { kind: "empty" };
};

const cellText = (cell) => {
  const c = readCell(cell);
  return c.kind === "string" || c.kind === "number" ? String(c.raw) : "";
};

// Looks for the heading row: the first row carrying both a Branch and a
// PAN heading. Returns { rowNumber, columns: {field: colNumber}, unknown }.
const findHeader = (ws) => {
  const last = Math.min(ws.rowCount || 0, cfg.HEADER_SCAN_ROWS);
  for (let r = 1; r <= last; r += 1) {
    const row = ws.getRow(r);
    const columns = {};
    const repeated = [];
    const unknown = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const text = cellText(cell);
      if (!text) return;
      const field = ALIAS_TO_FIELD.get(norm(text));
      if (!field) return unknown.push(text);
      if (columns[field]) return repeated.push(text);
      columns[field] = col;
    });
    if (columns.branch && columns.panNumber)
      return { rowNumber: r, columns, repeated, unknown };
  }
  return null;
};

const detectType = (sheetName, columns) => {
  const name = norm(sheetName);
  const byName = Object.entries(SHEETS)
    .filter(([, s]) => s.nameHints.some((h) => name.includes(h)))
    .map(([type]) => type);
  if (byName.length === 1) return byName[0];
  // Tab name gives no clear answer — go by the columns.
  if (columns.noOfSurgeries && !columns.patientName) return TYPES.SURGEON;
  if (columns.patientName && !columns.noOfSurgeries) return TYPES.REFERRAL;
  return null;
};

// ============================================================
// readWorkbook
// → { sheets: [{ type, sheetName, headerRow, rows:[{rowNumber, cells}] }],
//     fileErrors: [..], fileWarnings: [..] }
// Throws only when the file is not a readable .xlsx.
// ============================================================
const readWorkbook = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (err) {
    const e = new Error(
      "This file could not be read as an Excel (.xlsx) workbook. Save it as .xlsx — not .xls or .csv — and make sure it is not password-protected.",
    );
    e.status = 400;
    throw e;
  }

  const sheets = [];
  const fileErrors = [];
  const fileWarnings = [];

  wb.eachSheet((ws) => {
    const header = findHeader(ws);
    if (!header) return; // notes / instructions / empty tab — not ours

    const type = detectType(ws.name, header.columns);
    if (!type) {
      fileWarnings.push(
        `Sheet "${ws.name}" was ignored — it is neither "${SHEETS[TYPES.REFERRAL].name}" nor "${SHEETS[TYPES.SURGEON].name}"`,
      );
      return;
    }

    // A hidden tab full of payout rows must never go through unseen.
    if (ws.state && ws.state !== "visible") {
      fileErrors.push(
        `Sheet "${ws.name}" is hidden — unhide it or delete it, then upload again`,
      );
      return;
    }

    if (sheets.some((s) => s.type === type)) {
      fileErrors.push(
        `More than one sheet looks like ${TYPE_LABELS[type]} ("${ws.name}") — keep only one`,
      );
      return;
    }

    const missing = cfg.REQUIRED_FIELDS[type].filter((f) => !header.columns[f]);
    if (missing.length) {
      fileErrors.push(
        `Sheet "${ws.name}" is missing column${missing.length === 1 ? "" : "s"}: ${missing
          .map((f) => FIELD_LABELS[f])
          .join(", ")}`,
      );
      return;
    }
    if (header.repeated.length)
      fileWarnings.push(
        `Sheet "${ws.name}": heading${header.repeated.length === 1 ? "" : "s"} repeated (${header.repeated.join(
          ", ",
        )}) — the first one was used`,
      );

    const fields = Object.entries(header.columns);
    const rows = [];
    // Formatting dragged down a whole column can make a sheet claim a
    // million rows; never walk further than this past the heading.
    const lastRow = Math.min(ws.rowCount, header.rowNumber + SCAN_LIMIT);
    for (let r = header.rowNumber + 1; r <= lastRow; r += 1) {
      const row = ws.getRow(r);
      const cells = {};
      let any = false;
      fields.forEach(([field, col]) => {
        const c = readCell(row.getCell(col));
        cells[field] = c;
        if (c.kind !== "empty") any = true;
      });
      if (any) rows.push({ rowNumber: r, cells });
    }

    sheets.push({
      type,
      sheetName: ws.name,
      headerRow: header.rowNumber,
      rows,
    });
  });

  if (!sheets.length && !fileErrors.length)
    fileErrors.push(
      `No "${SHEETS[TYPES.REFERRAL].name}" or "${SHEETS[TYPES.SURGEON].name}" sheet with the template headings was found — download the template and paste your data into it`,
    );

  return { sheets, fileErrors, fileWarnings };
};

// ============================================================
// buildTemplate — the blank upload template
// ------------------------------------------------------------
// Same tabs, headings and position (row 2, column B) as the client's
// Template.xlsx, with the cell formats fixed:
//   - PAN / account number / IFSC / mobile columns are TEXT, so Excel no
//     longer drops leading zeros or rounds 16+ digit account numbers
//   - Date is DD/MM/YYYY, amounts are 2-decimal numbers
// branchNames: the branches this user may upload for (listed on the
// Instructions tab, since the Branch column must match one exactly).
// ============================================================
const TEXT_FIELDS = ["panNumber", "accountNumber", "ifscCode", "mobile"];
const AMOUNT_FIELDS = [
  "settledAmount",
  "basicAmount",
  "tdsAmount",
  "payableAmount",
];
const WIDTHS = {
  branch: 20,
  date: 13,
  doctorName: 26,
  patientName: 26,
  settledAmount: 16,
  noOfSurgeries: 16,
  basicAmount: 15,
  tdsAmount: 12,
  payableAmount: 16,
  panNumber: 15,
  accountNumber: 24,
  ifscCode: 15,
  bankName: 22,
  accountHolderName: 26,
  mobile: 18,
  email: 28,
};

const HEADER_STYLE = {
  font: { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3C6E" } },
  alignment: { vertical: "middle", horizontal: "center", wrapText: true },
  border: {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  },
};

const buildTemplate = ({ branchNames = [] } = {}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PMS — Healing Hands Clinic";
  wb.created = new Date();

  Object.values(TYPES).forEach((type) => {
    const ws = wb.addWorksheet(SHEETS[type].name);
    ws.getColumn(1).width = 3; // column A stays empty, as in the original
    const header = ws.getRow(2);
    header.height = 30;
    cfg.TEMPLATE_COLUMNS[type].forEach(([field, title], i) => {
      const col = ws.getColumn(i + 2);
      col.width = WIDTHS[field] || 18;
      if (TEXT_FIELDS.includes(field)) col.numFmt = "@";
      else if (AMOUNT_FIELDS.includes(field)) col.numFmt = "#,##0.00";
      else if (field === "date") col.numFmt = "dd/mm/yyyy";
      else if (field === "noOfSurgeries") col.numFmt = "0";
      const cell = header.getCell(i + 2);
      cell.value = title;
      Object.assign(cell, HEADER_STYLE);
      cell.numFmt = "@";
    });
    ws.views = [{ state: "frozen", ySplit: 2 }];
  });

  const notes = wb.addWorksheet("Instructions");
  notes.getColumn(1).width = 110;
  const lines = [
    ["How to fill this file", true],
    [
      "1. Enter referral payouts on the “Dr Ref” tab and surgeon / anaesthetist payouts on the “Dr Sur And Anesthetic” tab. One payout per row. Do not change the headings.",
    ],
    [
      "2. Every column is compulsory except Doctor Mobile No and Doctor Email Id.",
    ],
    ["3. Payable Amount must equal Basic Amount minus TDS."],
    [
      "4. PAN identifies the doctor. A new PAN creates the doctor in the Doctor Master; an existing PAN is checked against the stored bank details.",
    ],
    [
      "5. Bank Account Number, IFSC, PAN and mobile columns are formatted as Text — keep them that way so leading zeros and long account numbers are not altered by Excel.",
    ],
    ["6. Date format: DD/MM/YYYY."],
    ["7. Do not add a totals row, and do not leave hidden tabs with data."],
    [
      "8. The value in the first column must be one of these, exactly as written:",
    ],
    ...(branchNames.length
      ? branchNames.map((n) => [`      ${n}`])
      : [["      (your assigned names as shown in PMS)"]]),
  ];
  lines.forEach(([text, bold], i) => {
    const cell = notes.getCell(i + 1, 1);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: "top" };
    if (bold) cell.font = { bold: true, size: 13 };
  });

  return wb;
};

module.exports = { readWorkbook, buildTemplate, readCell };
