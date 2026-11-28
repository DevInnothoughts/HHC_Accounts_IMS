// ============================================================
// BACKEND: src/services/privateStorageService.js — NEW FILE
// ------------------------------------------------------------
// File store for documents that must NOT be reachable by URL.
//
// Everything under uploads/ is served by express.static at /files with
// no login (app.js), so anyone holding a link can open the file. Doctor
// PAN cards and cancelled cheques are kept here instead: a separate
// folder that no static route points at. The only way out is an API
// handler that has already checked the caller's login and role and then
// streams the file (doctorController.viewDocument).
//
// Folder: backend/private_uploads/  (override with PRIVATE_UPLOAD_DIR).
// Keep it out of git (.gitignore) and include it in server backups.
// ============================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE = path.resolve(
  process.env.PRIVATE_UPLOAD_DIR ||
    path.join(__dirname, "..", "..", "private_uploads"),
);

// What the file really is, from its first bytes — never from its name or
// the type the browser claimed.
const sniff = (buffer) => {
  if (!buffer || buffer.length < 8) return null;
  if (buffer.slice(0, 4).toString("latin1") === "%PDF")
    return { ext: ".pdf", mime: "application/pdf" };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { ext: ".jpg", mime: "image/jpeg" };
  if (buffer[0] === 0x89 && buffer.slice(1, 4).toString("latin1") === "PNG")
    return { ext: ".png", mime: "image/png" };
  return null;
};

// key → absolute path, refusing anything that would leave BASE.
const resolveKey = (key) => {
  const abs = path.resolve(BASE, String(key || ""));
  if (abs !== BASE && !abs.startsWith(BASE + path.sep)) return null;
  return abs;
};

// Saves a PDF / JPG / PNG. Returns { key, mime, size } or throws with a
// message fit to show the user.
const savePrivateFile = async (buffer, folder) => {
  const kind = sniff(buffer);
  if (!kind) {
    const e = new Error("Only PDF, JPG or PNG files can be uploaded");
    e.status = 400;
    throw e;
  }
  const safeFolder = String(folder || "misc").replace(/[^a-zA-Z0-9_/-]/g, "");
  const name = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${kind.ext}`;
  const key = `${safeFolder}/${name}`;
  const abs = resolveKey(key);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buffer, { mode: 0o600 });
  return { key, mime: kind.mime, size: buffer.length };
};

// → a read stream, or null when the file is not there.
const openPrivateFile = (key) => {
  const abs = resolveKey(key);
  if (!abs || !fs.existsSync(abs)) return null;
  return fs.createReadStream(abs);
};

module.exports = {
  savePrivateFile,
  openPrivateFile,
  sniff,
  PRIVATE_BASE: BASE,
};
