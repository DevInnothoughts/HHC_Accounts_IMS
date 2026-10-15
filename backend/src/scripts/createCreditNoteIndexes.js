// ============================================================
// BACKEND: scripts/createCreditNoteIndexes.js  —  NEW FILE
// ------------------------------------------------------------
//   node src/scripts/createCreditNoteIndexes.js
//
// Run once when deploying Credit Notes. Two ordinary (non-unique)
// indexes on the new creditnotes collection, for the invoice page and
// the approval queue. Writes nothing else. Safe to re-run.
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
    // Credit notes of one invoice (invoice page, line-availability checks).
    collection: "creditnotes",
    keys: { invoice: 1, status: 1 },
    options: { name: "credit_note_invoice_status" },
    duplicateMatch: null,
  },
  {
    // Approval queue and list page.
    collection: "creditnotes",
    keys: { status: 1, branch: 1, createdAt: -1 },
    options: { name: "credit_note_status_branch" },
    duplicateMatch: null,
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
    if (!idx.duplicateMatch) {
      await coll.createIndex(idx.keys, idx.options);
      console.log(`  created  ${label}`);
      continue;
    }
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
      : "\nDone. All credit note indexes are in place.",
  );
  await mongoose.disconnect();
  process.exit(skipped ? 2 : 0);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
