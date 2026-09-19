// ============================================================
// BACKEND: scripts/syncVendorMasters.js  —  NEW FILE
// ------------------------------------------------------------
// Safety net for the master -> branch copy. Finds every branch vendor
// whose bank / identity fields no longer match its Vendor Master and,
// with --apply, re-copies them. Normally the app keeps them in step on
// every edit; this catches the rare crash between "master saved" and
// "branch rows synced".
//
//   node src/scripts/syncVendorMasters.js            # DRY RUN — report only
//   node src/scripts/syncVendorMasters.js --apply    # fix drift
//   ONLY_MASTER=<id> node src/scripts/syncVendorMasters.js --apply
//
// DRY RUN by default: nothing is written without --apply. Safe to re-run;
// a row that already matches is never touched. Each corrected row gets a
// SYNC_FROM_VENDOR_MASTER audit entry, exactly as an in-app edit would.
// Run it before every payment cycle if you want belt and braces.
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
const VendorMaster = require("../models/VendorMaster");
const Vendor = require("../models/Vendor");
// Registers the Branch model for populate("branch") below. A standalone
// script does not load app.js, so every populated model must be required.
require("../models/Branch");
const svc = require("../services/vendorMasterService");

const APPLY = process.argv.includes("--apply");
const ONLY = process.env.ONLY_MASTER;
const BANK = ["accountNumber", "ifscCode", "accountHolderName", "bankName"];

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI is missing from " + envPath);
    process.exit(1);
  }
  await mongoose.connect(uri);

  const filter = ONLY ? { _id: ONLY } : {};
  const masters = await VendorMaster.find(filter).lean();
  console.log(
    `\n${APPLY ? "APPLY" : "DRY RUN"} — checking ${masters.length} vendor master(s)\n`,
  );

  let driftRows = 0;
  let bankDriftRows = 0;
  let fixed = 0;

  for (const m of masters) {
    const rows = await Vendor.find({
      vendorMaster: m._id,
      sourceOfTruth: "master",
    })
      .populate("branch", "name")
      .lean();

    for (const r of rows) {
      const d = svc.diffFromMaster(r, m);
      if (!d.changed.length) continue;
      driftRows++;
      const bank = d.changed.some((f) => BANK.includes(f));
      if (bank) bankDriftRows++;
      console.log(
        `  ${bank ? "BANK " : "     "} ${String(m.vendorName).padEnd(28).slice(0, 28)} ` +
          `${String(r.branch?.name || r.branch)
            .padEnd(18)
            .slice(0, 18)} ` +
          `differs: ${d.changed.join(", ")}`,
      );
    }

    if (APPLY && rows.length) {
      const res = await svc.syncMasterToBranchVendors(
        m._id,
        null,
        "Reconciled by scripts/syncVendorMasters.js",
      );
      fixed += res.modified;
    }
  }

  console.log(
    `\nRows out of sync : ${driftRows}   (bank details: ${bankDriftRows})`,
  );
  console.log(
    APPLY
      ? `Rows corrected   : ${fixed}`
      : "DRY RUN — nothing written. Re-run with --apply to correct.",
  );

  await mongoose.disconnect();
  process.exit(!APPLY && bankDriftRows ? 2 : 0);
})().catch(async (err) => {
  console.error("\nFailed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
