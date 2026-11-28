// ============================================================
// FRONTEND: src/pages/DoctorPayouts.jsx — NEW FILE
// ------------------------------------------------------------
// Doctor Referral + Surgeon payouts: upload and approval.
//   Accounts            — download template, upload Excel, preview
//                         (new doctors / bank mismatches / errors /
//                         duplicates highlighted), submit, withdraw
//   Cluster / Dept Head — open an upload, approve or reject its records
//   Super Admin, Director — read only
// The payment side (raise, bank file, UTR) is pages/DoctorPayments.jsx.
// ============================================================
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { roleLabel } from "../utils/roleLabel.js";
import {
  C,
  S,
  TYPES,
  typeLabel,
  ROW_STATUS,
  BATCH_STATUS,
  Chip,
  Tag,
  Modal,
  Notice,
  Pager,
  DoctorNav,
  inr,
  fmtDate,
  fmtDateTime,
  saveBlob,
  readError,
  canUpload,
  canApprove,
} from "../components/doctorPayoutUi.jsx";

const PAGE_SIZE = 20;
const PREVIEW_CHUNK = 150; // preview rows rendered at a time

const bankLine = (b) =>
  b
    ? `${b.bankName || "—"} · ${b.accountNumber || "—"} · ${b.ifscCode || "—"}`
    : "—";

// ════════════════════════════════════════════════════════════
// Upload + preview
// ════════════════════════════════════════════════════════════
const ROW_FILTERS = [
  { key: "all", label: "All" },
  { key: "errors", label: "Errors", test: (r) => r.errors.length > 0 },
  { key: "new", label: "New doctors", test: (r) => r.flags.newDoctor },
  {
    key: "bank",
    label: "Bank mismatch",
    test: (r) => r.flags.bankMismatch && r.flags.bankMismatch !== "missing",
  },
  { key: "dup", label: "Duplicates", test: (r) => r.flags.duplicate },
  { key: "warn", label: "Warnings", test: (r) => r.warnings.length > 0 },
];

// Background of a preview row: the most serious thing about it wins.
const rowTone = (r) => {
  if (r.errors.length)
    return { background: "#fef2f2", boxShadow: "inset 3px 0 0 #dc2626" };
  if (r.flags.bankMismatch === "critical")
    return { background: "#fffbeb", boxShadow: "inset 3px 0 0 #d97706" };
  if (r.flags.duplicate)
    return { background: "#faf5ff", boxShadow: "inset 3px 0 0 #7c3aed" };
  if (r.flags.newDoctor)
    return { background: "#f0fdf4", boxShadow: "inset 3px 0 0 #16a34a" };
  return {};
};

function UploadModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [decisions, setDecisions] = useState({
    bank: {},
    allowDuplicates: false,
  });
  const [busy, setBusy] = useState(""); // "", "preview", "submit"
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [type, setType] = useState("");
  const [shown, setShown] = useState(PREVIEW_CHUNK);
  const [showNew, setShowNew] = useState(false);
  const inputRef = useRef(null);
  const seq = useRef(0);

  const runPreview = useCallback(async (f, d) => {
    const mine = ++seq.current;
    setBusy("preview");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("decisions", JSON.stringify(d));
      const { data } = await api.post("/doctor-payouts/preview", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (mine !== seq.current) return; // a newer request superseded this one
      setPreview(data);
      const withRows = data.sheets.filter((s) =>
        data.rows.some((r) => r.type === s.type),
      );
      setType((t) =>
        withRows.some((s) => s.type === t) ? t : withRows[0]?.type || "",
      );
    } catch (err) {
      if (mine !== seq.current) return;
      setPreview(null);
      setError(err.response?.data?.message || "Could not read the file");
    } finally {
      if (mine === seq.current) setBusy("");
    }
  }, []);

  const pick = (f) => {
    if (!f) return;
    const fresh = { bank: {}, allowDuplicates: false };
    setFile(f);
    setDecisions(fresh);
    setFilter("all");
    setShown(PREVIEW_CHUNK);
    setPreview(null);
    runPreview(f, fresh);
  };

  // A decision changes what blocks the submit, so the server re-checks.
  const decide = (next) => {
    setDecisions(next);
    if (file) runPreview(file, next);
  };

  const submit = async () => {
    if (!file || !preview?.canSubmit) return;
    setBusy("submit");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("decisions", JSON.stringify(decisions));
      fd.append("fileHash", preview.fileHash);
      const { data } = await api.post("/doctor-payouts/batches", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onDone(data.message);
    } catch (err) {
      const data = err.response?.data;
      if (data?.preview) setPreview(data.preview); // state changed since the preview
      setError(data?.message || "Could not submit the file");
    } finally {
      setBusy("");
    }
  };

  const rowsOfType = useMemo(
    () => (preview?.rows || []).filter((r) => !type || r.type === type),
    [preview, type],
  );
  const counts = useMemo(() => {
    const out = {};
    ROW_FILTERS.forEach((f) => {
      out[f.key] = f.test
        ? rowsOfType.filter(f.test).length
        : rowsOfType.length;
    });
    return out;
  }, [rowsOfType]);
  const visible = useMemo(() => {
    const f = ROW_FILTERS.find((x) => x.key === filter);
    return f?.test ? rowsOfType.filter(f.test) : rowsOfType;
  }, [rowsOfType, filter]);

  // Tabs show the rows that will actually be submitted (a totals line the
  // server skipped is not counted), and only sheets that have any.
  const sheetTabs = useMemo(
    () =>
      (preview?.sheets || [])
        .map((s) => ({
          ...s,
          count: (preview.rows || []).filter((r) => r.type === s.type).length,
        }))
        .filter((s) => s.count > 0),
    [preview],
  );

  const sum = preview?.summary;
  // "missing" = the master has no bank details yet (doctor came from the
  // doctor list): nothing to choose, the Excel's details are proposed.
  const mismatches = (preview?.doctors || []).filter(
    (d) => d.mismatch && d.mismatch.severity !== "missing",
  );
  const bankAdds = (preview?.doctors || []).filter(
    (d) => d.mismatch?.severity === "missing",
  );
  const newDoctors = (preview?.doctors || []).filter((d) => d.isNew);
  const isRef = type === "referral";

  // one preview cell: the value, or what was typed (in red) if it failed
  const cell = (r, field, render) => {
    const bad = r.errors.find((e) => e.field === field);
    const v = r.values[field];
    if (bad)
      return (
        <span title={bad.message} style={PS.badCell}>
          {r.raw?.[field] || "blank"}
        </span>
      );
    if (v === undefined || v === null || v === "")
      return <span style={{ color: C.faint }}>—</span>;
    return render ? render(v) : v;
  };

  return (
    <Modal
      title="Upload doctor payouts"
      sub="Excel with the “Dr Ref” and / or “Dr Sur And Anesthetic” sheet. Nothing is saved until you submit."
      onClose={busy === "submit" ? undefined : onClose}
      width={preview ? 1240 : 620}
      footer={
        <>
          {preview && (
            <span
              style={{ marginRight: "auto", fontSize: 12.5, color: C.muted }}
            >
              {busy === "preview" ? "Re-checking…" : file?.name}
            </span>
          )}
          <button
            style={S.btnGhost}
            onClick={onClose}
            disabled={busy === "submit"}
          >
            Cancel
          </button>
          {preview && (
            <button
              style={S.btnGhost}
              onClick={() => inputRef.current?.click()}
              disabled={!!busy}
            >
              Choose another file
            </button>
          )}
          {preview && (
            <button
              style={{
                ...S.btnTeal,
                ...(!preview.canSubmit || busy ? S.disabled : {}),
              }}
              disabled={!preview.canSubmit || !!busy}
              onClick={submit}
            >
              {busy === "submit"
                ? "Submitting…"
                : `Submit ${sum.rows} record${sum.rows === 1 ? "" : "s"} for approval`}
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

      {error && (
        <Notice tone="error" onClose={() => setError("")}>
          {error}
        </Notice>
      )}

      {!preview && (
        <div
          style={PS.drop}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          <div style={{ fontSize: 34 }}>📄</div>
          <div style={{ fontWeight: 600, color: C.ink, margin: "8px 0 4px" }}>
            {busy === "preview"
              ? "Reading the file…"
              : "Drop the Excel here, or"}
          </div>
          {busy !== "preview" && (
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
            PAN and bank details are compulsory on every row. A PAN not yet in
            the Doctor Master creates a new doctor; an existing PAN is checked
            against the stored bank details.
          </div>
        </div>
      )}

      {preview && (
        <>
          {/* ── summary ── */}
          <div style={PS.tiles}>
            <Tile label="Records" value={sum.rows} />
            <Tile label="Total payable" value={inr(sum.totals.payable)} />
            <Tile label="TDS" value={inr(sum.totals.tds)} />
            <Tile
              label="New doctors"
              value={sum.newDoctors}
              tone={sum.newDoctors ? "#16a34a" : null}
            />
            <Tile
              label="Bank mismatches"
              value={sum.bankMismatches}
              tone={sum.bankMismatches ? "#d97706" : null}
            />
            <Tile
              label="Rows with errors"
              value={sum.errorRows}
              tone={sum.errorRows ? "#dc2626" : null}
            />
            <Tile
              label="Possible duplicates"
              value={sum.duplicateRows}
              tone={sum.duplicateRows ? "#7c3aed" : null}
            />
          </div>

          {preview.blockers.length > 0 ? (
            <Notice tone="error">
              <strong>This file cannot be submitted yet:</strong>
              <ul style={PS.ul}>
                {preview.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </Notice>
          ) : (
            <Notice tone="ok">
              No errors. Check the highlighted rows below, then submit — the
              records go to the Cluster / Department Head of each branch for
              approval.
            </Notice>
          )}

          {preview.fileWarnings.length > 0 && (
            <Notice tone="warn">
              <ul style={{ ...PS.ul, marginTop: 0 }}>
                {preview.fileWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}

          {/* ── bank mismatches: stored vs sheet, and the choice ── */}
          {mismatches.length > 0 && (
            <div style={PS.panel}>
              <div style={PS.panelTitle}>
                Bank details differ from the Doctor Master ({mismatches.length})
              </div>
              {mismatches.map((d) => {
                const choice = decisions.bank[d.panNumber] || d.decision || "";
                const set = (v) =>
                  decide({
                    ...decisions,
                    bank: { ...decisions.bank, [d.panNumber]: v },
                  });
                return (
                  <div key={d.panNumber} style={PS.mismatch}>
                    <div style={{ flex: "1 1 420px", minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: C.ink }}>
                        {d.storedName || d.name}{" "}
                        <span
                          style={{ ...S.mono, color: C.muted, fontWeight: 500 }}
                        >
                          {d.panNumber}
                        </span>{" "}
                        <Tag
                          tone={
                            d.mismatch.severity === "critical" ? "red" : "amber"
                          }
                        >
                          {d.mismatch.severity === "critical"
                            ? "ACCOUNT / IFSC DIFFERENT"
                            : "ONLY THE NAME IS TYPED DIFFERENTLY"}
                        </Tag>
                      </div>
                      <table style={PS.diff}>
                        <thead>
                          <tr>
                            <th style={PS.diffTh} />
                            <th style={PS.diffTh}>In Doctor Master</th>
                            <th style={PS.diffTh}>In this Excel</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.mismatch.fields.map((f) => (
                            <tr key={f.field}>
                              <td style={PS.diffTd}>{f.label}</td>
                              <td style={{ ...PS.diffTd, ...S.mono }}>
                                {f.stored || "—"}
                              </td>
                              <td
                                style={{
                                  ...PS.diffTd,
                                  ...S.mono,
                                  color: "#b91c1c",
                                  fontWeight: 700,
                                }}
                              >
                                {f.sheet || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ flex: "0 1 330px" }}>
                      <label style={PS.radio}>
                        <input
                          type="radio"
                          name={`bank_${d.panNumber}`}
                          checked={choice === "keep"}
                          onChange={() => set("keep")}
                        />
                        <span>
                          <strong>Keep the Doctor Master details</strong>
                          <br />
                          <span style={S.small}>
                            Pay to the stored account; the Excel values are
                            ignored.
                          </span>
                        </span>
                      </label>
                      <label style={PS.radio}>
                        <input
                          type="radio"
                          name={`bank_${d.panNumber}`}
                          checked={choice === "update"}
                          onChange={() => set("update")}
                        />
                        <span>
                          <strong>
                            Update the Doctor Master to this Excel
                          </strong>
                          <br />
                          <span style={S.small}>
                            Shown to the approver as a bank change; takes effect
                            when approved.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {bankAdds.length > 0 && (
            <Notice tone="info">
              <strong>
                {bankAdds.length} doctor
                {bankAdds.length === 1 ? " has" : "s have"} no bank details in
                the Doctor Master yet
              </strong>{" "}
              — {bankAdds.map((d) => d.storedName || d.name).join(", ")}. The
              bank details in this Excel will be added to the master when the
              records are approved.
            </Notice>
          )}

          {/* ── new doctors ── */}
          {newDoctors.length > 0 && (
            <div style={PS.panel}>
              <div
                style={{
                  ...PS.panelTitle,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  <Tag tone="green">NEW</Tag>
                  {newDoctors.length} doctor{newDoctors.length === 1 ? "" : "s"}{" "}
                  will be added to the Doctor Master
                </span>
                <button style={S.link} onClick={() => setShowNew((v) => !v)}>
                  {showNew ? "Hide" : "Show details"}
                </button>
              </div>
              {showNew && (
                <div style={S.tableWrap}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        {[
                          "Doctor",
                          "PAN",
                          "Account number",
                          "IFSC",
                          "Bank",
                          "Name as per bank",
                          "Rows",
                        ].map((h) => (
                          <th key={h} style={S.th}>
                            {h}
                          </th>
                        ))}
                        <th style={{ ...S.th, ...S.thR }}>Payable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newDoctors.map((d) => (
                        <tr key={d.panNumber}>
                          <td style={S.td}>{d.name}</td>
                          <td style={{ ...S.td, ...S.mono }}>{d.panNumber}</td>
                          <td style={{ ...S.td, ...S.mono }}>
                            {d.sheetBank?.accountNumber || "—"}
                          </td>
                          <td style={{ ...S.td, ...S.mono }}>
                            {d.sheetBank?.ifscCode || "—"}
                          </td>
                          <td style={S.td}>{d.sheetBank?.bankName || "—"}</td>
                          <td style={S.td}>
                            {d.sheetBank?.accountHolderName || "—"}
                          </td>
                          <td style={S.td}>{d.rows}</td>
                          <td style={{ ...S.td, ...S.tdR }}>
                            {inr(d.payable)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── duplicates must be confirmed ── */}
          {sum.duplicateRows > 0 && (
            <label style={{ ...PS.radio, ...PS.dupBox }}>
              <input
                type="checkbox"
                checked={decisions.allowDuplicates}
                onChange={(e) =>
                  decide({ ...decisions, allowDuplicates: e.target.checked })
                }
              />
              <span>
                <strong>
                  I have checked the {sum.duplicateRows} possible duplicate
                  {sum.duplicateRows === 1 ? "" : "s"} and they are separate,
                  genuine payouts.
                </strong>
                <br />
                <span style={S.small}>
                  A duplicate is the same doctor, branch, date and patient (or
                  surgery count and amount) appearing twice — in this file or in
                  an earlier upload. They will be marked for the approver.
                </span>
              </span>
            </label>
          )}

          {/* ── rows ── */}
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
              margin: "14px 0 10px",
            }}
          >
            {sheetTabs.length > 1 && (
              <div style={S.seg}>
                {sheetTabs.map((s) => (
                  <button
                    key={s.type}
                    style={{
                      ...S.segBtn,
                      ...(type === s.type ? S.segActive : {}),
                    }}
                    onClick={() => {
                      setType(s.type);
                      setFilter("all");
                      setShown(PREVIEW_CHUNK);
                    }}
                  >
                    {typeLabel(s.type)} ({s.count})
                  </button>
                ))}
              </div>
            )}
            {ROW_FILTERS.filter(
              (f) => f.key === "all" || counts[f.key] > 0,
            ).map((f) => (
              <button
                key={f.key}
                style={{ ...PS.chip, ...(filter === f.key ? PS.chipOn : {}) }}
                onClick={() => {
                  setFilter(f.key);
                  setShown(PREVIEW_CHUNK);
                }}
              >
                {f.label} {counts[f.key]}
              </button>
            ))}
          </div>

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
                    <th style={S.th}>Branch</th>
                    <th style={S.th}>Date</th>
                    <th style={S.th}>Doctor</th>
                    <th style={S.th}>{isRef ? "Patient" : "Surgeries"}</th>
                    <th style={{ ...S.th, ...S.thR }}>Settled</th>
                    <th style={{ ...S.th, ...S.thR }}>Basic</th>
                    <th style={{ ...S.th, ...S.thR }}>TDS</th>
                    <th style={{ ...S.th, ...S.thR }}>Payable</th>
                    <th style={S.th}>Bank account</th>
                    <th style={S.th}>What to check</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, shown).map((r) => (
                    <tr key={r.key} style={rowTone(r)}>
                      <td style={{ ...S.td, color: C.muted }}>{r.rowNumber}</td>
                      <td style={S.td}>
                        {r.errors.some((e) => e.field === "branch") ? (
                          <span style={PS.badCell}>
                            {r.values.branchRaw || "blank"}
                          </span>
                        ) : (
                          r.values.branchName
                        )}
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        {cell(r, "date", fmtDate)}
                      </td>
                      <td style={S.td}>
                        {cell(r, "doctorName")}
                        <div style={{ ...S.small, ...S.id }}>
                          {cell(r, "panNumber")}
                          {r.doctor ? ` · ${r.doctor.doctorCode}` : ""}
                        </div>
                      </td>
                      <td style={S.td}>
                        {cell(r, isRef ? "patientName" : "noOfSurgeries")}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {cell(r, "settledAmount", inr)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {cell(r, "basicAmount", inr)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {cell(r, "tdsAmount", inr)}
                        {r.values.tdsPercent != null && (
                          <div style={S.small}>{r.values.tdsPercent}%</div>
                        )}
                      </td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {cell(r, "payableAmount", inr)}
                      </td>
                      <td style={{ ...S.td, ...S.mono }}>
                        {cell(r, "accountNumber")}
                        <div style={S.small}>
                          {cell(r, "ifscCode")} · {cell(r, "bankName")}
                        </div>
                        <div style={S.small}>
                          {cell(r, "accountHolderName")}
                        </div>
                      </td>
                      <td style={{ ...S.td, minWidth: 200, maxWidth: 300 }}>
                        {r.flags.newDoctor && (
                          <Tag tone="green">NEW DOCTOR</Tag>
                        )}
                        {r.flags.bankMismatch === "critical" && (
                          <Tag tone="red">
                            BANK MISMATCH
                            {r.flags.bankDecision
                              ? ` · ${r.flags.bankDecision === "update" ? "UPDATE MASTER" : "KEEP MASTER"}`
                              : ""}
                          </Tag>
                        )}
                        {r.flags.bankMismatch === "missing" && (
                          <Tag tone="blue">BANK DETAILS → DOCTOR MASTER</Tag>
                        )}
                        {r.flags.bankMismatch === "minor" && (
                          <Tag tone="amber">
                            BANK NAME DIFFERS
                            {r.flags.bankDecision === "update"
                              ? " · UPDATE MASTER"
                              : ""}
                          </Tag>
                        )}
                        {r.flags.duplicate && (
                          <Tag tone="purple">
                            DUPLICATE OF{" "}
                            {r.flags.duplicateRef?.payoutId
                              ? `${r.flags.duplicateRef.payoutId}${r.flags.duplicateRef.batchId ? ` (${r.flags.duplicateRef.batchId})` : ""}`
                              : `ROW ${r.flags.duplicateRef?.rowNumber}`}
                          </Tag>
                        )}
                        {r.errors.map((e, i) => (
                          <div key={`e${i}`} style={PS.err}>
                            ✕ {e.message}
                          </div>
                        ))}
                        {r.warnings.map((w, i) => (
                          <div key={`w${i}`} style={PS.warn}>
                            ⚠ {w.message}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={11} style={S.empty}>
                        No rows in this view
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {visible.length > shown && (
              <div style={{ textAlign: "center", padding: 10 }}>
                <button
                  style={S.btnGhostSm}
                  onClick={() => setShown((n) => n + PREVIEW_CHUNK)}
                >
                  Show {Math.min(PREVIEW_CHUNK, visible.length - shown)} more of{" "}
                  {visible.length - shown} remaining
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

const Tile = ({ label, value, tone }) => (
  <div style={{ ...S.tile, ...(tone ? { border: `1px solid ${tone}` } : {}) }}>
    <div style={S.tileLabel}>{label}</div>
    <div style={{ ...S.tileValue, ...(tone ? { color: tone } : {}) }}>
      {value}
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════
// One upload: its records, and the approve / reject actions
// ════════════════════════════════════════════════════════════
const DETAIL_FILTERS = [
  { key: "all", label: "All" },
  {
    key: "pending",
    label: "Pending",
    test: (r) => r.status === "pending_approval",
  },
  {
    key: "attention",
    label: "Needs a second look",
    test: (r) =>
      r.flags?.newDoctor ||
      r.flags?.duplicate ||
      r.flags?.sharedBank ||
      r.flags?.bankMismatchKept ||
      r.bankChange?.requested,
  },
  {
    key: "approved",
    label: "Approved",
    test: (r) =>
      !["pending_approval", "rejected", "withdrawn"].includes(r.status),
  },
  {
    key: "rejected",
    label: "Rejected / withdrawn",
    test: (r) => ["rejected", "withdrawn"].includes(r.status),
  },
];

function BatchDetail({ id, user, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState(null); // { kind: "reject" | "withdraw", ids }
  const [reason, setReason] = useState("");
  const [showLog, setShowLog] = useState(false);

  const approver = canApprove(user);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/doctor-payouts/batches/${id}`);
      setData(res.data);
      setSelected([]);
    } catch (err) {
      setError(err.response?.data?.message || "Could not open the upload");
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows || [];
  const pending = rows.filter((r) => r.status === "pending_approval");
  const shown = useMemo(() => {
    const f = DETAIL_FILTERS.find((x) => x.key === filter);
    return f?.test ? rows.filter(f.test) : rows;
  }, [rows, filter]);
  const selRows = rows.filter((r) => selected.includes(r._id));
  const selAmount = selRows.reduce((s, r) => s + (r.payableAmount || 0), 0);
  const isUploader =
    data &&
    String(data.batch.uploadedBy?._id) === String(user?._id || user?.id);
  const canWithdraw =
    (isUploader || user?.role === "super_admin") && pending.length > 0;

  const toggle = (rid) =>
    setSelected((s) =>
      s.includes(rid) ? s.filter((x) => x !== rid) : [...s, rid],
    );
  const shownPending = shown
    .filter((r) => r.status === "pending_approval")
    .map((r) => r._id);
  const allOn =
    shownPending.length > 0 && shownPending.every((x) => selected.includes(x));

  const act = async (kind, body) => {
    setBusy(kind);
    setError("");
    try {
      const { data: res } = await api.patch(
        `/doctor-payouts/batches/${id}/${kind}`,
        body,
      );
      setNotice(
        `${res.message}${res.skipped ? ` (${res.skipped} skipped — already reviewed)` : ""}${
          res.bankChangesApplied
            ? `. Doctor Master bank details updated for ${res.bankChangesApplied} doctor${res.bankChangesApplied === 1 ? "" : "s"}.`
            : ""
        }`,
      );
      setAsk(null);
      setReason("");
      await load();
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || "Action failed");
    } finally {
      setBusy("");
    }
  };

  const approve = (ids) => {
    const list = ids || pending.map((r) => r._id);
    const total = rows
      .filter((r) => list.includes(r._id))
      .reduce((s, r) => s + (r.payableAmount || 0), 0);
    const changes = rows.filter(
      (r) =>
        list.includes(r._id) &&
        r.bankChange?.requested &&
        !r.bankChange.appliedAt,
    );
    const doctors = new Set(changes.map((r) => r.doctor?._id)).size;
    if (
      !window.confirm(
        `Approve ${list.length} record${list.length === 1 ? "" : "s"} for payment — ${inr(total)}?` +
          (doctors
            ? `\n\nThis also SETS / CHANGES THE BANK ACCOUNT in the Doctor Master for ${doctors} doctor${doctors === 1 ? "" : "s"}.`
            : ""),
      )
    )
      return;
    act("approve", ids ? { payoutIds: ids } : { all: true });
  };

  const b = data?.batch;

  return (
    <Modal
      title={b ? `${b.batchId} · ${b.fileName}` : "Upload"}
      sub={
        b
          ? `Uploaded ${fmtDateTime(b.createdAt)} by ${b.uploadedBy?.name || "—"} · ${(
              b.branches || []
            )
              .map((x) => x.name)
              .join(", ")}`
          : ""
      }
      onClose={onClose}
      width={1280}
      footer={
        <>
          {canWithdraw && (
            <button
              style={{ ...S.btnDanger, marginRight: "auto" }}
              onClick={() => setAsk({ kind: "withdraw" })}
            >
              Withdraw {pending.length} pending record
              {pending.length === 1 ? "" : "s"}
            </button>
          )}
          {approver && pending.length > 0 && (
            <>
              <span
                style={{ fontSize: 12.5, color: C.muted, marginRight: "auto" }}
              >
                {selected.length
                  ? `${selected.length} selected · ${inr(selAmount)}`
                  : `${pending.length} awaiting your approval`}
              </span>
              <button
                style={{
                  ...S.btnDanger,
                  ...(selected.length ? {} : S.disabled),
                }}
                disabled={!selected.length || !!busy}
                onClick={() => setAsk({ kind: "reject", ids: selected })}
              >
                Reject selected
              </button>
              <button
                style={{
                  ...S.btnGhost,
                  ...(selected.length ? {} : S.disabled),
                }}
                disabled={!selected.length || !!busy}
                onClick={() => approve(selected)}
              >
                Approve selected
              </button>
              <button
                style={S.btnTeal}
                disabled={!!busy}
                onClick={() => approve(null)}
              >
                {busy === "approve"
                  ? "Approving…"
                  : `Approve all ${pending.length} pending`}
              </button>
            </>
          )}
          <button style={S.btnGhost} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
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
      {!data && !error && <div style={S.empty}>Loading…</div>}

      {data && (
        <>
          <div style={PS.tiles}>
            <Tile label="Records" value={b.counts.total} />
            <Tile label="Payable" value={inr(b.counts.payable)} />
            <Tile
              label="Pending"
              value={b.counts.pending}
              tone={b.counts.pending ? "#b45309" : null}
            />
            <Tile
              label="Approved"
              value={b.counts.approved + b.counts.inPayment + b.counts.paid}
            />
            <Tile label="Paid" value={b.counts.paid} />
            <Tile
              label="Rejected"
              value={b.counts.rejected}
              tone={b.counts.rejected ? "#dc2626" : null}
            />
            <div style={{ alignSelf: "center" }}>
              <Chip map={BATCH_STATUS} value={b.status} />
            </div>
          </div>

          {data.partialView && (
            <Notice tone="info">
              This upload also has records for other branches. You see only your
              branches.
            </Notice>
          )}

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            {DETAIL_FILTERS.map((f) => {
              const n = f.test ? rows.filter(f.test).length : rows.length;
              if (f.key !== "all" && !n) return null;
              return (
                <button
                  key={f.key}
                  style={{ ...PS.chip, ...(filter === f.key ? PS.chipOn : {}) }}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} {n}
                </button>
              );
            })}
          </div>

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
                    {approver && (
                      <th style={{ ...S.th, width: 28 }}>
                        <input
                          type="checkbox"
                          checked={allOn}
                          disabled={!shownPending.length}
                          onChange={() =>
                            setSelected((s) =>
                              allOn
                                ? s.filter((x) => !shownPending.includes(x))
                                : [...new Set([...s, ...shownPending])],
                            )
                          }
                        />
                      </th>
                    )}
                    <th style={S.th}>Record</th>
                    <th style={S.th}>Date</th>
                    <th style={S.th}>Doctor</th>
                    <th style={S.th}>Patient / surgeries</th>
                    <th style={{ ...S.th, ...S.thR }}>Basic</th>
                    <th style={{ ...S.th, ...S.thR }}>TDS</th>
                    <th style={{ ...S.th, ...S.thR }}>Payable</th>
                    <th style={S.th}>Pay to</th>
                    <th style={S.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const change = r.bankChange?.requested
                      ? r.bankChange
                      : null;
                    const isPending = r.status === "pending_approval";
                    return (
                      <tr
                        key={r._id}
                        style={
                          isPending && change
                            ? { background: "#fffbeb" }
                            : isPending && r.flags?.newDoctor
                              ? { background: "#f0fdf4" }
                              : {}
                        }
                      >
                        {approver && (
                          <td style={S.td}>
                            {isPending && (
                              <input
                                type="checkbox"
                                checked={selected.includes(r._id)}
                                onChange={() => toggle(r._id)}
                              />
                            )}
                          </td>
                        )}
                        <td style={S.td}>
                          <span style={S.id}>{r.payoutId}</span>
                          <div style={S.small}>{typeLabel(r.type)}</div>
                          <div style={S.small}>{r.branch?.name}</div>
                        </td>
                        <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                          {fmtDate(r.date)}
                        </td>
                        <td style={S.td}>
                          <div style={{ fontWeight: 600 }}>
                            {r.doctor?.name || r.doctorName}
                          </div>
                          <div style={{ ...S.small, ...S.mono }}>
                            {r.panNumber} · {r.doctor?.doctorCode}
                          </div>
                          <div style={{ marginTop: 3 }}>
                            {r.flags?.newDoctor && (
                              <Tag
                                tone="green"
                                title="Created by this upload — check the bank details"
                              >
                                NEW DOCTOR
                              </Tag>
                            )}
                            {r.flags?.duplicate && (
                              <Tag
                                tone="purple"
                                title="Accounts confirmed this is not a repeat"
                              >
                                POSSIBLE DUPLICATE OF {r.flags.duplicateOf}
                              </Tag>
                            )}
                            {r.flags?.sharedBank && (
                              <Tag tone="amber">SHARED BANK ACCOUNT</Tag>
                            )}
                            {r.doctor?.status &&
                              r.doctor.status !== "active" && (
                                <Tag tone="red">
                                  DOCTOR {r.doctor.status.toUpperCase()}
                                </Tag>
                              )}
                          </div>
                          {(r.warnings || []).map((w, i) => (
                            <div key={i} style={PS.warn}>
                              ⚠ {w}
                            </div>
                          ))}
                        </td>
                        <td style={S.td}>
                          {r.type === "referral"
                            ? r.patientName
                            : `${r.noOfSurgeries} surger${r.noOfSurgeries === 1 ? "y" : "ies"}`}
                          <div style={S.small}>
                            Settled {inr(r.settledAmount)}
                          </div>
                        </td>
                        <td style={{ ...S.td, ...S.tdR }}>
                          {inr(r.basicAmount)}
                        </td>
                        <td style={{ ...S.td, ...S.tdR }}>
                          {inr(r.tdsAmount)}
                        </td>
                        <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                          {inr(r.payableAmount)}
                        </td>
                        <td style={{ ...S.td, minWidth: 190 }}>
                          {change && !change.appliedAt ? (
                            <div style={PS.changeBox}>
                              <Tag tone="red">
                                {change.from?.accountNumber
                                  ? "BANK CHANGE REQUESTED"
                                  : "BANK DETAILS FROM THIS EXCEL"}
                              </Tag>
                              <div style={{ ...S.small, ...S.mono }}>
                                {change.from?.accountNumber
                                  ? `Now: ${bankLine(change.from)}`
                                  : "Doctor Master has none yet"}
                              </div>
                              <div
                                style={{
                                  ...S.mono,
                                  color: "#b91c1c",
                                  fontWeight: 700,
                                  fontSize: 12,
                                }}
                              >
                                New: {bankLine(change.to)}
                              </div>
                              <div style={S.small}>
                                {change.to?.accountHolderName}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={S.mono}>
                                {r.doctor?.accountNumber || "—"}
                              </div>
                              <div style={S.small}>
                                {r.doctor?.ifscCode} · {r.doctor?.bankName}
                              </div>
                              <div style={S.small}>
                                {r.doctor?.accountHolderName}
                              </div>
                              {change?.appliedAt && (
                                <Tag tone="blue">
                                  BANK CHANGED BY THIS UPLOAD
                                </Tag>
                              )}
                              {r.flags?.bankMismatchKept && (
                                <Tag
                                  tone="amber"
                                  title={`Excel had: ${bankLine(r.sheetBank)}`}
                                >
                                  EXCEL HAD A DIFFERENT ACCOUNT — MASTER KEPT
                                </Tag>
                              )}
                            </>
                          )}
                        </td>
                        <td style={S.td}>
                          <Chip map={ROW_STATUS} value={r.status} />
                          {r.status === "rejected" && (
                            <div style={{ ...S.small, color: "#b91c1c" }}>
                              {r.rejectionReason} — {r.rejectedBy?.name}
                            </div>
                          )}
                          {r.approvedBy?.name && r.status !== "rejected" && (
                            <div style={S.small}>
                              by {r.approvedBy.name}, {fmtDate(r.approvedAt)}
                            </div>
                          )}
                          {r.paymentRef && (
                            <div style={{ ...S.small, ...S.mono }}>
                              {r.paymentRef}
                            </div>
                          )}
                          {r.utrNumber && (
                            <div style={{ ...S.small, ...S.mono }}>
                              UTR {r.utrNumber}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={10} style={S.empty}>
                        No records in this view
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button style={S.link} onClick={() => setShowLog((v) => !v)}>
              {showLog
                ? "Hide activity"
                : `Activity (${b.history?.length || 0})`}
            </button>
            {showLog && (
              <div style={{ marginTop: 8 }}>
                {(b.history || []).map((h, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 12.5,
                      color: "#475569",
                      padding: "3px 0",
                    }}
                  >
                    <strong>{h.action}</strong> · {h.by?.name || "—"}
                    {h.by?.role ? ` (${roleLabel(h.by)})` : ""} ·{" "}
                    {fmtDateTime(h.at)}
                    {h.rows
                      ? ` · ${h.rows} record${h.rows === 1 ? "" : "s"}`
                      : ""}
                    {h.amount ? ` · ${inr(h.amount)}` : ""}
                    {h.remarks ? ` — ${h.remarks}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {ask && (
        <Modal
          title={
            ask.kind === "reject"
              ? `Reject ${ask.ids.length} record${ask.ids.length === 1 ? "" : "s"}`
              : `Withdraw ${pending.length} pending record${pending.length === 1 ? "" : "s"}`
          }
          sub={
            ask.kind === "reject"
              ? "Rejected records are closed. Accounts corrects the Excel and uploads them again."
              : "Use this when the wrong file was uploaded. Records already approved are not affected."
          }
          onClose={() => setAsk(null)}
          width={460}
          footer={
            <>
              <button style={S.btnGhost} onClick={() => setAsk(null)}>
                Cancel
              </button>
              <button
                style={{
                  ...S.btnDanger,
                  ...(reason.trim().length < 3 || busy ? S.disabled : {}),
                }}
                disabled={reason.trim().length < 3 || !!busy}
                onClick={() =>
                  act(
                    ask.kind,
                    ask.kind === "reject"
                      ? { payoutIds: ask.ids, reason: reason.trim() }
                      : { all: true, reason: reason.trim() },
                  )
                }
              >
                {busy
                  ? "Saving…"
                  : ask.kind === "reject"
                    ? "Reject"
                    : "Withdraw"}
              </button>
            </>
          }
        >
          <label style={S.label}>Reason</label>
          <textarea
            style={{
              ...S.field,
              minHeight: 80,
              resize: "vertical",
              fontFamily: "inherit",
            }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Modal>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════
// Page: list of uploads
// ════════════════════════════════════════════════════════════
export default function DoctorPayouts() {
  const { user } = useAuth();
  const uploader = canUpload(user);
  const approver = canApprove(user);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pendingRows, setPendingRows] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useState(approver ? "pending" : "all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, limit: PAGE_SIZE });
      if (view === "pending") p.set("view", "pending");
      if (search.trim()) p.set("search", search.trim());
      const { data } = await api.get(`/doctor-payouts/batches?${p}`);
      setRows(data.batches || []);
      setTotal(data.total || 0);
      setPendingRows(data.pendingRows || 0);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the uploads");
    } finally {
      setLoading(false);
    }
  }, [page, view, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const template = async () => {
    try {
      const res = await api.get("/doctor-payouts/template", {
        responseType: "blob",
      });
      saveBlob(res.data, "Doctor_Payout_Template.xlsx");
    } catch (err) {
      setError(await readError(err, "Could not download the template"));
    }
  };

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <DoctorNav active="payouts" />
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>🩺 Upload &amp; approvals</h1>
            <p style={S.sub}>
              {approver
                ? "Review and approve doctor referral and surgeon payouts for your branches"
                : "Upload doctor referral and surgeon payouts for approval"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btnGhost} onClick={template}>
              ⬇ Template
            </button>
            {uploader && (
              <button style={S.btn} onClick={() => setUploadOpen(true)}>
                ⬆ Upload Excel
              </button>
            )}
          </div>
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
          <div style={S.tabs}>
            <button
              style={{ ...S.tab, ...(view === "pending" ? S.tabActive : {}) }}
              onClick={() => {
                setView("pending");
                setPage(1);
              }}
            >
              Awaiting approval{" "}
              {pendingRows > 0 && <span style={S.badge}>{pendingRows}</span>}
            </button>
            <button
              style={{ ...S.tab, ...(view === "all" ? S.tabActive : {}) }}
              onClick={() => {
                setView("all");
                setPage(1);
              }}
            >
              All uploads
            </button>
          </div>
          <input
            style={{ ...S.input, minWidth: 240, marginBottom: 14 }}
            placeholder="Search batch id or file name"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div style={S.card}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Upload</th>
                  <th style={S.th}>Uploaded</th>
                  <th style={S.th}>Branches</th>
                  <th style={S.th}>Records</th>
                  <th style={{ ...S.th, ...S.thR }}>Payable</th>
                  <th style={S.th}>To check</th>
                  <th style={S.th}>Progress</th>
                  <th style={S.th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b._id}>
                    <td style={S.td}>
                      <button
                        style={{ ...S.link, ...S.id }}
                        onClick={() => setOpenId(b._id)}
                      >
                        {b.batchId}
                      </button>
                      <div
                        style={{
                          ...S.small,
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {b.fileName}
                      </div>
                    </td>
                    <td style={S.td}>
                      {fmtDateTime(b.createdAt)}
                      <div style={S.small}>{b.uploadedBy?.name}</div>
                    </td>
                    <td style={{ ...S.td, maxWidth: 220 }}>
                      {(b.branches || []).map((x) => x.name).join(", ")}
                    </td>
                    <td style={S.td}>
                      {b.counts.total}
                      <div style={S.small}>
                        {TYPES.filter((t) => b.counts[t.key])
                          .map((t) => `${t.short} ${b.counts[t.key]}`)
                          .join(" · ")}
                      </div>
                    </td>
                    <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                      {inr(b.counts.payable)}
                    </td>
                    <td style={S.td}>
                      {b.newDoctorCount > 0 && (
                        <Tag tone="green">{b.newDoctorCount} NEW</Tag>
                      )}
                      {b.bankChangeCount > 0 && (
                        <Tag tone="red">{b.bankChangeCount} BANK CHANGE</Tag>
                      )}
                      {b.duplicateCount > 0 && (
                        <Tag tone="purple">{b.duplicateCount} DUPLICATE</Tag>
                      )}
                      {!b.newDoctorCount &&
                        !b.bankChangeCount &&
                        !b.duplicateCount && (
                          <span style={{ color: C.faint }}>—</span>
                        )}
                    </td>
                    <td style={S.td}>
                      <Chip map={BATCH_STATUS} value={b.status} />
                      <div style={S.small}>
                        {[
                          b.counts.pending && `${b.counts.pending} pending`,
                          b.counts.approved && `${b.counts.approved} approved`,
                          b.counts.inPayment &&
                            `${b.counts.inPayment} in payment`,
                          b.counts.paid && `${b.counts.paid} paid`,
                          b.counts.rejected && `${b.counts.rejected} rejected`,
                          b.counts.withdrawn &&
                            `${b.counts.withdrawn} withdrawn`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <button
                        style={
                          approver && b.counts.pending
                            ? S.btnTeal
                            : S.btnGhostSm
                        }
                        onClick={() => setOpenId(b._id)}
                      >
                        {approver && b.counts.pending ? "Review" : "Open"}
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={S.empty}>
                      {view === "pending"
                        ? "Nothing is awaiting approval."
                        : uploader
                          ? "No uploads yet. Download the template, fill it in and upload it."
                          : "No uploads yet."}
                    </td>
                  </tr>
                )}
                {loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={S.empty}>
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} limit={PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      </main>

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onDone={(msg) => {
            setUploadOpen(false);
            setNotice(msg);
            setView("all");
            setPage(1);
            load();
          }}
        />
      )}
      {openId && (
        <BatchDetail
          id={openId}
          user={user}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// styles used only on this page
const PS = {
  drop: {
    border: "2px dashed #cbd5e1",
    borderRadius: 12,
    padding: "34px 24px",
    textAlign: "center",
    background: "#f8fafc",
  },
  tiles: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 },
  ul: { margin: "6px 0 0", paddingLeft: 18 },
  panel: {
    border: `1px solid ${C.line}`,
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 12,
    background: "#fff",
  },
  panelTitle: {
    fontWeight: 700,
    color: C.ink,
    fontSize: 13.5,
    marginBottom: 6,
  },
  mismatch: {
    display: "flex",
    gap: 18,
    flexWrap: "wrap",
    alignItems: "flex-start",
    padding: "10px 0",
    borderTop: `1px solid ${C.line}`,
  },
  diff: { borderCollapse: "collapse", marginTop: 6, fontSize: 12.5 },
  diffTh: {
    textAlign: "left",
    padding: "3px 16px 3px 0",
    color: C.muted,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  diffTd: { padding: "3px 16px 3px 0", color: C.ink },
  radio: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 13,
    color: C.ink,
    padding: "5px 0",
    cursor: "pointer",
    lineHeight: 1.4,
  },
  dupBox: {
    border: "1px solid #ddd6fe",
    background: "#faf5ff",
    borderRadius: 10,
    padding: "10px 14px",
    marginBottom: 12,
  },
  chip: {
    border: `1px solid ${C.line}`,
    background: "#fff",
    borderRadius: 999,
    padding: "4px 12px",
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
  badCell: {
    background: "#fee2e2",
    color: "#b91c1c",
    border: "1px solid #fca5a5",
    borderRadius: 4,
    padding: "0 5px",
    fontWeight: 600,
  },
  err: { fontSize: 11.5, color: "#b91c1c", marginTop: 3, lineHeight: 1.35 },
  warn: { fontSize: 11.5, color: "#92400e", marginTop: 3, lineHeight: 1.35 },
  changeBox: {
    border: "1px solid #fca5a5",
    background: "#fff",
    borderRadius: 8,
    padding: "6px 8px",
  },
};
