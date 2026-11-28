// ============================================================
// FRONTEND: src/pages/Doctors.jsx — NEW FILE
// ------------------------------------------------------------
// Doctor Master — one record per PAN, with the bank account payments go
// to, the documents on file and the full PAYMENT HISTORY against that PAN.
//   Accounts, Super Admin         — add a doctor, import the doctor list,
//                                   complete the profile (details, bank,
//                                   documents), change status
//   Cluster / Dept Head, Director — view
// Doctors also arrive through the payout Excel upload (Doctor Payouts).
// PAN is never editable.
// ============================================================
import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { downloadExcel } from "../utils/exportExcel.js";
import {
  C,
  S,
  typeLabel,
  ROW_STATUS,
  DOCTOR_STATUS,
  Chip,
  Tag,
  Modal,
  Notice,
  Pager,
  DoctorNav,
  inr,
  fmtDate,
  fmtDateTime,
  maskAccount,
  saveBlob,
  readError,
  canEditDoctor,
} from "../components/doctorPayoutUi.jsx";

const PAGE_SIZE = 25;
const DOCTOR_TYPES = {
  referring: "Referring doctor",
  surgeon: "Surgeon",
  anaesthetist: "Anaesthetist",
  other: "Other",
};
// labels for "this import will fill …"
const FIELD_LABELS = {
  mobile: "Mobile",
  email: "Email",
  doctorType: "Doctor type",
  specialisation: "Specialisation",
  registrationNumber: "Registration no.",
  hospitalName: "Hospital / clinic",
  city: "City",
  address: "Address",
  accountNumber: "Account number",
  ifscCode: "IFSC",
  bankName: "Bank name",
  accountHolderName: "Name as per bank",
};

const CHIPS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "incomplete", label: "Profile incomplete" },
  { key: "unverified", label: "Unverified" },
  { key: "inactive", label: "Inactive" },
  { key: "blocked", label: "Blocked" },
];

export default function Doctors() {
  const { user } = useAuth();
  const editor = canEditDoctor(user);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, limit: PAGE_SIZE });
      if (status) p.set("status", status);
      if (search.trim()) p.set("search", search.trim());
      const { data } = await api.get(`/doctors?${p}`);
      setRows(data.doctors || []);
      setTotal(data.total || 0);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the doctors");
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const countOf = (k) =>
    k === ""
      ? (counts.active || 0) + (counts.inactive || 0) + (counts.blocked || 0)
      : counts[k] || 0;

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <DoctorNav active="doctors" />
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>👨‍⚕️ Doctor Master</h1>
            <p style={S.sub}>
              One record per PAN — profile, bank details, documents and payment
              history.
            </p>
          </div>
          {editor && (
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.btnGhost} onClick={() => setImporting(true)}>
                ⬆ Import doctor list
              </button>
              <button style={S.btn} onClick={() => setAdding(true)}>
                ＋ Add doctor
              </button>
            </div>
          )}
        </div>

        {error && (
          <Notice tone="error" onClose={() => setError("")}>
            {error}
          </Notice>
        )}
        {notice && (
          <Notice tone="ok" onClose={() => setNotice("")}>
            {notice}
          </Notice>
        )}

        <div style={S.filters}>
          <input
            style={{ ...S.input, flex: "1 1 260px", maxWidth: 380 }}
            placeholder="Search name, PAN, code, mobile, account number, clinic or city"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {CHIPS.map((c) => (
            <button
              key={c.key}
              style={{ ...DS.chip, ...(status === c.key ? DS.chipOn : {}) }}
              onClick={() => {
                setStatus(c.key);
                setPage(1);
              }}
            >
              {c.label} {countOf(c.key)}
            </button>
          ))}
        </div>

        <div style={S.card}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Doctor</th>
                  <th style={S.th}>PAN</th>
                  <th style={S.th}>Contact</th>
                  <th style={S.th}>Bank account</th>
                  <th style={{ ...S.th, ...S.thR }}>Paid</th>
                  <th style={{ ...S.th, ...S.thR }}>Outstanding</th>
                  <th style={S.th}>Last paid</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr
                    key={d._id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setOpenId(d._id)}
                  >
                    <td style={S.td}>
                      <div style={{ fontWeight: 600, color: C.accent }}>
                        {d.name}
                      </div>
                      <div style={S.small}>
                        <span style={S.id}>{d.doctorCode}</span>
                        {d.doctorType
                          ? ` · ${DOCTOR_TYPES[d.doctorType] || d.doctorType}`
                          : ""}
                        {d.city ? ` · ${d.city}` : ""}
                      </div>
                    </td>
                    <td style={{ ...S.td, ...S.mono }}>{d.panNumber}</td>
                    <td style={S.td}>
                      {d.mobile || <span style={{ color: C.faint }}>—</span>}
                      {d.email && <div style={S.small}>{d.email}</div>}
                    </td>
                    <td style={S.td}>
                      {d.accountNumber ? (
                        <>
                          <span style={S.mono}>
                            {maskAccount(d.accountNumber)}
                          </span>{" "}
                          · {d.bankName}
                          <div style={{ ...S.small, ...S.mono }}>
                            {d.ifscCode}
                          </div>
                        </>
                      ) : (
                        <Tag tone="amber">NOT ADDED</Tag>
                      )}
                    </td>
                    <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                      {inr(d.totals.paid)}
                    </td>
                    <td style={{ ...S.td, ...S.tdR }}>
                      {d.totals.outstanding ? inr(d.totals.outstanding) : "—"}
                    </td>
                    <td style={S.td}>{fmtDate(d.totals.lastPaidOn)}</td>
                    <td style={S.td}>
                      <Chip map={DOCTOR_STATUS} value={d.status} />
                      {!d.verifiedAt && (
                        <div style={{ marginTop: 3 }}>
                          <Tag
                            tone="amber"
                            title="No payout for this doctor has been approved yet"
                          >
                            UNVERIFIED
                          </Tag>
                        </div>
                      )}
                      {d.profile && !d.profile.complete && (
                        <div style={{ marginTop: 3 }}>
                          <Tag
                            tone="red"
                            title={`Missing: ${d.profile.missing.join(", ")}`}
                          >
                            PROFILE INCOMPLETE
                          </Tag>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={S.empty}>
                      {loading
                        ? "Loading…"
                        : search || status
                          ? "No doctors match."
                          : "No doctors yet. Import the doctor list, add one, or upload a payout Excel."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} limit={PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      </main>

      {openId && (
        <DoctorDetail
          id={openId}
          editor={editor}
          onClose={() => setOpenId(null)}
          onSaved={(msg) => {
            if (msg) setNotice(msg);
            load();
          }}
        />
      )}
      {adding && (
        <DoctorForm
          doctor={null}
          onClose={() => setAdding(false)}
          onSaved={(msg, doctor) => {
            setAdding(false);
            setNotice(`${msg}. Add the documents to complete the profile.`);
            load();
            if (doctor?._id) setOpenId(doctor._id); // straight to documents
          }}
        />
      )}
      {importing && (
        <ImportDoctors
          onClose={() => setImporting(false)}
          onDone={(msg) => {
            setImporting(false);
            setNotice(msg);
            setStatus("incomplete"); // what is left to complete
            setPage(1);
            load();
          }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// One doctor: details, bank, bank-change log, payment history
// ════════════════════════════════════════════════════════════
function DoctorDetail({ id, editor, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [showBank, setShowBank] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/doctors/${id}`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not open the doctor");
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const d = data?.doctor;

  const exportHistory = () =>
    downloadExcel({
      filename: `Doctor_Payments_${d.panNumber}`,
      sheets: [
        {
          name: "Payment history",
          title: `${d.name} — ${d.panNumber}`,
          meta: [["Generated", new Date().toLocaleString("en-GB")]],
          columns: [
            { header: "Record", key: "payoutId", width: 14 },
            { header: "Type", value: (r) => typeLabel(r.type), width: 16 },
            { header: "Branch", value: (r) => r.branch?.name, width: 20 },
            { header: "Date", key: "date", fmt: "date", width: 12 },
            { header: "Patient", key: "patientName", width: 24 },
            {
              header: "No of surgeries",
              key: "noOfSurgeries",
              fmt: "int",
              width: 14,
            },
            {
              header: "Settled",
              key: "settledAmount",
              fmt: "money",
              width: 14,
            },
            { header: "Basic", key: "basicAmount", fmt: "money", width: 14 },
            { header: "TDS", key: "tdsAmount", fmt: "money", width: 12 },
            {
              header: "Payable",
              key: "payableAmount",
              fmt: "money",
              width: 14,
            },
            {
              header: "Status",
              value: (r) => ROW_STATUS[r.status]?.label,
              width: 18,
            },
            { header: "Payment", key: "paymentRef", width: 13 },
            { header: "UTR", key: "utrNumber", width: 22 },
            {
              header: "Payment date",
              key: "paymentDate",
              fmt: "date",
              width: 13,
            },
            { header: "Upload", value: (r) => r.batch?.batchId, width: 11 },
          ],
          rows: data.payouts,
        },
      ],
    });

  return (
    <Modal
      title={d ? d.name : "Doctor"}
      sub={d ? `${d.doctorCode} · PAN ${d.panNumber}` : ""}
      onClose={onClose}
      width={1120}
      footer={
        <>
          {editor && d && (
            <button
              style={{ ...S.btn, marginRight: "auto" }}
              onClick={() => setEditing(true)}
            >
              ✎ Edit doctor
            </button>
          )}
          <button style={S.btnGhost} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <div style={S.empty}>Loading…</div>}

      {d && (
        <>
          {!data.profile.complete && (
            <Notice tone="warn">
              <strong>Profile incomplete.</strong> Still needed:{" "}
              {data.profile.missing.join(", ")}.
            </Notice>
          )}
          <div style={DS.grid}>
            <div style={DS.box}>
              <div style={DS.boxTitle}>Details</div>
              <Row k="Status">
                <Chip map={DOCTOR_STATUS} value={d.status} />{" "}
                {!d.verifiedAt && <Tag tone="amber">UNVERIFIED</Tag>}
                {d.status !== "active" && d.statusReason && (
                  <div style={S.small}>{d.statusReason}</div>
                )}
              </Row>
              <Row k="Type">{DOCTOR_TYPES[d.doctorType] || "—"}</Row>
              <Row k="Specialisation">{d.specialisation || "—"}</Row>
              <Row k="Registration no.">{d.registrationNumber || "—"}</Row>
              <Row k="Hospital / clinic">
                {[d.hospitalName, d.city].filter(Boolean).join(", ") || "—"}
              </Row>
              <Row k="Address">{d.address || "—"}</Row>
              <Row k="Mobile">{d.mobile || "—"}</Row>
              <Row k="Email">{d.email || "—"}</Row>
              <Row k="Added">
                {fmtDateTime(d.createdAt)}
                {d.createdBy?.name ? ` by ${d.createdBy.name}` : ""}
                {d.createdViaBatch?.batchId
                  ? ` · upload ${d.createdViaBatch.batchId}`
                  : d.createdVia === "list"
                    ? " · doctor list"
                    : ""}
              </Row>
              <Row k="Verified">
                {d.verifiedAt
                  ? `${fmtDateTime(d.verifiedAt)} by ${d.verifiedBy?.name || "—"}`
                  : "Not yet — no payout has been approved for this doctor"}
              </Row>
            </div>
            <div style={DS.box}>
              <div style={DS.boxTitle}>Bank account payments go to</div>
              {!d.accountNumber && (
                <div style={{ fontSize: 13, color: "#92400e" }}>
                  Not added yet. Add it with “Edit doctor”, or it is taken from
                  the first payout Excel for this PAN once that is approved. No
                  payment can be raised until then.
                </div>
              )}
              {d.accountNumber && (
                <>
                  <Row k="Account number">
                    <span style={S.mono}>
                      {showBank
                        ? d.accountNumber
                        : maskAccount(d.accountNumber)}
                    </span>{" "}
                    <button
                      style={S.link}
                      onClick={() => setShowBank((v) => !v)}
                    >
                      {showBank ? "hide" : "show"}
                    </button>
                  </Row>
                  <Row k="IFSC">
                    <span style={S.mono}>{d.ifscCode}</span>
                  </Row>
                  <Row k="Bank">{d.bankName}</Row>
                  <Row k="Name as per bank">{d.accountHolderName}</Row>
                </>
              )}
              {d.bankHistory?.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: C.accent,
                      fontWeight: 600,
                    }}
                  >
                    Bank details changed {d.bankHistory.length} time
                    {d.bankHistory.length === 1 ? "" : "s"}
                  </summary>
                  {[...d.bankHistory].reverse().map((h, i) => (
                    <div key={i} style={DS.hist}>
                      <div>
                        <strong>{fmtDateTime(h.replacedAt)}</strong> ·{" "}
                        {h.source === "upload"
                          ? `upload ${h.batch?.batchId || ""} — requested by ${h.requestedBy?.name || "—"}, approved by ${h.replacedBy?.name || "—"}`
                          : `edited by ${h.replacedBy?.name || "—"}`}
                      </div>
                      <div style={{ ...S.small, ...S.mono }}>
                        Previous: {h.bankName} · {h.accountNumber} ·{" "}
                        {h.ifscCode} · {h.accountHolderName}
                      </div>
                      {h.reason && <div style={S.small}>{h.reason}</div>}
                    </div>
                  ))}
                </details>
              )}
            </div>
          </div>

          <Documents
            doctorId={d._id}
            documents={d.documents || []}
            types={data.documentTypes || {}}
            required={data.requiredDocumentTypes || []}
            editor={editor}
            onChanged={() => {
              load();
              onSaved("");
            }}
          />

          {data.fyTotals.length > 0 && (
            <div style={{ ...DS.box, marginBottom: 14 }}>
              <div style={DS.boxTitle}>Totals by financial year</div>
              <table style={{ ...S.table, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={S.th}>Year</th>
                    <th style={{ ...S.th, ...S.thR }}>Records</th>
                    <th style={{ ...S.th, ...S.thR }}>Referral</th>
                    <th style={{ ...S.th, ...S.thR }}>Surgeon</th>
                    <th style={{ ...S.th, ...S.thR }}>Basic</th>
                    <th style={{ ...S.th, ...S.thR }}>TDS</th>
                    <th style={{ ...S.th, ...S.thR }}>Payable</th>
                    <th style={{ ...S.th, ...S.thR }}>Paid so far</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fyTotals.map((y) => (
                    <tr key={y.fy}>
                      <td style={{ ...S.td, fontWeight: 700 }}>FY {y.fy}</td>
                      <td style={{ ...S.td, ...S.tdR }}>{y.records}</td>
                      <td style={{ ...S.td, ...S.tdR }}>{inr(y.referral)}</td>
                      <td style={{ ...S.td, ...S.tdR }}>{inr(y.surgeon)}</td>
                      <td style={{ ...S.td, ...S.tdR }}>{inr(y.basic)}</td>
                      <td style={{ ...S.td, ...S.tdR }}>{inr(y.tds)}</td>
                      <td style={{ ...S.td, ...S.tdR }}>{inr(y.payable)}</td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(y.paid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div style={DS.boxTitle}>
              Payment history ({data.payoutCount})
              {data.scoped && (
                <span style={{ ...S.small, fontWeight: 400, marginLeft: 8 }}>
                  your branches only
                </span>
              )}
            </div>
            <button
              style={S.btnGhostSm}
              onClick={exportHistory}
              disabled={!data.payouts.length}
            >
              ⬇ Export
            </button>
          </div>
          {data.historyTruncated && (
            <Notice tone="info">
              Showing the latest {data.payouts.length} records.
            </Notice>
          )}
          <div
            style={{
              ...S.card,
              border: `1px solid ${C.line}`,
              boxShadow: "none",
            }}
          >
            <div style={S.tableWrap}>
              <table style={{ ...S.table, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={S.th}>Date</th>
                    <th style={S.th}>Type</th>
                    <th style={S.th}>Branch</th>
                    <th style={S.th}>Patient / surgeries</th>
                    <th style={{ ...S.th, ...S.thR }}>Basic</th>
                    <th style={{ ...S.th, ...S.thR }}>TDS</th>
                    <th style={{ ...S.th, ...S.thR }}>Payable</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Payment · UTR</th>
                    <th style={S.th}>Paid on</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.map((p) => (
                    <tr key={p._id}>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        {fmtDate(p.date)}
                        <div style={{ ...S.small, ...S.mono }}>
                          {p.payoutId}
                        </div>
                      </td>
                      <td style={S.td}>{typeLabel(p.type)}</td>
                      <td style={S.td}>{p.branch?.name}</td>
                      <td style={S.td}>
                        {p.type === "referral"
                          ? p.patientName
                          : `${p.noOfSurgeries} surgeries`}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {inr(p.basicAmount)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>{inr(p.tdsAmount)}</td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(p.payableAmount)}
                      </td>
                      <td style={S.td}>
                        <Chip map={ROW_STATUS} value={p.status} />
                        {p.status === "rejected" && p.rejectionReason && (
                          <div style={{ ...S.small, color: "#b91c1c" }}>
                            {p.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, ...S.mono }}>
                        {p.paymentRef || "—"}
                        {p.utrNumber && (
                          <div style={S.small}>{p.utrNumber}</div>
                        )}
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        {fmtDate(p.paymentDate)}
                      </td>
                    </tr>
                  ))}
                  {data.payouts.length === 0 && (
                    <tr>
                      <td colSpan={10} style={S.empty}>
                        No payout records yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {editing && d && (
        <DoctorForm
          doctor={d}
          onClose={() => setEditing(false)}
          onSaved={(msg) => {
            setEditing(false);
            load();
            onSaved(msg);
          }}
        />
      )}
    </Modal>
  );
}

const Row = ({ k, children }) => (
  <div style={{ display: "flex", gap: 10, padding: "4px 0", fontSize: 13 }}>
    <div style={{ width: 130, color: C.muted, flexShrink: 0 }}>{k}</div>
    <div style={{ color: C.ink, minWidth: 0 }}>{children}</div>
  </div>
);

// ── documents (PAN card, cancelled cheque, …) ─────────────
// Files are never linked by URL: "View" fetches the file with the user's
// login and opens it from memory.
function Documents({
  doctorId,
  documents,
  types,
  required,
  editor,
  onChanged,
}) {
  const [type, setType] = useState(
    () => required.find((t) => !documents.some((d) => d.type === t)) || "other",
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const missing = required.filter((t) => !documents.some((d) => d.type === t));

  const upload = async (file) => {
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      const fd = new FormData();
      fd.append("type", type);
      fd.append("file", file);
      await api.post(`/doctors/${doctorId}/documents`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || "Could not upload the document");
    } finally {
      setBusy("");
    }
  };

  const view = async (doc) => {
    // Opened now, while the click is still "live", so the browser does not
    // treat it as a pop-up; filled once the file has arrived.
    const tab = window.open("", "_blank");
    setBusy(doc._id);
    setError("");
    try {
      const res = await api.get(`/doctors/${doctorId}/documents/${doc._id}`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type: doc.mimeType || res.data.type,
      });
      if (tab) tab.location = window.URL.createObjectURL(blob);
      else saveBlob(blob, doc.name);
    } catch (err) {
      if (tab) tab.close();
      setError(await readError(err, "Could not open the document"));
    } finally {
      setBusy("");
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Remove "${doc.name}" from this doctor's profile?`))
      return;
    setBusy(doc._id);
    setError("");
    try {
      await api.delete(`/doctors/${doctorId}/documents/${doc._id}`);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || "Could not remove the document");
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={{ ...DS.box, marginBottom: 14 }}>
      <div
        style={{
          ...DS.boxTitle,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        Documents
        {missing.map((t) => (
          <Tag key={t} tone="red">
            {(types[t] || t).toUpperCase()} MISSING
          </Tag>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {documents.length === 0 && (
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>
          No documents uploaded yet.
        </div>
      )}
      {documents.map((doc) => (
        <div key={doc._id} style={DS.docRow}>
          <div style={{ minWidth: 0 }}>
            <strong>{types[doc.type] || doc.type}</strong>{" "}
            <span style={{ color: C.muted }}>· {doc.name}</span>
            <div style={S.small}>
              Uploaded {fmtDateTime(doc.uploadedAt)}
              {doc.uploadedBy?.name ? ` by ${doc.uploadedBy.name}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              style={S.btnGhostSm}
              disabled={!!busy}
              onClick={() => view(doc)}
            >
              {busy === doc._id ? "…" : "View"}
            </button>
            {editor && (
              <button
                style={{ ...S.btnGhostSm, color: "#dc2626" }}
                disabled={!!busy}
                onClick={() => remove(doc)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      {editor && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 10,
          }}
        >
          <select
            style={S.input}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {Object.entries(types).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            style={{ display: "none" }}
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            style={S.btnGhost}
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy === "upload" ? "Uploading…" : "⬆ Upload document"}
          </button>
          <span style={S.small}>PDF, JPG or PNG, up to 5 MB</span>
        </div>
      )}
    </div>
  );
}

// ── add / edit ────────────────────────────────────────────
// doctor = null → add a new doctor (PAN is typed once and then fixed).
function DoctorForm({ doctor, onClose, onSaved }) {
  const adding = !doctor;
  const [f, setF] = useState({
    name: doctor?.name || "",
    panNumber: doctor?.panNumber || "",
    doctorType: doctor?.doctorType || "",
    specialisation: doctor?.specialisation || "",
    registrationNumber: doctor?.registrationNumber || "",
    hospitalName: doctor?.hospitalName || "",
    city: doctor?.city || "",
    address: doctor?.address || "",
    mobile: doctor?.mobile || "",
    email: doctor?.email || "",
    status: doctor?.status || "active",
    accountNumber: doctor?.accountNumber || "",
    ifscCode: doctor?.ifscCode || "",
    bankName: doctor?.bankName || "",
    accountHolderName: doctor?.accountHolderName || "",
    reason: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const hadBank = Boolean(doctor?.accountNumber);
  const anyBank = [
    f.accountNumber,
    f.ifscCode,
    f.bankName,
    f.accountHolderName,
  ].some((v) => v.trim());
  const bankChanged =
    f.accountNumber.trim() !== (doctor?.accountNumber || "") ||
    f.ifscCode.trim().toUpperCase() !== (doctor?.ifscCode || "") ||
    f.bankName.trim() !== (doctor?.bankName || "") ||
    f.accountHolderName.trim() !== (doctor?.accountHolderName || "");
  const statusChanged = !adding && f.status !== doctor.status;
  // A reason is needed to CHANGE an account or the status — not to add
  // bank details for the first time.
  const needReason = statusChanged || (bankChanged && hadBank);
  const blocked = saving || (needReason && f.reason.trim().length < 3);

  const save = async () => {
    setSaving(true);
    setError("");
    const bank = {
      accountNumber: f.accountNumber,
      ifscCode: f.ifscCode,
      bankName: f.bankName,
      accountHolderName: f.accountHolderName,
    };
    const profile = {
      name: f.name,
      doctorType: f.doctorType,
      specialisation: f.specialisation,
      registrationNumber: f.registrationNumber,
      hospitalName: f.hospitalName,
      city: f.city,
      address: f.address,
      mobile: f.mobile,
      email: f.email,
    };
    try {
      if (adding) {
        const { data } = await api.post("/doctors", {
          ...profile,
          panNumber: f.panNumber,
          ...(anyBank ? { bank } : {}),
        });
        onSaved(data.message, data.doctor);
      } else {
        const { data } = await api.put(`/doctors/${doctor._id}`, {
          ...profile,
          status: f.status,
          reason: f.reason,
          ...(bankChanged && anyBank ? { bank } : {}),
        });
        onSaved(
          data.openPayments
            ? `${data.message}. ${data.openPayments} payment${data.openPayments === 1 ? "" : "s"} already raised still point${data.openPayments === 1 ? "s" : ""} at the old account — cancel and raise ${data.openPayments === 1 ? "it" : "them"} again.`
            : data.message,
          data.doctor,
        );
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not save");
      setSaving(false);
    }
  };

  return (
    <Modal
      title={adding ? "Add doctor" : `Edit ${doctor.name}`}
      sub={
        adding
          ? "Name and PAN are compulsory. The rest can be completed later; documents are added on the doctor's page."
          : `PAN ${doctor.panNumber} cannot be changed`
      }
      onClose={onClose}
      width={680}
      footer={
        <>
          <button style={S.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...S.btnTeal, ...(blocked ? S.disabled : {}) }}
            disabled={blocked}
            onClick={save}
          >
            {saving ? "Saving…" : adding ? "Add doctor" : "Save"}
          </button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <div style={DS.formGrid}>
        <div>
          <label style={S.label}>Doctor name *</label>
          <input
            style={S.field}
            value={f.name}
            onChange={set("name")}
            autoFocus={adding}
          />
        </div>
        <div>
          <label style={S.label}>PAN *</label>
          <input
            style={{
              ...S.field,
              ...S.mono,
              textTransform: "uppercase",
              ...(adding ? {} : { background: "#f1f5f9", color: C.muted }),
            }}
            value={f.panNumber}
            onChange={set("panNumber")}
            disabled={!adding}
            maxLength={10}
            placeholder="ABCDE1234F"
          />
        </div>
        <div>
          <label style={S.label}>Doctor type</label>
          <select
            style={S.field}
            value={f.doctorType}
            onChange={set("doctorType")}
          >
            <option value="">—</option>
            {Object.entries(DOCTOR_TYPES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={S.label}>Specialisation</label>
          <input
            style={S.field}
            value={f.specialisation}
            onChange={set("specialisation")}
          />
        </div>
        <div>
          <label style={S.label}>Medical registration no.</label>
          <input
            style={S.field}
            value={f.registrationNumber}
            onChange={set("registrationNumber")}
          />
        </div>
        <div>
          <label style={S.label}>Hospital / clinic</label>
          <input
            style={S.field}
            value={f.hospitalName}
            onChange={set("hospitalName")}
          />
        </div>
        <div>
          <label style={S.label}>City</label>
          <input style={S.field} value={f.city} onChange={set("city")} />
        </div>
        <div>
          <label style={S.label}>Address</label>
          <input style={S.field} value={f.address} onChange={set("address")} />
        </div>
        <div>
          <label style={S.label}>Mobile</label>
          <input style={S.field} value={f.mobile} onChange={set("mobile")} />
        </div>
        <div>
          <label style={S.label}>Email</label>
          <input style={S.field} value={f.email} onChange={set("email")} />
        </div>
        {!adding && (
          <>
            <div>
              <label style={S.label}>Status</label>
              <select style={S.field} value={f.status} onChange={set("status")}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blocked">Blocked — do not pay</option>
              </select>
            </div>
            <div />
          </>
        )}
        <div style={{ gridColumn: "1 / -1", ...DS.boxTitle, marginTop: 4 }}>
          Bank account{" "}
          <span style={{ ...S.small, fontWeight: 400 }}>
            {hadBank ? "" : "— all four, or leave blank for now"}
          </span>
        </div>
        <div>
          <label style={S.label}>Account number</label>
          <input
            style={{ ...S.field, ...S.mono }}
            value={f.accountNumber}
            onChange={set("accountNumber")}
          />
        </div>
        <div>
          <label style={S.label}>IFSC</label>
          <input
            style={{ ...S.field, ...S.mono, textTransform: "uppercase" }}
            value={f.ifscCode}
            onChange={set("ifscCode")}
          />
        </div>
        <div>
          <label style={S.label}>Bank name</label>
          <input
            style={S.field}
            value={f.bankName}
            onChange={set("bankName")}
          />
        </div>
        <div>
          <label style={S.label}>Name as per bank</label>
          <input
            style={S.field}
            value={f.accountHolderName}
            onChange={set("accountHolderName")}
          />
        </div>
        {needReason && (
          <div style={{ gridColumn: "1 / -1" }}>
            {bankChanged && hadBank && (
              <Notice tone="warn">
                You are changing the account this doctor is paid into. The old
                details are kept in the change log with your name.
              </Notice>
            )}
            <label style={S.label}>
              Reason for the {bankChanged && hadBank ? "bank detail" : "status"}{" "}
              change (required)
            </label>
            <input style={S.field} value={f.reason} onChange={set("reason")} />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── import the doctor list ────────────────────────────────
const ACTION = {
  create: { label: "NEW", tone: "green" },
  update: { label: "FILL BLANKS", tone: "blue" },
  none: { label: "NO CHANGE", tone: "grey" },
  error: { label: "ERROR", tone: "red" },
};

function ImportDoctors({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [only, setOnly] = useState("");
  const inputRef = useRef(null);

  const send = async (f, dryRun) => {
    const fd = new FormData();
    fd.append("file", f);
    return api.post(`/doctors/import${dryRun ? "?dryRun=1" : ""}`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  };

  const pick = async (f) => {
    if (!f) return;
    setFile(f);
    setReport(null);
    setBusy("check");
    setError("");
    try {
      const { data } = await send(f, true);
      setReport(data);
      setOnly("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not read the list");
    } finally {
      setBusy("");
    }
  };

  const run = async () => {
    setBusy("import");
    setError("");
    try {
      const { data } = await send(file, false);
      onDone(data.message);
    } catch (err) {
      if (err.response?.data?.report) setReport(err.response.data.report);
      setError(err.response?.data?.message || "Could not import the list");
      setBusy("");
    }
  };

  const template = async () => {
    try {
      const res = await api.get("/doctors/import/template", {
        responseType: "blob",
      });
      saveBlob(res.data, "Doctor_List_Template.xlsx");
    } catch (err) {
      setError(await readError(err, "Could not download the template"));
    }
  };

  const sum = report?.summary;
  const todo = sum ? sum.create + sum.update : 0;
  const rows = (report?.rows || []).filter((r) => !only || r.action === only);

  return (
    <Modal
      title="Import doctor list"
      sub="Adds new PANs to the Doctor Master and fills blank details of doctors already there. Nothing stored is overwritten."
      onClose={busy === "import" ? undefined : onClose}
      width={report ? 1040 : 600}
      footer={
        <>
          <button style={{ ...S.link, marginRight: "auto" }} onClick={template}>
            ⬇ Doctor list template
          </button>
          <button
            style={S.btnGhost}
            onClick={onClose}
            disabled={busy === "import"}
          >
            Cancel
          </button>
          {report && (
            <button
              style={S.btnGhost}
              disabled={!!busy}
              onClick={() => inputRef.current?.click()}
            >
              Choose another file
            </button>
          )}
          {report && (
            <button
              style={{
                ...S.btnTeal,
                ...(report.canImport && !busy ? {} : S.disabled),
              }}
              disabled={!report.canImport || !!busy}
              onClick={run}
            >
              {busy === "import"
                ? "Importing…"
                : `Import ${todo} doctor${todo === 1 ? "" : "s"}`}
            </button>
          )}
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        style={{ display: "none" }}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <Notice tone="error">{error}</Notice>}

      {!report && (
        <div style={DS.drop}>
          <div style={{ fontSize: 32 }}>📋</div>
          <div style={{ fontWeight: 600, color: C.ink, margin: "8px 0" }}>
            {busy === "check" ? "Reading the list…" : "Excel list of doctors"}
          </div>
          {busy !== "check" && (
            <button style={S.btn} onClick={() => inputRef.current?.click()}>
              Choose file (.xlsx)
            </button>
          )}
          <div
            style={{
              fontSize: 12,
              color: C.muted,
              marginTop: 12,
              lineHeight: 1.6,
            }}
          >
            Name of Doctor and Pan Number are compulsory. Bank details, contact
            and the other columns can be blank and completed afterwards, along
            with the documents.
          </div>
        </div>
      )}

      {report && (
        <>
          {report.fileErrors.map((e, i) => (
            <Notice key={i} tone="error">
              {e}
            </Notice>
          ))}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            {[
              ["", `All ${sum.rows}`],
              ["create", `New ${sum.create}`],
              ["update", `Fill blanks ${sum.update}`],
              ["none", `No change ${sum.unchanged}`],
              ["error", `Errors ${sum.errors}`],
            ].map(([k, label]) => (
              <button
                key={k}
                style={{ ...DS.chip, ...(only === k ? DS.chipOn : {}) }}
                onClick={() => setOnly(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {sum.errors > 0 && todo > 0 && (
            <Notice tone="warn">
              {sum.errors} row{sum.errors === 1 ? "" : "s"} with errors will be
              skipped. Correct
              {sum.errors === 1 ? " it" : " them"} in the Excel and import the
              file again — doctors already imported are not duplicated.
            </Notice>
          )}
          <div
            style={{
              ...S.card,
              border: `1px solid ${C.line}`,
              boxShadow: "none",
            }}
          >
            <div style={S.tableWrap}>
              <table style={{ ...S.table, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={S.th}>Row</th>
                    <th style={S.th}>Doctor</th>
                    <th style={S.th}>PAN</th>
                    <th style={S.th}>Bank account</th>
                    <th style={S.th}>Result</th>
                    <th style={S.th}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map((r) => (
                    <tr
                      key={r.rowNumber}
                      style={
                        r.action === "error" ? { background: "#fef2f2" } : {}
                      }
                    >
                      <td style={{ ...S.td, color: C.muted }}>{r.rowNumber}</td>
                      <td style={S.td}>
                        {r.values.name || (
                          <span style={{ color: C.faint }}>—</span>
                        )}
                        <div style={S.small}>
                          {[
                            DOCTOR_TYPES[r.values.doctorType],
                            r.values.hospitalName,
                            r.values.city,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td style={{ ...S.td, ...S.mono }}>
                        {r.values.panNumber || "—"}
                      </td>
                      <td style={{ ...S.td, ...S.mono }}>
                        {r.values.accountNumber ? (
                          <>
                            {r.values.accountNumber}
                            <div style={S.small}>
                              {r.values.ifscCode} · {r.values.bankName}
                            </div>
                          </>
                        ) : (
                          <span style={{ color: C.faint }}>not given</span>
                        )}
                      </td>
                      <td style={S.td}>
                        <Tag tone={ACTION[r.action].tone}>
                          {ACTION[r.action].label}
                        </Tag>
                        {r.doctor && (
                          <div style={{ ...S.small, ...S.id }}>
                            {r.doctor.doctorCode}
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, maxWidth: 380 }}>
                        {r.action === "update" && (
                          <div style={{ fontSize: 12 }}>
                            Will fill:{" "}
                            {Object.keys(r.fills)
                              .map((k) => FIELD_LABELS[k] || k)
                              .join(", ")}
                          </div>
                        )}
                        {r.errors.map((e, i) => (
                          <div
                            key={`e${i}`}
                            style={{ fontSize: 11.5, color: "#b91c1c" }}
                          >
                            ✕ {e}
                          </div>
                        ))}
                        {r.notes.map((w, i) => (
                          <div
                            key={`n${i}`}
                            style={{ fontSize: 11.5, color: "#92400e" }}
                          >
                            ⚠ {w}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} style={S.empty}>
                        No rows in this view
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {rows.length > 500 && (
              <div style={{ ...S.small, padding: 10, textAlign: "center" }}>
                First 500 of {rows.length} rows shown.
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

const DS = {
  chip: {
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    cursor: "pointer",
  },
  chipOn: {
    background: C.primary,
    color: "#fff",
    border: `1px solid ${C.primary}`,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 14,
    marginBottom: 14,
  },
  box: {
    border: `1px solid ${C.line}`,
    borderRadius: 10,
    padding: "12px 14px",
  },
  boxTitle: { fontWeight: 700, color: C.ink, fontSize: 13.5, marginBottom: 6 },
  hist: {
    borderTop: `1px solid ${C.line}`,
    padding: "6px 0",
    fontSize: 12.5,
    color: "#475569",
    marginTop: 6,
  },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" },
  docRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "7px 0",
    borderTop: `1px solid ${C.line}`,
    fontSize: 13,
  },
  drop: {
    border: "2px dashed #cbd5e1",
    borderRadius: 12,
    padding: "30px 24px",
    textAlign: "center",
    background: "#f8fafc",
  },
};
