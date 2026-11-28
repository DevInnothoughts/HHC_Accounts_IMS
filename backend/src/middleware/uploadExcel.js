// ============================================================
// BACKEND: src/middleware/uploadExcel.js — NEW FILE
// ------------------------------------------------------------
// Upload of ONE .xlsx workbook, held in memory (it is parsed and thrown
// away — never written to uploads/, which is served without a login).
//
// The shared middleware/upload.js only accepts PDFs and images, and lets
// multer errors fall through to the generic 500 handler. This one answers
// with a clear 400 instead ("file too large", "not an .xlsx").
// ============================================================
const multer = require("multer");
const path = require("path");
const { MAX_FILE_MB } = require("../config/doctorPayoutConfig");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // Browsers report several MIME types for .xlsx (or none at all on a
    // machine without Excel), so the extension decides here and the
    // controller then checks the file really is a workbook.
    if (path.extname(file.originalname || "").toLowerCase() === ".xlsx")
      return cb(null, true);
    const err = new Error(
      "Only .xlsx files can be uploaded. Open the file in Excel and use Save As → Excel Workbook (.xlsx).",
    );
    err.status = 400;
    cb(err);
  },
});

// uploadExcel("file") → middleware
module.exports =
  (field = "file") =>
  (req, res, next) =>
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE")
        return res
          .status(400)
          .json({ message: `The file is larger than ${MAX_FILE_MB} MB` });
      return res
        .status(err.status || 400)
        .json({ message: err.message || "Upload failed" });
    });
