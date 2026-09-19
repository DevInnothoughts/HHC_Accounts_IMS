// ============================================================
// BACKEND: scripts/backupDb.js  —  NEW FILE
// ------------------------------------------------------------
// Full backup of the HHC Accounts IMS database (every collection), plus
// optionally the uploaded files. Reads only — never changes the database.
//
// Run from backend/:
//   node src/scripts/backupDb.js                   # database only
//   node src/scripts/backupDb.js --uploads         # database + copy of uploads/
//
//   Optional: OUT_DIR=<folder>          default: backend/backups
//             ONLY=vendors,vendormasters  just these collections
//
// Writes backups/hhc-db-<timestamp>/ with one compressed file per
// collection, its index definitions, and manifest.json (counts + SHA-256
// checksums). Each file is read back and counted before the run reports OK.
// Restore with scripts/restoreDb.js.
//
// ⚠ The backup holds everything, including users' password hashes and
//   vendor bank details. Keep it private; backups/ is not for git.
// ⚠ Run when the app is quiet (or stop the backend): collections are copied
//   one after another, so writes made during the run may be half-included.
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
const { runBackup } = require("./lib/dbBackup");

const OUT_DIR = path.resolve(
  process.env.OUT_DIR || path.join(__dirname, "..", "..", "backups"),
);
const ONLY = listArg(process.env.ONLY);
// Same folder the app serves files from (services/linodeStorageService.js).
const UPLOADS = path.resolve(__dirname, "..", "..", "uploads");

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) fail("MONGO_URI is missing from " + envPath);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const { dir } = await runBackup(
    {
      outDir: OUT_DIR,
      only: ONLY,
      uploadsDir: process.argv.includes("--uploads") ? UPLOADS : null,
    },
    { db, EJSON: loadEJSON(), fs },
  );
  console.log(`\nBackup saved in: ${dir}`);
  console.log(
    "Copy this folder off the server (PC / Google Drive) to keep it safe.",
  );

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error("\nBackup FAILED:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
