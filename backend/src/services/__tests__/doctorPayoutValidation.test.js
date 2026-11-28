// Run:  node src/services/__tests__/doctorPayoutValidation.test.js
// Plain node + assert, no database and no Excel library (same style as
// scripts/lib/__tests__). Covers the rules of the doctor payout upload.
const assert = require("assert");
const V = require("../doctorPayoutValidation");

const S = (raw) => ({ kind: "string", raw });
const N = (raw) => ({ kind: "number", raw });
const D = (y, m, d) => ({ kind: "date", raw: new Date(Date.UTC(y, m - 1, d)) });
const E = { kind: "empty" };

const BRANCHES = [
  { _id: "b1", name: "Sangamvadi", code: "SGV", status: "active" },
  { _id: "b2", name: "HHC DP Road", code: "DPR", status: "active" },
  { _id: "b3", name: "Bopal", code: "BPL", status: "inactive" },
  { _id: "b4", name: "Raipur", code: "RPR", status: "active" },
];
const TODAY = "2026-11-26";

const ref = (over = {}) => ({
  branch: S("Sangamvadi"),
  date: D(2026, 11, 20),
  doctorName: S("Dr Asha Kulkarni"),
  patientName: S("Ramesh Patil"),
  settledAmount: N(50000),
  basicAmount: N(5000),
  tdsAmount: N(500),
  payableAmount: N(4500),
  panNumber: S("ABCPK1234F"),
  accountNumber: S("001234567890"),
  ifscCode: S("HDFC0001234"),
  bankName: S("HDFC Bank"),
  accountHolderName: S("Asha Kulkarni"),
  mobile: E,
  email: E,
  ...over,
});
const sur = (over = {}) => {
  const { patientName, ...rest } = ref();
  return { ...rest, noOfSurgeries: N(4), ...over };
};

const run = (sheets, opts = {}) => {
  const n = V.normaliseRows({
    sheets,
    branches: BRANCHES,
    allowedBranchIds:
      opts.allowed === undefined ? ["b1", "b2", "b3"] : opts.allowed,
    today: TODAY,
  });
  const a = V.assessRows({
    rows: n.rows,
    doctorsByPan: opts.doctors || {},
    doctorsByAccount: opts.byAccount || {},
    existingByFingerprint: opts.existing || {},
    decisions: opts.decisions || {},
    fileErrors: n.fileErrors,
  });
  return { ...a, fileWarnings: n.fileWarnings, raw: n };
};
const sheet = (type, cellsList) => ({
  type,
  sheetName: type === "referral" ? "Dr Ref" : "Dr Sur And Anesthetic",
  rows: cellsList.map((cells, i) => ({ rowNumber: i + 3, cells })),
});
const errs = (r) => r.errors.map((e) => e.field);
const codes = (r) => r.warnings.map((w) => w.code);

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

// ── happy path ──
test("clean referral + surgeon rows submit, new doctor flagged", () => {
  const r = run([sheet("referral", [ref()]), sheet("surgeon", [sur()])]);
  assert.strictEqual(r.canSubmit, true, JSON.stringify(r.blockers));
  assert.strictEqual(r.summary.rows, 2);
  assert.strictEqual(r.summary.newDoctors, 1); // same PAN on both sheets
  assert.strictEqual(r.summary.totals.payable, 9000);
  assert.ok(r.rows.every((x) => x.flags.newDoctor));
  assert.strictEqual(r.rows[0].values.branchId, "b1");
  assert.strictEqual(r.rows[0].values.date, "2026-11-20");
  assert.strictEqual(r.rows[0].values.tdsPercent, 10);
});

// ── required fields ──
test("every field except mobile/email is required", () => {
  const blank = Object.fromEntries(Object.keys(ref()).map((k) => [k, E]));
  const r = run([sheet("referral", [{ ...blank, branch: S("Sangamvadi") }])]);
  const f = errs(r.rows[0]);
  [
    "date",
    "doctorName",
    "patientName",
    "settledAmount",
    "basicAmount",
    "tdsAmount",
    "payableAmount",
    "panNumber",
    "accountNumber",
    "ifscCode",
    "bankName",
    "accountHolderName",
  ].forEach((k) => assert.ok(f.includes(k), k));
  assert.ok(!f.includes("mobile") && !f.includes("email"));
  assert.strictEqual(r.canSubmit, false);
});
test("surgeon needs No of Surgeries (whole number ≥ 1), not Patient Name", () => {
  let r = run([sheet("surgeon", [sur({ noOfSurgeries: E })])]);
  assert.ok(errs(r.rows[0]).includes("noOfSurgeries"));
  r = run([sheet("surgeon", [sur({ noOfSurgeries: N(2.5) })])]);
  assert.ok(errs(r.rows[0]).includes("noOfSurgeries"));
  r = run([sheet("surgeon", [sur({ noOfSurgeries: N(0) })])]);
  assert.ok(errs(r.rows[0]).includes("noOfSurgeries"));
  r = run([sheet("surgeon", [sur()])]);
  assert.deepStrictEqual(errs(r.rows[0]), []);
});

// ── PAN / IFSC / account ──
test("PAN format, lower case accepted, non-individual warned", () => {
  let r = run([sheet("referral", [ref({ panNumber: S("abcpk1234f") })])]);
  assert.strictEqual(r.rows[0].values.panNumber, "ABCPK1234F");
  assert.deepStrictEqual(errs(r.rows[0]), []);
  r = run([sheet("referral", [ref({ panNumber: S("ABCPK1234") })])]);
  assert.ok(errs(r.rows[0]).includes("panNumber"));
  r = run([sheet("referral", [ref({ panNumber: S("ABCFK1234F") })])]);
  assert.ok(codes(r.rows[0]).includes("PAN_NOT_INDIVIDUAL"));
});
test("IFSC letter-O typo gets a specific message", () => {
  const r = run([sheet("referral", [ref({ ifscCode: S("HDFCO001234") })])]);
  assert.ok(/digit 0/.test(r.rows[0].errors[0].message));
});
test("account number: text keeps zeros; long number cell is refused", () => {
  let r = run([sheet("referral", [ref()])]);
  assert.strictEqual(r.rows[0].values.accountNumber, "001234567890");
  r = run([sheet("referral", [ref({ accountNumber: N(1234567890123456) })])]);
  assert.ok(/altered/.test(r.rows[0].errors[0].message));
  r = run([sheet("referral", [ref({ accountNumber: S("1.23457E+15") })])]);
  assert.ok(errs(r.rows[0]).includes("accountNumber"));
  r = run([sheet("referral", [ref({ accountNumber: N(50100123456789) })])]);
  assert.deepStrictEqual(errs(r.rows[0]), []);
  assert.ok(codes(r.rows[0]).includes("ACCOUNT_NUMBER_CELL")); // new doctor
});

// ── amounts ──
test("Payable must be Basic − TDS (₹1 tolerance)", () => {
  let r = run([sheet("referral", [ref({ payableAmount: N(4600) })])]);
  assert.ok(/4500\.00/.test(r.rows[0].errors[0].message));
  r = run([sheet("referral", [ref({ payableAmount: N(4500.6) })])]);
  assert.deepStrictEqual(errs(r.rows[0]), []);
  r = run([sheet("referral", [ref({ tdsAmount: N(5000) })])]);
  assert.ok(errs(r.rows[0]).includes("tdsAmount"));
});
test("amount text forms, negatives, zero TDS warning", () => {
  let r = run([
    sheet("referral", [
      ref({
        basicAmount: S("₹ 5,000.00"),
        tdsAmount: S("-"),
        payableAmount: S("5,000"),
      }),
    ]),
  ]);
  assert.deepStrictEqual(errs(r.rows[0]), []);
  assert.ok(codes(r.rows[0]).includes("NO_TDS"));
  r = run([sheet("referral", [ref({ basicAmount: N(-5000) })])]);
  assert.ok(errs(r.rows[0]).includes("basicAmount"));
  r = run([sheet("referral", [ref({ basicAmount: S("five thousand") })])]);
  assert.ok(errs(r.rows[0]).includes("basicAmount"));
  r = run([sheet("referral", [ref({ settledAmount: N(1000) })])]);
  assert.ok(codes(r.rows[0]).includes("BASIC_OVER_SETTLED"));
});

// ── dates ──
test("dates: real cell, DD/MM text, serial, month, invalid, future", () => {
  const d = (cell) => run([sheet("referral", [ref({ date: cell })])]).rows[0];
  assert.strictEqual(d(S("05/11/2026")).values.date, "2026-11-05"); // not 11 May
  assert.strictEqual(d(S("5-Nov-26")).values.date, "2026-11-05");
  assert.strictEqual(d(S("2026-11-05")).values.date, "2026-11-05");
  assert.strictEqual(d(N(46331)).values.date, "2026-11-05");
  assert.strictEqual(d(S("Nov 2026")).values.date, "2026-11-01");
  assert.ok(errs(d(S("31/02/2026"))).includes("date"));
  assert.ok(errs(d(S("soon"))).includes("date"));
  assert.ok(codes(d(D(2026, 12, 25))).includes("DATE_FUTURE"));
  assert.ok(codes(d(D(2025, 1, 1))).includes("DATE_OLD"));
});

// ── branch ──
test("branch: name, code, brand-prefix, unknown, inactive, not assigned", () => {
  const b = (cell, opts) =>
    run([sheet("referral", [ref({ branch: cell })])], opts).rows[0];
  assert.strictEqual(b(S("sangamvadi ")).values.branchId, "b1");
  assert.strictEqual(b(S("SGV")).values.branchId, "b1");
  assert.strictEqual(b(S("DP Road")).values.branchId, "b2"); // "HHC DP Road"
  assert.strictEqual(b(S("HHC Sangamvadi")).values.branchId, "b1");
  assert.ok(errs(b(S("Kothrud"))).includes("branch"));
  assert.ok(/inactive/.test(b(S("Bopal")).errors[0].message));
  assert.ok(/assigned/.test(b(S("Raipur")).errors[0].message));
  assert.strictEqual(b(S("Raipur"), { allowed: null }).values.branchId, "b4"); // super admin
});

// ── total rows ──
test("totals / blank identity rows are skipped with a note", () => {
  const blank = Object.fromEntries(Object.keys(ref()).map((k) => [k, E]));
  const r = run([
    sheet("referral", [
      ref(),
      { ...blank, payableAmount: N(4500) },
      { ...blank, doctorName: S("Total"), payableAmount: N(4500) },
    ]),
  ]);
  assert.strictEqual(r.summary.rows, 1);
  assert.strictEqual(r.fileWarnings.length, 2);
  assert.strictEqual(r.canSubmit, true);
});

// ── doctor master comparison ──
const MASTER = {
  _id: "d1",
  doctorCode: "DR-00001",
  name: "Dr Asha Kulkarni",
  panNumber: "ABCPK1234F",
  status: "active",
  accountNumber: "001234567890",
  ifscCode: "HDFC0001234",
  bankName: "HDFC Bank",
  accountHolderName: "Asha Kulkarni",
};
test("existing doctor, same bank → no flags", () => {
  const r = run([sheet("referral", [ref()])], {
    doctors: { ABCPK1234F: MASTER },
  });
  assert.strictEqual(r.summary.newDoctors, 0);
  assert.strictEqual(r.summary.bankMismatches, 0);
  assert.strictEqual(r.rows[0].doctor.doctorCode, "DR-00001");
  assert.strictEqual(r.canSubmit, true);
});
test("bank account differs → blocked until keep/update chosen", () => {
  const rows = [ref({ accountNumber: S("999999999999") })];
  let r = run([sheet("referral", rows)], { doctors: { ABCPK1234F: MASTER } });
  assert.strictEqual(r.canSubmit, false);
  assert.strictEqual(r.rows[0].flags.bankMismatch, "critical");
  assert.strictEqual(r.doctors[0].mismatch.fields[0].stored, "001234567890");
  assert.strictEqual(r.doctors[0].mismatch.fields[0].sheet, "999999999999");
  for (const choice of ["keep", "update"]) {
    r = run([sheet("referral", rows)], {
      doctors: { ABCPK1234F: MASTER },
      decisions: { bank: { ABCPK1234F: choice } },
    });
    assert.strictEqual(r.canSubmit, true);
    assert.strictEqual(r.rows[0].flags.bankDecision, choice);
  }
  r = run([sheet("referral", rows)], {
    doctors: { ABCPK1234F: MASTER },
    decisions: { bank: { ABCPK1234F: "whatever" } },
  });
  assert.strictEqual(r.canSubmit, false);
});
test("only bank name spelling differs → minor, keeps master, not blocked", () => {
  const r = run([sheet("referral", [ref({ bankName: S("HDFC Bank Ltd") })])], {
    doctors: { ABCPK1234F: MASTER },
  });
  assert.strictEqual(r.rows[0].flags.bankMismatch, "minor");
  assert.strictEqual(r.rows[0].flags.bankDecision, "keep");
  assert.strictEqual(r.canSubmit, true);
  // case / spacing alone is not a mismatch at all
  const same = run(
    [
      sheet("referral", [
        ref({ bankName: S("hdfc  bank"), ifscCode: S("hdfc0001234") }),
      ]),
    ],
    { doctors: { ABCPK1234F: MASTER } },
  );
  assert.strictEqual(same.summary.bankMismatches, 0);
});
test("master has no bank details yet → Excel details proposed, nothing to choose", () => {
  const noBank = {
    ...MASTER,
    accountNumber: undefined,
    ifscCode: undefined,
    bankName: undefined,
    accountHolderName: undefined,
  };
  const r = run([sheet("referral", [ref()])], {
    doctors: { ABCPK1234F: noBank },
  });
  assert.strictEqual(r.canSubmit, true, JSON.stringify(r.blockers));
  assert.strictEqual(r.rows[0].flags.bankMismatch, "missing");
  assert.strictEqual(r.rows[0].flags.bankDecision, "update");
  assert.deepStrictEqual(
    [
      r.summary.bankMismatches,
      r.summary.bankAdds,
      r.summary.unresolvedBankMismatches,
    ],
    [0, 1, 0],
  );
  // "keep" makes no sense when there is nothing to keep — still "update"
  const k = run([sheet("referral", [ref()])], {
    doctors: { ABCPK1234F: noBank },
    decisions: { bank: { ABCPK1234F: "keep" } },
  });
  assert.strictEqual(k.rows[0].flags.bankDecision, "update");
});
test("inactive / blocked doctor is an error; name difference is a warning", () => {
  let r = run([sheet("referral", [ref()])], {
    doctors: { ABCPK1234F: { ...MASTER, status: "blocked" } },
  });
  assert.ok(/blocked/.test(r.rows[0].errors[0].message));
  r = run([sheet("referral", [ref({ doctorName: S("Dr A. Kulkarni") })])], {
    doctors: { ABCPK1234F: MASTER },
  });
  assert.ok(codes(r.rows[0]).includes("NAME_DIFFERS_FROM_MASTER"));
  assert.strictEqual(r.canSubmit, true);
});
test("one PAN with two bank accounts in the same file is an error", () => {
  const r = run([
    sheet("referral", [
      ref(),
      ref({ patientName: S("Other"), accountNumber: S("888888888888") }),
    ]),
  ]);
  assert.deepStrictEqual(errs(r.rows[0]), []);
  assert.ok(errs(r.rows[1]).includes("accountNumber"));
});
test("same bank account under another PAN is warned (master and in-file)", () => {
  let r = run([sheet("referral", [ref()])], {
    byAccount: {
      "001234567890|HDFC0001234": [
        { panNumber: "ZZZPZ9999Z", name: "Dr Other" },
      ],
    },
  });
  assert.ok(codes(r.rows[0]).includes("SHARED_BANK_ACCOUNT"));
  r = run([
    sheet("referral", [
      ref(),
      ref({
        panNumber: S("QWEPR5678K"),
        doctorName: S("Dr Two"),
        patientName: S("P2"),
      }),
    ]),
  ]);
  assert.ok(r.rows.every((x) => x.flags.sharedBank));
  assert.strictEqual(r.canSubmit, true); // warning only
});

// ── duplicates ──
test("duplicate inside the file and against earlier uploads", () => {
  let r = run([sheet("referral", [ref(), ref({ payableAmount: N(4500) })])]);
  assert.strictEqual(r.rows[0].flags.duplicate, null);
  assert.strictEqual(r.rows[1].flags.duplicate, "file");
  assert.strictEqual(r.canSubmit, false);
  r = run([sheet("referral", [ref(), ref()])], {
    decisions: { allowDuplicates: true },
  });
  assert.strictEqual(r.canSubmit, true);

  const fp = run([sheet("referral", [ref()])]).rows[0].fingerprint;
  r = run([sheet("referral", [ref()])], {
    existing: {
      [fp]: { payoutId: "DPO-000007", batchId: "DPB-0001", status: "paid" },
    },
  });
  assert.strictEqual(r.rows[0].flags.duplicate, "existing");
  assert.strictEqual(r.rows[0].flags.duplicateRef.payoutId, "DPO-000007");
  assert.strictEqual(r.canSubmit, false);
});
test("different patient / date / branch is not a duplicate", () => {
  const r = run([
    sheet("referral", [
      ref(),
      ref({ patientName: S("Someone Else") }),
      ref({ date: D(2026, 11, 21) }),
      ref({ branch: S("DPR") }),
    ]),
  ]);
  assert.strictEqual(r.summary.duplicateRows, 0);
});

// ── limits / empties ──
test("empty file and oversize sheet are blocked", () => {
  let r = run([]);
  assert.strictEqual(r.canSubmit, false);
  const many = Array.from({ length: 2001 }, (_, i) =>
    ref({ patientName: S(`P${i}`) }),
  );
  r = run([sheet("referral", many)]);
  assert.ok(r.blockers.some((b) => /limit is 2000/.test(b)));
});

// ── optional contact ──
test("bad mobile / email are dropped with a warning, never block", () => {
  const r = run([
    sheet("referral", [ref({ mobile: S("12345"), email: S("not-an-email") })]),
  ]);
  assert.deepStrictEqual(errs(r.rows[0]), []);
  assert.strictEqual(r.rows[0].values.mobile, undefined);
  assert.strictEqual(r.rows[0].values.email, undefined);
  const ok = run([
    sheet("referral", [
      ref({ mobile: N(919876543210), email: S("Dr.Asha@Example.com") }),
    ]),
  ]);
  assert.strictEqual(ok.rows[0].values.mobile, "9876543210");
  assert.strictEqual(ok.rows[0].values.email, "dr.asha@example.com");
});

console.log(
  `${passed} tests passed${process.exitCode ? " — with FAILURES above" : ""}`,
);
