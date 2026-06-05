// ============================================================
// FRONTEND: src/components/InvoiceItemsEditor.jsx
// Reusable line-items editor with per-field validation.
// Items drive base amount + total GST.
// Emits onChange(items, { amount, gstAmount, grandTotal, valid }).
// Pass showErrors={true} (e.g. on a failed "Next") to reveal all errors.
// ============================================================
import React, { useEffect, useState } from "react";

const GST_PRESETS = [0, 5, 12, 18, 28];
const MAX_DESC = 200;

// Strip anything that isn't a digit or a single decimal point.
// This makes it impossible to type "-", "e", or letters → no negatives.
const cleanNumber = (v) => {
  let s = String(v).replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return s;
};

// Same as cleanNumber but clamped to the 0–100 GST range.
const cleanPercent = (v) => {
  const s = cleanNumber(v);
  if (s !== "" && Number(s) > 100) return "100";
  return s;
};

const blankItem = () => ({
  key: Math.random().toString(36).slice(2),
  description: "",
  amount: "",
  gstPercentage: 18,
  touched: {},
});

// A row the user hasn't meaningfully started (ignored for validation/nagging)
const isBlankRow = (r) =>
  (r.description || "").trim() === "" &&
  (r.amount === "" || r.amount === null || r.amount === undefined);

// Per-row validation → returns { description?, amount?, gstPercentage? }
const validateRow = (r) => {
  const errs = {};
  const desc = (r.description || "").trim();
  const a = r.amount;
  const g = r.gstPercentage;

  if (!desc) errs.description = "Description is required";
  else if (desc.length > MAX_DESC)
    errs.description = `Max ${MAX_DESC} characters`;

  if (a === "" || a === null || a === undefined)
    errs.amount = "Value is required";
  else if (isNaN(Number(a))) errs.amount = "Enter a valid number";
  else if (Number(a) < 0) errs.amount = "Cannot be negative";
  else if (Number(a) === 0) errs.amount = "Must be greater than 0";

  if (g === "" || g === null || g === undefined)
    errs.gstPercentage = "Required";
  else if (isNaN(Number(g))) errs.gstPercentage = "Invalid";
  else if (Number(g) < 0) errs.gstPercentage = "Cannot be negative";
  else if (Number(g) > 100) errs.gstPercentage = "Max 100%";

  return errs;
};

export default function InvoiceItemsEditor({ value, onChange, showErrors }) {
  const [rows, setRows] = useState(() =>
    Array.isArray(value) && value.length
      ? value.map((it) => ({
          key: Math.random().toString(36).slice(2),
          description: it.description || "",
          amount: it.amount ?? "",
          gstPercentage: it.gstPercentage ?? 18,
          touched: {},
        }))
      : [blankItem()],
  );

  const emit = (next) => {
    const nonBlank = next.filter((r) => !isBlankRow(r));
    const valid =
      nonBlank.length >= 1 &&
      nonBlank.every((r) => Object.keys(validateRow(r)).length === 0);

    // Only valid, non-blank rows contribute to the committed totals
    const items = nonBlank
      .filter((r) => Object.keys(validateRow(r)).length === 0)
      .map((r) => {
        const amount = Number(r.amount) || 0;
        const gstPercentage = Number(r.gstPercentage) || 0;
        const gstAmount = +((amount * gstPercentage) / 100).toFixed(2);
        return {
          description: r.description.trim(),
          amount: +amount.toFixed(2),
          gstPercentage,
          gstAmount,
          total: +(amount + gstAmount).toFixed(2),
        };
      });
    const amount = +items.reduce((s, i) => s + i.amount, 0).toFixed(2);
    const gstAmount = +items.reduce((s, i) => s + i.gstAmount, 0).toFixed(2);
    const grandTotal = +(amount + gstAmount).toFixed(2);
    onChange?.(items, { amount, gstAmount, grandTotal, valid });
  };

  const update = (next) => {
    setRows(next);
    emit(next);
  };

  const setRow = (key, patch) =>
    update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const touch = (key, field) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, touched: { ...r.touched, [field]: true } } : r,
      ),
    );
  const addRow = () => update([...rows, blankItem()]);
  const removeRow = (key) =>
    update(
      rows.length === 1 ? [blankItem()] : rows.filter((r) => r.key !== key),
    );

  // Emit initial totals/validity once on mount (covers edit mode + empty row)
  useEffect(() => {
    emit(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inr = (n) =>
    "₹" +
    (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  // Running totals over any rows with a parseable amount (live as you type)
  const totals = rows.reduce(
    (acc, r) => {
      const amount = Number(r.amount);
      if (!isNaN(amount) && amount > 0) {
        const gst = (amount * (Number(r.gstPercentage) || 0)) / 100;
        acc.amount += amount;
        acc.gst += gst;
      }
      return acc;
    },
    { amount: 0, gst: 0 },
  );
  const grand = totals.amount + totals.gst;

  const nonBlankCount = rows.filter((r) => !isBlankRow(r)).length;
  const showNoItemBanner = showErrors && nonBlankCount === 0;

  const errStyle = (on) =>
    on ? { borderColor: "#dc2626", background: "#fef2f2" } : {};

  return (
    <div style={S.wrapper}>
      <div style={S.headerRow}>
        <div style={S.title}>🧾 Invoice Items</div>
        <button type="button" style={S.addBtn} onClick={addRow}>
          + Add Item
        </button>
      </div>

      {showNoItemBanner && (
        <div style={S.banner}>
          Please add at least one item with a value greater than 0.
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, textAlign: "left" }}>Item Description</th>
              <th style={S.thR}>Value (₹)</th>
              <th style={S.thR}>GST %</th>
              <th style={S.thR}>GST Amt</th>
              <th style={S.thR}>Total</th>
              <th style={S.th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const amount = Number(r.amount) || 0;
              const gstAmt = (amount * (Number(r.gstPercentage) || 0)) / 100;
              // Don't nag a brand-new blank row unless the form forces it
              const rowErrors = isBlankRow(r) ? {} : validateRow(r);
              const showFor = (field) =>
                (r.touched?.[field] || showErrors) && rowErrors[field];
              return (
                <tr key={r.key}>
                  <td style={S.td}>
                    <input
                      style={{
                        ...S.input,
                        ...errStyle(showFor("description")),
                      }}
                      placeholder="e.g. Consulting fee, equipment…"
                      maxLength={MAX_DESC + 1}
                      value={r.description}
                      onChange={(e) =>
                        setRow(r.key, { description: e.target.value })
                      }
                      onBlur={() => touch(r.key, "description")}
                    />
                    {showFor("description") && (
                      <div style={S.fieldErr}>{rowErrors.description}</div>
                    )}
                  </td>
                  <td style={S.tdR}>
                    <input
                      style={{
                        ...S.input,
                        textAlign: "right",
                        width: 110,
                        ...errStyle(showFor("amount")),
                      }}
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={r.amount}
                      onChange={(e) =>
                        setRow(r.key, { amount: cleanNumber(e.target.value) })
                      }
                      onBlur={() => touch(r.key, "amount")}
                    />
                    {showFor("amount") && (
                      <div style={S.fieldErr}>{rowErrors.amount}</div>
                    )}
                  </td>
                  <td style={S.tdR}>
                    <input
                      style={{
                        ...S.input,
                        textAlign: "right",
                        width: 80,
                        ...errStyle(showFor("gstPercentage")),
                      }}
                      type="text"
                      inputMode="decimal"
                      list="gst-presets"
                      value={r.gstPercentage}
                      onChange={(e) =>
                        setRow(r.key, {
                          gstPercentage: cleanPercent(e.target.value),
                        })
                      }
                      onBlur={() => touch(r.key, "gstPercentage")}
                    />
                    {showFor("gstPercentage") && (
                      <div style={S.fieldErr}>{rowErrors.gstPercentage}</div>
                    )}
                  </td>
                  <td style={S.cellVal}>{inr(gstAmt)}</td>
                  <td style={{ ...S.cellVal, fontWeight: 700 }}>
                    {inr(amount + gstAmt)}
                  </td>
                  <td style={S.tdR}>
                    <button
                      type="button"
                      style={S.removeBtn}
                      title="Remove item"
                      onClick={() => removeRow(r.key)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="gst-presets">
          {GST_PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>

      <div style={S.totals}>
        <div style={S.totalRow}>
          <span style={S.totalLabel}>Base Amount</span>
          <span style={S.totalVal}>{inr(totals.amount)}</span>
        </div>
        <div style={S.totalRow}>
          <span style={S.totalLabel}>Total GST</span>
          <span style={S.totalVal}>{inr(totals.gst)}</span>
        </div>
        <div style={{ ...S.totalRow, ...S.grandRow }}>
          <span style={S.grandLabel}>Grand Total (before TDS)</span>
          <span style={S.grandVal}>{inr(grand)}</span>
        </div>
        <div style={S.note}>
          TDS is deducted later by the accounts team during approval.
        </div>
      </div>
    </div>
  );
}

const S = {
  wrapper: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 18,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  title: { fontSize: 14, fontWeight: 700, color: "#1a3c6e" },
  addBtn: {
    padding: "7px 14px",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  banner: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 12,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: "1px solid #e2e8f0",
    textAlign: "right",
  },
  thR: {
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: "1px solid #e2e8f0",
    textAlign: "right",
  },
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "top",
  },
  tdR: {
    padding: "8px 10px",
    borderBottom: "1px solid #f1f5f9",
    textAlign: "right",
    verticalAlign: "top",
  },
  cellVal: {
    padding: "8px 10px",
    borderBottom: "1px solid #f1f5f9",
    textAlign: "right",
    color: "#334155",
    whiteSpace: "nowrap",
    verticalAlign: "top",
  },
  input: {
    width: "100%",
    padding: "8px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
    color: "#334155",
  },
  fieldErr: {
    fontSize: 11,
    color: "#dc2626",
    marginTop: 4,
    textAlign: "left",
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#dc2626",
    cursor: "pointer",
    fontWeight: 700,
  },
  totals: {
    marginTop: 16,
    borderTop: "2px solid #e2e8f0",
    paddingTop: 12,
    maxWidth: 360,
    marginLeft: "auto",
  },
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "5px 0",
  },
  totalLabel: { fontSize: 13, color: "#64748b" },
  totalVal: { fontSize: 13, fontWeight: 600, color: "#334155" },
  grandRow: { borderTop: "1px solid #e2e8f0", marginTop: 6, paddingTop: 10 },
  grandLabel: { fontSize: 14, fontWeight: 700, color: "#1a3c6e" },
  grandVal: { fontSize: 18, fontWeight: 700, color: "#1a3c6e" },
  note: { fontSize: 11, color: "#94a3b8", marginTop: 8, fontStyle: "italic" },
};
