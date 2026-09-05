// ============================================================
// BACKEND: scripts/createReportIndexes.js — REPLACE WHOLE FILE
// ------------------------------------------------------------
// Works from any directory, and from either backend/scripts/ or
// backend/src/scripts/ — it locates .env itself.
//
// Run once, off-peak:   node scripts/createReportIndexes.js
//
// Creates only indexes; no data is read or written. Every index is
// built in the background so the collections stay writable. Safe to
// re-run — existing indexes are skipped.
//
// Do NOT add these to the Mongoose schemas: on a large collection,
// autoIndex would try to rebuild them on every app boot.
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
    collection: "slatrackings",
    specs: [
      // Report 1 main scan: stage + window, then breach evaluation.
      [{ stage: 1, stageEnteredAt: -1 }, { name: "rpt_stage_entered" }],
      // Live "what is stuck right now" queries.
      [{ status: 1, stage: 1, deadlineAt: 1 }, { name: "rpt_status_deadline" }],
      // Join back to the invoice (this field holds the invoice id).
      [
        { paymentRequest: 1, stageEnteredAt: -1 },
        { name: "rpt_invoice_stage" },
      ],
    ],
  },
  {
    collection: "invoicerequests",
    specs: [
      [{ branch: 1, createdAt: -1 }, { name: "rpt_branch_created" }],
      [{ status: 1, branch: 1, createdAt: -1 }, { name: "rpt_status_branch" }],
      [{ expenseCategory: 1, createdAt: -1 }, { name: "rpt_category_created" }],
      [
        { branch: 1, expenseType: 1, createdAt: -1 },
        { name: "rpt_branch_type_created" },
      ],
      // Rework count in report 1.
      [
        { "rejectionHistory.0": 1 },
        { name: "rpt_has_rejection", sparse: true },
      ],
    ],
  },
  {
    collection: "paymentprocessings",
    specs: [
      [{ branch: 1, createdAt: -1 }, { name: "rpt_branch_created" }],
      [
        { status: 1, branch: 1, createdAt: -1 },
        { name: "rpt_status_branch_created" },
      ],
      [{ invoiceRequest: 1 }, { name: "rpt_invoice_ref" }],
    ],
  },
];

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI is missing from " + envPath);
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected. Building indexes in the background.\n");

  const db = mongoose.connection.db;

  for (const { collection, specs } of INDEXES) {
    for (const [keys, options] of specs) {
      const label = `${collection}.${options.name}`;
      try {
        const started = Date.now();
        await db
          .collection(collection)
          .createIndex(keys, { ...options, background: true });
        console.log(`  created  ${label}  (${Date.now() - started}ms)`);
      } catch (err) {
        console.error(`  FAILED   ${label}  — ${err.message}`);
      }
    }
  }

  console.log("\nDone. Background builds may still be finishing.");
  console.log(
    "Check progress with: db.currentOp({ 'command.createIndexes': { $exists: true } })",
  );

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
