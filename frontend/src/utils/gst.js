// ============================================================
// FRONTEND: src/utils/gst.js
// GST supply type — Nov 2026. Mirrors backend/src/utils/gst.js.
//   CGST_SGST → intra-state: CGST + SGST, each half the GST rate
//   IGST      → inter-state: IGST at the full rate
// Invoices saved before Nov 2026 have no gstType and read as IGST.
// ============================================================

export const GST_TYPES = Object.freeze({
  INTRA: "CGST_SGST",
  INTER: "IGST",
});

export const GST_TYPE_OPTIONS = [
  {
    value: GST_TYPES.INTRA,
    label: "CGST + SGST",
    hint: "Intra-state — vendor and branch in the same state",
  },
  {
    value: GST_TYPES.INTER,
    label: "IGST",
    hint: "Inter-state — vendor in a different state",
  },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const isValidGstType = (v) =>
  v === GST_TYPES.INTRA || v === GST_TYPES.INTER;

export const resolveGstType = (docOrValue) => {
  const v =
    docOrValue && typeof docOrValue === "object"
      ? docOrValue.gstType
      : docOrValue;
  return isValidGstType(v) ? v : GST_TYPES.INTER;
};

export const gstTypeLabel = (docOrValue) =>
  resolveGstType(docOrValue) === GST_TYPES.INTRA ? "CGST + SGST" : "IGST";

// Odd paisa goes to SGST so CGST + SGST always equals the total.
export const splitGstAmount = (gstAmount, gstType) => {
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

// 18 → "CGST 9% + SGST 9%" or "IGST 18%"
export const gstRateLabel = (gstPercentage, gstType) => {
  const rate = Number(gstPercentage) || 0;
  if (resolveGstType(gstType) === GST_TYPES.INTRA) {
    const half = round2(rate / 2);
    return `CGST ${half}% + SGST ${half}%`;
  }
  return `IGST ${rate}%`;
};

// Invoice split: stored values when present, else derived from gstAmount.
export const invoiceGstBreakup = (invoice) => {
  const gstType = resolveGstType(invoice);
  const stored =
    invoice?.gstType &&
    typeof invoice?.cgstAmount === "number" &&
    typeof invoice?.igstAmount === "number";
  const split = stored
    ? {
        cgstAmount: round2(invoice.cgstAmount),
        sgstAmount: round2(invoice.sgstAmount),
        igstAmount: round2(invoice.igstAmount),
      }
    : splitGstAmount(invoice?.gstAmount, gstType);
  return {
    gstType,
    isLegacy: !invoice?.gstType || !!invoice?.gstTypeDerived,
    ...split,
  };
};
