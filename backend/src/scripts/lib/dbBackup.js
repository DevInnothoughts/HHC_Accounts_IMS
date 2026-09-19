// ============================================================
// BACKEND: src/scripts/lib/dbBackup.js  —  NEW FILE
// ------------------------------------------------------------
// Backup / restore logic used by scripts/backupDb.js and scripts/restoreDb.js.
// Takes a native MongoDB `db` handle and an EJSON implementation as inputs
// (no Mongoose import), so it can be tested against an in-memory fake.
//
// Backup folder layout:
//   hhc-db-<timestamp>/
//     manifest.json                 database, time, per-collection counts,
//                                   file sizes and SHA-256 checksums
//     <collection>.ejson.gz         one document per line, Extended JSON
//                                   (canonical: ObjectIds, dates and decimals
//                                   round-trip exactly)
//     <collection>.indexes.json     index definitions
//     uploads/                      (with --uploads) copy of backend/uploads
// ============================================================
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const readline = require("readline");
const { once } = require("events");

const FORMAT = "hhc-ejson-v1";
const BATCH = 1000;

const sha256File = (fs, file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });

// Reads a .ejson.gz file line by line.
async function* readLines(fs, file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line.trim()) yield line;
}

// Collection names are used as file names — refuse anything odd.
const safeName = (n) => /^[A-Za-z0-9_.-]+$/.test(n) && !n.startsWith(".");

const copyDir = (fs, from, to) => {
  let files = 0;
  let bytes = 0;
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) walk(s, d);
      else if (e.isFile()) {
        fs.copyFileSync(s, d);
        files++;
        bytes += fs.statSync(s).size;
      }
    }
  };
  walk(from, to);
  return { files, bytes };
};

const MB = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;

// ════════════════════════════════════════════════════════════
// BACKUP
// ════════════════════════════════════════════════════════════
async function runBackup(opts, deps) {
  const { outDir, only = null, uploadsDir = null, now = new Date() } = opts;
  const { db, EJSON, fs, log = console.log } = deps;

  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(outDir, `hhc-db-${stamp}`);
  if (fs.existsSync(dir)) throw new Error(`Refusing to overwrite ${dir}`);
  fs.mkdirSync(dir, { recursive: true });

  let names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .filter((c) => (c.type || "collection") === "collection")
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    .sort();
  if (only) {
    const missing = only.filter((n) => !names.includes(n));
    if (missing.length) throw new Error(`Not in the database: ${missing.join(", ")}`);
    names = names.filter((n) => only.includes(n));
  }

  const manifest = {
    format: FORMAT,
    database: db.databaseName,
    createdAt: now.toISOString(),
    finishedAt: null,
    collections: [],
    uploads: null,
  };
  log(`Backing up database "${db.databaseName}" → ${dir}`);

  for (const name of names) {
    if (!safeName(name)) {
      log(`  SKIPPED  ${name} (name not usable as a file name)`);
      continue;
    }
    const coll = db.collection(name);
    const file = path.join(dir, `${name}.ejson.gz`);
    const out = fs.createWriteStream(file);
    const gz = zlib.createGzip();
    gz.pipe(out);
    let count = 0;
    const cursor = coll.find({}, { batchSize: BATCH });
    for await (const doc of cursor) {
      const line = EJSON.stringify(doc, { relaxed: false }) + "\n";
      if (!gz.write(line)) await once(gz, "drain");
      count++;
    }
    gz.end();
    await once(out, "finish");

    const indexes = (await coll.listIndexes().toArray()).map(({ v, ns, ...rest }) => rest);
    fs.writeFileSync(path.join(dir, `${name}.indexes.json`), JSON.stringify(indexes, null, 2));

    // Verify: read the file back and count the documents in it.
    let reread = 0;
    for await (const _ of readLines(fs, file)) reread++; // eslint-disable-line no-unused-vars
    if (reread !== count) throw new Error(`${name}: wrote ${count} documents but the file holds ${reread}`);

    const bytes = fs.statSync(file).size;
    manifest.collections.push({
      name,
      count,
      file: path.basename(file),
      bytes,
      sha256: await sha256File(fs, file),
      indexes: indexes.length,
    });
    log(`  ${name.padEnd(28)} ${String(count).padStart(8)} docs   ${MB(bytes)}`);
  }

  if (uploadsDir) {
    if (fs.existsSync(uploadsDir)) {
      const r = copyDir(fs, uploadsDir, path.join(dir, "uploads"));
      manifest.uploads = { source: uploadsDir, ...r };
      log(`  uploads/ copied: ${r.files} file(s), ${MB(r.bytes)}`);
    } else {
      log(`  uploads/ not found at ${uploadsDir} — not copied`);
    }
  }

  manifest.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const total = manifest.collections.reduce((s, c) => s + c.count, 0);
  log(`Done: ${manifest.collections.length} collection(s), ${total} documents.`);
  return { dir, manifest };
}

// ════════════════════════════════════════════════════════════
// RESTORE
// ════════════════════════════════════════════════════════════
/**
 * Restores a backup folder into `db` (the TARGET database).
 * Default is a dry run. A collection that already holds documents is
 * skipped unless `drop` is set.
 */
async function runRestore(opts, deps) {
  const { backupDir, apply = false, drop = false, only = null } = opts;
  const { db, EJSON, fs, log = console.log } = deps;

  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json in ${backupDir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.format !== FORMAT) throw new Error("Not a backup made by backupDb.js");
  if (!manifest.finishedAt) throw new Error("This backup did not finish — do not restore it");

  let list = manifest.collections;
  if (only) {
    const missing = only.filter((n) => !list.some((c) => c.name === n));
    if (missing.length) throw new Error(`Not in this backup: ${missing.join(", ")}`);
    list = list.filter((c) => only.includes(c.name));
  }

  log(`${apply ? "RESTORE" : "RESTORE DRY RUN"}  backup of "${manifest.database}" (${manifest.createdAt})  →  database "${db.databaseName}"`);

  // Check every file BEFORE touching the database.
  for (const c of list) {
    if (!safeName(c.name) || c.file !== `${c.name}.ejson.gz`) throw new Error(`Bad manifest entry: ${c.name}`);
    const file = path.join(backupDir, c.file);
    if (!fs.existsSync(file)) throw new Error(`Missing file ${c.file}`);
    if ((await sha256File(fs, file)) !== c.sha256) throw new Error(`${c.file} is damaged (checksum mismatch)`);
  }
  log(`Checksums OK for ${list.length} file(s).`);

  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  const result = { restored: [], skipped: [] };

  for (const c of list) {
    const coll = db.collection(c.name);
    const current = existing.has(c.name) ? await coll.countDocuments({}) : 0;
    if (current > 0 && !drop) {
      result.skipped.push({ name: c.name, why: `target already has ${current} document(s) — use --drop to replace` });
      log(`  SKIP     ${c.name.padEnd(28)} target has ${current} document(s)`);
      continue;
    }
    if (!apply) {
      log(`  would ${current > 0 ? "REPLACE" : "restore"} ${c.name.padEnd(22)} ${c.count} docs${current > 0 ? ` (target has ${current})` : ""}`);
      continue;
    }
    if (current > 0 && drop) await coll.drop();

    let batch = [];
    let inserted = 0;
    const flush = async () => {
      if (!batch.length) return;
      await coll.insertMany(batch, { ordered: false });
      inserted += batch.length;
      batch = [];
    };
    for await (const line of readLines(fs, path.join(backupDir, c.file))) {
      batch.push(EJSON.parse(line, { relaxed: false }));
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    const idxFile = path.join(backupDir, `${c.name}.indexes.json`);
    const indexes = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, "utf8")) : [];
    let idxErrors = 0;
    for (const { key, name, ...options } of indexes) {
      if (name === "_id_") continue;
      try {
        await coll.createIndex(key, { name, ...options });
      } catch (e) {
        idxErrors++;
        log(`    index ${name}: ${e.message}`);
      }
    }
    const after = await coll.countDocuments({});
    if (after !== c.count) throw new Error(`${c.name}: expected ${c.count} documents after restore, found ${after}`);
    result.restored.push({ name: c.name, count: inserted, idxErrors });
    log(`  restored ${c.name.padEnd(28)} ${String(inserted).padStart(8)} docs`);
  }

  if (manifest.uploads) log(`Note: this backup also holds uploads/ (${manifest.uploads.files} files). Copy it back by hand if needed.`);
  if (!apply) log("DRY RUN — nothing written. Re-run with --apply.");
  return result;
}

module.exports = { runBackup, runRestore, FORMAT };
