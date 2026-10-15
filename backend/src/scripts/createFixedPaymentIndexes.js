// ============================================================
// BACKEND: scripts/createFixedPaymentIndexes.js  —  NEW FILE
// ------------------------------------------------------------
//   node src/scripts/createFixedPaymentIndexes.js
//
// Run once when deploying Fixed Payments. Creates:
//  1. invoicerequests { fixedPayment, fixedPeriod }  UNIQUE, PARTIAL —
//     guarantees one invoice per fixed payment per month even if the job
//     and a manual "Generate now" run at the same moment.
//  2. fixedpayments   { status, lastGeneratedPeriod } — nightly job lookup
// Writes nothing except the indexes. Existing invoice documents are not
// indexed (partial filter) and not modified. Safe to re-run.
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
    // One automatically created invoice per fixed payment per month.
    collection: "invoicerequests",
    keys: { fixedPayment: 1, fixedPeriod: 1 },
    options: {
      name: "uniq_fixed_payment_period",
      unique: true,
      // Partial: ordinary invoices never carry fixedPayment, so none of the
      // existing documents enter this index.
      partialFilterExpression: { fixedPayment: { $type: "objectId" } },
    },
    duplicateMatch: { fixedPayment: { $type: "objectId" } },
    duplicateGroup: {
      fixedPayment: "$fixedPayment",
      fixedPeriod: "$fixedPeriod",
    },
  },
  {
    // The daily job's lookup of active templates.
    collection: "fixedpayments",
    keys: { status: 1, lastGeneratedPeriod: 1 },
    options: { name: "fixed_payment_status_period" },
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
      : "\nDone. All fixed payment indexes are in place.",
  );
  await mongoose.disconnect();
  process.exit(skipped ? 2 : 0);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
