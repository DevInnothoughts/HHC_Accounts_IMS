// ============================================================
// FRONTEND: src/components/DuplicateInvoiceChecker.jsx
// ============================================================
import { useState, useEffect, useRef } from "react";
import React from "react";
import api from "../api/axios";

export default function DuplicateInvoiceChecker({
  branchId,
  vendorId,
  invoiceNumber,
  amount,
  excludeId,
  onChange,
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!branchId || !vendorId || !invoiceNumber || invoiceNumber.length < 3) {
      setResult(null);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      try {
        const { data } = await api.post("/invoices/check-duplicate", {
          branchId,
          vendorId,
          invoiceNumber,
          amount: Number(amount) || 0,
          excludeId,
        });
        setResult(data);
        onChange?.(data);
      } catch (err) {
        console.error("Duplicate check error:", err.message);
      } finally {
        setChecking(false);
      }
    }, 600);

    return () => clearTimeout(debounceRef.current);
  }, [branchId, vendorId, invoiceNumber, amount]);

  if (!invoiceNumber || invoiceNumber.length < 3) return null;

  if (checking)
    return (
      <div style={S.checking}>
        <div style={S.spinner} />
        <span>Checking for duplicates...</span>
      </div>
    );

  if (!result) return null;

  if (result.isDuplicate)
    return (
      <div style={S.errorCard}>
        <div style={S.errorHeader}>🚨 Duplicate Invoice Detected</div>
        <p style={S.errorText}>
          This invoice number already exists for this vendor.
        </p>
        <div style={S.matchCard}>
          <div style={S.matchRow}>
            <span style={S.matchLabel}>Request ID</span>
            <span style={S.matchVal}>{result.exactMatch?.requestId}</span>
          </div>
          <div style={S.matchRow}>
            <span style={S.matchLabel}>Amount</span>
            <span style={S.matchVal}>
              ₹{result.exactMatch?.amount?.toLocaleString("en-IN")}
            </span>
          </div>
          <div style={S.matchRow}>
            <span style={S.matchLabel}>Status</span>
            <span style={{ ...S.matchVal, color: "#2563eb" }}>
              {result.exactMatch?.status}
            </span>
          </div>
          <div style={S.matchRow}>
            <span style={S.matchLabel}>Submitted</span>
            <span style={S.matchVal}>
              {new Date(result.exactMatch?.createdAt).toLocaleDateString(
                "en-GB",
              )}
            </span>
          </div>
        </div>
        <p style={S.errorFooter}>
          You cannot submit this request. Please verify the invoice number.
        </p>
      </div>
    );

  if (
    result.warning === "similar_found" ||
    result.warning === "cross_vendor_match"
  )
    return (
      <div style={S.warningCard}>
        <div style={S.warningHeader}>⚠️ Similar Requests Found</div>
        <p style={S.warningText}>
          The following requests have similar details. Please verify this is not
          a duplicate payment.
        </p>
        {result.similarMatches.map((m, i) => (
          <div key={i} style={S.matchCard}>
            <div style={S.matchRow}>
              <span style={S.matchLabel}>Request ID</span>
              <span style={S.matchVal}>{m.requestId}</span>
            </div>
            <div style={S.matchRow}>
              <span style={S.matchLabel}>Invoice No.</span>
              <span style={S.matchVal}>{m.invoiceNumber}</span>
            </div>
            {m.vendor && (
              <div style={S.matchRow}>
                <span style={S.matchLabel}>Vendor</span>
                <span style={S.matchVal}>{m.vendor}</span>
              </div>
            )}
            <div style={S.matchRow}>
              <span style={S.matchLabel}>Amount</span>
              <span style={S.matchVal}>
                ₹{m.amount?.toLocaleString("en-IN")}
              </span>
            </div>
            <div style={S.matchRow}>
              <span style={S.matchLabel}>Status</span>
              <span style={{ ...S.matchVal, color: "#2563eb" }}>
                {m.status}
              </span>
            </div>
            {m.note && <div style={S.noteText}>ℹ️ {m.note}</div>}
          </div>
        ))}
        <p style={S.warningFooter}>
          You can still proceed, but please confirm this is a new payment.
        </p>
      </div>
    );

  return (
    <div style={S.okCard}>
      <span style={S.okIcon}>✓</span>
      <span style={S.okText}>No duplicate invoices found</span>
    </div>
  );
}

const S = {
  checking: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: "#f8fafc",
    borderRadius: 8,
    fontSize: 13,
    color: "#64748b",
  },
  spinner: {
    width: 14,
    height: 14,
    border: "2px solid #e2e8f0",
    borderTop: "2px solid #2563eb",
    borderRadius: "50%",
    animation: "spin 0.6s linear infinite",
    flexShrink: 0,
  },
  errorCard: {
    background: "#fef2f2",
    border: "1.5px solid #fecaca",
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  errorHeader: {
    fontSize: 14,
    fontWeight: 700,
    color: "#dc2626",
    marginBottom: 6,
  },
  errorText: { fontSize: 13, color: "#dc2626", marginBottom: 10 },
  errorFooter: {
    fontSize: 12,
    color: "#dc2626",
    marginTop: 10,
    fontStyle: "italic",
  },
  warningCard: {
    background: "#fffbeb",
    border: "1.5px solid #fde68a",
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  warningHeader: {
    fontSize: 14,
    fontWeight: 700,
    color: "#d97706",
    marginBottom: 6,
  },
  warningText: { fontSize: 13, color: "#92400e", marginBottom: 10 },
  warningFooter: {
    fontSize: 12,
    color: "#d97706",
    marginTop: 10,
    fontStyle: "italic",
  },
  matchCard: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 8,
  },
  matchRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 0",
    borderBottom: "1px solid #f8fafc",
    fontSize: 13,
  },
  matchLabel: { color: "#64748b" },
  matchVal: { fontWeight: 600, color: "#334155" },
  noteText: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 6,
    fontStyle: "italic",
  },
  okCard: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    marginTop: 8,
  },
  okIcon: { color: "#16a34a", fontWeight: 700 },
  okText: { fontSize: 13, color: "#16a34a", fontWeight: 600 },
};
