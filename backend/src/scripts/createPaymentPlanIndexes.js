// ============================================================
// BACKEND: scripts/createPaymentPlanIndexes.js  —  NEW FILE (Nov 2026)
// ------------------------------------------------------------
//   node src/scripts/createPaymentPlanIndexes.js
//
// Run once when deploying part payments. Creates one PARTIAL index:
//   invoicerequests { branch, paymentPlan.activeStatus }
//     — backs Invoice Processing → Part Payments ("waiting for me").
// Only part-payment invoices enter the index, so no existing document is
// indexed or modified. Writes nothing except the index. Safe to re-run.
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

const INDEX = {
  collection: "invoicerequests",
  keys: { branch: 1, "paymentPlan.activeStatus": 1 },
  options: {
    name: "payment_plan_by_branch_active",
    partialFilterExpression: { "paymentPlan.mode": "partial" },
  },
};

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is missing from " + envPath);
    process.exit(1);
  }
  await mongoose.connect(uri);
  const coll = mongoose.connection.db.collection(INDEX.collection);
  const label = `${INDEX.collection}.${INDEX.options.name}`;

  const existing = await coll.indexes().catch(() => []);
  if (existing.some((i) => i.name === INDEX.options.name)) {
    console.log(`  exists   ${label}`);
  } else {
    const started = Date.now();
    await coll.createIndex(INDEX.keys, INDEX.options);
    console.log(`  created  ${label}  (${Date.now() - started}ms)`);
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
