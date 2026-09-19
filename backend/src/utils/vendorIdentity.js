// ============================================================
// BACKEND: src/utils/vendorIdentity.js  —  NEW FILE (Phase 5)
// ------------------------------------------------------------
// One real-world vendor can appear as several branch Vendor rows (one per
// branch, plus any pre-master duplicates). Reports that count or rank
// "vendors" must count the REAL vendor once. These aggregation stages give
// every invoice a stable identity:
//
//   vendorKey   = the PAN, trimmed + upper-cased   (only a well-formed PAN —
//                 AAAAA9999A; placeholders like "NA" must not merge payees)
//               → else the Vendor Master id        (defensive; masters have PANs)
//               → else the branch Vendor _id       (no-PAN payees)
//
// PAN first, not the master id: linked rows carry the master's PAN, so the
// two agree — and a record the backfill left branch-level (e.g. a bank
// conflict) still groups with its master instead of showing as a second
// vendor. It also makes the reports correct BEFORE the backfill runs.
//
// Also adds vendorLabel / vendorCompany / vendorCategory / vendorGst so the
// callers need no second $lookup. Uses only operators available on
// MongoDB 4.2+ ($arrayElemAt rather than $first, $regexMatch, plain $lookup).
// ============================================================

/**
 * @param {string} localField  path holding the branch Vendor _id ("vendor",
 *                             "invoice.vendor", …)
 * @returns {object[]} pipeline stages
 */
const vendorIdentityStages = (localField = "vendor") => [
  {
    $lookup: {
      from: "vendors",
      localField,
      foreignField: "_id",
      as: "_vendorDoc",
    },
  },
  { $set: { _vd: { $arrayElemAt: ["$_vendorDoc", 0] } } },
  {
    $set: {
      _pan: {
        $toUpper: {
          $trim: {
            input: {
              $cond: [{ $eq: [{ $type: "$_vd.panNumber" }, "string"] }, "$_vd.panNumber", ""],
            },
          },
        },
      },
    },
  },
  {
    $set: {
      vendorKey: {
        $cond: [
          { $regexMatch: { input: "$_pan", regex: "^[A-Z]{5}[0-9]{4}[A-Z]$" } },
          "$_pan",
          { $ifNull: ["$_vd.vendorMaster", `$${localField}`] },
        ],
      },
      vendorLabel: { $ifNull: ["$_vd.vendorName", "Unknown"] },
      vendorCompany: "$_vd.companyName",
      vendorCategory: "$_vd.vendorCategory",
      // The branch's own GSTIN (GST is registered per state). Two branches
      // of the same vendor can legitimately reuse an invoice number under
      // DIFFERENT GSTINs, so duplicate checks key on it too.
      vendorGst: { $toUpper: { $ifNull: ["$_vd.gstNumber", ""] } },
    },
  },
  { $unset: ["_vendorDoc", "_vd", "_pan"] },
];

module.exports = { vendorIdentityStages };
