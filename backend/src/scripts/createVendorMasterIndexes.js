// ============================================================
// BACKEND: scripts/createVendorMasterIndexes.js  —  NEW FILE
// ------------------------------------------------------------
// Works from any directory, and from either backend/scripts/ or
// backend/src/scripts/ — it locates .env itself.
//
//   node src/scripts/createVendorMasterIndexes.js
//
// Creates two UNIQUE PARTIAL indexes. Reads data only to check that each
// index CAN be built; writes nothing except the indexes. Safe to re-run —
// existing indexes are skipped.
//
//  1. vendormasters { panNumber }             — requirement 5 at DB level
//  2. vendors       { vendorMaster, branch }  — one link per branch
//
// RUN IT TWICE:
//  • Now (Phase 2). Index 1 is built immediately — the collection is new,
//    so there cannot be duplicates. Index 2 is built too if possible.
//  • Again after scripts/buildVendorMaster.js --apply (Phase 3). If legacy
//    data put two same-PAN records in one branch, index 2 is SKIPPED and the
//    offending rows are listed instead of the build failing half-way.
//
// Kept out of the Mongoose schemas for the same reason as
// createReportIndexes.js: autoIndex would retry them on every boot.
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

const INDEXES = [
  {
    collection: "vendormasters",
    keys: { panNumber: 1 },
    options: {
      name: "uniq_master_pan",
      unique: true,
      // Partial: a document without a string PAN is not indexed at all,
      // so the unique rule never fires on missing values.
      partialFilterExpression: { panNumber: { $type: "string" } },
    },
    duplicateMatch: { panNumber: { $type: "string" } },
    duplicateGroup: { panNumber: "$panNumber" },
  },
  {
    collection: "vendors",
    keys: { vendorMaster: 1, branch: 1 },
    options: {
      name: "uniq_master_branch_link",
      unique: true,
      // Partial: the thousands of legacy rows with vendorMaster null or
      // absent are outside the index and never collide with each other.
      partialFilterExpression: { vendorMaster: { $type: "objectId" } },
    },
    duplicateMatch: { vendorMaster: { $type: "objectId" } },
    duplicateGroup: { vendorMaster: "$vendorMaster", branch: "$branch" },
  },
];

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is missing from " + envPath);
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  let skipped = 0;

  for (const idx of INDEXES) {
    const label = `${idx.collection}.${idx.options.name}`;
    const coll = db.collection(idx.collection);

    const existing = await coll.indexes().catch(() => []);
    if (existing.some((i) => i.name === idx.options.name)) {
      console.log(`  exists   ${label}`);
      continue;
    }

    // Would the unique build fail? Find the duplicates first.
    const dups = await coll
      .aggregate([
        { $match: idx.duplicateMatch },
        {
          $group: {
            _id: idx.duplicateGroup,
            count: { $sum: 1 },
            ids: { $push: "$_id" },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $limit: 50 },
      ])
      .toArray();

    if (dups.length) {
      skipped++;
      console.log(`  SKIPPED  ${label} — ${dups.length} duplicate group(s):`);
      dups.forEach((d) =>
        console.log(
          `           ${JSON.stringify(d._id)}  x${d.count}  ids: ${d.ids.join(", ")}`,
        ),
      );
      console.log(
        "           Resolve these (deactivate / detach the extra rows), then re-run.",
      );
      continue;
    }

    try {
      const started = Date.now();
      await coll.createIndex(idx.keys, { ...idx.options, background: true });
      console.log(`  created  ${label}  (${Date.now() - started}ms)`);
    } catch (err) {
      skipped++;
      console.error(`  FAILED   ${label}  — ${err.message}`);
    }
  }

  console.log(
    skipped
      ? `\nDone with ${skipped} index(es) not built — see above.`
      : "\nDone. All vendor master indexes are in place.",
  );
  await mongoose.disconnect();
  process.exit(skipped ? 2 : 0);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
