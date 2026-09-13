// ============================================================
// FRONTEND: src/components/PaymentCycleWidgets.jsx — NEW FILE
// ------------------------------------------------------------
// Exports three things:
//   usePaymentCycle()   — fetches the cycle from the API
//   PaymentCycleModal   — the confirm popup before invoice submit
//   PaymentCycleCard    — the dashboard card, all roles
//
// No date arithmetic here. The backend is the only place the rule
// exists, so the popup and the dashboard cannot drift apart.
// ============================================================
import { useState, useEffect } from "react";
import React from "react";
import api from "../api/axios";

const C = {
  primary: "#1a3c6e",
  teal: "#0f766e",
  tealBg: "#f0fdfa",
  tealLine: "#99f6e4",
  amber: "#b45309",
  amberBg: "#fffbeb",
  amberLine: "#fde68a",
  line: "#e2e8f0",
  muted: "#64748b",
  faint: "#94a3b8",
  ink: "#0f172a",
};

// ── Hook ────────────────────────────────────────────────────
export function usePaymentCycle() {
  const [cycle, setCycle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get("/payment-cycle/current")
      .then((r) => {
        if (!cancelled) setCycle(r.data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load payment cycle");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { cycle, loading, error };
}

// ── Shared: collapsible terms ──────────────────────────────
function TermsBlock({ terms, small }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(terms) || !terms.length) return null;

  return (
    <div>
      <button
        type="button"
        style={{ ...T.toggle, fontSize: small ? 11 : 12 }}
        onClick={() => setOpen(!open)}
      >
        {open ? "▴ Hide" : "▾ View"} terms &amp; conditions
      </button>
      {open && (
        <ol style={T.list}>
          {terms.map((t, i) => (
            <li key={i} style={{ ...T.item, fontSize: small ? 10.5 : 11.5 }}>
              {t}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const T = {
  toggle: {
    background: "none",
    border: "none",
    padding: "8px 0 0",
    cursor: "pointer",
    color: C.teal,
    fontWeight: 600,
    textDecoration: "underline",
  },
  list: { margin: "4px 0 0", paddingLeft: 18 },
  item: { color: C.muted, lineHeight: 1.65, marginBottom: 7 },
};

// ── Pre-submit modal ───────────────────────────────────────
export function PaymentCycleModal({
  cycle,
  loading,
  submitting,
  onConfirm,
  onCancel,
}) {
  return (
    <div
      style={M.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pc-title"
    >
      <div style={M.modal}>
        <div style={M.head}>
          <h3 id="pc-title" style={M.title}>
            🗓️ Payment Cycle
          </h3>
          <button
            type="button"
            style={M.close}
            onClick={onCancel}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        {loading && <p style={M.muted}>Loading payment cycle…</p>}

        {!loading && !cycle && (
          <p style={M.warn}>
            Payment cycle details could not be loaded. You can still submit —
            the Accounts team will confirm the cycle once this invoice is
            finally approved.
          </p>
        )}

        {!loading && cycle && (
          <>
            <p style={M.lead}>
              The payment cycle is fixed on the date this invoice receives{" "}
              <strong>final approval from the Cluster Head</strong> — not on
              today's upload date.
            </p>

            {/* Branch A — makes this cycle */}
            <div style={M.branch}>
              <div style={M.branchHead}>
                <span style={{ ...M.mark, color: C.teal }}>✓</span>
                <span>
                  If finally approved on or before{" "}
                  <strong>{cycle.cutoffDateLabel}</strong>
                </span>
              </div>
              <div style={M.branchBody}>
                <span style={{ ...M.pill, background: C.teal }}>
                  {cycle.cycleLabel}
                </span>
                <span style={M.payDate}>
                  Payment on {cycle.paymentDateLabel}
                </span>
              </div>
            </div>

            {/* Branch B — slips to the next cycle */}
            <div
              style={{
                ...M.branch,
                background: C.amberBg,
                borderColor: C.amberLine,
              }}
            >
              <div style={M.branchHead}>
                <span style={{ ...M.mark, color: C.amber }}>→</span>
                <span>
                  If approval is completed after{" "}
                  <strong>{cycle.cutoffDateLabel}</strong>
                </span>
              </div>
              <div style={M.branchBody}>
                <span style={{ ...M.pill, background: C.amber }}>
                  {cycle.nextCycle.cycleLabel}
                </span>
                <span style={M.payDate}>
                  Payment on {cycle.nextCycle.paymentDateLabel}
                </span>
              </div>
            </div>

            {cycle.isCutoffToday && (
              <p style={M.warn}>
                ⚠ Today is the approval cut-off. This invoice will only make the{" "}
                {cycle.cycleLabel} if every approval is completed today.
              </p>
            )}

            {!cycle.isCutoffToday && cycle.daysToCutoff > 0 && (
              <p style={M.muted}>
                {cycle.daysToCutoff} day{cycle.daysToCutoff === 1 ? "" : "s"}{" "}
                remain for the approval chain to clear this invoice for the{" "}
                {cycle.cycleLabel}.
              </p>
            )}

            <TermsBlock terms={cycle.terms} />
          </>
        )}

        <div style={M.actions}>
          <button
            type="button"
            style={M.secondary}
            onClick={onCancel}
            disabled={submitting}
          >
            Back
          </button>
          <button
            type="button"
            style={{ ...M.primary, opacity: submitting ? 0.6 : 1 }}
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "I Understand — Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

const M = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 16,
  },
  modal: {
    background: "#fff",
    borderRadius: 12,
    padding: "22px 24px 20px",
    width: "100%",
    maxWidth: 520,
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 20px 45px rgba(0,0,0,0.22)",
  },
  head: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 700, color: C.primary },
  close: {
    background: "none",
    border: "none",
    fontSize: 18,
    color: C.faint,
    cursor: "pointer",
    lineHeight: 1,
  },
  lead: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 1.65,
    margin: "0 0 16px",
  },
  branch: {
    background: C.tealBg,
    border: `1px solid ${C.tealLine}`,
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 10,
  },
  branchHead: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 13,
    color: "#334155",
    marginBottom: 9,
    lineHeight: 1.5,
  },
  mark: { fontWeight: 700, flexShrink: 0 },
  branchBody: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  pill: {
    color: "#fff",
    padding: "3px 11px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  payDate: { fontSize: 14, fontWeight: 600, color: C.ink },
  muted: { fontSize: 13, color: C.muted, margin: "10px 0", lineHeight: 1.55 },
  warn: {
    fontSize: 13,
    color: "#92400e",
    background: "#fef3c7",
    border: "1px solid #fde68a",
    padding: "9px 12px",
    borderRadius: 8,
    margin: "10px 0",
    lineHeight: 1.5,
  },
  actions: {
    display: "flex",
    gap: 12,
    justifyContent: "flex-end",
    marginTop: 20,
    paddingTop: 14,
    borderTop: `1px solid #f1f5f9`,
  },
  primary: {
    background: C.teal,
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  secondary: {
    background: "#fff",
    color: "#475569",
    border: `1px solid #cbd5e1`,
    padding: "10px 20px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
};

// ── Dashboard card ─────────────────────────────────────────
// ── Dashboard indicator ────────────────────────────────────
// One component, three presentations:
//   variant="ribbon"  slim full-width strip with cycle progress
//   variant="pill"    compact chip for the header bar
//   variant="stat"    tile that drops into the existing statsGrid
//
// Detail and terms live behind a click in every variant. A dashboard
// answers "when do I get paid"; it does not host reference text.
export function PaymentCycleIndicator({ variant = "ribbon" }) {
  const { cycle, loading, error } = usePaymentCycle();
  const [open, setOpen] = useState(false);

  if (loading || error || !cycle) return null;

  const urgent = cycle.daysToCutoff <= 1;
  const accent = urgent ? "#d97706" : C.teal;

  const daysText = cycle.isCutoffToday
    ? "Cut-off today"
    : `${cycle.daysToCutoff} day${cycle.daysToCutoff === 1 ? "" : "s"} left`;

  const detail = (
    <PaymentCycleDetail
      cycle={cycle}
      accent={accent}
      onClose={() => setOpen(false)}
    />
  );

  // ── Ribbon ───────────────────────────────────────────────
  if (variant === "ribbon") {
    return (
      <div style={{ position: "relative", marginBottom: 18 }}>
        <div style={{ ...R.bar, borderLeft: `3px solid ${accent}` }}>
          <div style={R.left}>
            <span style={{ ...R.chip, background: accent }}>
              {cycle.cycleLabel}
            </span>
            <div style={R.leftText}>
              <div style={R.payLine}>
                Bank payment <strong>{cycle.paymentDateLabel}</strong>
              </div>
              <div style={R.subLine}>
                Approval cut-off {cycle.cutoffDateLabel}
              </div>
            </div>
          </div>

          <div style={R.track}>
            <div
              style={{
                ...R.fill,
                width: `${cycle.progressPercent}%`,
                background: accent,
              }}
            />
            <div style={R.trackEnds}>
              <span>{cycle.windowStartLabel}</span>
              <span>{cycle.cutoffDateLabel}</span>
            </div>
          </div>

          <div style={R.right}>
            <div style={{ ...R.days, color: accent }}>{daysText}</div>
            <button
              type="button"
              style={R.infoBtn}
              onClick={() => setOpen(!open)}
              aria-label="Payment cycle details"
            >
              {open ? "✕" : "ⓘ"}
            </button>
          </div>
        </div>
        {open && detail}
      </div>
    );
  }

  // ── Pill ─────────────────────────────────────────────────
  if (variant === "pill") {
    return (
      <div style={{ position: "relative" }}>
        <button
          type="button"
          style={{ ...P.pill, borderColor: accent }}
          onClick={() => setOpen(!open)}
        >
          <span style={{ ...P.dot, background: accent }} />
          <span style={P.label}>{cycle.cycleLabel}</span>
          <span style={P.sep}>·</span>
          <span style={P.date}>{cycle.paymentDateLabel}</span>
          <span style={P.caret}>{open ? "▴" : "▾"}</span>
        </button>
        {open && detail}
      </div>
    );
  }

  // ── Stat tile ────────────────────────────────────────────
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{ ...ST.card, borderTop: `3px solid ${accent}` }}
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setOpen(!open)}
      >
        <div style={ST.top}>
          <span style={ST.icon}>🗓️</span>
          <span style={{ ...ST.chip, color: accent }}>{cycle.cycleLabel}</span>
        </div>
        <div style={ST.value}>{cycle.paymentDateLabel}</div>
        <div style={ST.label}>Bank payment date</div>
        <div style={{ ...ST.sub, color: accent }}>{daysText} to cut-off</div>
      </div>
      {open && detail}
    </div>
  );
}

// Shared detail panel — the only place the long text lives.
function PaymentCycleDetail({ cycle, accent, onClose }) {
  return (
    <>
      <div style={DT.scrim} onClick={onClose} />
      <div style={DT.panel}>
        <div style={DT.head}>
          <span style={DT.title}>Payment Cycle</span>
          <button type="button" style={DT.close} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={DT.row}>
          <span style={DT.k}>Current cycle</span>
          <span style={{ ...DT.v, color: accent, fontWeight: 700 }}>
            {cycle.cycleLabel}
          </span>
        </div>
        <div style={DT.row}>
          <span style={DT.k}>Approval cut-off</span>
          <span style={DT.v}>{cycle.cutoffDateLabel}</span>
        </div>
        <div style={DT.row}>
          <span style={DT.k}>Bank payment</span>
          <span style={{ ...DT.v, fontWeight: 700 }}>
            {cycle.paymentDateLabel}
          </span>
        </div>
        <div style={DT.row}>
          <span style={DT.k}>Next cycle</span>
          <span style={DT.v}>
            {cycle.nextCycle.cycleLabel} · {cycle.nextCycle.paymentDateLabel}
          </span>
        </div>

        <p style={DT.note}>
          The cycle is fixed on the date an invoice receives final approval from
          the Cluster Head, not on its upload date.
        </p>

        <TermsBlock terms={cycle.terms} small />
      </div>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────
const R = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    background: "#fff",
    borderRadius: 10,
    padding: "12px 16px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    flexWrap: "wrap",
  },
  left: { display: "flex", alignItems: "center", gap: 11, flexShrink: 0 },
  chip: {
    color: "#fff",
    padding: "3px 10px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  leftText: { lineHeight: 1.35 },
  payLine: { fontSize: 13, color: C.ink },
  subLine: { fontSize: 11, color: C.faint, marginTop: 1 },
  track: {
    flex: "1 1 200px",
    minWidth: 160,
    position: "relative",
    paddingBottom: 13,
  },
  fill: { height: 6, borderRadius: 3, transition: "width .5s" },
  trackEnds: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    justifyContent: "space-between",
    fontSize: 10,
    color: C.faint,
  },
  right: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  days: { fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  infoBtn: {
    background: "#f8fafc",
    border: `1px solid ${C.line}`,
    borderRadius: 6,
    width: 26,
    height: 26,
    fontSize: 12,
    color: C.muted,
    cursor: "pointer",
    lineHeight: 1,
  },
};

const P = {
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    background: "#fff",
    border: "1px solid",
    borderRadius: 999,
    padding: "6px 13px",
    cursor: "pointer",
    fontSize: 12,
  },
  dot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  label: { fontWeight: 700, color: C.ink },
  sep: { color: C.faint },
  date: { color: C.muted },
  caret: { color: C.faint, fontSize: 9 },
};

const ST = {
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "14px 16px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    cursor: "pointer",
    minWidth: 0,
  },
  top: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  icon: { fontSize: 22, lineHeight: 1 },
  chip: { fontSize: 11, fontWeight: 700 },
  value: { fontSize: 17, fontWeight: 700, color: C.ink, lineHeight: 1.2 },
  label: { fontSize: 12, color: C.muted, marginTop: 3 },
  sub: { fontSize: 11, fontWeight: 600, marginTop: 5 },
};

const DT = {
  scrim: { position: "fixed", inset: 0, zIndex: 40 },
  panel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    zIndex: 41,
    width: 330,
    maxWidth: "90vw",
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "14px 16px 12px",
    boxShadow: "0 12px 30px rgba(15,23,42,0.16)",
  },
  head: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: `1px solid #f1f5f9`,
  },
  title: { fontSize: 13, fontWeight: 700, color: C.primary },
  close: {
    background: "none",
    border: "none",
    color: C.faint,
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "5px 0",
    fontSize: 12.5,
  },
  k: { color: C.muted, whiteSpace: "nowrap" },
  v: { color: C.ink, textAlign: "right" },
  note: {
    fontSize: 11,
    color: C.faint,
    lineHeight: 1.6,
    margin: "10px 0 0",
    paddingTop: 9,
    borderTop: `1px solid #f1f5f9`,
  },
};
