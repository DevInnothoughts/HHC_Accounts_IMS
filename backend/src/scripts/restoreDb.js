// ============================================================
// BACKEND: scripts/restoreDb.js  —  REPLACE WHOLE FILE
// ------------------------------------------------------------
// Restores a backup made by scripts/backupDb.js — into the database in
// .env, or into ANY other MongoDB (another cluster / Atlas project) via
// TARGET_URI. The .env file itself is never changed.
//
// Run from backend/:
//
//   Into another cluster (TARGET_URI):
//     TARGET_URI="mongodb+srv://user:pass@other.xxxxx.mongodb.net/hhc_pms" \
//     BACKUP=backups/hhc-db-<ts> node src/scripts/restoreDb.js            # dry run
//     ... same ... node src/scripts/restoreDb.js --apply
//
//   Into another database on the .env cluster:
//     BACKUP=backups/hhc-db-<ts> TARGET_DB=hhc_staging node src/scripts/restoreDb.js [--apply]
//
//   Target database name, in order of preference:
//     1. TARGET_DB=<name>
//     2. the name inside TARGET_URI (…mongodb.net/<name>?…)
//     3. with TARGET_URI only: the name the backup was taken from
//
//   Optional: ONLY=vendors,vendormasters   just these collections
//
// SAFETY
//  • DRY RUN unless --apply. Every file's checksum is verified first, and
//    the dry run prints the target cluster and database.
//  • A target collection that already has documents is SKIPPED. --drop
//    replaces it — this DELETES the current data in that collection.
//  • If the target is the LIVE database (same cluster AND same database as
//    MONGO_URI in .env), --apply also needs CONFIRM_LIVE=<database name>.
//  • Uploaded files are not restored automatically; copy the backup's
//    uploads/ folder to the target server by hand if needed.
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

// Extended JSON from the MongoDB driver that Mongoose already installs.
const loadEJSON = () => {
  try {
    if (mongoose.mongo && mongoose.mongo.BSON && mongoose.mongo.BSON.EJSON)
      return mongoose.mongo.BSON.EJSON;
  } catch {
    /* fall through */
  }
  return require("bson").EJSON;
};

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const listArg = (v) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
const { runRestore } = require("./lib/dbBackup");

// Host list and database name of a MongoDB connection string, without
// connecting. db is null when the string names no database.
const uriInfo = (uri) => {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i.exec(
    String(uri || "").trim(),
  );
  if (!m) return null;
  let db = null;
  try {
    db = decodeURIComponent(m[2] || "") || null;
  } catch {
    db = m[2] || null;
  }
  return { hosts: m[1].toLowerCase().split(",").sort().join(","), db };
};
// Connection string with the user name and password hidden, for printing.
const mask = (uri) => String(uri).replace(/\/\/[^@/]*@/, "//***:***@");
const DB_NAME_RX = /^[A-Za-z0-9_-]{1,63}$/;

const APPLY = process.argv.includes("--apply");
const DROP = process.argv.includes("--drop");
const BACKUP = process.env.BACKUP ? path.resolve(process.env.BACKUP) : null;
const TARGET_URI = (process.env.TARGET_URI || "").trim();
const ENV_URI = (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
const ONLY = listArg(process.env.ONLY);

if (!BACKUP) fail("BACKUP=<backup folder> is required");
const manifestPath = path.join(BACKUP, "manifest.json");
if (!fs.existsSync(manifestPath))
  fail(`No manifest.json in ${BACKUP} — is this a backupDb.js folder?`);
const backupDbName = JSON.parse(fs.readFileSync(manifestPath, "utf8")).database;

const targetUri = TARGET_URI || ENV_URI;
if (!targetUri)
  fail("No connection string: set TARGET_URI, or MONGO_URI in " + envPath);
const target = uriInfo(targetUri);
if (!target)
  fail(
    "TARGET_URI is not a valid mongodb:// or mongodb+srv:// connection string",
  );

// Without TARGET_URI the name must be given explicitly — never fall back to
// the live database name in .env.
const TARGET_DB =
  (process.env.TARGET_DB || "").trim() ||
  (TARGET_URI ? target.db || backupDbName : "");
if (!TARGET_DB)
  fail(
    "TARGET_DB=<database name> is required when restoring into the .env cluster (e.g. hhc_staging)",
  );
if (!DB_NAME_RX.test(TARGET_DB))
  fail("The target database name may use only letters, digits, _ and -");

// "Live" = the database the app itself uses: same cluster AND same db as .env.
const live = uriInfo(ENV_URI);
const isLive =
  Boolean(live) &&
  live.hosts === target.hosts &&
  (live.db || "test") === TARGET_DB;

(async () => {
  console.log(
    `Backup     : ${BACKUP}  (taken from database "${backupDbName}")`,
  );
  console.log(`Target     : ${mask(targetUri)}`);
  console.log(
    `Target db  : ${TARGET_DB}${isLive ? "   ⚠ this is the LIVE database from .env" : ""}`,
  );

  if (isLive && APPLY && process.env.CONFIRM_LIVE !== TARGET_DB) {
    fail(
      `The target is the LIVE database "${TARGET_DB}". To restore into it, add CONFIRM_LIVE=${TARGET_DB} (take a fresh backup first).`,
    );
  }
  if (DROP)
    console.log(
      "⚠ --drop: target collections that already hold data will be REPLACED.",
    );

  await mongoose.connect(targetUri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.useDb(TARGET_DB, { useCache: false }).db;
  const r = await runRestore(
    { backupDir: BACKUP, apply: APPLY, drop: DROP, only: ONLY },
    { db, EJSON: loadEJSON(), fs },
  );
  if (r.skipped.length)
    console.log(`\n${r.skipped.length} collection(s) skipped — see above.`);
  if (APPLY && TARGET_URI) {
    console.log(
      `\nTo run the app on this data, set MONGO_URI in .env to the target cluster with /${TARGET_DB} as the database.`,
    );
  }

  await mongoose.disconnect();
  process.exit(r.skipped.length ? 2 : 0);
})().catch(async (err) => {
  const hint = /bad auth|authentication failed/i.test(err.message)
    ? "\n  → check the user name / password in TARGET_URI (Atlas → Database Access)"
    : /ENOTFOUND|querySrv|timed out|Server selection/i.test(err.message)
      ? "\n  → check the host name, and that your IP is allowed (Atlas → Network Access)"
      : "";
  console.error("\nRestore FAILED:", err.message + hint);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
