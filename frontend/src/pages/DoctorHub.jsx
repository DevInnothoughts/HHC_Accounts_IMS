// ============================================================
// FRONTEND: src/pages/DoctorHub.jsx — NEW FILE
// ------------------------------------------------------------
// Doctor Payments — the ONE screen the sidebar opens for the whole doctor
// referral / surgeon module. It shows where things stand and links to
// every part of the module:
//   Upload & approvals   → /doctor-payouts
//   Referral payments    → /doctor-payments?type=referral
//   Surgeon payments     → /doctor-payments?type=surgeon
//   Doctor Master        → /doctors
//   TDS — Doctors        → /reports/primary?tab=doctorTds
//   Tally export         → /tally-export?source=doctors   (Accounts, Super Admin)
// Read-only: it only calls three existing GET endpoints, so there is no
// backend change. Each figure loads on its own — if one call fails the
// rest of the screen still works.
// ============================================================
import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  C,
  S,
  BATCH_STATUS,
  Chip,
  Notice,
  DoctorNav,
  inr,
  fmtDate,
  canUpload,
  canApprove,
  canPay,
  canEditDoctor,
} from "../components/doctorPayoutUi.jsx";

const TALLY_ROLES = ["accounts", "super_admin"];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const blank = { count: 0, amount: 0 };

export default function DoctorHub() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [batches, setBatches] = useState(null);
  const [pendingRows, setPendingRows] = useState(null);
  const [doctors, setDoctors] = useState(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [sum, bat, doc] = await Promise.allSettled([
      api.get("/doctor-payments/summary"),
      api.get("/doctor-payouts/batches?page=1&limit=5"),
      api.get("/doctors?page=1&limit=1"),
    ]);
    if (sum.status === "fulfilled") setSummary(sum.value.data || null);
    if (bat.status === "fulfilled") {
      setBatches(bat.value.data?.batches || []);
      setPendingRows(bat.value.data?.pendingRows ?? 0);
    }
    if (doc.status === "fulfilled") setDoctors(doc.value.data || null);
    setFailed([sum, bat, doc].some((r) => r.status === "rejected"));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const of = (type, key) => summary?.[type]?.[key] || blank;
  const both = (key) => ({
    count: of("referral", key).count + of("surgeon", key).count,
    amount: of("referral", key).amount + of("surgeon", key).amount,
  });
  const have = summary !== null;
  const toRaise = both("raise");
  const inProcess = both("processing");
  const paid = both("paid");
  // send the user to whichever type actually has work waiting
  const typeWith = (key) =>
    of("referral", key).count === 0 && of("surgeon", key).count > 0
      ? "surgeon"
      : "referral";

  const counts = doctors?.counts || {};
  const doctorTotal =
    (counts.active || 0) + (counts.inactive || 0) + (counts.blocked || 0);
  const incomplete = counts.incomplete || 0;

  const tiles = [
    {
      label: "Awaiting approval",
      value: pendingRows === null ? "—" : pendingRows,
      note:
        pendingRows === null
          ? ""
          : canApprove(user)
            ? `${pendingRows === 1 ? "record" : "records"} waiting for your approval`
            : `${pendingRows === 1 ? "record" : "records"} with the Cluster Head`,
      to: "/doctor-payouts",
      tone: pendingRows > 0 ? "#b45309" : C.ink,
    },
    {
      label: "Approved, to be raised",
      value: have ? inr(toRaise.amount) : "—",
      note: have ? plural(toRaise.count, "record", "records") : "",
      to: `/doctor-payments?type=${typeWith("raise")}&tab=raise`,
      tone: toRaise.count > 0 ? "#1d4ed8" : C.ink,
    },
    {
      label: "Raised, UTR pending",
      value: have ? inr(inProcess.amount) : "—",
      note: have ? plural(inProcess.count, "payment", "payments") : "",
      to: `/doctor-payments?type=${typeWith("processing")}&tab=processing`,
      tone: inProcess.count > 0 ? "#6d28d9" : C.ink,
    },
    {
      label: "Paid to date",
      value: have ? inr(paid.amount) : "—",
      note: have ? plural(paid.count, "payment", "payments") : "",
      to: `/doctor-payments?type=${typeWith("paid")}&tab=paid`,
      tone: "#15803d",
    },
  ];

  const paymentCard = (type, icon, title, text) => ({
    icon,
    title,
    text,
    to: `/doctor-payments?type=${type}`,
    action: canPay(user) ? "Process payments" : "View payments",
    links: [
      [
        "To raise",
        of(type, "raise").count,
        `/doctor-payments?type=${type}&tab=raise`,
      ],
      [
        "UTR pending",
        of(type, "processing").count,
        `/doctor-payments?type=${type}&tab=processing`,
      ],
      [
        "Paid",
        of(type, "paid").count,
        `/doctor-payments?type=${type}&tab=paid`,
      ],
    ],
  });

  const work = [
    {
      icon: "📥",
      title: "Upload & approvals",
      text: "Upload the payout Excel, check the preview for new doctors and bank mismatches, and send it to the Cluster Head for approval.",
      to: "/doctor-payouts",
      action: canUpload(user)
        ? "Upload / view uploads"
        : canApprove(user)
          ? "Review & approve"
          : "View uploads",
      status:
        pendingRows === null
          ? null
          : pendingRows > 0
            ? `${plural(pendingRows, "record", "records")} awaiting approval`
            : "Nothing awaiting approval",
      alert: pendingRows > 0,
    },
    paymentCard(
      "referral",
      "🤝",
      "Doctor Referral payments",
      "Payments to doctors who referred patients. Raise approved records, download the bank file and record the UTR.",
    ),
    paymentCard(
      "surgeon",
      "🩺",
      "Surgeon payments",
      "Incentive payments to surgeons and anaesthetists. Raise approved records, download the bank file and record the UTR.",
    ),
  ];

  const records = [
    {
      icon: "👨‍⚕️",
      title: "Doctor Master",
      text: "One record per PAN — profile, bank details, documents and the full payment history of each doctor.",
      to: "/doctors",
      action: canEditDoctor(user) ? "Manage doctors" : "View doctors",
      status: !doctors
        ? null
        : incomplete > 0
          ? `${plural(doctorTotal, "doctor", "doctors")} · ${plural(incomplete, "profile", "profiles")} incomplete`
          : plural(doctorTotal, "doctor", "doctors"),
      alert: incomplete > 0,
    },
    {
      icon: "🧾",
      title: "TDS — Doctors",
      text: "TDS deducted on doctor payouts, doctor-wise and as a register, with the TDS working Excel for Accounts.",
      to: "/reports/primary?tab=doctorTds",
      action: "Open report",
    },
    TALLY_ROLES.includes(user?.role) && {
      icon: "📤",
      title: "Tally export — Doctor payments",
      text: "Preview and download the Tally import file for approved doctor payouts, kept separate from vendor invoices.",
      to: "/tally-export?source=doctors",
      action: "Open export",
    },
  ].filter(Boolean);

  const Card = ({ card }) => (
    <div style={H.card}>
      <div style={H.cardHead}>
        <span style={H.icon} aria-hidden="true">
          {card.icon}
        </span>
        <div style={H.cardTitle}>{card.title}</div>
      </div>
      <p style={H.cardText}>{card.text}</p>
      {card.links && (
        <div style={H.links}>
          {card.links.map(([label, count, to]) => (
            <Link key={label} to={to} style={H.pill}>
              {label}
              <b
                style={{
                  ...H.pillCount,
                  ...(have && count > 0 ? H.pillCountOn : {}),
                }}
              >
                {have ? count : "—"}
              </b>
            </Link>
          ))}
        </div>
      )}
      {card.status && (
        <div style={{ ...H.status, color: card.alert ? "#b45309" : C.muted }}>
          {card.alert ? "● " : ""}
          {card.status}
        </div>
      )}
      <Link to={card.to} style={H.open}>
        {card.action} →
      </Link>
    </div>
  );

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <DoctorNav active="overview" />
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>🩺 Doctor Payments</h1>
            <p style={S.sub}>
              Doctor referral and surgeon payouts — everything for this module
              is on this screen.
            </p>
          </div>
          <button
            style={{ ...S.btnGhost, ...(loading ? S.disabled : {}) }}
            onClick={load}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>

        {failed && (
          <Notice tone="warn">
            Some figures could not be loaded. The links below still work — use
            Refresh to try again.
          </Notice>
        )}

        <div style={H.tiles}>
          {tiles.map((t) => (
            <Link key={t.label} to={t.to} style={H.tile}>
              <div style={S.tileLabel}>{t.label}</div>
              <div style={{ ...H.tileValue, color: t.tone }}>{t.value}</div>
              <div style={H.tileNote}>{t.note || " "}</div>
            </Link>
          ))}
        </div>

        <div style={H.flow}>
          <b style={{ color: C.primary }}>How a payout moves:</b>
          {[
            "Accounts uploads Excel",
            "Cluster Head approves",
            "Accounts raises payment",
            "Bank file",
            "UTR recorded",
          ].map((step, i) => (
            <span key={step} style={H.step}>
              {i > 0 && <span style={H.arrow}>→</span>}
              {step}
            </span>
          ))}
        </div>

        <h2 style={H.section}>Process payments</h2>
        <div style={H.grid}>
          {work.map((card) => (
            <Card key={card.title} card={card} />
          ))}
        </div>

        <h2 style={H.section}>Records &amp; reports</h2>
        <div style={H.grid}>
          {records.map((card) => (
            <Card key={card.title} card={card} />
          ))}
        </div>

        <div style={H.sectionRow}>
          <h2 style={{ ...H.section, margin: 0 }}>Recent uploads</h2>
          <Link to="/doctor-payouts" style={H.viewAll}>
            View all uploads →
          </Link>
        </div>
        <div style={S.card}>
          {batches === null ? (
            <div style={S.empty}>
              {loading ? "Loading…" : "Could not load the uploads."}
            </div>
          ) : batches.length === 0 ? (
            <div style={S.empty}>
              No payout Excel has been uploaded yet.
              {canUpload(user) && " Start with Upload & approvals."}
            </div>
          ) : (
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Upload</th>
                    <th style={S.th}>Branch</th>
                    <th style={S.th}>Uploaded</th>
                    <th style={{ ...S.th, ...S.thR }}>Records</th>
                    <th style={{ ...S.th, ...S.thR }}>Payable</th>
                    <th style={S.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b._id}>
                      <td style={S.td}>
                        <Link to="/doctor-payouts" style={H.rowLink}>
                          {b.batchId}
                        </Link>
                        <div style={S.small}>{b.fileName}</div>
                      </td>
                      <td style={S.td}>
                        {(b.branches || []).map((x) => x.name).join(", ") ||
                          "—"}
                      </td>
                      <td style={S.td}>
                        {fmtDate(b.createdAt)}
                        <div style={S.small}>{b.uploadedBy?.name || ""}</div>
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {b.counts?.total ?? b.rowCount ?? 0}
                        {b.counts?.pending > 0 && (
                          <div style={{ ...S.small, color: "#b45309" }}>
                            {b.counts.pending} pending
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {inr(b.counts?.payable ?? b.totals?.payable ?? 0)}
                      </td>
                      <td style={S.td}>
                        <Chip map={BATCH_STATUS} value={b.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const H = {
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 12,
    marginBottom: 14,
  },
  tile: {
    display: "block",
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "14px 16px",
    textDecoration: "none",
  },
  tileValue: {
    fontSize: 24,
    fontWeight: 700,
    marginTop: 6,
    fontVariantNumeric: "tabular-nums",
  },
  tileNote: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  flow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: C.muted,
    background: "#fff",
    border: `1px dashed ${C.line}`,
    borderRadius: 10,
    padding: "9px 14px",
    marginBottom: 22,
  },
  step: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  },
  arrow: { color: C.faint },
  section: {
    fontSize: 13,
    fontWeight: 700,
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    margin: "0 0 10px",
  },
  sectionRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 10,
  },
  viewAll: {
    fontSize: 13,
    fontWeight: 600,
    color: C.accent,
    textDecoration: "none",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
    gap: 14,
    marginBottom: 24,
  },
  card: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
  },
  cardHead: { display: "flex", alignItems: "center", gap: 10 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    background: "#eff6ff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    flexShrink: 0,
  },
  cardTitle: { fontSize: 15.5, fontWeight: 700, color: C.primary },
  cardText: {
    fontSize: 13,
    lineHeight: 1.5,
    color: C.muted,
    margin: "10px 0 12px",
    flex: 1,
  },
  links: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    color: "#475569",
    textDecoration: "none",
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    padding: "4px 6px 4px 11px",
    whiteSpace: "nowrap",
  },
  pillCount: {
    minWidth: 20,
    textAlign: "center",
    fontSize: 12,
    borderRadius: 999,
    padding: "1px 6px",
    background: "#f1f5f9",
    color: C.muted,
  },
  pillCountOn: { background: C.primary, color: "#fff" },
  status: { fontSize: 12.5, fontWeight: 600, marginBottom: 12 },
  open: {
    alignSelf: "flex-start",
    background: C.primary,
    color: "#fff",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 14px",
    borderRadius: 8,
    whiteSpace: "nowrap",
  },
  rowLink: { color: C.accent, fontWeight: 700, textDecoration: "none" },
};
