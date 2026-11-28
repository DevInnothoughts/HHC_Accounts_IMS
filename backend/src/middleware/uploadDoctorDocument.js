// ============================================================
// BACKEND: src/middleware/uploadDoctorDocument.js — NEW FILE
// ------------------------------------------------------------
// One PDF / JPG / PNG, held in memory, for a doctor's profile. Size and
// "is it really a PDF / image" are checked again where it is saved
// (privateStorageService). Answers with a clear 400 instead of letting a
// multer error fall through to the generic 500 handler.
// ============================================================
const multer = require("multer");
const { MAX_DOCUMENT_MB } = require("../config/doctorPayoutConfig");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_MB * 1024 * 1024, files: 1 },
});

module.exports =
  (field = "file") =>
  (req, res, next) =>
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE")
        return res
          .status(400)
          .json({ message: `The file is larger than ${MAX_DOCUMENT_MB} MB` });
      return res.status(400).json({ message: err.message || "Upload failed" });
    });
