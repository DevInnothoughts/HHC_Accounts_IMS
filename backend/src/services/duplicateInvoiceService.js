// ============================================================
// BACKEND: services/duplicateInvoiceService.js  —  REPLACE WHOLE FILE (Phase 5)
// ------------------------------------------------------------
// Duplicate-invoice detection, now keyed on the REAL vendor rather than the
// branch Vendor row. "Same vendor" = every branch Vendor row that shares the
// Vendor Master or the PAN (so it works before and after the Phase 3
// backfill, and for records the backfill left branch-level).
//
// Same invoice number from the same real vendor:
//   • same branch                         → BLOCK  (exact_duplicate — as before)
//   • another branch, SAME GSTIN          → BLOCK  (cross_branch_duplicate):
//       one tax invoice, raised by two branches, would be paid twice.
//       Previously never checked — every query was scoped to one branch.
//   • another branch, DIFFERENT GSTIN     → WARN   (cross_branch_match):
//       separate state registrations may reuse a number series.
// Also (unchanged in spirit):
//   • same real vendor + same amount, this branch, last 90 days → WARN
//   • same invoice number, a DIFFERENT vendor, this branch      → WARN
//
// Invoice numbers are compared trimmed and case-insensitively
// ("inv-001" and "INV-001 " are the same bill). Rejected invoices never count.
//
// Pre-existing bugs fixed in getDuplicateReport: `mongoose` was never
// imported (ReferenceError on every call), ObjectId was called without
// `new` (throws on Mongoose 8), and `$unwind` used a misspelled option
// (`preserveNullAndEmpty`, rejected by MongoDB).
// ============================================================
const mongoose = require("mongoose");
const InvoiceRequest = require("../models/InvoiceRequest");
const Vendor = require("../models/Vendor");
const Branch = require("../models/Branch");
const { vendorIdentityStages } = require("../utils/vendorIdentity");

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s) => String(s ?? "").trim();
const up = (s) => norm(s).toUpperCase();
const idStr = (v) => String(v && v._id ? v._id : v);
// Only a real PAN identifies a vendor. Placeholders such as "NA", "NIL" or
// "0000000000" would otherwise merge unrelated payees into one "vendor".
const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const realPan = (s) => (PAN_RX.test(up(s)) ? up(s) : "");
const NOT_REJECTED = { $nin: ["Rejected"] };

// Factory so the decision logic can be exercised against in-memory models.
const createDuplicateService = ({ InvoiceRequest, Vendor, Branch, isValidId }) => {
  // Every branch Vendor row that is the same real-world vendor.
  const siblingVendors = async (vendor) => {
    const or = [{ _id: vendor._id }];
    if (vendor.vendorMaster) or.push({ vendorMaster: vendor.vendorMaster });
    const pan = realPan(vendor.panNumber);
    if (pan) or.push({ panNumber: pan });
    return Vendor.find({ $or: or })
      .select("_id branch gstNumber vendorName")
      .lean();
  };

  /**
   * @returns {{ isDuplicate, exactMatch, similarMatches, warning }}
   * warning: null | "exact_duplicate" | "cross_branch_duplicate"
   *        | "similar_found" | "cross_branch_match" | "cross_vendor_match"
   */
  const checkDuplicateInvoice = async (
    branchId,
    vendorId,
    invoiceNumber,
    amount,
    excludeId = null,
  ) => {
    const results = {
      isDuplicate: false,
      exactMatch: null,
      similarMatches: [],
      warning: null,
    };
    const num = norm(invoiceNumber);
    if (!num || !isValidId(vendorId) || !isValidId(branchId)) return results;

    const vendor = await Vendor.findById(vendorId)
      .select("_id branch gstNumber panNumber vendorMaster vendorName")
      .lean();
    const siblings = vendor
      ? await siblingVendors(vendor)
      : [{ _id: vendorId, branch: branchId, gstNumber: "" }];
    const sibIds = siblings.map((s) => s._id);
    const gstOf = new Map(siblings.map((s) => [idStr(s._id), up(s.gstNumber)]));
    const myGst = up(vendor?.gstNumber);
    const exclude = excludeId && isValidId(excludeId) ? { _id: { $ne: excludeId } } : {};
    const numberRx = { $regex: `^\\s*${escapeRegex(num)}\\s*$`, $options: "i" };

    // ── 1. Same invoice number from the same real vendor, any branch ──
    const sameNumber = await InvoiceRequest.find({
      ...exclude,
      vendor: { $in: sibIds },
      invoiceNumber: numberRx,
      status: NOT_REJECTED,
    })
      .populate("vendor", "vendorName")
      .populate("branch", "name")
      .select("requestId invoiceNumber invoiceDate amount netPayable status createdAt vendor branch")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const crossBranchSoft = [];
    for (const m of sameNumber) {
      const sameBranch = idStr(m.branch) === String(branchId);
      // A blank GSTIN on either side proves nothing → warn, never block.
      const sameGstin = myGst !== "" && gstOf.get(idStr(m.vendor)) === myGst;
      if (sameBranch || sameGstin) {
        results.isDuplicate = true;
        results.exactMatch = {
          requestId: m.requestId,
          invoiceNumber: m.invoiceNumber,
          amount: m.netPayable,
          status: m.status,
          createdAt: m.createdAt,
          vendor: m.vendor?.vendorName,
          branch: m.branch?.name,
          crossBranch: !sameBranch,
        };
        results.warning = sameBranch ? "exact_duplicate" : "cross_branch_duplicate";
        return results;
      }
      crossBranchSoft.push(m);
    }

    // ── 2. Same real vendor + same amount, this branch, last 90 days ──
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const branchSibIds = siblings
      .filter((s) => idStr(s.branch) === String(branchId))
      .map((s) => s._id);
    const amt = amount === null || amount === undefined || amount === "" ? NaN : Number(amount);
    if (branchSibIds.length && Number.isFinite(amt)) {
      const similar = await InvoiceRequest.find({
        ...exclude,
        branch: branchId,
        vendor: { $in: branchSibIds },
        netPayable: amt,
        createdAt: { $gte: ninetyDaysAgo },
        status: NOT_REJECTED,
      })
        .select("requestId invoiceNumber amount netPayable status createdAt")
        .limit(5)
        .lean();
      if (similar.length) {
        results.similarMatches = similar.map((m) => ({
          requestId: m.requestId,
          invoiceNumber: m.invoiceNumber,
          amount: m.netPayable,
          status: m.status,
          createdAt: m.createdAt,
        }));
        results.warning = "similar_found";
      }
    }

    // ── 3. Same number, same vendor, another state's GSTIN ──
    for (const m of crossBranchSoft.slice(0, 3)) {
      results.similarMatches.push({
        requestId: m.requestId,
        invoiceNumber: m.invoiceNumber,
        amount: m.netPayable,
        vendor: m.vendor?.vendorName,
        branch: m.branch?.name,
        status: m.status,
        createdAt: m.createdAt,
        note: `Same invoice number from this vendor at ${m.branch?.name || "another branch"}, under a different GSTIN — check it is not the same bill`,
      });
    }
    if (crossBranchSoft.length && !results.warning) results.warning = "cross_branch_match";

    // ── 4. Same number, a DIFFERENT vendor, this branch ──
    const crossVendor = await InvoiceRequest.findOne({
      ...exclude,
      branch: branchId,
      invoiceNumber: numberRx,
      vendor: { $nin: sibIds },
      status: NOT_REJECTED,
    })
      .populate("vendor", "vendorName")
      .select("requestId invoiceNumber vendor status createdAt")
      .lean();
    if (crossVendor) {
      results.similarMatches.push({
        requestId: crossVendor.requestId,
        invoiceNumber: crossVendor.invoiceNumber,
        vendor: crossVendor.vendor?.vendorName,
        status: crossVendor.status,
        createdAt: crossVendor.createdAt,
        note: "Same invoice number used by different vendor",
      });
      if (!results.warning) results.warning = "cross_vendor_match";
    }

    return results;
  };

  /**
   * Invoice numbers used more than once by the same real vendor (under the
   * same GSTIN), across the given branches.
   * @param {string[]|null} branchIds  null = all branches
   */
  const getDuplicateReport = async (branchIds, from, to) => {
    const match = { status: NOT_REJECTED };
    if (branchIds) {
      match.branch = { $in: branchIds.map((b) => new mongoose.Types.ObjectId(String(b))) };
    }
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        match.createdAt.$lte = end;
      }
    }

    const rows = await InvoiceRequest.aggregate([
      { $match: match },
      ...vendorIdentityStages("vendor"),
      {
        $group: {
          _id: {
            vendor: "$vendorKey",
            gst: "$vendorGst",
            invoiceNumber: { $toUpper: { $trim: { input: { $ifNull: ["$invoiceNumber", ""] } } } },
          },
          count: { $sum: 1 },
          vendorName: { $first: "$vendorLabel" },
          branches: { $addToSet: "$branch" },
          requests: {
            $push: {
              requestId: "$requestId",
              status: "$status",
              amount: "$netPayable",
              createdAt: "$createdAt",
              branch: "$branch",
            },
          },
          totalAmount: { $sum: { $ifNull: ["$netPayable", 0] } },
        },
      },
      { $match: { count: { $gt: 1 }, "_id.invoiceNumber": { $ne: "" } } },
      { $sort: { count: -1, totalAmount: -1 } },
      { $limit: 500 },
    ]);

    const names = new Map(
      (await Branch.find().select("name").lean()).map((b) => [String(b._id), b.name]),
    );
    return rows.map((r) => ({
      vendor: r.vendorName,
      gstNumber: r._id.gst || null,
      invoiceNumber: r._id.invoiceNumber,
      count: r.count,
      totalAmount: r.totalAmount,
      crossBranch: r.branches.length > 1,
      branches: r.branches.map((b) => names.get(String(b)) || String(b)),
      requests: r.requests.map((q) => ({ ...q, branch: names.get(String(q.branch)) || q.branch })),
    }));
  };

  return { checkDuplicateInvoice, getDuplicateReport, siblingVendors, realPan };
};

const service = createDuplicateService({
  InvoiceRequest,
  Vendor,
  Branch,
  isValidId: (v) => mongoose.isValidObjectId(v),
});

module.exports = {
  checkDuplicateInvoice: service.checkDuplicateInvoice,
  getDuplicateReport: service.getDuplicateReport,
  createDuplicateService,
};
