// ============================================================
// FRONTEND: src/pages/TallyExport.jsx — NEW FILE (Nov 2026)
// ------------------------------------------------------------
// TallyPrime import file for Accounts / Super Admin.
// Pick a branch (one Tally company per branch) and a period, preview the
// vouchers with anything to check, then download the Excel. Downloaded
// records are marked exported and skipped next time unless
// "Include already exported" is ticked.
//
// Nov 2026 — two separate lists, chosen with the switch at the top:
//   Invoices & credit notes   /api/tally/preview          /api/tally/export
//   Doctor payments           /api/tally/doctors/preview  /api/tally/doctors/export
// Each has its own preview, its own download and its own "exported" marks.
// ============================================================
import React, { useState, useEffect } from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";

const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

const TYPE_STYLE = {
  Journal: { bg: "#eff6ff", color: "#1e40af" },
  Purchase: { bg: "#f0fdf4", color: "#166534" },
  "Debit Note": { bg: "#fef2f2", color: "#b91c1c" },
};

// The two lists this screen can export.
const SOURCES = {
  invoices: {
    label: "Invoices & credit notes",
    path: "/tally",
    sub: "Accounts-approved invoices (Journal / Purchase) and approved credit notes (Debit Note) in TallyPrime import format — one branch per file.",
    party: "Vendor",
    ref: "Vendor Ref / Date",
    file: "Tally",
  },
  doctors: {
    label: "Doctor payments",
    path: "/tally/doctors",
    sub: "Doctor Referral and Surgeon payments approved by the Cluster / Department Head — one Journal per record, in the same TallyPrime import format. One branch per file.",
    party: "Doctor",
    ref: "Upload / Sheet date",
    file: "Tally_Doctors",
  },
};
const PAYOUT_TYPE = { referral: "Referral", surgeon: "Surgeon" };

export default function TallyExport() {
  // ?source=doctors opens the doctor list directly (Doctor Payments overview).
  const [source, setSource] = useState(() =>
    new URLSearchParams(window.location.search).get("source") === "doctors"
      ? "doctors"
      : "invoices",
  );
  const src = SOURCES[source];
  const isDoctors = source === "doctors";
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [includeExported, setIncludeExported] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState({}); // voucherNumber → expanded

  useEffect(() => {
    api
      .get("/branches")
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : r.data.branches || [];
        setBranches(list.filter((b) => b.status !== "inactive"));
        if (list.length === 1) setBranch(list[0]._id);
      })
      .catch(() => setError("Could not load branches"));
  }, []);

  const params = () =>
    new URLSearchParams({
      branch,
      from,
      to,
      includeExported: includeExported ? "1" : "0",
    });

  const loadPreview = async () => {
    if (!branch) return setError("Select a branch");
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.get(`${src.path}/preview?${params()}`);
      setData(data);
      setOpen({});
    } catch (err) {
      setData(null);
      setError(err.response?.data?.message || "Could not load the preview");
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const res = await api.post(
        `${src.path}/export`,
        { branch, from, to, includeExported },
        { responseType: "blob" },
      );
      const cd = res.headers?.["content-disposition"] || "";
      const name =
        /filename="?([^";]+)"?/i.exec(cd)?.[1] ||
        `${src.file}_${from}_to_${to}.xlsx`;
      const url = window.URL.createObjectURL(
        new Blob([res.data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setNotice(
        `Downloaded ${name}. These vouchers are now marked as exported.`,
      );
      await loadPreview();
    } catch (err) {
      let msg = "The Tally file could not be generated.";
      try {
        const text = await err.response?.data?.text?.();
        msg = JSON.parse(text).message || msg;
      } catch {}
      setError(msg);
    } finally {
      setDownloading(false);
    }
  };

  const s = data?.summary;

  return (
    <div style={S.page}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.header}>
          <div>
            <h1 style={S.title}>Tally Export</h1>
            <div style={S.sub}>{src.sub}</div>
          </div>
        </div>

        {/* Which list — each keeps its own preview and download */}
        <div style={S.sourceBar}>
          {Object.entries(SOURCES).map(([key, cfg]) => (
            <button
              key={key}
              style={{
                ...S.sourceBtn,
                ...(source === key ? S.sourceBtnOn : {}),
              }}
              onClick={() => {
                if (source === key) return;
                setSource(key);
                setData(null);
                setOpen({});
                setError("");
                setNotice("");
              }}
            >
              {cfg.label}
            </button>
          ))}
        </div>

        <div style={S.filters}>
          <label style={S.field}>
            <span style={S.label}>Branch *</span>
            <select
              style={S.input}
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setData(null);
              }}
            >
              <option value="">Select branch…</option>
              {branches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                  {b.code ? ` (${b.code})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label style={S.field}>
            <span style={S.label}>Approved from</span>
            <input
              type="date"
              style={S.input}
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label style={S.field}>
            <span style={S.label}>Approved to</span>
            <input
              type="date"
              style={S.input}
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label style={S.check}>
            <input
              type="checkbox"
              checked={includeExported}
              onChange={(e) => setIncludeExported(e.target.checked)}
            />
            Include already exported
          </label>
          <button
            style={S.btn}
            onClick={loadPreview}
            disabled={loading || !branch}
          >
            {loading ? "Loading…" : "Preview"}
          </button>
          <button
            style={{
              ...S.btnPrimary,
              opacity: !s?.vouchers || downloading ? 0.5 : 1,
            }}
            onClick={download}
            disabled={!s?.vouchers || downloading}
            title={!s?.vouchers ? "Preview first" : ""}
          >
            {downloading ? "Generating…" : "⬇ Download Tally Excel"}
          </button>
        </div>

        {error && <div style={S.error}>{error}</div>}
        {notice && <div style={S.notice}>{notice}</div>}

        {s && (
          <div style={S.stats}>
            <Stat label="Vouchers" value={s.vouchers} />
            {isDoctors ? (
              <>
                <Stat label="Referral" value={s.referral} />
                <Stat label="Surgeon" value={s.surgeon} />
                <Stat label="Amount" value={inr(s.amount)} />
              </>
            ) : (
              <>
                <Stat label="Journal" value={s.journal} />
                <Stat label="Purchase" value={s.purchase} />
                <Stat label="Debit Note" value={s.debitNote} />
              </>
            )}
            <Stat
              label="To check"
              value={s.withWarnings}
              tone={s.withWarnings ? "#b45309" : undefined}
            />
            {includeExported && (
              <Stat label="Already exported" value={s.alreadyExported} />
            )}
          </div>
        )}

        {isDoctors && data?.ledgers && (
          <div style={S.ledgerNote}>
            Expense ledgers used: <strong>{data.ledgers.referral}</strong>{" "}
            (referral) and <strong>{data.ledgers.surgeon}</strong> (surgeon).
            The doctor ledger is the doctor's name as in the Doctor Master.
            These must exist in the branch's Tally company.
          </div>
        )}

        {data && !data.vouchers.length && (
          <div style={S.empty}>
            Nothing to export for this branch and period
            {includeExported ? "." : " (already exported vouchers are hidden)."}
          </div>
        )}

        {data?.vouchers?.length > 0 && (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Voucher No.</th>
                  <th style={S.th}>Type</th>
                  <th style={S.th}>Date</th>
                  <th style={S.th}>{src.ref}</th>
                  <th style={S.th}>{src.party}</th>
                  <th style={S.th}>{isDoctors ? "For" : "GST"}</th>
                  <th style={S.thR}>Amount</th>
                  <th style={S.th}>Check</th>
                </tr>
              </thead>
              <tbody>
                {data.vouchers.map((v) => {
                  const isOpen = !!open[v.voucherNumber];
                  const t = TYPE_STYLE[v.voucherType] || {};
                  return (
                    <React.Fragment key={v.voucherNumber}>
                      <tr
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          setOpen((o) => ({
                            ...o,
                            [v.voucherNumber]: !o[v.voucherNumber],
                          }))
                        }
                      >
                        <td style={S.td}>
                          <span style={S.caret}>{isOpen ? "▾" : "▸"}</span>
                          <strong>{v.voucherNumber}</strong>
                          {v.exportedAt && (
                            <span style={S.exported}>exported</span>
                          )}
                        </td>
                        <td style={S.td}>
                          <span
                            style={{
                              ...S.pill,
                              background: t.bg,
                              color: t.color,
                            }}
                          >
                            {v.voucherType}
                          </span>
                        </td>
                        <td style={S.td}>{v.voucherDate}</td>
                        <td style={S.td}>
                          {v.refNumber}
                          <div style={S.muted}>{v.refDate}</div>
                        </td>
                        <td style={S.td}>{v.vendorName}</td>
                        <td style={S.td}>
                          {isDoctors
                            ? PAYOUT_TYPE[v.payoutType] || v.payoutType
                            : v.gstType === "CGST_SGST"
                              ? "CGST+SGST"
                              : "IGST"}
                        </td>
                        <td style={S.tdR}>{inr(v.drTotal)}</td>
                        <td style={S.td}>
                          {v.warnings.length ? (
                            <span style={S.warnPill}>
                              ⚠ {v.warnings.length}
                            </span>
                          ) : (
                            <span style={S.okPill}>OK</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} style={S.detail}>
                            {v.warnings.length > 0 && (
                              <ul style={S.warnList}>
                                {v.warnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            )}
                            <table style={S.inner}>
                              <thead>
                                <tr>
                                  <th style={S.ith}>Ledger</th>
                                  <th style={S.ithR}>Dr</th>
                                  <th style={S.ithR}>Cr</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.lines.map((l, i) => (
                                  <tr key={i}>
                                    <td style={S.itd}>{l.ledger || "—"}</td>
                                    <td style={S.itdR}>
                                      {l.side === "Dr" ? inr(l.amount) : ""}
                                    </td>
                                    <td style={S.itdR}>
                                      {l.side === "Cr" ? inr(l.amount) : ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div style={S.narr}>
                              <strong>Narration:</strong> {v.narration}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

const Stat = ({ label, value, tone }) => (
  <div style={S.stat}>
    <div style={S.statLabel}>{label}</div>
    <div style={{ ...S.statVal, color: tone || "#1a3c6e" }}>{value}</div>
  </div>
);

const S = {
  page: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", overflowX: "auto" },
  header: { marginBottom: 18 },
  title: { fontSize: 22, fontWeight: 700, color: "#1a3c6e", margin: 0 },
  sub: { fontSize: 13, color: "#64748b", marginTop: 4 },
  sourceBar: {
    display: "inline-flex",
    background: "#e2e8f0",
    borderRadius: 10,
    padding: 3,
    gap: 2,
    marginBottom: 14,
  },
  sourceBtn: {
    border: "none",
    background: "none",
    padding: "7px 16px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    cursor: "pointer",
  },
  sourceBtnOn: {
    background: "#fff",
    color: "#1a3c6e",
    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
  },
  ledgerNote: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e40af",
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 12.5,
    marginBottom: 12,
  },
  filters: {
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    flexWrap: "wrap",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: "#475569" },
  input: {
    padding: "8px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 13,
    minWidth: 160,
    fontFamily: "inherit",
  },
  check: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "#475569",
    paddingBottom: 9,
  },
  btn: {
    padding: "9px 16px",
    border: "1.5px solid #2563eb",
    background: "#fff",
    color: "#2563eb",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  btnPrimary: {
    padding: "9px 16px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  error: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    marginBottom: 12,
  },
  notice: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#166534",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    marginBottom: 12,
  },
  stats: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  stat: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "10px 16px",
    minWidth: 110,
  },
  statLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase" },
  statVal: { fontSize: 20, fontWeight: 700 },
  empty: {
    background: "#fff",
    border: "1px dashed #cbd5e1",
    borderRadius: 12,
    padding: 30,
    textAlign: "center",
    color: "#64748b",
    fontSize: 13,
  },
  tableWrap: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    overflow: "hidden",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 11,
    color: "#475569",
    textTransform: "uppercase",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },
  thR: {
    textAlign: "right",
    padding: "10px 12px",
    fontSize: 11,
    color: "#475569",
    textTransform: "uppercase",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #f1f5f9",
    color: "#334155",
    verticalAlign: "top",
  },
  tdR: {
    padding: "10px 12px",
    borderBottom: "1px solid #f1f5f9",
    textAlign: "right",
    fontWeight: 600,
    color: "#1a3c6e",
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
  caret: { color: "#94a3b8", marginRight: 6 },
  muted: { fontSize: 11, color: "#94a3b8" },
  pill: {
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 10,
  },
  exported: {
    marginLeft: 6,
    fontSize: 10,
    color: "#64748b",
    background: "#f1f5f9",
    padding: "1px 6px",
    borderRadius: 8,
  },
  warnPill: {
    fontSize: 11,
    fontWeight: 700,
    color: "#b45309",
    background: "#fffbeb",
    padding: "2px 8px",
    borderRadius: 10,
  },
  okPill: {
    fontSize: 11,
    fontWeight: 700,
    color: "#16a34a",
    background: "#f0fdf4",
    padding: "2px 8px",
    borderRadius: 10,
  },
  detail: {
    background: "#f8fafc",
    padding: "12px 20px 16px 36px",
    borderBottom: "1px solid #e2e8f0",
  },
  warnList: {
    margin: "0 0 10px",
    paddingLeft: 18,
    color: "#b45309",
    fontSize: 12,
  },
  inner: {
    borderCollapse: "collapse",
    fontSize: 12,
    minWidth: 480,
    background: "#fff",
    border: "1px solid #e2e8f0",
  },
  ith: {
    textAlign: "left",
    padding: "6px 10px",
    fontSize: 11,
    color: "#64748b",
    borderBottom: "1px solid #e2e8f0",
  },
  ithR: {
    textAlign: "right",
    padding: "6px 10px",
    fontSize: 11,
    color: "#64748b",
    borderBottom: "1px solid #e2e8f0",
    width: 110,
  },
  itd: { padding: "5px 10px", borderBottom: "1px solid #f1f5f9" },
  itdR: {
    padding: "5px 10px",
    borderBottom: "1px solid #f1f5f9",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  narr: { fontSize: 12, color: "#475569", marginTop: 10, lineHeight: 1.5 },
};
