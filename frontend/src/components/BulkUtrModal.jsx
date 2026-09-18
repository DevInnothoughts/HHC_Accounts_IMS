// ============================================================
// Bulk UTR entry
// ------------------------------------------------------------
// Accounts release payments as one bank batch, then key the UTRs back
// in from the bank statement. Posting them one modal at a time does not
// match that: this is a grid of every payment still awaiting a UTR,
// typed straight in and submitted as one batch.
//
// A payment appears here only once its bank Excel has been generated —
// that Excel IS the batch the UTRs are being read back from, so a payment
// with no bank file was never in it.
//
// No file import by design — the team keys the numbers directly.
//
// Fast keying is the whole point, so the grid is built around the
// keyboard: Enter or ↓ moves to the next UTR box, ↑ goes back, and
// "same UTR for all" fills a single consolidated transfer in one go.
//
// Rows are applied independently on the server (PATCH /payments/bulk-utr),
// so a bad row is reported back without holding up the rest of the batch.
// ============================================================
import React from "react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import api from "../api/axios";

const today = () => new Date().toISOString().slice(0, 10);

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// Indian UTR / RRN references run 12–22 alphanumeric characters. Anything
// shorter is almost always a half-typed entry, so it is flagged — but not
// blocked, because bank formats vary and the team has the statement in hand.
const looksShort = (utr) => utr.length > 0 && utr.length < 10;

export default function BulkUtrModal({
  open,
  preselectedIds = [],
  onClose,
  onDone,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [truncated, setTruncated] = useState(false);

  // rowId (payment _id) -> { utrNumber, paymentDate }
  const [values, setValues] = useState({});
  // Which payments are in the grid. Starts as the page selection, or
  // everything awaiting a UTR when nothing was ticked.
  const [rowIds, setRowIds] = useState([]);
  const [allIds, setAllIds] = useState([]);
  // True when the rows ticked on the page behind have all been paid since.
  const [staleSelection, setStaleSelection] = useState(false);
  const [search, setSearch] = useState("");

  const [sameUtr, setSameUtr] = useState("");
  const [sameDate, setSameDate] = useState(today());

  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState(null);

  // One ref per visible UTR box, for Enter / arrow navigation.
  const utrRefs = useRef({});

  const byId = useMemo(() => {
    const map = new Map();
    candidates.forEach((c) => map.set(String(c._id), c));
    return map;
  }, [candidates]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/payments/awaiting-utr");
      const rows = (data.payments || []).filter((p) => !p.alreadyRecorded);
      setCandidates(rows);
      setTruncated(Boolean(data.truncated));

      const available = new Set(rows.map((r) => String(r._id)));
      const every = rows.map((r) => String(r._id));
      const picked = preselectedIds
        .map(String)
        .filter((id) => available.has(id));

      setAllIds(every);
      // "Nothing was ticked" and "everything ticked has already been paid"
      // are different situations. Silently widening the second one to every
      // payment in scope is how a single "same UTR for all" could be applied
      // to hundreds of unrelated invoices.
      if (preselectedIds.length && !picked.length) {
        setRowIds([]);
        setStaleSelection(true);
      } else {
        setRowIds(picked.length ? picked : every);
        setStaleSelection(false);
      }
    } catch (err) {
      setError(
        err.response?.data?.message || "Could not load payments awaiting a UTR",
      );
    } finally {
      setLoading(false);
    }
    // preselectedIds is a fresh array each render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedIds.join(",")]);

  // Reset and load on open only. `load` is deliberately not a dependency:
  // onDone triggers a refetch on the parent page while the batch summary is
  // still on screen, and re-running this would wipe the summary being read.
  useEffect(() => {
    if (!open) return;
    setValues({});
    setSummary(null);
    setStaleSelection(false);
    setSameUtr("");
    setSameDate(today());
    setSearch("");
    utrRefs.current = {};
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const rows = rowIds.map((id) => byId.get(id)).filter(Boolean);

  const term = search.trim().toLowerCase();
  const visibleRows = term
    ? rows.filter((p) =>
        [
          p.paymentId,
          p.installmentId,
          p.invoiceRequest?.requestId,
          p.invoiceRequest?.invoiceNumber,
          p.vendor?.vendorName,
          p.vendor?.companyName,
          p.branch?.name,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term)),
      )
    : rows;

  const setValue = (id, patch) =>
    setValues((prev) => ({
      ...prev,
      [id]: { utrNumber: "", paymentDate: sameDate, ...prev[id], ...patch },
    }));

  const valueOf = (id) =>
    values[id] || { utrNumber: "", paymentDate: sameDate };

  // "Same UTR / same date for all" fill only what is on screen, so a search
  // can be used to scope them to one branch or vendor's rows.
  const applySameUtr = () => {
    const utr = sameUtr.trim().toUpperCase();
    if (!utr) return;
    setValues((prev) => {
      const next = { ...prev };
      visibleRows.forEach((p) => {
        const id = String(p._id);
        next[id] = { paymentDate: sameDate, ...next[id], utrNumber: utr };
      });
      return next;
    });
  };

  const applySameDate = () => {
    if (!sameDate) return;
    setValues((prev) => {
      const next = { ...prev };
      visibleRows.forEach((p) => {
        const id = String(p._id);
        next[id] = { utrNumber: "", ...next[id], paymentDate: sameDate };
      });
      return next;
    });
  };

  // Clear the typed value as well — otherwise a removed row that is later
  // brought back by "Show all" returns pre-filled and silently rejoins the
  // next batch.
  // Widening is the operator's explicit choice, so the stale-selection
  // warning clears with it — otherwise it would sit above a full grid
  // saying nothing is pre-filled.
  const showEverything = () => {
    setRowIds(allIds);
    setStaleSelection(false);
  };

  const removeRow = (id) => {
    setRowIds((prev) => prev.filter((rowId) => rowId !== id));
    setValues((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // ── Keyboard: keep hands on the number pad ────────────────
  const focusNeighbour = (id, delta) => {
    const order = visibleRows.map((p) => String(p._id));
    const next = order[order.indexOf(id) + delta];
    if (!next) return;
    const el = utrRefs.current[next];
    if (el) {
      el.focus();
      el.select?.();
    }
  };

  const handleKeyDown = (event, id) => {
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      focusNeighbour(id, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusNeighbour(id, -1);
    }
  };

  // ── Submit ────────────────────────────────────────────────
  // Only rows carrying a UTR are sent; the rest are simply left for later.
  const entries = rowIds
    .map((id) => {
      const payment = byId.get(id);
      const value = valueOf(id);
      if (!payment || !value.utrNumber?.trim()) return null;
      return {
        _id: id,
        reference: payment.paymentId,
        utrNumber: value.utrNumber.trim(),
        paymentDate: value.paymentDate || undefined,
        // The printed installment id, not its array position: the server
        // resolves it by name so a payment rejected and re-raised while
        // this grid was open cannot land the UTR on the abandoned row.
        installmentRef: payment.installmentId || undefined,
        installmentIndex: payment.installmentId
          ? undefined
          : (payment.installmentIndex ?? undefined),
      };
    })
    .filter(Boolean);

  const filledCount = entries.length;

  const shortCount = entries.filter((e) => looksShort(e.utrNumber)).length;

  // Repeats are legitimate for one consolidated transfer covering several
  // invoices, so this is a note, not a warning.
  const repeatedCount = (() => {
    const seen = new Map();
    entries.forEach((e) =>
      seen.set(e.utrNumber, (seen.get(e.utrNumber) || 0) + 1),
    );
    return [...seen.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
  })();

  const handleSubmit = async () => {
    if (!entries.length || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { data } = await api.patch("/payments/bulk-utr", {
        entries,
        paymentDate: sameDate || undefined,
      });
      setSummary(data);
      onDone?.(data);
    } catch (err) {
      setError(err.response?.data?.message || "Bulk UTR recording failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Result view ───────────────────────────────────────────
  if (summary) {
    const problems = (summary.results || []).filter(
      (r) => r.status !== "success",
    );

    // Successful rows are dropped — from the grid AND from the candidate
    // list behind it — so neither a retry nor "show all" can re-post a UTR
    // that is already on the ledger. Their typed values are cleared too.
    const fixProblemRows = () => {
      const posted = new Set(
        (summary.results || [])
          .filter((r) => r.status === "success")
          .map((r) => entries[r.index]?._id)
          .filter(Boolean)
          .map(String),
      );
      // Everything except the rows that went through — so the problem rows
      // AND the rows deliberately left blank for the next statement page
      // both stay on screen.
      const keep = new Set(rowIds.map(String).filter((id) => !posted.has(id)));

      setValues((prev) => {
        const next = {};
        keep.forEach((id) => {
          if (prev[id]) next[id] = prev[id];
        });
        return next;
      });
      setCandidates((prev) => prev.filter((c) => !posted.has(String(c._id))));
      setAllIds((prev) => prev.filter((id) => !posted.has(String(id))));
      setRowIds((prev) => prev.filter((id) => keep.has(String(id))));
      setSearch("");
      setSummary(null);
    };

    return (
      <div style={S.overlay}>
        <div style={{ ...S.modal, maxWidth: 720 }}>
          <h3 style={S.title}>
            {summary.updated ? "✅" : "⚠️"} Bulk UTR complete
          </h3>
          <div style={S.statRow}>
            <Stat label="Recorded" value={summary.updated} tone="#16a34a" />
            <Stat label="Skipped" value={summary.skipped} tone="#d97706" />
            <Stat label="Failed" value={summary.failed} tone="#dc2626" />
          </div>

          {problems.length > 0 && (
            <div style={S.problemBox}>
              <div style={S.problemHead}>
                {problems.length} row{problems.length === 1 ? "" : "s"} need
                attention — nothing was posted for these
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {problems.map((row) => (
                  <div
                    key={`${row.index}-${row.reference}`}
                    style={S.problemRow}
                  >
                    <span style={S.mono}>{row.paymentId || row.reference}</span>
                    <span style={{ color: "#64748b" }}>{row.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={S.footer}>
            <span style={S.countNote}>
              {summary.updated} payment{summary.updated === 1 ? "" : "s"} moved
              to Partially / Fully Paid.
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              {problems.length > 0 && (
                <button style={S.cancelBtn} onClick={fixProblemRows}>
                  Fix {problems.length} row{problems.length === 1 ? "" : "s"}
                </button>
              )}
              <button style={S.primaryBtn} onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const showingSubset = rowIds.length < allIds.length;

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.header}>
          <div>
            <h3 style={S.title}>🔢 Bulk UTR Entry</h3>
            <p style={S.sub}>
              Type the UTR against each payment and post them in one go. Press{" "}
              <kbd style={S.kbd}>Enter</kbd> to drop to the next row.
            </p>
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {error && (
          <div style={S.errorBox}>
            {error}
            <button style={S.errorClose} onClick={() => setError("")}>
              ✕
            </button>
          </div>
        )}

        <div style={S.toolbar}>
          <div style={S.toolGroup}>
            <label style={S.toolLabel}>Same UTR for all</label>
            <input
              style={{ ...S.input, fontFamily: "monospace", width: 200 }}
              placeholder="e.g. HDFCN52025091800123"
              value={sameUtr}
              onChange={(e) => setSameUtr(e.target.value.toUpperCase())}
            />
            <button
              style={S.applyBtn}
              onClick={applySameUtr}
              disabled={!sameUtr.trim()}
              title="One consolidated transfer covering every row shown"
            >
              Apply
            </button>
          </div>

          <div style={S.toolGroup}>
            <label style={S.toolLabel}>Payment date</label>
            <input
              type="date"
              max={today()}
              style={{ ...S.input, width: 150 }}
              value={sameDate}
              onChange={(e) => setSameDate(e.target.value)}
            />
            <button
              style={S.applyBtn}
              onClick={applySameDate}
              title="Set this date on every row shown"
            >
              Apply to all
            </button>
          </div>

          <div style={{ ...S.toolGroup, marginLeft: "auto" }}>
            <input
              style={{ ...S.input, width: 200 }}
              placeholder="🔍 Filter by vendor, invoice, branch"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {staleSelection && (
          <div style={S.warnBox}>
            The payments you ticked have already been paid or moved on since
            that list was loaded, so nothing is pre-filled here.{" "}
            <button style={S.linkBtn} onClick={showEverything}>
              Show all {allIds.length} awaiting a UTR
            </button>
          </div>
        )}

        {!staleSelection && showingSubset && (
          <div style={S.infoBox}>
            Showing {rowIds.length} of {allIds.length} payment
            {allIds.length === 1 ? "" : "s"} awaiting a UTR.{" "}
            <button style={S.linkBtn} onClick={showEverything}>
              Show all {allIds.length}
            </button>
          </div>
        )}

        {truncated && (
          <div style={S.warnBox}>
            More payments are awaiting a UTR than can be listed at once. Post
            these, then reopen to continue.
          </div>
        )}

        <div style={S.tableWrap}>
          {loading ? (
            <div style={S.empty}>Loading payments awaiting a UTR…</div>
          ) : visibleRows.length === 0 ? (
            <div style={S.empty}>
              {rows.length === 0
                ? staleSelection
                  ? "Nothing pre-filled — use the link above to list every payment awaiting a UTR."
                  : "No payments are awaiting a UTR. Bulk UTR lists a payment once its bank Excel has been generated."
                : "No rows match that filter."}
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  {[
                    "Payment / Installment",
                    "Invoice",
                    "Vendor",
                    "Amount",
                    "UTR / Reference No.",
                    "Payment Date",
                    "",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((payment) => {
                  const id = String(payment._id);
                  const value = valueOf(id);
                  const utr = value.utrNumber?.trim() || "";
                  const short = looksShort(utr);
                  return (
                    <tr key={id} style={S.tr}>
                      <td style={S.td}>
                        <div style={S.mono}>
                          {payment.installmentId || payment.paymentId}
                        </div>
                        <div style={S.dim}>{payment.branch?.name || "—"}</div>
                      </td>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>
                          {payment.invoiceRequest?.requestId || "—"}
                        </div>
                        <div style={S.dim}>
                          {payment.invoiceRequest?.invoiceNumber || ""}
                        </div>
                      </td>
                      <td style={S.td}>
                        {payment.vendor?.vendorName ||
                          payment.vendor?.companyName ||
                          "—"}
                      </td>
                      <td
                        style={{ ...S.td, fontWeight: 700, color: "#16a34a" }}
                      >
                        {money(payment.amount)}
                      </td>
                      <td style={S.td}>
                        <input
                          ref={(el) => {
                            if (el) utrRefs.current[id] = el;
                            else delete utrRefs.current[id];
                          }}
                          style={{
                            ...S.input,
                            fontFamily: "monospace",
                            width: "100%",
                            borderColor: short
                              ? "#fde68a"
                              : utr
                                ? "#bbf7d0"
                                : "#e2e8f0",
                          }}
                          placeholder="Enter UTR"
                          value={value.utrNumber}
                          onKeyDown={(e) => handleKeyDown(e, id)}
                          onChange={(e) =>
                            setValue(id, {
                              utrNumber: e.target.value
                                .toUpperCase()
                                .replace(/\s+/g, ""),
                            })
                          }
                        />
                        {short && (
                          <div style={S.rowHint}>Looks short — check it</div>
                        )}
                      </td>
                      <td style={S.td}>
                        <input
                          type="date"
                          max={today()}
                          style={{ ...S.input, width: 140 }}
                          value={value.paymentDate || ""}
                          onChange={(e) =>
                            setValue(id, { paymentDate: e.target.value })
                          }
                        />
                      </td>
                      <td style={S.td}>
                        <button
                          style={S.removeBtn}
                          onClick={() => removeRow(id)}
                          title="Leave this payment out of this batch"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={S.footer}>
          <span style={S.countNote}>
            {filledCount} of {rows.length} row{rows.length === 1 ? "" : "s"}{" "}
            ready to post
            {rows.length > filledCount && " — blank rows are left for later"}
            {repeatedCount > 0 && (
              <span style={{ color: "#64748b" }}>
                {" "}
                · {repeatedCount} share a UTR (one consolidated transfer)
              </span>
            )}
            {shortCount > 0 && (
              <span style={{ color: "#b45309" }}>
                {" "}
                · {shortCount} look short
              </span>
            )}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={S.cancelBtn} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              style={{
                ...S.primaryBtn,
                opacity: !filledCount || submitting ? 0.5 : 1,
                cursor: !filledCount || submitting ? "not-allowed" : "pointer",
              }}
              disabled={!filledCount || submitting}
              onClick={handleSubmit}
            >
              {submitting
                ? "Recording…"
                : `✅ Record ${filledCount} UTR${filledCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const Stat = ({ label, value, tone }) => (
  <div style={S.stat}>
    <div style={S.statLabel}>{label}</div>
    <div style={{ ...S.statValue, color: tone }}>{value ?? 0}</div>
  </div>
);

const S = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 20,
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    padding: 22,
    width: "100%",
    maxWidth: 1100,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: 700, color: "#1a3c6e", margin: 0 },
  sub: { fontSize: 13, color: "#64748b", margin: "4px 0 0" },
  kbd: {
    fontFamily: "monospace",
    fontSize: 11,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: "1px 5px",
    color: "#475569",
  },
  closeBtn: {
    border: "none",
    background: "#f1f5f9",
    borderRadius: 8,
    width: 30,
    height: 30,
    cursor: "pointer",
    color: "#475569",
    fontSize: 14,
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "10px 14px",
    marginBottom: 10,
  },
  toolGroup: { display: "flex", alignItems: "center", gap: 8 },
  toolLabel: { fontSize: 12, fontWeight: 600, color: "#64748b" },
  input: {
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 7,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  },
  applyBtn: {
    padding: "7px 12px",
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  infoBox: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    marginBottom: 10,
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: "#1d4ed8",
    textDecoration: "underline",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    padding: 0,
  },
  tableWrap: {
    flex: 1,
    overflowY: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    minHeight: 120,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    position: "sticky",
    top: 0,
    background: "#f8fafc",
    padding: "9px 12px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    borderBottom: "1px solid #e2e8f0",
  },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "8px 12px", verticalAlign: "middle" },
  mono: { fontFamily: "monospace", fontWeight: 600, color: "#334155" },
  dim: { fontSize: 11, color: "#94a3b8" },
  rowHint: { fontSize: 10, color: "#b45309", marginTop: 2 },
  removeBtn: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#dc2626",
    borderRadius: 6,
    width: 26,
    height: 26,
    cursor: "pointer",
    fontSize: 12,
  },
  empty: { padding: 28, textAlign: "center", color: "#94a3b8", fontSize: 13 },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 14,
  },
  countNote: { fontSize: 12, color: "#64748b" },
  cancelBtn: {
    padding: "10px 18px",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    color: "#475569",
    fontSize: 13,
  },
  primaryBtn: {
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    background: "#166534",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13,
    marginBottom: 10,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
  },
  errorClose: {
    border: "none",
    background: "transparent",
    color: "#dc2626",
    cursor: "pointer",
    fontWeight: 700,
  },
  warnBox: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#b45309",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 12,
    marginBottom: 10,
  },
  statRow: { display: "flex", gap: 12, margin: "16px 0" },
  stat: {
    flex: 1,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "12px 14px",
    textAlign: "center",
  },
  statLabel: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  statValue: { fontSize: 24, fontWeight: 700, marginTop: 4 },
  problemBox: {
    border: "1px solid #fde68a",
    background: "#fffbeb",
    borderRadius: 10,
    padding: "10px 12px",
  },
  problemHead: {
    fontSize: 12,
    fontWeight: 700,
    color: "#b45309",
    marginBottom: 6,
  },
  problemRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 12,
    padding: "4px 0",
    borderBottom: "1px solid rgba(0,0,0,0.04)",
  },
};
