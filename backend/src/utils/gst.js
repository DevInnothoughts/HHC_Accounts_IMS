// ============================================================
// BACKEND: src/utils/gst.js
// GST supply type — Nov 2026.
//
// Under GST law the tax on an invoice is either:
//   • Intra-state supply → CGST + SGST (each = half the GST rate)
//   • Inter-state supply → IGST (full GST rate)
// The type applies to the whole invoice, so it is stored once on the
// invoice (gstType) and the per-item / per-invoice split is derived from it.
//
// Purely additive: invoices saved before this change have no gstType and
// are treated as IGST at read time. Nothing in the database is rewritten.
// gstAmount keeps holding the TOTAL GST, so every existing report, budget
// check and payment calculation is unchanged.
// ============================================================

const GST_TYPES = Object.freeze({
  INTRA: "CGST_SGST", // intra-state: CGST + SGST
  INTER: "IGST", // inter-state: IGST
});
const GST_TYPE_VALUES = Object.values(GST_TYPES);
const DEFAULT_LEGACY_GST_TYPE = GST_TYPES.INTER; // existing invoices → IGST

const GST_TYPE_LABELS = Object.freeze({
  [GST_TYPES.INTRA]: "CGST + SGST (Intra-state)",
  [GST_TYPES.INTER]: "IGST (Inter-state)",
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const isValidGstType = (v) => GST_TYPE_VALUES.includes(v);

// Anything missing or unrecognised reads as IGST (the legacy rule).
const resolveGstType = (docOrValue) => {
  const v =
    docOrValue && typeof docOrValue === "object"
      ? docOrValue.gstType
      : docOrValue;
  return isValidGstType(v) ? v : DEFAULT_LEGACY_GST_TYPE;
};

// Split a GST amount. For CGST+SGST the odd paisa goes to SGST so that
// cgst + sgst always equals the total exactly.
const splitGstAmount = (gstAmount, gstType) => {
  const total = round2(gstAmount);
  if (resolveGstType(gstType) === GST_TYPES.INTRA) {
    const cgstAmount = round2(total / 2);
    return {
      cgstAmount,
      sgstAmount: round2(total - cgstAmount),
      igstAmount: 0,
    };
  }
  return { cgstAmount: 0, sgstAmount: 0, igstAmount: total };
};

// Component rates for display / Tally ledger naming (e.g. 18 → 9 + 9).
const splitGstRate = (gstPercentage, gstType) => {
  const rate = Number(gstPercentage) || 0;
  if (resolveGstType(gstType) === GST_TYPES.INTRA) {
    const half = round2(rate / 2);
    return { cgstRate: half, sgstRate: half, igstRate: 0 };
  }
  return { cgstRate: 0, sgstRate: 0, igstRate: rate };
};

// Adds cgstAmount / sgstAmount / igstAmount to one line item.
const withItemSplit = (item, gstType) => ({
  ...item,
  ...splitGstAmount(item?.gstAmount, gstType),
});

// Invoice-level split = sum of the item splits (so per-rate Tally lines
// always add up to the invoice). Falls back to splitting gstAmount when
// there are no items (legacy single-amount invoices).
const sumSplits = (items = [], gstType, fallbackGstAmount = 0) => {
  if (!Array.isArray(items) || items.length === 0) {
    return splitGstAmount(fallbackGstAmount, gstType);
  }
  return items.reduce(
    (acc, it) => {
      const s = splitGstAmount(it?.gstAmount, gstType);
      acc.cgstAmount = round2(acc.cgstAmount + s.cgstAmount);
      acc.sgstAmount = round2(acc.sgstAmount + s.sgstAmount);
      acc.igstAmount = round2(acc.igstAmount + s.igstAmount);
      return acc;
    },
    { cgstAmount: 0, sgstAmount: 0, igstAmount: 0 },
  );
};

// Fields to write when an invoice is saved: gstType, split per item and
// split totals. `items` must already carry gstAmount.
const buildGstFields = (items, gstType, fallbackGstAmount = 0) => {
  const type = resolveGstType(gstType);
  const splitItems = (Array.isArray(items) ? items : []).map((it) =>
    withItemSplit(it, type),
  );
  return {
    gstType: type,
    items: splitItems,
    ...sumSplits(splitItems, type, fallbackGstAmount),
  };
};

// Read-time decorator for API responses. Legacy documents (no gstType)
// come back as IGST with their split derived; stored values are kept
// as they are. Never writes to the database.
const withGstSplit = (doc) => {
  const obj = doc?.toObject ? doc.toObject() : doc;
  if (!obj || typeof obj !== "object") return obj;
  const type = resolveGstType(obj);
  const hasStoredSplit =
    obj.gstType &&
    [obj.cgstAmount, obj.sgstAmount, obj.igstAmount].some(
      (v) => typeof v === "number",
    );
  if (Array.isArray(obj.items)) {
    obj.items = obj.items.map((it) =>
      typeof it?.cgstAmount === "number" ? it : withItemSplit(it, type),
    );
  }
  if (!hasStoredSplit) {
    // After a credit note gstAmount is the reduced figure, so split that.
    Object.assign(obj, splitGstAmount(obj.gstAmount, type));
  }
  if (!obj.gstType) obj.gstTypeDerived = true; // lets the UI mark legacy rows
  obj.gstType = type;
  return obj;
};

module.exports = {
  GST_TYPES,
  GST_TYPE_VALUES,
  GST_TYPE_LABELS,
  DEFAULT_LEGACY_GST_TYPE,
  isValidGstType,
  resolveGstType,
  splitGstAmount,
  splitGstRate,
  withItemSplit,
  sumSplits,
  buildGstFields,
  withGstSplit,
};
