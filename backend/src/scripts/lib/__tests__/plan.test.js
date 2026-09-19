// Run from backend/:  node src/scripts/lib/__tests__/plan.test.js   (no DB needed)
const assert = require("assert");
const P = require("../vendorMasterBackfillPlan");
const { MASTER_OWNED_FIELDS } = require("../../../config/constants");
let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log("  ✓", name);
};

const PAN = "ABCDE1234F";
const base = {
  panNumber: PAN,
  vendorName: "Acme Supplies",
  mobile: "9999999999",
  vendorType: "standard",
  accountHolderName: "ACME SUPPLIES PVT LTD",
  bankName: "SBI",
  accountNumber: "111122223333",
  ifscCode: "SBIN0001234",
  gstNumber: "27ABCDE1234F1Z5",
  approvalStatus: "approved",
  status: "active",
  documents: [
    { type: "pan", key: "k/pan" },
    { type: "cheque", key: "k/chq" },
    { type: "gst", key: "k/gst" },
  ],
};
let seq = 0;
const row = (over = {}) => ({
  ...base,
  _id: `v${++seq}`,
  branch: `b${seq}`,
  createdAt: new Date(2025, 0, seq),
  approvedAt: new Date(2025, 5, seq),
  ...over,
});
const ids = (arr) => arr.map((r) => r._id || r.row._id).sort();

t("single row → CREATE, links itself", () => {
  const r = row();
  const p = P.planPan(PAN, [r]);
  assert.equal(p.mode, "CREATE");
  assert.equal(p.golden._id, r._id);
  assert.deepEqual(ids(p.link), [r._id]);
  assert.equal(p.keep.length, 0);
});

t("identical rows in 3 branches → one master, 3 links", () => {
  const rs = [row(), row(), row()];
  const p = P.planPan(PAN, rs);
  assert.equal(p.mode, "CREATE");
  assert.equal(p.link.length, 3);
  assert.equal(p.keep.length, 0);
});

t("holder name punctuation/case differences are the same payee", () => {
  const rs = [row(), row({ accountHolderName: "Acme Supplies Pvt. Ltd." })];
  assert.equal(P.planPan(PAN, rs).link.length, 2);
});

t(
  "different bank account → that row stays local with PAYMENT_DETAILS_DIFFER",
  () => {
    const a = row(),
      b = row(),
      c = row({ accountNumber: "999988887777" });
    const p = P.planPan(PAN, [a, b, c]);
    assert.deepEqual(ids(p.link), [a._id, b._id].sort());
    assert.equal(p.keep.length, 1);
    assert.equal(p.keep[0].row._id, c._id);
    assert.equal(p.keep[0].reason, "PAYMENT_DETAILS_DIFFER");
    assert.deepEqual(p.keep[0].fields, ["accountNumber"]);
  },
);

t("majority bank wins even if minority row has better docs", () => {
  const minority = row({
    accountNumber: "555",
    approvedAt: new Date(2026, 0, 1),
  });
  const m1 = row({ documents: [{ type: "pan" }] }),
    m2 = row({ documents: [{ type: "pan" }] });
  const p = P.planPan(PAN, [minority, m1, m2]);
  assert.deepEqual(ids(p.link), [m1._id, m2._id].sort());
  assert.equal(p.keep[0].row._id, minority._id);
});

t(
  "GSTIN is branch-level by default → Pune (27) and Ahmedabad (24) link to one master",
  () => {
    assert.ok(!MASTER_OWNED_FIELDS.includes("gstNumber"));
    const pune = row(),
      ahd = row({ gstNumber: "24ABCDE1234F1Z9" });
    const p = P.planPan(PAN, [pune, ahd]);
    assert.equal(p.link.length, 2);
    assert.equal(p.keep.length, 0);
    // and linking does not list GSTIN among fields it will overwrite
    for (const f of p.overwrites.values()) assert.ok(!f.includes("gstNumber"));
  },
);

t(
  "if GSTIN were master-owned, a different-state GSTIN would stay branch-level",
  () => {
    const owned = [...MASTER_OWNED_FIELDS, "gstNumber"];
    const p = P.planPan(PAN, [row(), row({ gstNumber: "24ABCDE1234F1Z9" })], {
      owned,
    });
    assert.equal(p.link.length, 1);
    assert.deepEqual(p.keep[0].fields, ["gstNumber"]);
  },
);

t("a malformed GSTIN no longer blocks the master (branch-level)", () => {
  const p = P.planPan(PAN, [row({ gstNumber: "NOT-A-GSTIN" })]);
  assert.equal(p.mode, "CREATE");
});

t("GST NOT master-owned → different-state GSTIN links", () => {
  const owned = MASTER_OWNED_FIELDS.filter((f) => f !== "gstNumber");
  const p = P.planPan(PAN, [row(), row({ gstNumber: "24ABCDE1234F1Z9" })], {
    owned,
  });
  assert.equal(p.link.length, 2);
  assert.equal(p.keep.length, 0);
});

t(
  "two rows in the same branch → one links, other SAME_BRANCH_DUPLICATE",
  () => {
    const a = row({ branch: "bX" }),
      b = row({ branch: "bX", documents: [] });
    const p = P.planPan(PAN, [a, b]);
    assert.deepEqual(ids(p.link), [a._id]);
    assert.equal(p.keep[0].reason, "SAME_BRANCH_DUPLICATE");
    assert.equal(p.keep[0].row._id, b._id);
  },
);

t("golden = most required docs, then latest approval", () => {
  const fewDocs = row({ documents: [{ type: "pan" }] });
  const older = row({ approvedAt: new Date(2024, 0, 1) });
  const newer = row({ approvedAt: new Date(2026, 0, 1) });
  assert.equal(P.planPan(PAN, [fewDocs, older, newer]).golden._id, newer._id);
});

t(
  "invalid IFSC on best row → next valid row in the cluster seeds the master",
  () => {
    const bad = row({ approvedAt: new Date(2027, 0, 1), ifscCode: "BAD" });
    const good = row();
    // different IFSC → different signature → two clusters of 1; tie → best-ranked cluster (bad) has no valid row → next cluster
    const p = P.planPan(PAN, [bad, good]);
    assert.equal(p.golden._id, good._id);
    assert.equal(p.keep[0].row._id, bad._id);
  },
);

t("no valid row at all → SKIP with INVALID_DATA and the problems", () => {
  const p = P.planPan(PAN, [row({ mobile: "" })]);
  assert.equal(p.mode, "SKIP");
  assert.equal(p.keep[0].reason, "INVALID_DATA");
  assert.ok(p.keep[0].fields.includes("mobile missing"));
});

t("invalid PAN → SKIP INVALID_PAN", () => {
  const p = P.planPan("BADPAN", [row({ panNumber: "BADPAN" })]);
  assert.equal(p.mode, "SKIP");
  assert.equal(p.keep[0].reason, "INVALID_PAN");
});

t("statutory vendor without bank details can seed a master", () => {
  const s = row({
    vendorType: "statutory",
    accountHolderName: "",
    bankName: "",
    accountNumber: "",
    ifscCode: "",
    gstNumber: "",
    documents: [],
  });
  assert.equal(P.planPan(PAN, [s]).mode, "CREATE");
});

t(
  "GOLDEN_VENDOR_ID override picks the minority account and links its cluster only",
  () => {
    const a = row(),
      b = row(),
      c = row({ accountNumber: "777" });
    const p = P.planPan(PAN, [a, b, c], { goldenOverrideId: c._id });
    assert.equal(p.golden._id, c._id);
    assert.deepEqual(ids(p.link), [c._id]);
    assert.equal(p.keep.length, 2);
  },
);

t("override id not in group → SKIP", () => {
  assert.equal(
    P.planPan(PAN, [row()], { goldenOverrideId: "nope" }).keep[0].reason,
    "GOLDEN_VENDOR_NOT_IN_GROUP",
  );
});

t(
  "existing approved master → links only matching rows, skips already-linked branches",
  () => {
    const m = {
      ...base,
      _id: "m1",
      approvalStatus: "approved",
      status: "active",
    };
    const a = row({ branch: "b100" }),
      b = row({ branch: "b200" }),
      c = row({ accountNumber: "1" });
    const p = P.planPan(PAN, [a, b, c], {
      existingMaster: m,
      existingLinkedBranches: new Set(["b200"]),
    });
    assert.equal(p.mode, "USE_EXISTING");
    assert.deepEqual(ids(p.link), [a._id]);
    const reasons = Object.fromEntries(
      p.keep.map((k) => [k.row._id, k.reason]),
    );
    assert.equal(reasons[b._id], "BRANCH_ALREADY_LINKED");
    assert.equal(reasons[c._id], "PAYMENT_DETAILS_DIFFER");
  },
);

t("existing master not approved → nothing linked", () => {
  const m = {
    ...base,
    _id: "m1",
    approvalStatus: "pending_approval",
    status: "active",
  };
  const p = P.planPan(PAN, [row()], { existingMaster: m });
  assert.equal(p.mode, "SKIP");
  assert.equal(p.keep[0].reason, "MASTER_NOT_APPROVED_OR_ACTIVE");
});

t(
  "documents: golden's copy per type, gaps filled from other linked rows",
  () => {
    const g = row({
      documents: [
        { type: "pan", key: "g/pan" },
        { type: "cheque", key: "g/chq" },
      ],
      approvedAt: new Date(2027, 0, 1),
    });
    const o = row({
      documents: [
        { type: "pan", key: "o/pan" },
        { type: "msme", key: "o/msme" },
      ],
    });
    const p = P.planPan(PAN, [g, o]);
    const byType = Object.fromEntries(p.documents.map((d) => [d.type, d.key]));
    assert.deepEqual(byType, { pan: "g/pan", cheque: "g/chq", msme: "o/msme" });
  },
);

t("overwrites lists non-payment fields that linking will change", () => {
  const g = row({ approvedAt: new Date(2027, 0, 1) }),
    o = row({ contactPerson: "Ravi (Ahmedabad)" });
  const p = P.planPan(PAN, [g, o]);
  assert.deepEqual(p.overwrites.get(o._id), ["contactPerson"]);
});

t("groupByPan normalises case and whitespace", () => {
  const g = P.groupByPan([row({ panNumber: " abcde1234f" }), row()]);
  assert.equal(g.size, 1);
  assert.equal(g.get(PAN).length, 2);
});

t("every row ends up in exactly one of link/keep", () => {
  const rs = [
    row(),
    row({ branch: "bZ" }),
    row({ branch: "bZ" }),
    row({ accountNumber: "3" }),
    row({ ifscCode: "HDFC0000001" }),
  ];
  const p = P.planPan(PAN, rs);
  const all = [
    ...p.link.map((r) => r._id),
    ...p.keep.map((k) => k.row._id),
  ].sort();
  assert.deepEqual(all, rs.map((r) => r._id).sort());
});

console.log(`\n${n} tests passed`);
