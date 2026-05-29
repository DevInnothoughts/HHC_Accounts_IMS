// ============================================================
// BACKEND: services/duplicateInvoiceService.js
// ============================================================
const InvoiceRequest = require("../models/InvoiceRequest");

/**
 * Check for duplicate invoices
 * Checks: exact invoice number, same vendor+amount combination
 * Returns: { isDuplicate, exactMatch, similarMatches, warning }
 */
const checkDuplicateInvoice = async (
  branchId,
  vendorId,
  invoiceNumber,
  amount,
  excludeId = null,
) => {
  const baseQuery = { branch: branchId };
  if (excludeId) baseQuery._id = { $ne: excludeId };

  const results = {
    isDuplicate: false,
    exactMatch: null,
    similarMatches: [],
    warning: null,
  };

  // 1. Exact invoice number match for same vendor
  const exactMatch = await InvoiceRequest.findOne({
    ...baseQuery,
    vendor: vendorId,
    invoiceNumber: invoiceNumber.trim(),
    status: { $nin: ["Rejected"] },
  })
    .populate("vendor", "vendorName companyName")
    .populate("branch", "name")
    .select(
      "requestId invoiceNumber invoiceDate amount netPayable status createdAt",
    );

  if (exactMatch) {
    results.isDuplicate = true;
    results.exactMatch = {
      requestId: exactMatch.requestId,
      invoiceNumber: exactMatch.invoiceNumber,
      amount: exactMatch.netPayable,
      status: exactMatch.status,
      createdAt: exactMatch.createdAt,
      vendor: exactMatch.vendor?.vendorName,
    };
    results.warning = "exact_duplicate";
    return results;
  }

  // 2. Same vendor + same amount within last 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const similarMatches = await InvoiceRequest.find({
    ...baseQuery,
    vendor: vendorId,
    netPayable: amount,
    createdAt: { $gte: ninetyDaysAgo },
    status: { $nin: ["Rejected"] },
  })
    .populate("vendor", "vendorName")
    .select("requestId invoiceNumber amount netPayable status createdAt")
    .limit(5);

  if (similarMatches.length > 0) {
    results.similarMatches = similarMatches.map((m) => ({
      requestId: m.requestId,
      invoiceNumber: m.invoiceNumber,
      amount: m.netPayable,
      status: m.status,
      createdAt: m.createdAt,
    }));
    results.warning = "similar_found";
  }

  // 3. Same invoice number across different vendors (global cross-vendor check)
  const crossVendorMatch = await InvoiceRequest.findOne({
    ...baseQuery,
    invoiceNumber: invoiceNumber.trim(),
    vendor: { $ne: vendorId },
    status: { $nin: ["Rejected"] },
  })
    .populate("vendor", "vendorName")
    .select("requestId invoiceNumber vendor status createdAt");

  if (crossVendorMatch) {
    results.similarMatches.push({
      requestId: crossVendorMatch.requestId,
      invoiceNumber: crossVendorMatch.invoiceNumber,
      vendor: crossVendorMatch.vendor?.vendorName,
      status: crossVendorMatch.status,
      createdAt: crossVendorMatch.createdAt,
      note: "Same invoice number used by different vendor",
    });
    if (!results.warning) results.warning = "cross_vendor_match";
  }

  return results;
};

/**
 * Get duplicate invoice report for a branch
 */
const getDuplicateReport = async (branchId, from, to) => {
  const match = { branch: mongoose.Types.ObjectId(branchId) };
  if (from) match.createdAt = { $gte: new Date(from) };
  if (to) match.createdAt = { ...match.createdAt, $lte: new Date(to) };

  // Find invoice numbers that appear more than once
  const duplicates = await InvoiceRequest.aggregate([
    { $match: match },
    {
      $group: {
        _id: { vendor: "$vendor", invoiceNumber: "$invoiceNumber" },
        count: { $sum: 1 },
        requests: {
          $push: {
            requestId: "$requestId",
            status: "$status",
            amount: "$netPayable",
            createdAt: "$createdAt",
          },
        },
        totalAmount: { $sum: "$netPayable" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    {
      $lookup: {
        from: "vendors",
        localField: "_id.vendor",
        foreignField: "_id",
        as: "vendor",
      },
    },
    { $unwind: { path: "$vendor", preserveNullAndEmpty: true } },
  ]);

  return duplicates;
};

module.exports = { checkDuplicateInvoice, getDuplicateReport };
