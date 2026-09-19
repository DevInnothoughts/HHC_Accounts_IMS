// ============================================================
// BACKEND: scripts/createPhase5Indexes.js  —  NEW FILE (Vendor Master, Phase 5)
// ------------------------------------------------------------
//   node src/scripts/createPhase5Indexes.js
//
// Two plain (non-unique) indexes for cross-branch duplicate-invoice
// detection. Writes nothing but the indexes; safe to re-run (an existing
// index with the same keys and name is a no-op). Optional — the feature works
// without them, only slower on a large invoice collection.
//
//  1. invoicerequests { vendor, createdAt }  — "invoices from these vendor
//     rows" ($in over the sibling rows of one real vendor)
//  2. vendors { panNumber }                  — finding a vendor's sibling rows
//     by PAN in every branch. The existing { branch, panNumber } index
//     cannot serve a PAN lookup without a branch.
//
// { vendorMaster } is already served by uniq_master_branch_link
// (createVendorMasterIndexes.js). Kept out of the Mongoose schemas for the
// same reason as createReportIndexes.js.
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
  console.error("Could not find a .env file.");
  process.exit(1);
}
require("dotenv").config({ path: envPath });
console.log(`Using env: ${envPath}`);

const mongoose = require("mongoose");

const INDEXES = [
  [
    "invoicerequests",
    { vendor: 1, createdAt: -1 },
    { name: "dup_vendor_created" },
  ],
  ["vendors", { panNumber: 1 }, { name: "dup_vendor_pan" }],
];

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI is missing from " + envPath);
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  for (const [collection, keys, options] of INDEXES) {
    const label = `${collection}.${options.name}`;
    try {
      const started = Date.now();
      await db
        .collection(collection)
        .createIndex(keys, { ...options, background: true });
      console.log(`  ok       ${label}  (${Date.now() - started}ms)`);
    } catch (err) {
      console.error(`  FAILED   ${label}  — ${err.message}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
