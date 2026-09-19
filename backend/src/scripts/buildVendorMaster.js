// ============================================================
// BACKEND: scripts/buildVendorMaster.js  —  NEW FILE (Phase 3)
// ------------------------------------------------------------
// Builds the Vendor Master from existing ACTIVE + APPROVED branch vendors
// (requirement 3), one master per PAN, and links the branch vendors to it.
//
// Run from backend/:
//   node src/scripts/buildVendorMaster.js                  # DRY RUN (default)
//   node src/scripts/buildVendorMaster.js --apply          # do it
//
//   ONLY_PAN=ABCDE1234F node src/scripts/buildVendorMaster.js [--apply]
//   ONLY_PAN=ABCDE1234F GOLDEN_VENDOR_ID=<vendorId> ... --apply
//       ↳ accounts has decided which branch record holds the correct bank
//         details for a PAN with conflicting records: that record seeds
//         the master, and only records identical to it are linked.
//
//   ROLLBACK=1 JOURNAL=./vendor-master-journal-<ts>.json node src/scripts/buildVendorMaster.js [--apply]
//
//   Optional: BACKFILL_ACTOR_ID=<userId>  (audit entries credited to this user)
//             OUT_DIR=<folder>            (report + journal; default: current folder)
//
// SAFETY CONTRACT
//  • DRY RUN unless --apply. The dry run writes only the CSV report.
//  • Never deletes a vendor, an invoice, a payment or a file.
//  • Links a branch vendor ONLY when its account number, IFSC and account
//    holder are identical to the master's. Each branch keeps its own GSTIN
//    (GST is per state); the master records all of them in gstins[]. No branch's payment destination changes. Every other record
//    stays exactly as it is and is listed in the report for accounts to
//    resolve with "Attach" on the master page.
//  • Existing documents are COPIED into uploads/vendor-masters/<id>/;
//    originals are untouched (Phase 6 reclaims them).
//  • Re-runnable: already-linked vendors are skipped; a PAN whose master
//    already exists gets its remaining matching vendors linked.
//  • Every change is journalled; ROLLBACK reverses a run exactly, and
//    refuses where the data has moved on (bank details edited since, or
//    new branches linked since).
//
// After --apply:  node src/scripts/createVendorMasterIndexes.js
// Deploy the Phase 4 frontend in the same window as --apply.
// ============================================================
const path = require("path");
const fs = require("fs");

const envPath = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, ".env"),
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
].find((p) => fs.existsSync(p));

if (!envPath) {
  console.error("Could not find a .env file. Looked in:");
  console.error("  " + process.cwd());
  console.error("  " + path.resolve(__dirname, "../"));
  console.error("  " + path.resolve(__dirname, "../../"));
  process.exit(1);
}
require("dotenv").config({ path: envPath });
console.log(`Using env: ${envPath}`);

const mongoose = require("mongoose");
const Vendor = require("../models/Vendor");
const VendorMaster = require("../models/VendorMaster");
const InvoiceRequest = require("../models/InvoiceRequest");
const Branch = require("../models/Branch");
const { logAction } = require("../services/auditService");
const { refreshMasterGstins } = require("../services/vendorMasterService");
const { UPLOAD_BASE, getFileUrl } = require("../services/linodeStorageService");
const { VENDOR_MASTER } = require("../config/constants");
const {
  runBackfill,
  runRollback,
} = require("./lib/vendorMasterBackfillRunner");

const APPLY = process.argv.includes("--apply");
const ONLY_PAN = (process.env.ONLY_PAN || "").trim().toUpperCase() || null;
const GOLDEN = (process.env.GOLDEN_VENDOR_ID || "").trim() || null;
const ACTOR = (process.env.BACKFILL_ACTOR_ID || "").trim() || null;
const OUT_DIR = path.resolve(process.env.OUT_DIR || process.cwd());

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (ONLY_PAN && !VENDOR_MASTER.PAN_REGEX.test(ONLY_PAN))
  fail(`ONLY_PAN is not a valid PAN: ${ONLY_PAN}`);
if (GOLDEN && !ONLY_PAN)
  fail(
    "GOLDEN_VENDOR_ID needs ONLY_PAN — it chooses the source record for one PAN.",
  );
if (GOLDEN && !mongoose.isValidObjectId(GOLDEN))
  fail("GOLDEN_VENDOR_ID is not a valid id");
if (ACTOR && !mongoose.isValidObjectId(ACTOR))
  fail("BACKFILL_ACTOR_ID is not a valid user id");

// ── Data access used by the runner ────────────────────────
const dal = {
  newId: () => new mongoose.Types.ObjectId(),

  loadCandidateRows: ({ onlyPan }) => {
    const filter = {
      approvalStatus: "approved",
      status: "active",
      vendorMaster: null,
      panNumber: { $exists: true, $nin: [null, ""] },
    };
    // onlyPan is regex-validated above, so it is safe inside a pattern.
    if (onlyPan)
      filter.panNumber = { $regex: `^\\s*${onlyPan}\\s*$`, $options: "i" };
    return Vendor.find(filter).lean();
  },

  loadMastersByPans: async (pans) => {
    const list = pans.length
      ? await VendorMaster.find({ panNumber: { $in: pans } }).lean()
      : [];
    return new Map(list.map((m) => [m.panNumber, m]));
  },

  loadLinkedBranches: async (masterIds) => {
    const out = new Map();
    if (!masterIds.length) return out;
    const rows = await Vendor.find({ vendorMaster: { $in: masterIds } })
      .select("branch vendorMaster")
      .lean();
    for (const r of rows) {
      const k = String(r.vendorMaster);
      if (!out.has(k)) out.set(k, new Set());
      out.get(k).add(String(r.branch));
    }
    return out;
  },

  invoiceCounts: async (vendorIds) => {
    const out = new Map();
    if (!vendorIds.length) return out;
    const agg = await InvoiceRequest.aggregate([
      { $match: { vendor: { $in: vendorIds } } },
      { $group: { _id: "$vendor", n: { $sum: 1 } } },
    ]);
    agg.forEach((a) => out.set(String(a._id), a.n));
    return out;
  },

  branchNames: async () => {
    const list = await Branch.find().select("name code").lean();
    return new Map(
      list.map((b) => [
        String(b._id),
        `${b.name}${b.code ? ` (${b.code})` : ""}`,
      ]),
    );
  },

  // The real schema, as a second check behind the plan's own validation.
  validateMaster: async (data) => {
    const err = new VendorMaster(data).validateSync();
    return err ? Object.values(err.errors).map((e) => e.message) : [];
  },

  createMaster: (data) => VendorMaster.create(data),

  // Only links a row that is still unlinked — a concurrent change makes
  // this match nothing, and the runner reports it instead of overwriting.
  linkRow: async (vendorId, set) => {
    const r = await Vendor.updateOne(
      { _id: vendorId, vendorMaster: null },
      { $set: set },
    );
    return r.matchedCount === 1;
  },

  // Called after every batch of links (and after a rollback): refresh the
  // link counter and the master's list of branch GSTINs.
  recount: async (masterId) => {
    const n = await Vendor.countDocuments({ vendorMaster: masterId });
    await VendorMaster.updateOne(
      { _id: masterId },
      { $set: { linkedBranchCount: n } },
    );
    await refreshMasterGstins(masterId);
  },

  findMaster: (id) => VendorMaster.findById(id).lean(),

  rowsOfMaster: async (id) =>
    (await Vendor.find({ vendorMaster: id }).select("_id").lean()).map((r) =>
      String(r._id),
    ),

  restoreRow: async (vendorId, masterId, before) => {
    const r = await Vendor.updateOne(
      { _id: vendorId, vendorMaster: masterId },
      { $set: before },
    );
    return r.matchedCount === 1;
  },

  deleteMaster: (id) =>
    VendorMaster.deleteOne({ _id: id, createdByScript: true }),
};

const audit = (entry) =>
  logAction({ ...entry, userId: entry.userId || undefined });

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGO_URI;
  if (!uri) fail("MONGO_URI is missing from " + envPath);
  await mongoose.connect(uri);

  const deps = { dal, fs, audit, uploadBase: UPLOAD_BASE, getFileUrl };
  let code = 0;
  if (process.env.ROLLBACK === "1") {
    if (!process.env.JOURNAL)
      fail("ROLLBACK needs JOURNAL=<path to vendor-master-journal-*.json>");
    const r = await runRollback(
      {
        journalPath: path.resolve(process.env.JOURNAL),
        apply: APPLY,
        actorId: ACTOR,
      },
      deps,
    );
    if (!APPLY)
      console.log("ROLLBACK DRY RUN — nothing written. Re-run with --apply.");
    code = r.refused.length ? 2 : 0;
  } else {
    const s = await runBackfill(
      {
        apply: APPLY,
        onlyPan: ONLY_PAN,
        goldenOverrideId: GOLDEN,
        actorId: ACTOR,
        outDir: OUT_DIR,
      },
      deps,
    );
    code = s.applied.failures.length ? 2 : 0;
  }

  await mongoose.disconnect();
  process.exit(code);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
