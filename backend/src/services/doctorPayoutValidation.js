// ============================================================
// BACKEND: src/services/doctorPayoutValidation.js — NEW FILE
// ------------------------------------------------------------
// Pure validation for the Doctor Referral / Surgeon payout upload.
// No database, no Excel library, no HTTP — plain data in, plain data out,
// so the same code runs for the PREVIEW and again for the SUBMIT (the
// server never trusts rows sent back by the browser; it re-reads the file).
//
//   normaliseRows()  cells  → typed values + per-row errors/warnings
//   assessRows()     rows   → new-doctor / bank-mismatch / duplicate flags,
//                             summary and the list of things blocking submit
//
// Input cells come from doctorPayoutSheetService.readWorkbook():
//   { kind: "empty" | "string" | "number" | "date" | "error", raw }
// ============================================================
const cfg = require("../config/doctorPayoutConfig");

const { TYPES, FIELD_LABELS } = cfg;

// ── small helpers ─────────────────────────────────────────
const norm = (v) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const squash = (v) =>
  String(v ?? "")
    .replace(/[ ​]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const pad2 = (n) => String(n).padStart(2, "0");

const isEmpty = (cell) => !cell || cell.kind === "empty";

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const isoOf = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    return null; // 31/02 etc.
  if (y < 2000 || y > 2100) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

const fullYear = (y) => (y < 100 ? 2000 + y : y);

// ── cell readers ──────────────────────────────────────────
// Plain text of a cell (numbers and dates rendered sensibly).
const readText = (cell) => {
  if (isEmpty(cell) || cell.kind === "error") return "";
  if (cell.kind === "date") {
    const d = cell.raw;
    return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }
  if (cell.kind === "number") {
    return String(cell.raw);
  }
  return squash(cell.raw);
};

// Money. Accepts 12500, "12,500.00", "₹ 12,500", "Rs. 500". "-" is how the
// accounting number format shows zero, so a typed "-" reads as 0.
const readAmount = (cell) => {
  if (isEmpty(cell)) return { empty: true };
  if (cell.kind === "error")
    return { error: "has an Excel error (#REF!, #N/A …)" };
  if (cell.kind === "date") return { error: "is a date, not an amount" };
  if (cell.kind === "number") {
    if (!Number.isFinite(cell.raw)) return { error: "is not a valid number" };
    return { value: round2(cell.raw) };
  }
  let s = squash(cell.raw);
  if (s === "-" || s === "–") return { value: 0 };
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s
    .replace(/^\(|\)$/g, "")
    .replace(/₹|rs\.?|inr|\/-/gi, "")
    .replace(/[,\s]/g, "")
    .replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: "is not a number" };
  const n = Number(s);
  return { value: round2(negative ? -n : n) };
};

const readInteger = (cell) => {
  const a = readAmount(cell);
  if (a.empty || a.error) return a;
  if (!Number.isInteger(a.value)) return { error: "must be a whole number" };
  return a;
};

// Dates. A real Excel date cell is unambiguous. Text is read the Indian
// way — DD/MM/YYYY — never MM/DD.
const readDate = (cell) => {
  if (isEmpty(cell)) return { empty: true };
  if (cell.kind === "error") return { error: "has an Excel error" };

  if (cell.kind === "date") {
    const d = cell.raw;
    const iso = isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return iso ? { value: iso } : { error: "is not a valid date" };
  }

  if (cell.kind === "number") {
    // A date cell formatted as a number arrives as its serial (46350).
    const n = cell.raw;
    if (Number.isFinite(n) && n > 36526 && n < 73050) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      const iso = isoOf(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
      );
      if (iso) return { value: iso };
    }
    return { error: "is not a valid date" };
  }

  const s = squash(cell.raw);
  let m;
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/))) {
    const iso = isoOf(fullYear(+m[3]), +m[2], +m[1]);
    return iso ? { value: iso } : { error: "is not a valid date (DD/MM/YYYY)" };
  }
  if ((m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/))) {
    const iso = isoOf(+m[1], +m[2], +m[3]);
    return iso ? { value: iso } : { error: "is not a valid date" };
  }
  if (
    (m = s.match(/^(\d{1,2})[\s\-/.]*([A-Za-z]{3,9})[\s\-/.,']*(\d{2}|\d{4})$/))
  ) {
    const mon =
      MONTHS[m[2].slice(0, 4).toLowerCase()] ||
      MONTHS[m[2].slice(0, 3).toLowerCase()];
    const iso = mon ? isoOf(fullYear(+m[3]), mon, +m[1]) : null;
    return iso ? { value: iso } : { error: "is not a valid date" };
  }
  if ((m = s.match(/^([A-Za-z]{3,9})[\s\-/.,']*(\d{2}|\d{4})$/))) {
    // "Nov 2026" — a month. Taken as the 1st of that month.
    const mon =
      MONTHS[m[1].slice(0, 4).toLowerCase()] ||
      MONTHS[m[1].slice(0, 3).toLowerCase()];
    const iso = mon ? isoOf(fullYear(+m[2]), mon, 1) : null;
    return iso
      ? { value: iso, monthOnly: true }
      : { error: "is not a valid date" };
  }
  return { error: "is not a valid date (use DD/MM/YYYY)" };
};

// Bank account number. Excel stores a typed number as a float: beyond 15
// digits the last digits are silently changed, and leading zeros vanish.
const readAccount = (cell) => {
  if (isEmpty(cell)) return { empty: true };
  if (cell.kind === "error") return { error: "has an Excel error" };
  if (cell.kind === "date")
    return { error: "is a date, not an account number" };
  if (cell.kind === "number") {
    const n = cell.raw;
    if (!Number.isInteger(n) || n < 0)
      return { error: "is not a valid account number" };
    if (n > 999999999999999)
      return {
        error:
          "has more than 15 digits in a number cell, so Excel has altered it — format the column as Text and type it again",
      };
    return { value: String(n), numericCell: true };
  }
  const s = String(cell.raw)
    .replace(/^'/, "")
    .replace(/[\s -]/g, "");
  if (/e\+/i.test(s))
    return {
      error:
        "is in scientific notation (Excel altered it) — format the column as Text and type it again",
    };
  return { value: s };
};

// 10-digit Indian mobile; +91 / 91 / leading 0 are dropped.
const readMobile = (cell) => {
  if (isEmpty(cell)) return { empty: true };
  let s = readText(cell).replace(/\D/g, "");
  if (s.length === 12 && s.startsWith("91")) s = s.slice(2);
  if (s.length === 11 && s.startsWith("0")) s = s.slice(1);
  if (!cfg.MOBILE_REGEX.test(s)) return { error: "is not a 10-digit mobile" };
  return { value: s };
};

// ── branch lookup ─────────────────────────────────────────
const BRAND_PREFIX = /^(healinghandsclinic|healinghands|hhc)/;

const buildBranchIndex = (branches) => {
  const exact = new Map(); // normalised name/code → [branch]
  const loose = new Map(); // brand prefix removed → [branch]
  const add = (map, key, b) => {
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.some((x) => String(x._id) === String(b._id))) list.push(b);
    map.set(key, list);
  };
  branches.forEach((b) => {
    add(exact, norm(b.name), b);
    add(exact, norm(b.code), b);
    add(loose, norm(b.name).replace(BRAND_PREFIX, ""), b);
  });
  return { exact, loose };
};

const findBranch = (index, raw) => {
  const key = norm(raw);
  if (!key) return { branch: null };
  let hits = index.exact.get(key);
  let loose = false;
  if (!hits) {
    hits = index.loose.get(key.replace(BRAND_PREFIX, ""));
    loose = Boolean(hits);
  }
  if (!hits || !hits.length) return { branch: null };
  if (hits.length > 1) return { branch: null, ambiguous: hits };
  return { branch: hits[0], loose };
};

// ── fingerprints (duplicate detection) ────────────────────
// Referral: the same patient referred by the same doctor to the same
//           branch on the same date is the same referral, whatever the
//           amount typed.
// Surgeon:  rows are per doctor per date, so the count and basic amount
//           are part of the identity.
const fingerprintOf = (type, v) => {
  if (!v.panNumber || !v.branchId || !v.date) return null;
  if (type === TYPES.REFERRAL) {
    if (!v.patientName) return null;
    return ["ref", v.panNumber, v.branchId, v.date, norm(v.patientName)].join(
      "|",
    );
  }
  if (v.noOfSurgeries == null || v.basicAmount == null) return null;
  return [
    "sur",
    v.panNumber,
    v.branchId,
    v.date,
    v.noOfSurgeries,
    round2(v.basicAmount).toFixed(2),
  ].join("|");
};

const daysBetween = (isoA, isoB) =>
  Math.round((Date.parse(isoA) - Date.parse(isoB)) / 86400000);

// ============================================================
// normaliseRows
// ------------------------------------------------------------
// sheets:   [{ type, sheetName, rows: [{ rowNumber, cells: {field: cell} }] }]
// branches: [{ _id, name, code, status }]            (every branch)
// allowedBranchIds: array of ids the uploader may use, or null = any
// today:    "YYYY-MM-DD" (IST) — injected so the function stays pure
// ============================================================
const normaliseRows = ({ sheets, branches, allowedBranchIds, today }) => {
  const index = buildBranchIndex(branches || []);
  const allowed = allowedBranchIds
    ? new Set(allowedBranchIds.map(String))
    : null;

  const rows = [];
  const fileErrors = [];
  const fileWarnings = [];

  (sheets || []).forEach((sheet) => {
    const { type, sheetName } = sheet;
    const required = cfg.REQUIRED_FIELDS[type] || [];
    let kept = 0;

    (sheet.rows || []).forEach(({ rowNumber, cells }) => {
      const c = cells || {};
      const errors = [];
      const warnings = [];
      const err = (field, message) => errors.push({ field, message });
      const warn = (code, message, field) =>
        warnings.push({ code, message, ...(field ? { field } : {}) });
      const label = (f) => FIELD_LABELS[f] || f;

      // A totals line typed under the data: no branch, doctor or PAN.
      const identityBlank =
        isEmpty(c.panNumber) && isEmpty(c.doctorName) && isEmpty(c.branch);
      const saysTotal = [c.branch, c.doctorName, c.date, c.patientName].some(
        (x) => !isEmpty(x) && /^(grand\s*)?total\b/i.test(readText(x)),
      );
      if (identityBlank || (saysTotal && isEmpty(c.panNumber))) {
        fileWarnings.push(
          `${sheetName} row ${rowNumber}: looks like a total / blank line — ignored`,
        );
        return;
      }

      kept += 1;
      if (kept > cfg.MAX_ROWS_PER_SHEET) return; // reported once, below

      const v = {};

      // ── required-field presence ──
      required.forEach((f) => {
        if (isEmpty(c[f])) err(f, `${label(f)} is required`);
      });

      // ── branch ──
      v.branchRaw = readText(c.branch);
      if (v.branchRaw) {
        const hit = findBranch(index, v.branchRaw);
        if (hit.ambiguous) {
          err(
            "branch",
            `Branch "${v.branchRaw}" matches more than one branch (${hit.ambiguous
              .map((b) => b.name)
              .join(", ")}) — use the branch code`,
          );
        } else if (!hit.branch) {
          err(
            "branch",
            `Branch "${v.branchRaw}" is not a branch in PMS — use the exact branch name or code`,
          );
        } else if (hit.branch.status && hit.branch.status !== "active") {
          err("branch", `Branch "${hit.branch.name}" is inactive`);
        } else if (allowed && !allowed.has(String(hit.branch._id))) {
          err(
            "branch",
            `Branch "${hit.branch.name}" is not one of your assigned branches`,
          );
        } else {
          v.branchId = String(hit.branch._id);
          v.branchName = hit.branch.name;
          v.branchCode = hit.branch.code;
          if (hit.loose)
            warn(
              "BRANCH_LOOSE_MATCH",
              `Branch "${v.branchRaw}" taken as "${hit.branch.name}"`,
              "branch",
            );
        }
      }

      // ── date ──
      const d = readDate(c.date);
      if (d.error) err("date", `Date ${d.error}`);
      else if (!d.empty) {
        v.date = d.value;
        if (today) {
          const ahead = daysBetween(d.value, today);
          if (ahead > cfg.DATE_WARN_FUTURE_DAYS)
            warn("DATE_FUTURE", "Date is in the future", "date");
          else if (-ahead > cfg.DATE_WARN_PAST_DAYS)
            warn("DATE_OLD", "Date is more than a year old", "date");
        }
        if (d.monthOnly)
          warn(
            "DATE_MONTH_ONLY",
            "Only a month was given — taken as the 1st",
            "date",
          );
      }

      // ── names ──
      v.doctorName = readText(c.doctorName).slice(0, 120);
      if (type === TYPES.REFERRAL)
        v.patientName = readText(c.patientName).slice(0, 120);

      // ── amounts ──
      const amount = (field, { min = 0, strict = false } = {}) => {
        const a = readAmount(c[field]);
        if (a.empty) return null;
        if (a.error) {
          err(field, `${label(field)} ${a.error}`);
          return null;
        }
        if (a.value < min || (strict && a.value <= min)) {
          err(
            field,
            `${label(field)} must be ${strict ? "more than" : "at least"} ${min}`,
          );
          return null;
        }
        return a.value;
      };
      v.settledAmount = amount("settledAmount");
      v.basicAmount = amount("basicAmount", { strict: true });
      v.tdsAmount = amount("tdsAmount");
      v.payableAmount = amount("payableAmount", { strict: true });

      if (type === TYPES.SURGEON) {
        const n = readInteger(c.noOfSurgeries);
        if (n.error) err("noOfSurgeries", `No of Surgeries ${n.error}`);
        else if (!n.empty) {
          if (n.value < 1)
            err("noOfSurgeries", "No of Surgeries must be 1 or more");
          else v.noOfSurgeries = n.value;
        }
      }

      if (v.basicAmount != null && v.tdsAmount != null) {
        if (v.tdsAmount >= v.basicAmount)
          err("tdsAmount", "TDS cannot be equal to or more than Basic Amount");
        else if (v.payableAmount != null) {
          const expected = round2(v.basicAmount - v.tdsAmount);
          if (Math.abs(expected - v.payableAmount) > cfg.AMOUNT_TOLERANCE)
            err(
              "payableAmount",
              `Payable Amount should be Basic − TDS = ${expected.toFixed(2)}`,
            );
        }
        v.tdsPercent = round2((v.tdsAmount / v.basicAmount) * 100);
        if (v.tdsAmount === 0) warn("NO_TDS", "No TDS deducted", "tdsAmount");
      }
      if (
        v.basicAmount != null &&
        v.settledAmount != null &&
        v.settledAmount > 0 &&
        v.basicAmount > v.settledAmount
      )
        warn(
          "BASIC_OVER_SETTLED",
          "Basic Amount is more than the Settled Amount",
          "basicAmount",
        );

      // ── PAN ──
      v.panNumber = readText(c.panNumber).toUpperCase().replace(/\s/g, "");
      if (v.panNumber && !cfg.PAN_REGEX.test(v.panNumber)) {
        err("panNumber", `PAN "${v.panNumber}" is not valid (e.g. ABCDE1234F)`);
      } else if (v.panNumber && v.panNumber[3] !== "P") {
        warn(
          "PAN_NOT_INDIVIDUAL",
          "PAN is not an individual's (4th letter is not P)",
          "panNumber",
        );
      }

      // ── bank ──
      const acc = readAccount(c.accountNumber);
      if (acc.error) err("accountNumber", `Bank Account Number ${acc.error}`);
      else if (!acc.empty) {
        if (!cfg.ACCOUNT_REGEX.test(acc.value))
          err("accountNumber", "Bank Account Number must be 6–20 digits");
        else v.accountNumber = acc.value;
      }
      v.ifscCode = readText(c.ifscCode).toUpperCase().replace(/\s/g, "");
      if (v.ifscCode && !cfg.IFSC_REGEX.test(v.ifscCode)) {
        err(
          "ifscCode",
          /^[A-Z]{4}O/.test(v.ifscCode)
            ? `IFSC "${v.ifscCode}" — the 5th character must be the digit 0, not the letter O`
            : `IFSC "${v.ifscCode}" is not valid (e.g. HDFC0001234)`,
        );
      }
      v.bankName = readText(c.bankName).slice(0, 80);
      v.accountHolderName = readText(c.accountHolderName).slice(0, 120);

      // ── optional contact — a bad value is dropped, never blocks ──
      const mob = readMobile(c.mobile);
      if (mob.error)
        warn("MOBILE_IGNORED", `Mobile ${mob.error} — not saved`, "mobile");
      else if (!mob.empty) v.mobile = mob.value;

      const email = readText(c.email).toLowerCase();
      if (email) {
        if (cfg.EMAIL_REGEX.test(email)) v.email = email;
        else warn("EMAIL_IGNORED", "Email is not valid — not saved", "email");
      }

      rows.push({
        key: `${type}:${rowNumber}`,
        type,
        sheetName,
        rowNumber,
        values: v,
        // What was typed, as text — the preview shows this for a cell that
        // failed validation (a bad date has no "value" to show).
        raw: Object.fromEntries(
          Object.keys(c).map((f) => [
            f,
            c[f]?.kind === "error" ? "#ERROR" : readText(c[f]),
          ]),
        ),
        accountNumericCell: Boolean(acc.numericCell),
        errors,
        warnings,
        fingerprint: errors.length ? null : fingerprintOf(type, v),
      });
    });

    if (kept > cfg.MAX_ROWS_PER_SHEET)
      fileErrors.push(
        `${sheetName}: ${kept} rows — the limit is ${cfg.MAX_ROWS_PER_SHEET} per sheet. Split the file.`,
      );
  });

  return { rows, fileErrors, fileWarnings };
};

// ── bank comparison ───────────────────────────────────────
const BANK_FIELDS = [
  ["accountNumber", "Account number", true],
  ["ifscCode", "IFSC", true],
  ["bankName", "Bank name", false],
  ["accountHolderName", "Name as per bank", false],
];

const sameBankValue = (field, a, b) =>
  field === "accountNumber" || field === "ifscCode"
    ? String(a || "")
        .trim()
        .toUpperCase() ===
      String(b || "")
        .trim()
        .toUpperCase()
    : norm(a) === norm(b);

// → null when identical, else { severity, fields: [{field,label,stored,sheet}] }
const compareBank = (stored, sheet) => {
  const fields = [];
  let critical = false;
  BANK_FIELDS.forEach(([field, label, isCritical]) => {
    if (!sameBankValue(field, stored?.[field], sheet?.[field])) {
      fields.push({
        field,
        label,
        stored: stored?.[field] || "",
        sheet: sheet?.[field] || "",
        critical: isCritical,
      });
      if (isCritical) critical = true;
    }
  });
  if (!fields.length) return null;
  return { severity: critical ? "critical" : "minor", fields };
};

const bankOf = (o) => ({
  accountNumber: o?.accountNumber || "",
  ifscCode: o?.ifscCode || "",
  bankName: o?.bankName || "",
  accountHolderName: o?.accountHolderName || "",
});

const accountKey = (o) =>
  o?.accountNumber && o?.ifscCode
    ? `${String(o.accountNumber).trim()}|${String(o.ifscCode).trim().toUpperCase()}`
    : null;

// ============================================================
// assessRows
// ------------------------------------------------------------
// rows:            output of normaliseRows
// doctorsByPan:    { PAN: doctor }                — master records found
// doctorsByAccount:{ "acct|IFSC": [{panNumber,name}] } — who uses a bank a/c
// existingByFingerprint: { fp: { payoutId, batchId, status } }
// decisions: {
//   bank: { PAN: "keep" | "update" },   // how to settle a bank mismatch
//   allowDuplicates: boolean            // uploader confirmed the duplicates
// }
// ============================================================
const assessRows = ({
  rows,
  doctorsByPan = {},
  doctorsByAccount = {},
  existingByFingerprint = {},
  decisions = {},
  fileErrors = [],
}) => {
  const bankDecisions = decisions.bank || {};
  const allowDuplicates = Boolean(decisions.allowDuplicates);
  const out = rows.map((r) => ({
    ...r,
    errors: [...r.errors],
    warnings: [...r.warnings],
    flags: {
      newDoctor: false,
      bankMismatch: null,
      bankDecision: null,
      duplicate: null,
      duplicateRef: null,
      sharedBank: false,
    },
    doctor: null,
  }));

  // ── group by PAN (only rows with a usable PAN) ──
  const byPan = new Map();
  out.forEach((r) => {
    const pan = r.values.panNumber;
    if (!pan || !cfg.PAN_REGEX.test(pan)) return;
    if (!byPan.has(pan)) byPan.set(pan, []);
    byPan.get(pan).push(r);
  });

  const doctors = [];

  byPan.forEach((group, pan) => {
    // The first row with complete, valid bank details is the reference.
    const complete = (r) =>
      r.values.accountNumber &&
      cfg.IFSC_REGEX.test(r.values.ifscCode || "") &&
      r.values.bankName &&
      r.values.accountHolderName;
    const ref = group.find(complete) || null;
    const sheetBank = ref ? bankOf(ref.values) : null;

    // One PAN = one bank account within a file.
    if (ref) {
      group.forEach((r) => {
        if (r === ref || !r.values.accountNumber || !r.values.ifscCode) return;
        const diff = compareBank(sheetBank, bankOf(r.values));
        if (diff?.severity === "critical")
          r.errors.push({
            field: "accountNumber",
            message: `Bank details differ from ${ref.sheetName} row ${ref.rowNumber} for the same PAN — one PAN can have only one bank account in a file`,
          });
        else if (diff)
          r.warnings.push({
            code: "BANK_TEXT_VARIES",
            message: `Bank name / holder name is typed differently from ${ref.sheetName} row ${ref.rowNumber}`,
          });
      });
    }

    // Same PAN typed with different doctor names.
    const names = [
      ...new Set(group.map((r) => norm(r.values.doctorName))),
    ].filter(Boolean);
    if (names.length > 1)
      group.forEach((r) =>
        r.warnings.push({
          code: "NAME_VARIES_IN_FILE",
          message: "This PAN appears with different doctor names in the file",
          field: "doctorName",
        }),
      );

    const master = doctorsByPan[pan] || null;
    const entry = {
      panNumber: pan,
      name: (ref || group[0]).values.doctorName,
      isNew: !master,
      doctorId: master ? String(master._id) : null,
      doctorCode: master?.doctorCode || null,
      storedName: master?.name || null,
      status: master?.status || null,
      rows: group.length,
      payable: round2(
        group.reduce((s, r) => s + (r.values.payableAmount || 0), 0),
      ),
      sheetBank,
      storedBank: master ? bankOf(master) : null,
      mismatch: null,
      decision: null,
      numericAccountCell: group.some((r) => r.accountNumericCell),
    };

    if (!master) {
      group.forEach((r) => {
        r.flags.newDoctor = true;
      });
      if (entry.numericAccountCell)
        group.forEach((r) =>
          r.warnings.push({
            code: "ACCOUNT_NUMBER_CELL",
            message:
              "Account number was typed as a number in the Excel — a leading 0, if it has one, was dropped. Confirm the account number.",
            field: "accountNumber",
          }),
        );
    } else {
      group.forEach((r) => {
        r.doctor = {
          _id: String(master._id),
          doctorCode: master.doctorCode,
          name: master.name,
        };
      });
      if (master.status && master.status !== "active")
        group.forEach((r) =>
          r.errors.push({
            field: "panNumber",
            message: `Doctor ${master.name} (${pan}) is ${master.status} in the Doctor Master — activate the doctor first`,
          }),
        );
      if (norm(master.name) !== norm(entry.name))
        group.forEach((r) =>
          r.warnings.push({
            code: "NAME_DIFFERS_FROM_MASTER",
            message: `Doctor Master has this PAN as "${master.name}"`,
            field: "doctorName",
          }),
        );

      if (sheetBank) {
        const mismatch = compareBank(entry.storedBank, sheetBank);
        if (mismatch) {
          // The master has no bank account yet (doctor added from the
          // doctor list without one): nothing to compare against, so the
          // Excel's details are proposed for the master. They still go
          // through the approver like any bank change.
          const masterHasBank = Boolean(master.accountNumber);
          if (!masterHasBank) mismatch.severity = "missing";
          const chosen = ["keep", "update"].includes(bankDecisions[pan])
            ? bankDecisions[pan]
            : null;
          // A difference only in how the bank / holder name is typed keeps
          // the stored details unless the uploader asks to update them.
          const decision = !masterHasBank
            ? "update"
            : chosen || (mismatch.severity === "minor" ? "keep" : null);
          entry.mismatch = mismatch;
          entry.decision = decision;
          group.forEach((r) => {
            r.flags.bankMismatch = mismatch.severity;
            r.flags.bankDecision = decision;
          });
        }
      }
    }

    // Another PAN already uses this bank account (master or this file).
    const key = accountKey(sheetBank);
    if (key) {
      const others = (doctorsByAccount[key] || []).filter(
        (d) => d.panNumber !== pan,
      );
      if (others.length) {
        entry.sharedBankWith = others;
        group.forEach((r) => {
          r.flags.sharedBank = true;
          r.warnings.push({
            code: "SHARED_BANK_ACCOUNT",
            message: `Same bank account as ${others
              .map((d) => `${d.name} (${d.panNumber})`)
              .join(", ")}`,
            field: "accountNumber",
          });
        });
      }
    }

    doctors.push(entry);
  });

  // Same account under two PANs inside this file.
  const fileAccounts = new Map();
  doctors.forEach((d) => {
    const key = accountKey(d.sheetBank);
    if (!key) return;
    if (!fileAccounts.has(key)) fileAccounts.set(key, []);
    fileAccounts.get(key).push(d);
  });
  fileAccounts.forEach((list) => {
    if (list.length < 2) return;
    list.forEach((d) => {
      const others = list.filter((x) => x !== d);
      out
        .filter((r) => r.values.panNumber === d.panNumber)
        .forEach((r) => {
          if (r.flags.sharedBank) return;
          r.flags.sharedBank = true;
          r.warnings.push({
            code: "SHARED_BANK_ACCOUNT",
            message: `Same bank account as ${others
              .map((o) => `${o.name} (${o.panNumber})`)
              .join(", ")} in this file`,
            field: "accountNumber",
          });
        });
    });
  });

  // ── duplicates ──
  const seen = new Map();
  out.forEach((r) => {
    if (!r.fingerprint || r.errors.length) return;
    const prior = existingByFingerprint[r.fingerprint];
    if (prior) {
      r.flags.duplicate = "existing";
      r.flags.duplicateRef = prior;
    } else if (seen.has(r.fingerprint)) {
      const first = seen.get(r.fingerprint);
      r.flags.duplicate = "file";
      r.flags.duplicateRef = {
        sheetName: first.sheetName,
        rowNumber: first.rowNumber,
      };
    }
    if (!seen.has(r.fingerprint)) seen.set(r.fingerprint, r);
  });

  // ── summary ──
  const totals = { settled: 0, basic: 0, tds: 0, payable: 0 };
  const byType = {};
  const byBranch = new Map();
  let errorRows = 0;
  let warningRows = 0;
  let duplicateRows = 0;

  out.forEach((r) => {
    if (r.errors.length) errorRows += 1;
    if (r.warnings.length) warningRows += 1;
    if (r.flags.duplicate) duplicateRows += 1;
    const v = r.values;
    totals.settled += v.settledAmount || 0;
    totals.basic += v.basicAmount || 0;
    totals.tds += v.tdsAmount || 0;
    totals.payable += v.payableAmount || 0;
    const t = (byType[r.type] = byType[r.type] || { rows: 0, payable: 0 });
    t.rows += 1;
    t.payable += v.payableAmount || 0;
    if (v.branchId) {
      const b =
        byBranch.get(v.branchId) ||
        byBranch
          .set(v.branchId, {
            branchId: v.branchId,
            name: v.branchName,
            code: v.branchCode,
            rows: 0,
            payable: 0,
          })
          .get(v.branchId);
      b.rows += 1;
      b.payable += v.payableAmount || 0;
    }
  });
  Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));
  Object.values(byType).forEach((t) => (t.payable = round2(t.payable)));
  byBranch.forEach((b) => (b.payable = round2(b.payable)));

  const unresolved = doctors.filter(
    (d) => d.mismatch?.severity === "critical" && !d.decision,
  );
  const newDoctors = doctors.filter((d) => d.isNew).length;
  const bankMismatches = doctors.filter(
    (d) => d.mismatch && d.mismatch.severity !== "missing",
  ).length;
  const bankAdds = doctors.filter(
    (d) => d.mismatch?.severity === "missing",
  ).length;

  const blockers = [...fileErrors];
  if (!out.length && !fileErrors.length)
    blockers.push("No payout rows were found in the file");
  if (errorRows)
    blockers.push(
      `${errorRows} row${errorRows === 1 ? " has" : "s have"} errors — correct the Excel and upload it again`,
    );
  if (unresolved.length)
    blockers.push(
      `${unresolved.length} doctor${unresolved.length === 1 ? "" : "s"} with bank details different from the Doctor Master — choose which details to use`,
    );
  if (duplicateRows && !allowDuplicates)
    blockers.push(
      `${duplicateRows} possible duplicate row${duplicateRows === 1 ? "" : "s"} — remove them, or confirm they are genuine`,
    );

  return {
    rows: out,
    doctors,
    summary: {
      rows: out.length,
      errorRows,
      warningRows,
      duplicateRows,
      newDoctors,
      existingDoctors: doctors.length - newDoctors,
      bankMismatches,
      bankAdds, // master had no bank details — taken from this Excel
      unresolvedBankMismatches: unresolved.length,
      totals,
      byType,
      byBranch: [...byBranch.values()],
    },
    blockers,
    canSubmit: blockers.length === 0,
  };
};

module.exports = {
  normaliseRows,
  assessRows,
  compareBank,
  bankOf,
  accountKey,
  fingerprintOf,
  // exported for tests / reuse
  readAmount,
  readDate,
  readAccount,
  readMobile,
  readText,
  norm,
  round2,
};
