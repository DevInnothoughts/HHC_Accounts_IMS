// Run from backend/:  node src/scripts/lib/__tests__/dbBackup.test.js   (no DB needed)
const assert = require("assert");
const fs = require("fs"); const path = require("path"); const os = require("os");
const { runBackup, runRestore } = require("../dbBackup");

// Minimal EJSON stand-in: Dates round-trip as {$date}, like the real one.
const EJSON = {
  stringify: (d) => JSON.stringify(d, function (k, v) { return this[k] instanceof Date ? { $date: this[k].toISOString() } : v; }),
  parse: (s) => JSON.parse(s, (k, v) => (v && typeof v === "object" && typeof v.$date === "string" ? new Date(v.$date) : v)),
};
// In-memory database with the driver calls the library uses.
const makeDb = (name, data = {}) => {
  const C = new Map(Object.entries(data).map(([n, docs]) => [n, { docs: docs.map((d) => ({ ...d })), idx: [{ v: 2, key: { _id: 1 }, name: "_id_" }] }]));
  // Like the real driver, a collection exists only once something is written.
  const coll = (n) => {
    const blank = { docs: [], idx: [{ v: 2, key: { _id: 1 }, name: "_id_" }] };
    const c = C.get(n) || blank;
    const ensure = () => { if (!C.has(n)) C.set(n, c); };
    return {
      find: () => ({ async *[Symbol.asyncIterator]() { for (const d of c.docs) yield d; } }),
      listIndexes: () => ({ toArray: async () => c.idx.map((i) => ({ ...i })) }),
      countDocuments: async () => c.docs.length,
      insertMany: async (b) => { ensure(); c.docs.push(...b); },
      drop: async () => { c.docs = []; c.idx = [{ v: 2, key: { _id: 1 }, name: "_id_" }]; },
      createIndex: async (key, o) => { ensure(); c.idx.push({ key, ...o }); },
      _c: c,
    };
  };
  return {
    databaseName: name,
    listCollections: () => ({ toArray: async () => [...C.keys()].map((n) => ({ name: n, type: "collection" })) }),
    collection: coll, _C: C,
  };
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
const quiet = () => {};
const vendors = Array.from({ length: 2500 }, (_, i) => ({ _id: `v${i}`, vendorName: `V${i}`, createdAt: new Date(Date.UTC(2025, 0, 1 + (i % 28))), documents: [{ type: "pan", key: `vendors/v${i}/documents/p.pdf` }] }));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ✓", name); };

(async () => {
  const live = makeDb("hhc", { vendors, invoicerequests: [{ _id: "i1", amount: 10.5 }], "system.views": [{ _id: 1 }] });
  live._C.get("vendors").idx.push({ v: 2, key: { panNumber: 1 }, name: "dup_vendor_pan", ns: "hhc.vendors" });
  const up = path.join(tmp, "uploads"); fs.mkdirSync(path.join(up, "vendors/v1/documents"), { recursive: true });
  fs.writeFileSync(path.join(up, "vendors/v1/documents/p.pdf"), "PDF");
  let dir;

  await t("backup: every collection, counts + checksums in manifest, system collections skipped, uploads copied", async () => {
    const r = await runBackup({ outDir: path.join(tmp, "backups"), uploadsDir: up }, { db: live, EJSON, fs, log: quiet });
    dir = r.dir;
    assert.deepEqual(r.manifest.collections.map((c) => [c.name, c.count]), [["invoicerequests", 1], ["vendors", 2500]]);
    assert.ok(r.manifest.collections.every((c) => /^[0-9a-f]{64}$/.test(c.sha256)));
    assert.equal(r.manifest.uploads.files, 1);
    assert.equal(fs.readFileSync(path.join(dir, "uploads/vendors/v1/documents/p.pdf"), "utf8"), "PDF");
    const idx = JSON.parse(fs.readFileSync(path.join(dir, "vendors.indexes.json"), "utf8"));
    assert.ok(idx.some((i) => i.name === "dup_vendor_pan" && !("ns" in i) && !("v" in i)));
    assert.equal(live._C.get("vendors").docs.length, 2500, "backup never changes the database");
  });
  await t("backup refuses to overwrite an existing folder", async () => {
    const at = new Date("2026-09-19T10:00:00Z");
    await runBackup({ outDir: path.join(tmp, "b2"), now: at }, { db: live, EJSON, fs, log: quiet });
    await assert.rejects(runBackup({ outDir: path.join(tmp, "b2"), now: at }, { db: live, EJSON, fs, log: quiet }), /Refusing to overwrite/);
  });
  await t("ONLY backs up just the named collections; unknown names are refused", async () => {
    const r = await runBackup({ outDir: path.join(tmp, "b3"), only: ["invoicerequests"] }, { db: live, EJSON, fs, log: quiet });
    assert.deepEqual(r.manifest.collections.map((c) => c.name), ["invoicerequests"]);
    await assert.rejects(runBackup({ outDir: path.join(tmp, "b4"), only: ["nope"] }, { db: live, EJSON, fs, log: quiet }), /Not in the database/);
  });
  await t("restore dry run writes nothing", async () => {
    const staging = makeDb("hhc_staging");
    await runRestore({ backupDir: dir }, { db: staging, EJSON, fs, log: quiet });
    assert.equal(staging._C.size, 0);
  });
  await t("restore into an empty database: exact documents (dates stay Dates) and indexes", async () => {
    const staging = makeDb("hhc_staging");
    const r = await runRestore({ backupDir: dir, apply: true }, { db: staging, EJSON, fs, log: quiet });
    assert.equal(r.restored.length, 2);
    const got = staging._C.get("vendors").docs;
    assert.equal(got.length, 2500);
    assert.ok(got[7].createdAt instanceof Date);
    assert.deepEqual(got[7], vendors[7]);
    assert.ok(staging._C.get("vendors").idx.some((i) => i.name === "dup_vendor_pan"));
  });
  await t("a collection that already has data is skipped unless --drop", async () => {
    const staging = makeDb("hhc_staging", { vendors: [{ _id: "keep" }] });
    const r = await runRestore({ backupDir: dir, apply: true }, { db: staging, EJSON, fs, log: quiet });
    assert.equal(r.skipped[0].name, "vendors"); assert.deepEqual(staging._C.get("vendors").docs, [{ _id: "keep" }]);
    const r2 = await runRestore({ backupDir: dir, apply: true, drop: true, only: ["vendors"] }, { db: staging, EJSON, fs, log: quiet });
    assert.equal(r2.restored[0].count, 2500); assert.equal(staging._C.get("vendors").docs.length, 2500);
  });
  await t("a damaged file is detected before anything is written", async () => {
    const f = path.join(dir, "invoicerequests.ejson.gz"); const saved = fs.readFileSync(f);
    fs.writeFileSync(f, Buffer.concat([saved, Buffer.from("x")]));
    const staging = makeDb("hhc_staging");
    await assert.rejects(runRestore({ backupDir: dir, apply: true }, { db: staging, EJSON, fs, log: quiet }), /damaged/);
    assert.equal(staging._C.size, 0);
    fs.writeFileSync(f, saved);
  });
  await t("an unfinished backup (no finishedAt) or a foreign folder is refused", async () => {
    const m = path.join(dir, "manifest.json"); const saved = fs.readFileSync(m, "utf8");
    fs.writeFileSync(m, JSON.stringify({ ...JSON.parse(saved), finishedAt: null }));
    await assert.rejects(runRestore({ backupDir: dir }, { db: makeDb("x"), EJSON, fs, log: quiet }), /did not finish/);
    fs.writeFileSync(m, JSON.stringify({ ...JSON.parse(saved), collections: [{ name: "../evil", file: "../evil.ejson.gz" }] }));
    await assert.rejects(runRestore({ backupDir: dir }, { db: makeDb("x"), EJSON, fs, log: quiet }), /Bad manifest entry/);
    fs.writeFileSync(m, saved);
    await assert.rejects(runRestore({ backupDir: tmp }, { db: makeDb("x"), EJSON, fs, log: quiet }), /No manifest/);
  });
  console.log(`\n${n} backup/restore tests passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
