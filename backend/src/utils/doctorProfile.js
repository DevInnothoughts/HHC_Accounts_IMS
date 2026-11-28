// ============================================================
// BACKEND: src/utils/doctorProfile.js — NEW FILE
// ------------------------------------------------------------
// "Is this doctor's profile complete?" — one definition, used by the
// Doctor Master (tag + filter) and, if switched on in the config, by the
// raise-payment check.
//   complete = valid bank details + one live document of each required type
// ============================================================
const cfg = require("../config/doctorPayoutConfig");

const liveDocuments = (doctor) =>
  (doctor?.documents || []).filter((d) => !d.removedAt);

const hasBankDetails = (doctor) =>
  cfg.ACCOUNT_REGEX.test(doctor?.accountNumber || "") &&
  cfg.IFSC_REGEX.test(doctor?.ifscCode || "") &&
  Boolean(doctor?.bankName) &&
  Boolean(doctor?.accountHolderName);

// → { complete, missing: ["Bank details", "PAN card", …] }
const profileOf = (doctor) => {
  const missing = [];
  if (!hasBankDetails(doctor)) missing.push("Bank details");
  const docs = liveDocuments(doctor);
  cfg.REQUIRED_DOCUMENT_TYPES.forEach((type) => {
    if (!docs.some((d) => d.type === type))
      missing.push(cfg.DOCUMENT_TYPES[type] || type);
  });
  return { complete: missing.length === 0, missing };
};

// Mongo filter matching doctors whose profile is NOT complete.
const incompleteFilter = () => ({
  $or: [
    { accountNumber: { $in: [null, ""] } },
    { ifscCode: { $in: [null, ""] } },
    ...cfg.REQUIRED_DOCUMENT_TYPES.map((type) => ({
      documents: {
        $not: { $elemMatch: { type, removedAt: { $exists: false } } },
      },
    })),
  ],
});

module.exports = { profileOf, hasBankDetails, liveDocuments, incompleteFilter };
