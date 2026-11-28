// ============================================================
// BACKEND: src/services/doctorListService.js — NEW FILE
// ------------------------------------------------------------
// "Import doctor list": Accounts are handed a list of doctors and load it
// into the Doctor Master in one go, then complete each profile (remaining
// details + documents) on screen.
//
//   readDoctorList(buffer)     .xlsx → plain cells          (uses ExcelJS)
//   normaliseDoctorRows(rows)  cells → values + errors      (pure)
//   planDoctorImport(...)      what each row will do        (pure)
//   buildDoctorListTemplate()  the blank template           (uses ExcelJS)
//
// Rules
//   - PAN and doctor name are compulsory; everything else may be blank.
//   - Bank details: all four fields or none.
//   - A PAN not in the master → new doctor.
//   - A PAN already in the master → only BLANK fields of the master are
//     filled. Nothing already stored is overwritten — in particular a
//     different bank account in the list is reported, never applied
//     (bank changes go through the payout approval or a reasoned edit).
// ============================================================
const ExcelJS = require("exceljs");
const cfg = require("../config/doctorPayoutConfig");
const {
  readText,
  readAccount,
  readMobile,
  norm,
  compareBank,
  bankOf,
} = require("./doctorPayoutValidation");
const { readCell } = require("./doctorPayoutSheetService");

const FIELD_TITLES = Object.fromEntries(cfg.DOCTOR_LIST_COLUMNS);
const ALIAS_TO_FIELD = Object.entries(cfg.DOCTOR_LIST_ALIASES).reduce(
  (map, [field, aliases]) => {
    aliases.forEach((a) => {
      if (!map.has(a)) map.set(a, field);
    });
    return map;
  },
  new Map(),
);
const TEXT_FIELDS = [
  "specialisation",
  "registrationNumber",
  "hospitalName",
  "city",
  "address",
];
const BANK_FIELDS = [
  "accountNumber",
  "ifscCode",
  "bankName",
  "accountHolderName",
];
// Fields an import may FILL when the master has them blank.
const FILLABLE = ["mobile", "email", "doctorType", ...TEXT_FIELDS];
const SCAN_ROWS = 15;
const SCAN_LIMIT = 20000;

const cellText = (cell) => {
  const c = readCell(cell);
  return c.kind === "string" || c.kind === "number" ? String(c.raw) : "";
};

// ── read ──────────────────────────────────────────────────
// First sheet that has a heading row with both a doctor-name and a PAN
// column. → { sheetName, rows: [{ rowNumber, cells }], fileErrors }
const readDoctorList = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (err) {
    const e = new Error(
      "This file could not be read as an Excel (.xlsx) workbook. Save it as .xlsx and make sure it is not password-protected.",
    );
    e.status = 400;
    throw e;
  }

  let found = null;
  wb.eachSheet((ws) => {
    if (found || (ws.state && ws.state !== "visible")) return;
    const last = Math.min(ws.rowCount || 0, SCAN_ROWS);
    for (let r = 1; r <= last; r += 1) {
      const columns = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        const field = ALIAS_TO_FIELD.get(norm(cellText(cell)));
        if (field && !columns[field]) columns[field] = col;
      });
      if (columns.name && columns.panNumber) {
        found = { ws, headerRow: r, columns };
        return;
      }
    }
  });

  if (!found)
    return {
      sheetName: null,
      rows: [],
      fileErrors: [
        `No sheet with "${FIELD_TITLES.name}" and "${FIELD_TITLES.panNumber}" headings was found — download the doctor list template and paste your list into it`,
      ],
    };

  const { ws, headerRow, columns } = found;
  const fields = Object.entries(columns);
  const rows = [];
  const lastRow = Math.min(ws.rowCount, headerRow + SCAN_LIMIT);
  for (let r = headerRow + 1; r <= lastRow; r += 1) {
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

  const fileErrors = [];
  if (rows.length > cfg.MAX_DOCTOR_LIST_ROWS)
    fileErrors.push(
      `${rows.length} rows — the limit is ${cfg.MAX_DOCTOR_LIST_ROWS}. Split the list.`,
    );
  return { sheetName: ws.name, rows, fileErrors };
};

// "Surgeon", "anesthetist", "Referral doctor" … → a DOCTOR_TYPES key
const readDoctorType = (text) => {
  const t = norm(text);
  if (!t) return { empty: true };
  if (cfg.DOCTOR_TYPES[t]) return { value: t };
  if (/an(a)?esth/.test(t)) return { value: "anaesthetist" };
  if (/surg/.test(t)) return { value: "surgeon" };
  if (/ref/.test(t)) return { value: "referring" };
  if (/other/.test(t)) return { value: "other" };
  return { error: true };
};

// ── normalise (pure) ──────────────────────────────────────
const normaliseDoctorRows = (rows) => {
  const seen = new Map(); // PAN → first row number
  return (rows || []).map(({ rowNumber, cells }) => {
    const c = cells || {};
    const errors = [];
    const warnings = [];
    const v = {};

    v.name = readText(c.name).slice(0, 120);
    if (!v.name) errors.push("Name of Doctor is required");

    v.panNumber = readText(c.panNumber).toUpperCase().replace(/\s/g, "");
    if (!v.panNumber) errors.push("Pan Number is required");
    else if (!cfg.PAN_REGEX.test(v.panNumber))
      errors.push(`PAN "${v.panNumber}" is not valid (e.g. ABCDE1234F)`);
    else if (seen.has(v.panNumber))
      errors.push(`Same PAN as row ${seen.get(v.panNumber)} of this list`);
    else seen.set(v.panNumber, rowNumber);

    const type = readDoctorType(readText(c.doctorType));
    if (type.error)
      warnings.push(
        `Doctor Type "${readText(c.doctorType)}" not recognised — left blank (use Referring doctor, Surgeon, Anaesthetist or Other)`,
      );
    else if (!type.empty) v.doctorType = type.value;

    TEXT_FIELDS.forEach((f) => {
      const t = readText(c[f]).slice(0, f === "address" ? 300 : 120);
      if (t) v[f] = t;
    });

    const mob = readMobile(c.mobile);
    if (mob.error) warnings.push(`Mobile ${mob.error} — not saved`);
    else if (!mob.empty) v.mobile = mob.value;

    const email = readText(c.email).toLowerCase();
    if (email) {
      if (cfg.EMAIL_REGEX.test(email)) v.email = email;
      else warnings.push("Email is not valid — not saved");
    }

    // Bank details: all four, valid — or none.
    const acc = readAccount(c.accountNumber);
    const ifsc = readText(c.ifscCode).toUpperCase().replace(/\s/g, "");
    const bankName = readText(c.bankName).slice(0, 80);
    const holder = readText(c.accountHolderName).slice(0, 120);
    const anyBank = !acc.empty || ifsc || bankName || holder;
    if (anyBank) {
      const before = errors.length;
      if (acc.error) errors.push(`Bank Account Number ${acc.error}`);
      else if (acc.empty || !cfg.ACCOUNT_REGEX.test(acc.value))
        errors.push("Bank Account Number must be 6–20 digits");
      if (!cfg.IFSC_REGEX.test(ifsc))
        errors.push(
          ifsc
            ? `IFSC "${ifsc}" is not valid (e.g. HDFC0001234)`
            : "IFSC is required when bank details are given",
        );
      if (!bankName)
        errors.push("Bank Name is required when bank details are given");
      if (!holder)
        errors.push("Name As Per Bank is required when bank details are given");
      if (errors.length === before) {
        Object.assign(v, {
          accountNumber: acc.value,
          ifscCode: ifsc,
          bankName,
          accountHolderName: holder,
        });
        if (acc.numericCell)
          warnings.push(
            "Account number was typed as a number in the Excel — a leading 0, if it has one, was dropped. Confirm the account number.",
          );
      }
    }

    return { rowNumber, values: v, errors, warnings };
  });
};

// ── plan (pure) ───────────────────────────────────────────
// doctorsByPan: { PAN: master doctor }
// → rows with { action: "create" | "update" | "none" | "error", fills, notes }
const planDoctorImport = (rows, doctorsByPan = {}) => {
  const out = rows.map((r) => {
    const base = { ...r, fills: {}, notes: [...r.warnings] };
    if (r.errors.length) return { ...base, action: "error" };

    const v = r.values;
    const master = doctorsByPan[v.panNumber];
    if (!master) {
      if (!v.accountNumber)
        base.notes.push(
          "No bank details — add them before a payment can be raised",
        );
      return { ...base, action: "create" };
    }

    const fills = {};
    FILLABLE.forEach((f) => {
      if (v[f] && !master[f]) fills[f] = v[f];
    });
    if (v.accountNumber) {
      if (!master.accountNumber) BANK_FIELDS.forEach((f) => (fills[f] = v[f]));
      else if (compareBank(bankOf(master), bankOf(v))?.severity === "critical")
        base.notes.push(
          "Bank account in the list differs from the Doctor Master — NOT changed. Edit it in the master (with a reason) if the list is right.",
        );
    }
    if (norm(master.name) !== norm(v.name))
      base.notes.push(
        `Doctor Master has this PAN as "${master.name}" — name not changed`,
      );

    return {
      ...base,
      doctor: {
        _id: String(master._id),
        doctorCode: master.doctorCode,
        name: master.name,
      },
      fills,
      action: Object.keys(fills).length ? "update" : "none",
    };
  });

  const count = (a) => out.filter((r) => r.action === a).length;
  return {
    rows: out,
    summary: {
      rows: out.length,
      create: count("create"),
      update: count("update"),
      unchanged: count("none"),
      errors: count("error"),
    },
  };
};

// ── template ──────────────────────────────────────────────
const buildDoctorListTemplate = () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PMS — Healing Hands Clinic";
  wb.created = new Date();
  const ws = wb.addWorksheet("Doctor List");
  const TEXT = [
    "panNumber",
    "accountNumber",
    "ifscCode",
    "mobile",
    "registrationNumber",
  ];
  const WIDTH = {
    name: 28,
    address: 36,
    email: 28,
    hospitalName: 26,
    accountHolderName: 26,
    accountNumber: 24,
  };
  const header = ws.getRow(1);
  header.height = 28;
  cfg.DOCTOR_LIST_COLUMNS.forEach(([field, title], i) => {
    const col = ws.getColumn(i + 1);
    col.width = WIDTH[field] || 18;
    if (TEXT.includes(field)) col.numFmt = "@";
    const cell = header.getCell(i + 1);
    cell.value = title;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A3C6E" },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.numFmt = "@";
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const notes = wb.addWorksheet("Instructions");
  notes.getColumn(1).width = 110;
  [
    "How to fill the doctor list",
    "1. One doctor per row. Name of Doctor and Pan Number are compulsory; every other column can be left blank and completed later in the Doctor Master.",
    "2. Doctor Type: Referring doctor, Surgeon, Anaesthetist or Other.",
    "3. Bank details: give all four (account number, IFSC, bank name, name as per bank) or leave all four blank.",
    "4. A PAN already in the Doctor Master is not duplicated: only details that are blank in the master are filled. Stored details — including the bank account — are never overwritten by this import.",
    "5. Documents (PAN card, cancelled cheque) are uploaded on the doctor's page in the Doctor Master after the import.",
  ].forEach((text, i) => {
    const cell = notes.getCell(i + 1, 1);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: "top" };
    if (i === 0) cell.font = { bold: true, size: 13 };
  });
  return wb;
};

module.exports = {
  readDoctorList,
  normaliseDoctorRows,
  planDoctorImport,
  buildDoctorListTemplate,
  FILLABLE,
  BANK_FIELDS,
};
