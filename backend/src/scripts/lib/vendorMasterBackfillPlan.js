// ============================================================
// BACKEND: src/scripts/lib/vendorMasterBackfillPlan.js  —  NEW FILE
// ------------------------------------------------------------
// The DECISIONS of the Phase 3 backfill, with no database access:
// given the branch vendor rows for one PAN, decide which row seeds the
// master, which rows link to it, and which stay branch-level and why.
//
// Kept free of Mongoose so it can be unit-tested and so the rules can
// be read in one place. scripts/buildVendorMaster.js does the I/O.
//
// THE SAFETY RULE this whole file exists to enforce:
//   A row is linked to a master ONLY if its payment destination
//   (account number + IFSC + account holder) is IDENTICAL to the master's.
//   GSTIN is kept per branch (GST is per state), so it does not block a
//   link and linking never changes a branch's GSTIN. Linking therefore
//   never changes where any branch's money goes. Every row that differs
//   stays a branch-level record, is listed in the report, and is resolved
//   by accounts through "Attach" on the master page, which shows the
//   difference and asks for confirmation.
// ============================================================
const {
  MASTER_OWNED_FIELDS,
  VENDOR_MASTER,
} = require("../../config/constants");

const norm = (v) => (v == null ? "" : String(v).trim());
const up = (v) => norm(v).toUpperCase();
// Holder names differ only in punctuation/spacing across branches
// ("ACME PVT. LTD." vs "Acme Pvt Ltd") — that is the same payee.
const alnum = (v) => up(v).replace(/[^A-Z0-9]/g, "");
const acct = (v) => norm(v).replace(/\s+/g, "");
const idOf = (v) => String(v && v._id ? v._id : v);

// Fields that must match exactly for a row to be linked.
const signatureFields = (owned = MASTER_OWNED_FIELDS) => [
  "accountNumber",
  "ifscCode",
  "accountHolderName",
  ...(owned.includes("gstNumber") ? ["gstNumber"] : []),
];

const signature = (row, owned = MASTER_OWNED_FIELDS) => {
  const parts = [
    acct(row.accountNumber),
    up(row.ifscCode),
    alnum(row.accountHolderName),
  ];
  if (owned.includes("gstNumber")) parts.push(up(row.gstNumber));
  return parts.join("|");
};

const fieldEqual = (f, a, b) => {
  if (f === "accountNumber") return acct(a) === acct(b);
  if (f === "accountHolderName") return alnum(a) === alnum(b);
  if (["ifscCode", "gstNumber", "panNumber", "email"].includes(f))
    return up(a) === up(b);
  return norm(a) === norm(b);
};

const diffFields = (a, b, fields) =>
  fields.filter((f) => !fieldEqual(f, a[f], b[f]));

const requiredDocs = (row) => {
  const byType = VENDOR_MASTER.requiredDocsByType || {};
  const req = [...(byType[row.vendorType] || byType.standard || [])];
  if (norm(row.gstNumber)) req.push("gst");
  return req;
};

const docScore = (row) => {
  const have = new Set((row.documents || []).map((d) => d.type));
  return requiredDocs(row).filter((t) => have.has(t)).length;
};

const time = (d) => (d ? new Date(d).getTime() : 0);

// Golden-record order: most required documents → most recently approved
// → most invoices → oldest record (deterministic tiebreak).
const rankRows = (rows, invoiceCounts = new Map()) =>
  [...rows].sort(
    (a, b) =>
      docScore(b) - docScore(a) ||
      time(b.approvedAt) - time(a.approvedAt) ||
      (invoiceCounts.get(idOf(b)) || 0) - (invoiceCounts.get(idOf(a)) || 0) ||
      time(a.createdAt) - time(b.createdAt) ||
      idOf(a).localeCompare(idOf(b)),
  );

// Would this row make a valid master? Mirrors VendorMaster.js validators so
// a bad legacy value is reported instead of crashing the run.
const masterProblems = (row, owned = MASTER_OWNED_FIELDS) => {
  const p = [];
  const standard = row.vendorType !== "statutory";
  if (!VENDOR_MASTER.PAN_REGEX.test(up(row.panNumber))) p.push("PAN format");
  if (!norm(row.vendorName)) p.push("vendor name missing");
  if (!norm(row.mobile)) p.push("mobile missing");
  if (norm(row.ifscCode) && !VENDOR_MASTER.IFSC_REGEX.test(up(row.ifscCode)))
    p.push("IFSC format");
  // Only matters if GSTIN is copied to branches. Per-branch GSTIN (the
  // default) never blocks a master: a bad seed GSTIN is simply not used
  // as the primary — see buildMasterData in the runner.
  if (
    owned.includes("gstNumber") &&
    norm(row.gstNumber) &&
    !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Z][A-Z\d]$/.test(up(row.gstNumber))
  )
    p.push("GSTIN format");
  if (standard) {
    for (const f of [
      "accountHolderName",
      "bankName",
      "accountNumber",
      "ifscCode",
    ])
      if (!norm(row[f])) p.push(`${f} missing`);
  }
  return p;
};

// Among candidate rows, keep one per branch (a master can link to a branch
// once). Rows are assumed ranked best-first; `preferId` wins its branch.
const onePerBranch = (
  rankedRows,
  preferId,
  alreadyLinkedBranches = new Set(),
) => {
  const link = [];
  const keep = [];
  const taken = new Set(alreadyLinkedBranches);
  const ordered = preferId
    ? [
        ...rankedRows.filter((r) => idOf(r) === preferId),
        ...rankedRows.filter((r) => idOf(r) !== preferId),
      ]
    : rankedRows;
  for (const r of ordered) {
    const b = idOf(r.branch);
    if (taken.has(b)) {
      keep.push({
        row: r,
        reason: alreadyLinkedBranches.has(b)
          ? "BRANCH_ALREADY_LINKED"
          : "SAME_BRANCH_DUPLICATE",
        fields: [],
      });
    } else {
      taken.add(b);
      link.push(r);
    }
  }
  return { link, keep };
};

// For each document type the linked rows hold, pick one file: the golden
// row's copy if it has one, otherwise the most recently uploaded.
const planDocuments = (golden, linkRows) => {
  const byType = new Map();
  for (const d of golden.documents || []) {
    if (d && d.type && !byType.has(d.type))
      byType.set(d.type, { ...d, fromVendor: idOf(golden) });
  }
  const others = linkRows.filter((r) => idOf(r) !== idOf(golden));
  for (const r of others) {
    for (const d of r.documents || []) {
      if (!d || !d.type) continue;
      const cur = byType.get(d.type);
      if (!cur) byType.set(d.type, { ...d, fromVendor: idOf(r) });
      else if (
        cur.fromVendor !== idOf(golden) &&
        time(d.uploadedAt) > time(cur.uploadedAt)
      )
        byType.set(d.type, { ...d, fromVendor: idOf(r) });
    }
  }
  return [...byType.values()];
};

/**
 * Plan one PAN.
 * @param {string} pan normalised PAN
 * @param {object[]} rows branch vendor rows (lean), approved + active + unlinked
 * @param {object} ctx
 *   existingMaster       lean VendorMaster for this PAN, or null
 *   existingLinkedBranches Set of branch ids already linked to that master
 *   invoiceCounts        Map vendorId -> invoice count
 *   goldenOverrideId     vendor id accounts chose as the source of truth
 *   owned                MASTER_OWNED_FIELDS (injectable for tests)
 * @returns {{pan, mode, golden, link, keep, documents, existingMasterId, overwrites}}
 *   mode: "CREATE" | "USE_EXISTING" | "SKIP"
 *   keep: [{ row, reason, fields }]
 *   overwrites: Map vendorId -> fields that linking will overwrite (non-payment)
 */
const planPan = (pan, rows, ctx = {}) => {
  const owned = ctx.owned || MASTER_OWNED_FIELDS;
  const sigFields = signatureFields(owned);
  const counts = ctx.invoiceCounts || new Map();
  const ranked = rankRows(rows, counts);
  const out = {
    pan,
    mode: "SKIP",
    golden: null,
    link: [],
    keep: [],
    documents: [],
    existingMasterId: null,
    overwrites: new Map(),
  };
  const keepAll = (reason, fields = []) => {
    out.keep = ranked.map((row) => ({ row, reason, fields }));
    return out;
  };

  if (!VENDOR_MASTER.PAN_REGEX.test(pan)) return keepAll("INVALID_PAN");

  // ── A master already exists (created in the app, or by an earlier run) ──
  if (ctx.existingMaster) {
    const m = ctx.existingMaster;
    out.existingMasterId = idOf(m);
    if (m.approvalStatus !== "approved" || m.status !== "active") {
      // Linking an approved, working branch vendor to an unusable master
      // would block its invoices (createInvoice checks the master).
      return keepAll("MASTER_NOT_APPROVED_OR_ACTIVE");
    }
    const target = signature(m, owned);
    const match = ranked.filter((r) => signature(r, owned) === target);
    for (const r of ranked.filter((r) => signature(r, owned) !== target)) {
      out.keep.push({
        row: r,
        reason: "PAYMENT_DETAILS_DIFFER",
        fields: diffFields(r, m, sigFields),
      });
    }
    const { link, keep } = onePerBranch(
      match,
      null,
      ctx.existingLinkedBranches || new Set(),
    );
    out.keep.push(...keep);
    out.link = link;
    out.mode = link.length ? "USE_EXISTING" : "SKIP";
    for (const r of link) out.overwrites.set(idOf(r), diffFields(r, m, owned));
    return out;
  }

  // ── New master: choose the golden row ─────────────────────────
  let golden = null;
  let cluster = null;

  if (ctx.goldenOverrideId) {
    golden = ranked.find((r) => idOf(r) === String(ctx.goldenOverrideId));
    if (!golden) return keepAll("GOLDEN_VENDOR_NOT_IN_GROUP");
    const problems = masterProblems(golden, owned);
    if (problems.length) return keepAll("INVALID_DATA", problems);
    cluster = ranked.filter(
      (r) => signature(r, owned) === signature(golden, owned),
    );
  } else {
    // Group rows by payment signature. The largest group wins: the most
    // branches already pay that account. Ties go to the group holding the
    // best-ranked row.
    const groups = new Map();
    for (const r of ranked) {
      const s = signature(r, owned);
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(r);
    }
    const ordered = [...groups.values()].sort(
      (a, b) =>
        b.length - a.length || ranked.indexOf(a[0]) - ranked.indexOf(b[0]),
    );
    // First group that contains a row able to seed a valid master.
    const allProblems = [];
    for (const g of ordered) {
      const ok = g.find((r) => masterProblems(r, owned).length === 0);
      if (ok) {
        golden = ok;
        cluster = g;
        break;
      }
      allProblems.push(...masterProblems(g[0], owned));
    }
    if (!golden) return keepAll("INVALID_DATA", [...new Set(allProblems)]);
  }

  const clusterIds = new Set(cluster.map(idOf));
  for (const r of ranked.filter((r) => !clusterIds.has(idOf(r)))) {
    out.keep.push({
      row: r,
      reason: "PAYMENT_DETAILS_DIFFER",
      fields: diffFields(r, golden, sigFields),
    });
  }
  const { link, keep } = onePerBranch(cluster, idOf(golden));
  out.keep.push(...keep);
  out.link = link;
  out.golden = golden;
  out.mode = "CREATE";
  out.documents = planDocuments(golden, link);
  for (const r of link) {
    if (idOf(r) !== idOf(golden))
      out.overwrites.set(idOf(r), diffFields(r, golden, owned));
  }
  return out;
};

// Group rows by normalised PAN.
const groupByPan = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const pan = up(r.panNumber);
    if (!pan) continue;
    if (!m.has(pan)) m.set(pan, []);
    m.get(pan).push(r);
  }
  return m;
};

module.exports = {
  planPan,
  groupByPan,
  rankRows,
  signature,
  signatureFields,
  masterProblems,
  diffFields,
  planDocuments,
  requiredDocs,
  idOf,
  up,
};
