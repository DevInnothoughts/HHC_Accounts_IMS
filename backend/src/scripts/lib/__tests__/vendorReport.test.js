// Run from backend/:  node src/scripts/lib/__tests__/vendorReport.test.js   (no DB needed)
// Exercises controllers/vendorReportController.js against an in-memory
// aggregation evaluator (miniAggregate.js) with a small fixture.
const assert = require("assert");
const Module = require("module");
const { run, matches } = require("./miniAggregate");

const id = (n) => n.toString(16).padStart(24, "0");
const D = (s) => new Date(`${s}T00:00:00.000Z`);
const B = { P: id(1), A: id(2), Bo: id(3) };
const Cc = { rev: id(11), cap: id(12) };
const V = { P1: id(21), A1: id(22), Leg: id(23), No: id(24), X: id(25), NA: id(26) };
const M1 = id(31);
const I = (n) => id(100 + n);
const P = (n) => id(200 + n);

const db = {
  branches: [
    { _id: B.P, name: "Pune", code: "PUN" },
    { _id: B.A, name: "Ahmedabad", code: "AHD" },
    { _id: B.Bo, name: "Bopal", code: "BOP" },
  ],
  expensecategories: [
    { _id: Cc.rev, type: "Revenue", code: "R01", name: "Consumables" },
    { _id: Cc.cap, type: "Capital", code: "C01", name: "Equipment" },
  ],
  vendors: [
    { _id: V.P1, branch: B.P, panNumber: "ABCDE1234F", vendorMaster: M1, vendorName: "Acme Pune", gstNumber: "27ABCDE1234F1Z5", updatedAt: D("2026-01-01") },
    { _id: V.A1, branch: B.A, panNumber: "ABCDE1234F", vendorMaster: M1, vendorName: "Acme Ahd", gstNumber: "24ABCDE1234F1Z9", updatedAt: D("2026-02-01") },
    { _id: V.Leg, branch: B.P, panNumber: " abcde1234f ", vendorMaster: null, vendorName: "ACME old", updatedAt: D("2025-01-01") },
    { _id: V.No, branch: B.P, panNumber: "", vendorName: "MSEB", updatedAt: D("2025-01-01") },
    { _id: V.X, branch: B.A, panNumber: "PQRST6789Z", vendorName: "Xylo Traders", companyName: "Xylo Pvt Ltd", updatedAt: D("2025-01-01") },
    { _id: V.NA, branch: B.Bo, panNumber: "NA", vendorName: "Plumber", updatedAt: D("2025-01-01") },
  ],
  vendormasters: [
    { _id: M1, panNumber: "ABCDE1234F", vendorName: "Acme Healthcare", companyName: "Acme HC Pvt Ltd", status: "active", approvalStatus: "approved", gstins: [{ gstin: "27ABCDE1234F1Z5", stateCode: "27" }] },
  ],
  invoicerequests: [
    { _id: I(1), requestId: "INV-1", vendor: V.P1, branch: B.P, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: D("2026-04-10"), createdAt: D("2026-04-11"), status: "Cluster Head Approved", amount: 900, gstAmount: 100, tdsAmount: 0, netPayable: 1000, invoiceNumber: "A-1", paymentRequest: P(1) },
    { _id: I(2), requestId: "INV-2", vendor: V.A1, branch: B.A, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: D("2026-05-05"), createdAt: D("2026-05-06"), status: "Cluster Head Approved", amount: 2000, gstAmount: 100, tdsAmount: 100, netPayable: 2000, invoiceNumber: "A-2", paymentRequest: P(2) },
    { _id: I(3), requestId: "INV-3", vendor: V.Leg, branch: B.P, expenseCategory: Cc.cap, expenseType: "Capital", invoiceDate: D("2026-06-01"), createdAt: D("2026-06-02"), status: "Submitted", amount: 300, gstAmount: 0, netPayable: 300, invoiceNumber: "A-3" },
    { _id: I(4), requestId: "INV-4", vendor: V.P1, branch: B.P, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: D("2026-06-10"), createdAt: D("2026-06-10"), status: "Draft", amount: 999, netPayable: 999, invoiceNumber: "A-4" },
    { _id: I(5), requestId: "INV-5", vendor: V.X, branch: B.A, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: D("2026-05-20"), createdAt: D("2026-05-20"), status: "Rejected", amount: 777, netPayable: 777, invoiceNumber: "X-5" },
    { _id: I(6), requestId: "INV-6", vendor: V.No, branch: B.P, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: D("2026-07-01"), createdAt: D("2026-07-01"), status: "Cluster Head Approved", amount: 400, netPayable: 400, invoiceNumber: "E-6" },
    { _id: I(7), requestId: "INV-7", vendor: V.X, branch: B.A, expenseCategory: Cc.cap, expenseType: "Capital", invoiceDate: D("2026-07-15"), createdAt: D("2026-07-15"), status: "Cluster Head Approved", amount: 5000, netPayable: 5000, invoiceNumber: "X-7", paymentRequest: P(7) },
    { _id: I(9), requestId: "INV-9", vendor: V.No, branch: B.P, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: D("2026-03-01"), createdAt: D("2026-03-01"), status: "Cluster Head Approved", amount: 600, netPayable: 600, invoiceNumber: "E-9", paymentRequest: P(9) },
    { _id: I(8), requestId: "INV-8", vendor: V.NA, branch: B.Bo, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: D("2026-08-01"), createdAt: D("2026-08-01"), status: "Cluster Head Approved", amount: 50, netPayable: 50, invoiceNumber: "N-8" },
  ],
  paymentprocessings: [
    { _id: P(1), paymentId: "PAY-1", invoiceRequest: I(1), vendor: V.P1, branch: B.P, status: "Fully Paid", paidAmount: 1000, paymentDate: D("2026-04-20"),
      installments: [{ amount: 1000, status: "Processed", paymentDate: D("2026-04-20"), utrNumber: "U1", paymentId: "PAY-1-1" }] },
    { _id: P(2), paymentId: "PAY-2", invoiceRequest: I(2), vendor: V.A1, branch: B.A, status: "Partially Paid", paidAmount: 500, paymentDate: D("2026-05-15"),
      installments: [{ amount: 500, status: "Processed", paymentDate: D("2026-05-15"), utrNumber: "U2", paymentId: "PAY-2-1" }, { amount: 1500, status: "Raised", paymentId: "PAY-2-2" }] },
    // Legacy shape: no installments array; paid via top-level fields.
    { _id: P(9), paymentId: "PAY-9", invoiceRequest: I(9), vendor: V.No, branch: B.P, status: "Payment Processed", paidAmount: 600, totalAmount: 600, paymentDate: null, utrRecordedAt: D("2026-03-11"), utrNumber: "UL9", updatedAt: D("2026-03-12") },
    { _id: P(7), paymentId: "PAY-7", invoiceRequest: I(7), vendor: V.X, branch: B.A, status: "Fully Paid", paidAmount: 5000, paymentDate: null,
      installments: [{ amount: 5000, status: "Processed", utrRecordedAt: D("2026-08-02"), utrNumber: "U7", paymentId: "PAY-7-1" }] },
  ],
};

// ── stubs ──
const chain = (list) => {
  let rows = list.map((x) => ({ ...x }));
  const q = {
    select: () => q, lean: () => q,
    sort: (s) => { const [[k, d]] = Object.entries(s); rows.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * d); return q; },
    then: (res, rej) => Promise.resolve(rows).then(res, rej),
  };
  return q;
};
const one = (list) => { const c = chain(list); const q = { select: () => q, lean: () => q, sort: (s) => { c.sort(s); return q; }, then: (res, rej) => c.then((r) => r[0] || null).then(res, rej) }; return q; };
const model = (coll) => ({
  aggregate: async (p) => run(p, db[coll], db),
  find: (f = {}) => chain(db[coll].filter((d) => matches(d, f))),
  findOne: (f = {}) => one(db[coll].filter((d) => matches(d, f))),
  countDocuments: async (f = {}) => db[coll].filter((d) => matches(d, f)).length,
});
const mongoose = {
  isValidObjectId: (v) => /^[0-9a-f]{24}$/.test(String(v)),
  Types: { ObjectId: function (x) { return new String(x); } },
};
const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === "mongoose") return mongoose;
  const m = /models\/(InvoiceRequest|PaymentProcessing|Vendor|VendorMaster|Branch)$/.exec(r);
  if (m) return model({ InvoiceRequest: "invoicerequests", PaymentProcessing: "paymentprocessings", Vendor: "vendors", VendorMaster: "vendormasters", Branch: "branches" }[m[1]]);
  return orig.call(this, r, ...a);
};
const ctrl = require("../../../controllers/vendorReportController");
Module._load = orig;

const SUPER = { role: "super_admin", branches: [] };
const call = async (fn, query, user = SUPER) => {
  let code = 200, body;
  const res = { status(c) { code = c; return res; }, json(b) { body = b; return res; } };
  await ctrl[fn]({ query, user }, res);
  return { code, body };
};
const rep = (q, u) => call("getVendorReport", q, u);
const det = (q, u) => call("getVendorDetail", q, u);
const byKey = (b, k) => b.vendors.find((v) => v.key === k);
const cellOf = (b, k, br) => b.matrix.cells.find((c) => c.key === k && c.branch === br);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ✓", name); };
const DAY = 864e5;
const ymd = (d) => d.toISOString().slice(0, 10);
const ageBucket = (d) => { const a = (Date.now() - D(d)) / DAY; return a < 31 ? "age0_30" : a < 61 ? "age31_60" : a < 91 ? "age61_90" : "age90p"; };

(async () => {
  await t("billed: one row per real vendor — linked rows in 2 branches + a legacy lowercase-PAN row", async () => {
    const { code, body } = await rep({});
    assert.equal(code, 200, JSON.stringify(body));
    const a = byKey(body, "ABCDE1234F");
    assert.equal(a.name, "Acme Healthcare"); assert.equal(a.inMaster, true); assert.equal(a.pan, "ABCDE1234F");
    assert.equal(a.invoices, 3); assert.equal(a.net, 3300); assert.equal(a.branchCount, 2);
    assert.equal(a.paid, 1500); assert.equal(a.approvedNet, 3000); assert.equal(a.inFlightNet, 300);
    assert.equal(a.outstanding, 1500, "only approved-but-unpaid counts");
    assert.equal(a.avgDaysToPay, 10, "only the fully paid invoice (10 days)");
    assert.equal(a.gross, 900 + 100 + 2000 + 100 + 300); assert.equal(a.tds, 100);
  });
  await t("billed: drafts and rejected excluded by default; no-PAN and placeholder-PAN vendors stay separate", async () => {
    const { body } = await rep({});
    assert.equal(body.vendors.length, 4);
    assert.equal(byKey(body, "PQRST6789Z").net, 5000, "rejected INV-5 not counted");
    assert.equal(byKey(body, V.No).net, 1000); assert.equal(byKey(body, V.No).pan, "");
    assert.equal(byKey(body, V.NA).net, 50, '"NA" is not a PAN');
    assert.equal(body.totals.net, 9350); assert.equal(body.totals.multiBranchVendors, 1);
    assert.deepEqual(body.vendors.map((v) => v.key), ["PQRST6789Z", "ABCDE1234F", V.No, V.NA], "sorted by value");
  });
  await t("billed: fully paid with no value date typed → timed from the UTR entry", async () => {
    const x = byKey((await rep({})).body, "PQRST6789Z");
    assert.equal(x.avgDaysToPay, 18); assert.equal(x.paid, 5000); assert.equal(x.outstanding, 0);
    assert.equal(new Date(x.lastPayment).toISOString().slice(0, 10), "2026-08-02");
  });
  await t("concentration and share", async () => {
    const { body } = await rep({});
    assert.equal(body.concentration.top5Share, 100); assert.equal(body.concentration.paretoCount, 2);
    assert.equal(byKey(body, "PQRST6789Z").share, Math.round((5000 / 9350) * 10000) / 100);
  });
  await t("vendor × branch matrix", async () => {
    const { body } = await rep({});
    assert.equal(cellOf(body, "ABCDE1234F", B.P).value, 1300);
    assert.equal(cellOf(body, "ABCDE1234F", B.A).value, 2000);
    assert.equal(cellOf(body, "ABCDE1234F", B.A).outstanding, 1500);
    assert.deepEqual(body.matrix.branches.map((b) => b.name), ["Ahmedabad", "Bopal", "Pune"]);
  });
  await t("outstanding ageing buckets by invoice date", async () => {
    const { body } = await rep({});
    const a = byKey(body, "ABCDE1234F");
    assert.equal(a[ageBucket("2026-05-05")], 1500);
    const no = byKey(body, V.No);
    assert.equal(no[ageBucket("2026-07-01")], 400);
    const sum = ["age0_30", "age31_60", "age61_90", "age90p"].reduce((s, k) => s + body.totals[k], 0);
    assert.equal(sum, body.totals.outstanding);
  });
  await t("monthly trend in IST", async () => {
    const { body } = await rep({});
    assert.deepEqual(body.monthly.map((m) => [m.m, m.value]), [[3, 600], [4, 1000], [5, 2000], [6, 300], [7, 5400], [8, 50]]);
    assert.equal(body.monthly.find((m) => m.m === 6).approved, 0);
  });
  await t("paid basis: UTR-recorded installments only; Raised installment excluded; UTR date when no value date", async () => {
    const { body } = await rep({ basis: "payment" });
    const a = byKey(body, "ABCDE1234F");
    assert.equal(a.payments, 2); assert.equal(a.paid, 1500); assert.equal(a.branchCount, 2); assert.equal(a.invoices, 2);
    const x = byKey(body, "PQRST6789Z");
    assert.equal(x.paid, 5000); assert.equal(new Date(x.lastDate).toISOString().slice(0, 10), "2026-08-02");
    assert.equal(body.totals.paid, 7100); assert.equal(body.vendors.length, 3);
    assert.equal(byKey(body, V.No).paid, 600, "legacy record without installments is counted");
    assert.equal(cellOf(body, "ABCDE1234F", B.A).value, 500);
    assert.deepEqual(body.monthly.map((m) => [m.m, m.value]), [[3, 600], [4, 1000], [5, 500], [8, 5000]]);
  });
  await t("period filters: paid in May vs billed in May", async () => {
    const p = (await rep({ basis: "payment", from: "2026-05-01", to: "2026-05-31" })).body;
    assert.deepEqual(p.vendors.map((v) => [v.key, v.paid]), [["ABCDE1234F", 500]]);
    const b = (await rep({ from: "2026-05-01", to: "2026-05-31" })).body;
    assert.deepEqual(b.vendors.map((v) => [v.key, v.net]), [["ABCDE1234F", 2000]]);
  });
  await t("IST day boundaries: 'to 30 Apr' ends at 23:59 IST and excludes 1 May invoices", async () => {
    const b = (await rep({ from: "2026-04-01", to: "2026-04-30" })).body;
    assert.deepEqual(b.vendors.map((v) => v.net), [1000]);
  });
  await t("Revenue/Capital and subtype filters (by category type)", async () => {
    const cap = (await rep({ expenseType: "Capital" })).body;
    assert.deepEqual(cap.vendors.map((v) => [v.key, v.net]), [["PQRST6789Z", 5000], ["ABCDE1234F", 300]]);
    const sub = (await rep({ category: Cc.cap })).body;
    assert.equal(sub.totals.net, 5300);
    const payCap = (await rep({ basis: "payment", expenseType: "Capital" })).body;
    assert.deepEqual(payCap.vendors.map((v) => [v.key, v.paid]), [["PQRST6789Z", 5000]]);
  });
  await t("status options", async () => {
    assert.equal((await rep({ status: "approved" })).body.totals.inFlightNet, 0);
    assert.equal(byKey((await rep({ status: "all" })).body, "PQRST6789Z").net, 5777);
    assert.equal((await rep({ status: "inflight" })).body.totals.net, 300);
  });
  await t("branch scoping: a branch-restricted user never sees other branches", async () => {
    const pune = { role: "accounts", branches: [{ _id: B.P }] };
    const own = (await rep({}, pune)).body;
    assert.equal(own.totals.net, 1000 + 300 + 400 + 600);
    assert.equal(own.matrix.branches.length, 1);
    const other = (await rep({ branch: B.A }, pune)).body;
    assert.equal(other.vendors.length, 0, "asking for Ahmedabad returns nothing");
    const sa = (await rep({ branch: B.A })).body;
    assert.equal(sa.totals.net, 7000);
  });
  await t("vendor search by name, company and PAN", async () => {
    assert.deepEqual((await rep({ search: "acme" })).body.vendors.map((v) => v.key), ["ABCDE1234F"]);
    assert.deepEqual((await rep({ search: "pqrst" })).body.vendors.map((v) => v.key), ["PQRST6789Z"]);
    assert.deepEqual((await rep({ search: "xylo pvt" })).body.vendors.map((v) => v.key), ["PQRST6789Z"]);
    assert.deepEqual((await rep({ search: "a.*" })).body.vendors.length, 0, "regex characters are literal");
  });
  await t("detail: branch-wise payments for one vendor, both lenses", async () => {
    const { code, body } = await det({ key: "ABCDE1234F" });
    assert.equal(code, 200, JSON.stringify(body));
    assert.equal(body.vendor.name, "Acme Healthcare"); assert.equal(String(body.vendor.masterId), M1);
    const pune = body.byBranch.find((b) => b.branch === B.P);
    const ahd = body.byBranch.find((b) => b.branch === B.A);
    assert.deepEqual([pune.invoices, pune.net, pune.paid, pune.outstanding, pune.inFlightNet, pune.payments, pune.paidInPeriod], [2, 1300, 1000, 0, 300, 1, 1000]);
    assert.deepEqual([ahd.invoices, ahd.net, ahd.paid, ahd.outstanding, ahd.payments, ahd.paidInPeriod], [1, 2000, 500, 1500, 1, 500]);
    assert.deepEqual(ahd.gstins, ["24ABCDE1234F1Z9"]);
    assert.equal(body.totals.net, 3300); assert.equal(body.totals.paidInPeriod, 1500); assert.equal(body.totals.branches, 2);
    assert.deepEqual(body.monthly.map((m) => [m.m, m.net, m.paid]), [[4, 1000, 1000], [5, 2000, 500], [6, 300, 0]]);
    assert.deepEqual(body.byCategory.map((c) => [c.name, c.net]), [["Consumables", 3000], ["Equipment", 300]]);
    assert.deepEqual(body.invoices.map((i) => i.requestId), ["INV-3", "INV-2", "INV-1"]);
    assert.equal(body.invoices[1].branchName, "Ahmedabad");
    assert.deepEqual(body.payments.map((p) => [p.utr, p.amount, p.branchName, p.requestId]), [["U2", 500, "Ahmedabad", "INV-2"], ["U1", 1000, "Pune", "INV-1"]]);
    assert.equal(body.invoiceCount, 3); assert.equal(body.paymentCount, 2);
  });
  await t("detail respects the period and branch filters", async () => {
    const b = (await det({ key: "ABCDE1234F", branch: B.A })).body;
    assert.deepEqual(b.byBranch.map((x) => x.branchName), ["Ahmedabad"]);
    const m = (await det({ key: "ABCDE1234F", from: "2026-05-01", to: "2026-05-31" })).body;
    assert.equal(m.totals.net, 2000); assert.equal(m.totals.paidInPeriod, 500);
  });
  await t("detail for a no-PAN vendor (keyed by its record id)", async () => {
    const { code, body } = await det({ key: V.No });
    assert.equal(code, 200); assert.equal(body.vendor.name, "MSEB"); assert.equal(body.totals.net, 1000); assert.equal(body.vendor.pan, "");
    assert.deepEqual(body.payments.map((p) => [p.utr, p.amount]), [["UL9", 600]], "legacy payment listed");
  });
  await t("bad input: invalid vendor key, unknown PAN, bad dates, reversed range, object-valued query", async () => {
    assert.equal((await det({ key: "x" })).code, 400);
    assert.equal((await det({ key: "ZZZZZ9999Z" })).code, 404);
    assert.equal((await rep({ from: "01-05-2026" })).code, 400);
    assert.equal((await rep({ from: "2026-06-01", to: "2026-05-01" })).code, 400);
    assert.equal((await rep({ category: "nope" })).code, 400);
    const inj = await rep({ status: { $ne: "x" }, branch: { $gt: "" }, search: { $where: "1" } });
    assert.equal(inj.code, 200); assert.equal(inj.body.totals.net, 9350, "object values are ignored, defaults apply");
    assert.equal((await rep({ from: "2026-13-01" })).code, 400, "month 13");
    assert.equal((await rep({ to: "2026-02-31" })).code, 400, "31 February");
  });
  await t("REVIEW FIX: days-to-pay uses the processed installment's date (UTR time when no value date typed)", async () => {
    // A: INV-1 paid 10 days after invoice via installment date; INV-9 legacy uses utrRecordedAt (10 days)
    db.paymentprocessings[0].paymentDate = null; // parent date blank, as when no date is typed
    const a = byKey((await rep({})).body, "ABCDE1234F");
    assert.equal(a.avgDaysToPay, 10); assert.equal(new Date(a.lastPayment).toISOString().slice(0, 10), "2026-05-15");
    const x = byKey((await rep({})).body, "PQRST6789Z");
    assert.equal(x.avgDaysToPay, 18, "fully paid, installment has only utrRecordedAt (15 Jul → 2 Aug)");
    assert.equal(byKey((await rep({})).body, V.No).avgDaysToPay, 10, "legacy 'Payment Processed' counts as fully paid");
  });
  await t("REVIEW FIX: a future-dated approved invoice still lands in an ageing bucket", async () => {
    const future = new Date(Date.now() + 5 * DAY); future.setUTCHours(0, 0, 0, 0);
    db.invoicerequests.push({ _id: I(50), requestId: "INV-50", vendor: V.NA, branch: B.Bo, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: future, createdAt: new Date(), status: "Cluster Head Approved", amount: 70, netPayable: 70, invoiceNumber: "F-50" });
    const { body } = await rep({});
    const sum = ["age0_30", "age31_60", "age61_90", "age90p"].reduce((s, k) => s + body.totals[k], 0);
    assert.equal(Math.round(sum), Math.round(body.totals.outstanding));
    assert.equal(byKey(body, V.NA)[ageBucket(ymd(future))] >= 70, true, "future invoice counted in the first bucket");
    assert.equal(byKey(body, V.NA).age0_30 >= 70, true);
    db.invoicerequests.pop();
  });
  await t("REVIEW FIX: invoice value includes round-off, so value − TDS = net", async () => {
    db.invoicerequests.push({ _id: I(51), requestId: "INV-51", vendor: V.NA, branch: B.Bo, expenseCategory: Cc.rev, expenseType: "Revenue", invoiceDate: D("2026-08-05"), createdAt: D("2026-08-05"), status: "Submitted", amount: 99.5, gstAmount: 0, roundOff: 0.5, tdsAmount: 0, netPayable: 100, invoiceNumber: "R-51" });
    const na = byKey((await rep({ from: "2026-08-05", to: "2026-08-05" })).body, V.NA);
    assert.equal(na.gross - na.tds, na.net);
    db.invoicerequests.pop();
  });
  await t("REVIEW FIX: branch-restricted user cannot open a vendor their branches never used", async () => {
    const bopal = { role: "cluster_head", branches: [{ _id: B.Bo }] };
    assert.equal((await det({ key: "ABCDE1234F" }, bopal)).code, 404);
    assert.equal((await det({ key: V.NA }, bopal)).code, 200);
    // used in their branch, but not in the chosen period → still allowed (empty lists)
    const pune = { role: "accounts", branches: [{ _id: B.P }] };
    const r = await det({ key: "ABCDE1234F", from: "2020-01-01", to: "2020-01-31" }, pune);
    assert.equal(r.code, 200); assert.equal(r.body.totals.invoices, 0);
  });
  console.log(`\n${n} vendor report tests passed`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
