// Run from backend/:  node src/scripts/lib/__tests__/runner.test.js   (no DB needed)
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { runBackfill, runRollback } = require("../vendorMasterBackfillRunner");
const { MASTER_OWNED_FIELDS } = require("../../../config/constants");

// ── In-memory DB ────────────────────────────────────────────
function makeDb(vendors, masters = []) {
  const V = new Map(vendors.map((v) => [String(v._id), { ...v }]));
  const M = new Map(masters.map((m) => [String(m._id), { ...m }]));
  let seq = 0;
  const dal = {
    newId: () => `m${++seq}`,
    loadCandidateRows: async ({ onlyPan }) =>
      [...V.values()]
        .filter(
          (v) =>
            v.approvalStatus === "approved" &&
            v.status === "active" &&
            !v.vendorMaster &&
            v.panNumber &&
            (!onlyPan || v.panNumber.trim().toUpperCase() === onlyPan),
        )
        .map((v) => ({ ...v })),
    loadMastersByPans: async (pans) =>
      new Map(
        [...M.values()]
          .filter((m) => pans.includes(m.panNumber))
          .map((m) => [m.panNumber, { ...m }]),
      ),
    loadLinkedBranches: async (ids) => {
      const o = new Map();
      for (const v of V.values())
        if (
          v.vendorMaster &&
          ids.map(String).includes(String(v.vendorMaster))
        ) {
          const k = String(v.vendorMaster);
          if (!o.has(k)) o.set(k, new Set());
          o.get(k).add(String(v.branch));
        }
      return o;
    },
    invoiceCounts: async () => new Map(),
    branchNames: async () =>
      new Map([
        ["bP", "Pune (PUN)"],
        ["bA", "Ahmedabad (AHD)"],
        ["bB", "Bopal (BOP)"],
      ]),
    validateMaster: async (d) => (d.vendorName ? [] : ["vendorName required"]),
    createMaster: async (d) => {
      if (dal.failCreate) throw new Error("boom");
      if ([...M.values()].some((m) => m.panNumber === d.panNumber))
        throw new Error("E11000");
      M.set(String(d._id), { ...d });
    },
    linkRow: async (id, set) => {
      const v = V.get(String(id));
      if (!v || v.vendorMaster) return false;
      Object.assign(v, set);
      return true;
    },
    recount: async (mid) => {
      const m = M.get(String(mid));
      if (m)
        m.linkedBranchCount = [...V.values()].filter(
          (v) => String(v.vendorMaster) === String(mid),
        ).length;
    },
    findMaster: async (id) =>
      M.has(String(id)) ? { ...M.get(String(id)) } : null,
    rowsOfMaster: async (id) =>
      [...V.values()]
        .filter((v) => String(v.vendorMaster) === String(id))
        .map((v) => String(v._id)),
    restoreRow: async (id, mid, before) => {
      const v = V.get(String(id));
      if (!v || String(v.vendorMaster) !== String(mid)) return false;
      Object.assign(v, before);
      return true;
    },
    deleteMaster: async (id) => {
      if (M.get(String(id))?.createdByScript) M.delete(String(id));
    },
  };
  return { dal, V, M };
}

// ── Temp uploads + fixtures ─────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vmtest-"));
const uploads = path.join(tmp, "uploads");
const out = path.join(tmp, "out");
const put = (key, bytes) => {
  const p = path.join(uploads, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
};
put("vendors/v1/documents/pan.pdf", 1000);
put("vendors/v1/documents/chq.jpg", 2000);
put("vendors/v2/documents/pan.pdf", 1000);
put("vendors/v2/documents/chq.jpg", 2000);

const common = {
  vendorName: "Acme",
  mobile: "9",
  vendorType: "standard",
  accountHolderName: "ACME",
  bankName: "SBI",
  ifscCode: "SBIN0001234",
  gstNumber: "",
  approvalStatus: "approved",
  status: "active",
};
const docs = (id) => [
  { type: "pan", key: `vendors/${id}/documents/pan.pdf`, name: "pan.pdf" },
  { type: "cheque", key: `vendors/${id}/documents/chq.jpg`, name: "chq.jpg" },
];
const fixtures = () => [
  {
    _id: "v1",
    branch: "bP",
    panNumber: "ABCDE1234F",
    accountNumber: "111",
    contactPerson: "Pune guy",
    documents: docs("v1"),
    approvedAt: new Date(2026, 1, 1),
    ...common,
  },
  {
    _id: "v2",
    branch: "bA",
    panNumber: "abcde1234f ",
    accountNumber: "111",
    contactPerson: "Ahd guy",
    documents: docs("v2"),
    approvedAt: new Date(2025, 1, 1),
    ...common,
  },
  {
    _id: "v3",
    branch: "bB",
    panNumber: "ABCDE1234F",
    accountNumber: "999",
    documents: [],
    ...common,
  }, // different bank → keep
  {
    _id: "v4",
    branch: "bP",
    panNumber: "PQRSX5678Z",
    accountNumber: "222",
    documents: [{ type: "pan", key: "vendors/missing.pdf" }],
    ...common,
  }, // missing file
  {
    _id: "v5",
    branch: "bP",
    panNumber: "ZZZZZ9999Z",
    accountNumber: "333",
    documents: [],
    ...common,
    approvalStatus: "pending_approval",
  }, // out of scope
];
const quiet = { log: () => {} };
const deps = (dal, extra = {}) => ({
  dal,
  fs,
  uploadBase: uploads,
  getFileUrl: (k) => `http://x/files/${k}`,
  audit: async (e) => audits.push(e),
  now: () => new Date("2026-09-19T06:00:00Z"),
  ...quiet,
  ...extra,
});
let audits = [];
let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log("  ✓", name);
};

(async () => {
  let db = makeDb(fixtures());

  await t("dry run writes only the CSV; no DB or file changes", async () => {
    const s = await runBackfill({ apply: false, outDir: out }, deps(db.dal));
    assert.equal(s.candidates, 4);
    assert.equal(s.groups, 2);
    assert.equal(s.createCount, 2);
    assert.equal(s.linkRows, 3);
    assert.equal(s.keepRows, 1);
    assert.equal(s.reasons.PAYMENT_DETAILS_DIFFER, 1);
    assert.equal(s.missingFiles, 1);
    assert.equal(s.copyFiles, 2);
    assert.equal(s.copyBytes, 3000);
    assert.equal(s.reclaimBytes, 6000);
    assert.equal(db.M.size, 0);
    assert.ok([...db.V.values()].every((v) => !v.vendorMaster));
    assert.ok(!fs.existsSync(path.join(uploads, "vendor-masters")));
    const csv = fs.readFileSync(s.reportPath, "utf8");
    assert.ok(
      csv.includes("KEEP_BRANCH_LEVEL,PAYMENT_DETAILS_DIFFER,accountNumber"),
    );
    assert.ok(csv.includes("****0111") === false && csv.includes("****111")); // masked, last 4
    assert.ok(!csv.includes(",111,")); // full account number never written
  });

  let journalPath;
  await t(
    "apply: masters created, matching rows linked, docs copied, bank unchanged",
    async () => {
      audits = [];
      const s = await runBackfill(
        { apply: true, outDir: out, actorId: "u1" },
        deps(db.dal),
      );
      journalPath = s.journalPath;
      assert.equal(s.applied.mastersCreated, 2);
      assert.equal(s.applied.rowsLinked, 3);
      assert.equal(s.applied.failures.length, 0);
      const m = [...db.M.values()].find((x) => x.panNumber === "ABCDE1234F");
      assert.equal(m.createdByScript, true);
      assert.equal(m.approvalStatus, "approved");
      assert.equal(m.linkedBranchCount, 2);
      assert.equal(m.sourceVendorId, "v1"); // most recently approved
      assert.equal(m.documents.length, 2);
      m.documents.forEach((d) => {
        assert.ok(d.key.startsWith(`vendor-masters/${m._id}/documents/`));
        assert.ok(fs.existsSync(path.join(uploads, d.key)));
      });
      assert.ok(
        fs.existsSync(path.join(uploads, "vendors/v1/documents/pan.pdf")),
        "originals untouched",
      );
      assert.equal(db.V.get("v2").vendorMaster, m._id);
      assert.equal(db.V.get("v2").sourceOfTruth, "master");
      assert.equal(db.V.get("v2").accountNumber, "111"); // payment unchanged
      assert.equal(db.V.get("v2").contactPerson, "Pune guy"); // non-payment field takes master's
      assert.equal(db.V.get("v2").panNumber, "ABCDE1234F"); // normalised
      assert.ok(
        !db.V.get("v3").vendorMaster,
        "different bank stays branch-level",
      );
      assert.ok(!db.V.get("v5").vendorMaster, "pending vendors out of scope");
      const m2 = [...db.M.values()].find((x) => x.panNumber === "PQRSX5678Z");
      assert.equal(m2.documents.length, 0, "missing file skipped, not fatal");
      assert.ok(
        audits.some((a) => a.action === "CREATE_VENDOR_MASTER") &&
          audits.filter((a) => a.action === "ATTACH_VENDOR_TO_MASTER")
            .length === 3,
      );
      const j = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      assert.equal(j.entries.length, 2);
      assert.ok(j.finishedAt);
      assert.equal(
        j.entries
          .find((e) => e.pan === "ABCDE1234F")
          .rows.find((r) => r.vendorId === "v2").before.contactPerson,
        "Ahd guy",
      );
    },
  );

  await t(
    "re-run is a no-op for linked rows; only the conflicting row remains a candidate",
    async () => {
      const s = await runBackfill({ apply: true, outDir: out }, deps(db.dal));
      assert.equal(s.candidates, 1);
      assert.equal(s.applied.mastersCreated, 0);
      assert.equal(s.applied.rowsLinked, 0);
      assert.equal(s.reasons.PAYMENT_DETAILS_DIFFER, 1);
    },
  );

  await t("rollback dry run changes nothing", async () => {
    const r = await runRollback({ journalPath, apply: false }, deps(db.dal));
    assert.equal(r.restoredRows, 0);
    assert.equal(db.M.size, 2);
  });

  await t(
    "rollback refuses a master whose bank details changed since",
    async () => {
      const m = [...db.M.values()].find((x) => x.panNumber === "ABCDE1234F");
      const saved = m.accountNumber;
      m.accountNumber = "555";
      const r = await runRollback({ journalPath, apply: true }, deps(db.dal));
      assert.ok(
        r.refused.some(
          (x) =>
            x.pan === "ABCDE1234F" && /payment details changed/.test(x.why),
        ),
      );
      assert.ok(
        db.M.has(String(m._id)) && db.V.get("v2").vendorMaster === m._id,
      );
      m.accountNumber = saved;
    },
  );

  await t(
    "rollback refuses when a branch was linked after the backfill",
    async () => {
      db = makeDb(fixtures());
      const s = await runBackfill({ apply: true, outDir: out }, deps(db.dal));
      const m = [...db.M.values()].find((x) => x.panNumber === "ABCDE1234F");
      db.V.set("vNew", { _id: "vNew", branch: "bX", vendorMaster: m._id });
      const r = await runRollback(
        { journalPath: s.journalPath, apply: true },
        deps(db.dal),
      );
      assert.ok(r.refused.some((x) => x.pan === "ABCDE1234F"));
      assert.ok(db.M.has(String(m._id)));
    },
  );

  await t(
    "rollback apply restores rows exactly and removes masters + copied files",
    async () => {
      db = makeDb(fixtures());
      const before = JSON.parse(JSON.stringify([...db.V.values()]));
      const s = await runBackfill({ apply: true, outDir: out }, deps(db.dal));
      const copied = [...db.M.values()].flatMap((m) =>
        m.documents.map((d) => d.key),
      );
      const r = await runRollback(
        { journalPath: s.journalPath, apply: true },
        deps(db.dal),
      );
      assert.equal(r.refused.length, 0);
      assert.equal(r.deletedMasters, 2);
      assert.equal(r.restoredRows, 3);
      assert.equal(db.M.size, 0);
      copied.forEach((k) => assert.ok(!fs.existsSync(path.join(uploads, k))));
      for (const b of before) {
        const v = db.V.get(b._id);
        for (const f of [...MASTER_OWNED_FIELDS, "vendorMaster"]) {
          const exp = b[f] === undefined || b[f] === "" ? null : b[f];
          const got = v[f] === undefined || v[f] === "" ? null : v[f];
          assert.deepEqual(got, exp, `${b._id}.${f}`);
        }
      }
    },
  );

  await t(
    "createMaster failure: copied files cleaned up, rows untouched, run continues",
    async () => {
      const dir = path.join(uploads, "vendor-masters");
      const list = () =>
        new Set(
          fs.existsSync(dir)
            ? fs
                .readdirSync(dir, { recursive: true })
                .filter((f) => /\.(pdf|jpg)$/.test(f))
            : [],
        );
      const beforeFiles = list();
      db = makeDb(fixtures());
      db.dal.failCreate = true;
      const s = await runBackfill({ apply: true, outDir: out }, deps(db.dal));
      assert.equal(s.applied.failures.length, 2);
      assert.equal(s.applied.rowsLinked, 0);
      const added = [...list()].filter((f) => !beforeFiles.has(f));
      assert.deepEqual(added, []);
      assert.ok([...db.V.values()].every((v) => !v.vendorMaster));
    },
  );

  await t(
    "existing approved master: matching rows linked, no new master, no doc copy",
    async () => {
      const m = {
        _id: "mX",
        panNumber: "ABCDE1234F",
        accountNumber: "111",
        accountHolderName: "ACME",
        ifscCode: "SBIN0001234",
        gstNumber: "",
        approvalStatus: "approved",
        status: "active",
        vendorName: "Acme Master",
        documents: [],
      };
      db = makeDb(fixtures(), [m]);
      const s = await runBackfill(
        { apply: true, outDir: out, onlyPan: "ABCDE1234F" },
        deps(db.dal),
      );
      assert.equal(s.existingCount, 1);
      assert.equal(s.applied.mastersCreated, 0);
      assert.equal(s.applied.rowsLinked, 2);
      assert.equal(db.V.get("v1").vendorName, "Acme Master");
      assert.ok(!db.V.get("v3").vendorMaster);
    },
  );

  await t(
    "GOLDEN override: accounts picks the 999 account; only v3 links",
    async () => {
      db = makeDb(fixtures());
      const s = await runBackfill(
        {
          apply: true,
          outDir: out,
          onlyPan: "ABCDE1234F",
          goldenOverrideId: "v3",
        },
        deps(db.dal),
      );
      assert.equal(s.applied.rowsLinked, 1);
      assert.ok(db.V.get("v3").vendorMaster);
      assert.ok(!db.V.get("v1").vendorMaster);
    },
  );

  await t("path traversal in a stored doc key is refused", async () => {
    db = makeDb([
      {
        _id: "v9",
        branch: "bP",
        panNumber: "LMNOP1111Q",
        accountNumber: "1",
        documents: [{ type: "pan", key: "../../etc/passwd" }],
        ...common,
      },
    ]);
    const s = await runBackfill({ apply: true, outDir: out }, deps(db.dal));
    const m = [...db.M.values()][0];
    assert.equal(m.documents.length, 0);
    assert.equal(s.missingFiles, 1);
  });

  await t(
    "GSTIN per branch: primary from the seed, each branch keeps its own, list refreshed",
    async () => {
      const refreshed = [];
      const g = (over) => ({
        ...common,
        panNumber: "GSTPN1234K",
        accountNumber: "42",
        documents: [],
        ...over,
      });
      db = makeDb([
        g({
          _id: "g1",
          branch: "bP",
          gstNumber: "27GSTPN1234K1Z5",
          approvedAt: new Date(2026, 5, 1),
        }),
        g({ _id: "g2", branch: "bA", gstNumber: "24GSTPN1234K1Z9" }),
        g({ _id: "g3", branch: "bB", gstNumber: "24OTHER9999X1Z1" }), // not this PAN
      ]);
      const baseRecount = db.dal.recount;
      db.dal.recount = async (id) => {
        refreshed.push(id);
        return baseRecount(id);
      };
      const s = await runBackfill({ apply: true, outDir: out }, deps(db.dal));
      const m = [...db.M.values()][0];
      assert.equal(m.gstNumber, "27GSTPN1234K1Z5"); // primary = seed's
      assert.equal(s.applied.rowsLinked, 3); // GSTIN never blocks a link
      assert.equal(db.V.get("g2").gstNumber, "24GSTPN1234K1Z9"); // Ahmedabad keeps Gujarat GSTIN
      assert.equal(db.V.get("g3").gstNumber, "24OTHER9999X1Z1"); // bad one untouched, only flagged
      assert.deepEqual(refreshed, [m._id]); // GSTIN list rebuilt after linking
      const csv = fs.readFileSync(s.reportPath, "utf8");
      assert.equal(
        (csv.match(/GSTIN does not belong to this PAN/g) || []).length,
        1,
      );
    },
  );

  await t(
    "seed GSTIN of another PAN → master primary left blank and noted",
    async () => {
      db = makeDb([
        {
          ...common,
          _id: "h1",
          branch: "bP",
          panNumber: "HHHHH1111H",
          accountNumber: "1",
          gstNumber: "27ZZZZZ9999Z1Z1",
          documents: [],
        },
      ]);
      const s = await runBackfill({ apply: true, outDir: out }, deps(db.dal));
      assert.equal([...db.M.values()][0].gstNumber, null);
      assert.ok(
        fs
          .readFileSync(s.reportPath, "utf8")
          .includes("primary GSTIN left blank"),
      );
    },
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} runner tests passed`);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
