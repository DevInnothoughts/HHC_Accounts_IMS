const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ✅ __dirname = backend/src/services/
// Resolves to backend/uploads/ regardless of where node is started from
const UPLOAD_BASE = path.join(__dirname, "..", "..", "uploads");

if (!fs.existsSync(UPLOAD_BASE)) {
  fs.mkdirSync(UPLOAD_BASE, { recursive: true });
}

console.log("[LocalStorage] Upload base:", UPLOAD_BASE);

const getFileUrl = (key) => {
  const base = (process.env.BASE_URL || "http://localhost:5000").replace(
    /\/$/,
    "",
  );
  return `${base}/files/${key}`;
};

const uploadFile = async (buffer, originalName, mimeType, folder = "misc") => {
  const safeFolder = folder
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9_/-]/g, "");
  const ext = path.extname(originalName).toLowerCase();
  const uniqueId = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now();
  const fileName = `${timestamp}-${uniqueId}${ext}`;
  const key = `${safeFolder}/${fileName}`;
  const absDir = path.join(UPLOAD_BASE, safeFolder);
  const absPath = path.join(UPLOAD_BASE, key);

  if (!fs.existsSync(absDir)) {
    fs.mkdirSync(absDir, { recursive: true });
  }

  fs.writeFileSync(absPath, buffer);
  console.log("[LocalStorage] Saved:", absPath);

  return { key, url: getFileUrl(key), fileName: originalName };
};

const deleteFile = async (key) => {
  if (!key) return;
  const absPath = path.join(UPLOAD_BASE, key);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
    console.log("[LocalStorage] Deleted:", absPath);
  } else {
    console.warn("[LocalStorage] File not found for deletion:", absPath);
  }
};

const fileExists = (key) => key && fs.existsSync(path.join(UPLOAD_BASE, key));

const validateFile = (file, options = {}) => {
  const {
    maxSizeMB = 3,
    allowedTypes = ["image/jpeg", "image/png", "image/jpg", "application/pdf"],
  } = options;
  const errors = [];
  if (!file) {
    errors.push("No file provided");
    return errors;
  }
  if (file.size / (1024 * 1024) > maxSizeMB)
    errors.push(`File exceeds ${maxSizeMB}MB limit`);
  if (!allowedTypes.includes(file.mimetype))
    errors.push("Invalid file type. Allowed: PDF, JPG, PNG");
  return errors;
};

module.exports = {
  uploadFile,
  deleteFile,
  fileExists,
  getFileUrl,
  validateFile,
  UPLOAD_BASE,
};
