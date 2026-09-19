// ============================================================
// BACKEND: scripts/checkExpenseTypeDrift.js — REPLACE WHOLE FILE
// ------------------------------------------------------------
// Works from any directory, and from either backend/scripts/ or
// backend/src/scripts/ — it locates .env and the models itself.
//
//   node scripts/checkExpenseTypeDrift.js
//
// READ ONLY. Nothing is written. Reports:
//   1. invoices whose expenseType disagrees with their category's type
//   2. invoices pointing at a category that no longer exists
//   3. the Revenue/Capital split computed both ways, so you can see
//      at a glance whether the two disagree
// ============================================================
const path = require("path");
const fs = require("fs");

// ── Locate .env ────────────────────────────────────────────
// dotenv resolves against process.cwd(), which breaks the moment the
// script is run from anywhere other than the folder holding .env.
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

// ── Locate the model ───────────────────────────────────────
const modelPath = [
  path.resolve(__dirname, "../src/models/InvoiceRequest.js"),
  path.resolve(__dirname, "../models/InvoiceRequest.js"),
  path.resolve(__dirname, "../../src/models/InvoiceRequest.js"),
].find((p) => fs.existsSync(p));

if (!modelPath) {
  console.error(
    "Could not find models/InvoiceRequest.js relative to this script.",
  );
  process.exit(1);
}

const mongoose = require("mongoose");

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is missing from " + envPath);
    process.exit(1);
  }

  await mongoose.connect(uri);
  const InvoiceRequest = require(modelPath);

  const [result] = await InvoiceRequest.aggregate([
    {
      $lookup: {
        from: "expensecategories",
        localField: "expenseCategory",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
    {
      $facet: {
        totals: [{ $count: "invoices" }],

        mismatched: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: [{ $type: "$category" }, "missing"] },
                  { $ne: ["$expenseType", "$category.type"] },
                ],
              },
            },
          },
          {
            $group: {
              _id: {
                storedOnInvoice: "$expenseType",
                storedOnCategory: "$category.type",
                categoryName: "$category.name",
                categoryCode: "$category.code",
              },
              count: { $sum: 1 },
              netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
              examples: { $push: "$requestId" },
            },
          },
          { $set: { examples: { $slice: ["$examples", 5] } } },
          { $sort: { count: -1 } },
        ],

        orphaned: [
          { $match: { $expr: { $eq: [{ $type: "$category" }, "missing"] } } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
              examples: { $push: "$requestId" },
            },
          },
          { $set: { examples: { $slice: ["$examples", 10] } } },
        ],

        byCategoryType: [
          {
            $group: {
              _id: { $ifNull: ["$category.type", "UNKNOWN"] },
              count: { $sum: 1 },
              netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
            },
          },
        ],

        byInvoiceType: [
          {
            $group: {
              _id: { $ifNull: ["$expenseType", "UNKNOWN"] },
              count: { $sum: 1 },
              netPayable: { $sum: { $ifNull: ["$netPayable", 0] } },
            },
          },
        ],
      },
    },
  ]);

  const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
  const total = result.totals?.[0]?.invoices || 0;
  const mismatched = result.mismatched || [];
  const orphaned = result.orphaned?.[0];

  console.log(`\nInvoices scanned: ${total}\n`);

  console.log("Revenue / Capital split, computed two different ways");
  console.log("  (if these disagree, the source data is inconsistent)\n");
  console.log("  By the category document (what the report uses):");
  (result.byCategoryType || []).forEach((r) =>
    console.log(
      `    ${String(r._id).padEnd(10)} ${String(r.count).padStart(7)}   ${inr(r.netPayable)}`,
    ),
  );
  console.log("\n  By the copy stored on the invoice:");
  (result.byInvoiceType || []).forEach((r) =>
    console.log(
      `    ${String(r._id).padEnd(10)} ${String(r.count).padStart(7)}   ${inr(r.netPayable)}`,
    ),
  );

  const mismatchTotal = mismatched.reduce((s, m) => s + m.count, 0);
  console.log(`\nType mismatches: ${mismatchTotal}`);
  mismatched.forEach((m) => {
    console.log(
      `    ${m._id.categoryCode} ${m._id.categoryName}: invoice says ${m._id.storedOnInvoice}, category says ${m._id.storedOnCategory}`,
    );
    console.log(
      `      ${m.count} invoices, ${inr(m.netPayable)}   e.g. ${m.examples.join(", ")}`,
    );
  });
  if (mismatchTotal) {
    console.log(
      "\n  Fix the source data before the client reconciles these numbers.",
    );
  }

  console.log(`\nInvoices with a missing category: ${orphaned?.count || 0}`);
  if (orphaned?.count) {
    console.log(
      `    ${inr(orphaned.netPayable)}   e.g. ${orphaned.examples.join(", ")}`,
    );
    console.log(
      "  These fall back to the invoice's own expenseType in the report.",
    );
  }

  console.log("");
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
