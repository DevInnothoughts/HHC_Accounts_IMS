// ============================================================
// FRONTEND: src/components/doctorPayoutUi.jsx — NEW FILE
// ------------------------------------------------------------
// Shared look, labels and helpers for the three doctor payout screens
// (DoctorPayouts, DoctorPayments, Doctors), so they stay consistent with
// each other and with the rest of PMS.
// ============================================================
import React from "react";
import { Link } from "react-router-dom";

export const C = {
  primary: "#1a3c6e",
  accent: "#2563eb",
  teal: "#0f766e",
  line: "#e2e8f0",
  muted: "#64748b",
  faint: "#94a3b8",
  ink: "#0f172a",
  bg: "#f8fafc",
};

export const TYPES = [
  { key: "referral", label: "Doctor Referral", short: "Referral", icon: "🤝" },
  { key: "surgeon", label: "Surgeon Payment", short: "Surgeon", icon: "🩺" },
];
export const typeLabel = (t) => TYPES.find((x) => x.key === t)?.label || t;

// Roles (permission checks use user.role; "Department Head" is a label).
export const canUpload = (u) => u?.role === "accounts";
export const canApprove = (u) => u?.role === "cluster_head";
export const canPay = (u) => u?.role === "accounts";
export const canRecordUtr = (u) =>
  ["accounts", "super_admin"].includes(u?.role);
export const canEditDoctor = (u) =>
  ["accounts", "super_admin"].includes(u?.role);
export const VIEW_ROLES = [
  "accounts",
  "super_admin",
  "cluster_head",
  "director",
];

// ── status chips ──────────────────────────────────────────
export const ROW_STATUS = {
  pending_approval: {
    label: "Pending approval",
    bg: "#fffbeb",
    color: "#b45309",
  },
  approved: { label: "Approved", bg: "#eff6ff", color: "#1d4ed8" },
  rejected: { label: "Rejected", bg: "#fef2f2", color: "#dc2626" },
  withdrawn: { label: "Withdrawn", bg: "#f1f5f9", color: "#64748b" },
  raised: { label: "Payment raised", bg: "#f5f3ff", color: "#6d28d9" },
  file_generated: {
    label: "Bank file generated",
    bg: "#ecfeff",
    color: "#0e7490",
  },
  paid: { label: "Paid", bg: "#f0fdf4", color: "#15803d" },
};
export const BATCH_STATUS = {
  pending_approval: {
    label: "Pending approval",
    bg: "#fffbeb",
    color: "#b45309",
  },
  partially_reviewed: {
    label: "Partly reviewed",
    bg: "#fff7ed",
    color: "#c2410c",
  },
  approved: { label: "Approved", bg: "#eff6ff", color: "#1d4ed8" },
  in_payment: { label: "In payment", bg: "#f5f3ff", color: "#6d28d9" },
  paid: { label: "Paid", bg: "#f0fdf4", color: "#15803d" },
  rejected: { label: "Rejected", bg: "#fef2f2", color: "#dc2626" },
  withdrawn: { label: "Withdrawn", bg: "#f1f5f9", color: "#64748b" },
  empty: { label: "—", bg: "#f1f5f9", color: "#64748b" },
};
export const PAYMENT_STATUS = {
  raised: { label: "Raised", bg: "#f5f3ff", color: "#6d28d9" },
  file_generated: {
    label: "Bank file generated",
    bg: "#ecfeff",
    color: "#0e7490",
  },
  paid: { label: "Paid", bg: "#f0fdf4", color: "#15803d" },
  cancelled: { label: "Cancelled", bg: "#f1f5f9", color: "#64748b" },
};
export const DOCTOR_STATUS = {
  active: { label: "Active", bg: "#f0fdf4", color: "#15803d" },
  inactive: { label: "Inactive", bg: "#f1f5f9", color: "#64748b" },
  blocked: { label: "Blocked", bg: "#fef2f2", color: "#dc2626" },
};

export const Chip = ({ map, value, style }) => {
  const s = (map && map[value]) || {
    label: value || "—",
    bg: "#f1f5f9",
    color: "#475569",
  };
  return (
    <span
      style={{
        display: "inline-block",
        background: s.bg,
        color: s.color,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {s.label}
    </span>
  );
};

// Small coloured tag: NEW doctor, bank change, duplicate…
const TAGS = {
  green: { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  red: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
  amber: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
  purple: { bg: "#ede9fe", color: "#5b21b6", border: "#c4b5fd" },
  grey: { bg: "#f1f5f9", color: "#475569", border: "#cbd5e1" },
  blue: { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
};
export const Tag = ({ tone = "grey", children, title }) => {
  const t = TAGS[tone] || TAGS.grey;
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.border}`,
        borderRadius: 5,
        padding: "0 6px",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.2,
        lineHeight: "17px",
        whiteSpace: "nowrap",
        marginRight: 4,
      }}
    >
      {children}
    </span>
  );
};

// ── formatting ────────────────────────────────────────────
export const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Dates are stored at UTC midnight of the sheet date, so they are shown
// in UTC — otherwise a viewer west of IST would see the previous day.
export const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};
// Timestamps (uploaded at, approved at) in the viewer's own time.
export const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const maskAccount = (a) => {
  const s = String(a || "");
  return s.length > 4 ? `••••${s.slice(-4)}` : s || "—";
};

// ── file download ─────────────────────────────────────────
export const saveBlob = (data, fileName, type) => {
  const url = window.URL.createObjectURL(
    new Blob([data], type ? { type } : undefined),
  );
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};
export const fileNameFromHeader = (headers, fallback) => {
  const cd = headers?.["content-disposition"] || "";
  const plain = cd.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : fallback;
};
// With responseType "blob" an error body arrives as a Blob too.
export const readError = async (err, fallback) => {
  let data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      data = JSON.parse(await data.text());
    } catch {
      return fallback;
    }
  }
  if (data?.errors?.length) return `${data.message}: ${data.errors.join("; ")}`;
  return data?.message || fallback;
};

// ── building blocks ───────────────────────────────────────
export const Modal = ({
  title,
  sub,
  onClose,
  children,
  footer,
  width = 560,
}) => (
  <div
    style={S.overlay}
    onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
  >
    <div style={{ ...S.modal, width, maxWidth: "96vw" }}>
      <div style={S.modalHead}>
        <div>
          <div style={S.modalTitle}>{title}</div>
          {sub && <div style={S.modalSub}>{sub}</div>}
        </div>
        {onClose && (
          <button style={S.x} onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <div style={S.modalBody}>{children}</div>
      {footer && <div style={S.modalFoot}>{footer}</div>}
    </div>
  </div>
);

export const Notice = ({ tone = "info", children, onClose }) => {
  const t = {
    info: { bg: "#eff6ff", border: "#bfdbfe", color: "#1e40af" },
    ok: { bg: "#f0fdf4", border: "#bbf7d0", color: "#166534" },
    warn: { bg: "#fffbeb", border: "#fde68a", color: "#92400e" },
    error: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
  }[tone];
  return (
    <div
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
        borderRadius: 8,
        padding: "9px 14px",
        fontSize: 13,
        lineHeight: 1.5,
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            ...S.x,
            color: t.color,
            fontSize: 14,
            alignSelf: "flex-start",
          }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
};

export const Pager = ({ page, limit, total, onPage }) => {
  const pages = Math.max(1, Math.ceil((total || 0) / limit));
  if (pages <= 1) return null;
  return (
    <div style={S.pager}>
      <button
        style={S.btnGhostSm}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        ‹ Prev
      </button>
      <span style={{ fontSize: 12.5, color: C.muted }}>
        Page {page} of {pages} · {total} records
      </span>
      <button
        style={S.btnGhostSm}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next ›
      </button>
    </div>
  );
};

// One sidebar entry ("Doctor Payments") opens the overview; this strip at
// the top of every doctor screen moves between them without going back.
export const DOCTOR_HOME = "/doctor-hub";
const DOCTOR_NAV = [
  { key: "overview", label: "Overview", to: DOCTOR_HOME },
  { key: "payouts", label: "Upload & approvals", to: "/doctor-payouts" },
  {
    key: "referral",
    label: "Referral payments",
    to: "/doctor-payments?type=referral",
  },
  {
    key: "surgeon",
    label: "Surgeon payments",
    to: "/doctor-payments?type=surgeon",
  },
  { key: "doctors", label: "Doctor Master", to: "/doctors" },
];
export const DoctorNav = ({ active }) => (
  <nav style={S.subNav} aria-label="Doctor payments sections">
    {DOCTOR_NAV.map((item) => (
      <Link
        key={item.key}
        to={item.to}
        style={{
          ...S.subNavItem,
          ...(active === item.key ? S.subNavActive : {}),
        }}
      >
        {item.label}
      </Link>
    ))}
  </nav>
);

// Vendor invoices | Doctor Referral | Surgeon Payment — the switch at the
// top of Payment Processing and Doctor Payments.
export const PaymentKindSwitch = ({ active, onPick }) => (
  <div style={S.seg}>
    {[{ key: "vendor", label: "Vendor Invoices", icon: "💳" }, ...TYPES].map(
      (t) => (
        <button
          key={t.key}
          style={{ ...S.segBtn, ...(active === t.key ? S.segActive : {}) }}
          onClick={() => active !== t.key && onPick(t.key)}
        >
          {t.icon} {t.label}
        </button>
      ),
    )}
  </div>
);

export const S = {
  layout: { display: "flex", minHeight: "100vh", background: C.bg },
  main: { flex: 1, padding: "24px 28px", overflowY: "auto", minWidth: 0 },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  subNav: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
    borderBottom: `1px solid ${C.line}`,
    marginBottom: 18,
  },
  subNavItem: {
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    color: C.muted,
    textDecoration: "none",
    borderBottom: "2px solid transparent",
    marginBottom: -1,
    whiteSpace: "nowrap",
  },
  subNavActive: { color: C.primary, borderBottom: `2px solid ${C.primary}` },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: "#888", marginTop: 4 },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 14,
    background: "#fff",
    borderRadius: 10,
    padding: 4,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    width: "fit-content",
    flexWrap: "wrap",
  },
  tab: {
    padding: "8px 16px",
    border: "none",
    borderRadius: 8,
    background: "none",
    cursor: "pointer",
    fontSize: 13.5,
    fontWeight: 500,
    color: C.muted,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  tabActive: { background: C.primary, color: "#fff", fontWeight: 700 },
  badge: {
    background: "#ef4444",
    color: "#fff",
    borderRadius: 20,
    padding: "1px 7px",
    fontSize: 11,
    fontWeight: 700,
  },
  seg: {
    display: "inline-flex",
    background: "#e2e8f0",
    borderRadius: 10,
    padding: 3,
    gap: 2,
    flexWrap: "wrap",
  },
  segBtn: {
    border: "none",
    background: "none",
    padding: "7px 14px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  segActive: {
    background: "#fff",
    color: C.primary,
    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
  },
  filters: {
    display: "flex",
    gap: 10,
    marginBottom: 14,
    flexWrap: "wrap",
    alignItems: "center",
  },
  input: {
    padding: "8px 12px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 13.5,
    outline: "none",
    background: "#fff",
    boxSizing: "border-box",
  },
  label: {
    display: "block",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#475569",
    marginBottom: 5,
  },
  field: {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 11px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 12,
    background: "#fff",
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflow: "hidden",
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    background: "#f8fafc",
    color: "#475569",
    fontSize: 11.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: `1px solid ${C.line}`,
    whiteSpace: "nowrap",
  },
  thR: { textAlign: "right" },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #f1f5f9",
    color: C.ink,
    verticalAlign: "top",
  },
  tdR: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  small: { fontSize: 11.5, color: C.muted, marginTop: 2 },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12.5,
  },
  // record / payment / batch ids — never broken across lines
  id: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12.5,
    whiteSpace: "nowrap",
  },
  // dense tables inside the wide modals
  tdTight: { padding: "9px 8px" },
  thTight: { padding: "9px 8px" },
  empty: {
    padding: "44px 20px",
    textAlign: "center",
    color: C.faint,
    fontSize: 14,
  },
  btn: {
    background: C.primary,
    color: "#fff",
    border: "none",
    padding: "9px 16px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnTeal: {
    background: C.teal,
    color: "#fff",
    border: "none",
    padding: "9px 16px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnDanger: {
    background: "#fff",
    color: "#dc2626",
    border: "1px solid #fecaca",
    padding: "9px 16px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnGhost: {
    background: "#fff",
    color: "#475569",
    border: "1px solid #cbd5e1",
    padding: "9px 16px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnGhostSm: {
    background: "#fff",
    color: "#475569",
    border: "1px solid #cbd5e1",
    padding: "5px 10px",
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  link: {
    background: "none",
    border: "none",
    padding: 0,
    color: C.accent,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left",
  },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  bulkBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 10,
    padding: "10px 14px",
    marginBottom: 12,
  },
  pager: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    padding: "12px 0",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 16,
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
    display: "flex",
    flexDirection: "column",
    maxHeight: "92vh",
  },
  modalHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    padding: "16px 20px 12px",
    borderBottom: `1px solid ${C.line}`,
  },
  modalTitle: { fontSize: 17, fontWeight: 700, color: C.primary },
  modalSub: { fontSize: 12.5, color: C.muted, marginTop: 3 },
  modalBody: { padding: "16px 20px", overflowY: "auto", minHeight: 0 },
  modalFoot: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    padding: "12px 20px",
    borderTop: `1px solid ${C.line}`,
    flexWrap: "wrap",
  },
  x: {
    background: "none",
    border: "none",
    fontSize: 16,
    color: C.faint,
    cursor: "pointer",
    fontWeight: 700,
    lineHeight: 1,
  },
  tile: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 10,
    padding: "10px 14px",
    minWidth: 120,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tileValue: { fontSize: 19, fontWeight: 700, color: C.ink, marginTop: 2 },
};
