// ============================================================
// FRONTEND: src/pages/DoctorPayments.jsx — NEW FILE
// ------------------------------------------------------------
// Payment processing for Doctor Referral and Surgeon payouts. Same three
// tabs as vendor Payment Processing:
//   1. Approved — to raise    select approved records → Raise payment
//   2. Payment requests       download FedOne Excel / e-Net CSV (one or
//                             many), record UTR + payment date (one or many),
//                             cancel
//   3. Paid                   UTR and payment date; Super Admin can correct
// Accounts act; Super Admin, Cluster / Dept Head and Director can view.
// ============================================================
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { downloadExcel } from "../utils/exportExcel.js";
import {
  C,
  S,
  TYPES,
  typeLabel,
  PAYMENT_STATUS,
  ROW_STATUS,
  Chip,
  Tag,
  Modal,
  Notice,
  Pager,
  DoctorNav,
  PaymentKindSwitch,
  inr,
  fmtDate,
  fmtDateTime,
  todayIso,
  saveBlob,
  fileNameFromHeader,
  readError,
  canPay,
  canRecordUtr,
} from "../components/doctorPayoutUi.jsx";

const PAGE_SIZE = 50;
const RAISE_PAGE = 500; // approved records are selected across the list
const TABS = [
  { key: "raise", label: "Approved — to raise", icon: "📋" },
  { key: "processing", label: "Payment requests", icon: "💳" },
  { key: "paid", label: "Paid", icon: "✅" },
];
// per-row buttons on the Payment requests tab: two per line
const ROW_ACTIONS = {
  display: "grid",
  gridTemplateColumns: "auto auto",
  gap: 4,
  justifyContent: "end",
};
const FORMATS = [
  { key: "fedone", label: "FedOne Excel", color: "#0369a1" },
  { key: "enet", label: "e-Net CSV", color: "#7c3aed" },
];

export default function DoctorPayments() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type = TYPES.some((t) => t.key === params.get("type"))
    ? params.get("type")
    : "referral";
  const tab = TABS.some((t) => t.key === params.get("tab"))
    ? params.get("tab")
    : "raise";
  const payer = canPay(user);
  const utrUser = canRecordUtr(user);
  const isAdmin = user?.role === "super_admin";
  const isRef = type === "referral";

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({});
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState("");

  // raise options
  const [consolidate, setConsolidate] = useState(true);
  const [valueDate, setValueDate] = useState("");
  // modals
  const [utrFor, setUtrFor] = useState(null); // payment | { correct: true, ...payment }
  const [bulkUtr, setBulkUtr] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  const [detail, setDetail] = useState(null);

  const go = (next) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => p.set(k, v));
    setParams(p, { replace: true });
    setPage(1);
    setSelected([]);
  };

  // The strip at the top changes type by link (not through go()), so the
  // selection and page are reset whenever the type or tab changes.
  useEffect(() => {
    setSelected([]);
    setPage(1);
  }, [type, tab]);

  useEffect(() => {
    api
      .get("/branches")
      .then((r) =>
        setBranches(Array.isArray(r.data) ? r.data : r.data.branches || []),
      )
      .catch(() => {});
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await api.get(
        `/doctor-payments/summary${branch ? `?branch=${branch}` : ""}`,
      );
      setSummary(data);
    } catch {
      /* badges are optional */
    }
  }, [branch]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ type, page });
      if (branch) p.set("branch", branch);
      if (search.trim()) p.set("search", search.trim());
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (tab === "raise") {
        p.set("status", "approved");
        p.set("limit", RAISE_PAGE);
        const { data } = await api.get(`/doctor-payouts?${p}`);
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setTotals(data.totals || {});
      } else {
        p.set("view", tab);
        p.set("limit", PAGE_SIZE);
        const { data } = await api.get(`/doctor-payments?${p}`);
        setRows(data.payments || []);
        setTotal(data.total || 0);
        setTotals(data.totals || {});
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not load the list");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [type, tab, page, branch, search, from, to]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const refresh = () => {
    setSelected([]);
    load();
    loadSummary();
  };

  const selRows = useMemo(
    () => rows.filter((r) => selected.includes(r._id)),
    [rows, selected],
  );
  const selAmount = selRows.reduce(
    (s, r) => s + (tab === "raise" ? r.payableAmount || 0 : r.amount || 0),
    0,
  );
  const allOn = rows.length > 0 && rows.every((r) => selected.includes(r._id));
  const toggle = (id) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  // How many transfers the current selection becomes.
  const transferCount = useMemo(() => {
    if (tab !== "raise") return 0;
    if (!consolidate) return selRows.length;
    return new Set(selRows.map((r) => `${r.doctor?._id}|${r.branch?._id}`))
      .size;
  }, [tab, consolidate, selRows]);

  // ── actions ──
  const raise = async () => {
    if (!selRows.length) return;
    if (
      !window.confirm(
        `Raise ${transferCount} payment${transferCount === 1 ? "" : "s"} for ${selRows.length} record${selRows.length === 1 ? "" : "s"} — ${inr(selAmount)}?`,
      )
    )
      return;
    setBusy("raise");
    setError("");
    try {
      const { data } = await api.post("/doctor-payments/raise", {
        payoutIds: selected,
        consolidate,
        scheduledDate: valueDate || undefined,
      });
      setNotice(
        `${data.message} — ${inr(data.total)}. They are now under Payment requests.`,
      );
      refresh();
    } catch (err) {
      setError(await readError(err, "Could not raise the payments"));
    } finally {
      setBusy("");
    }
  };

  const bankFile = async (ids, format) => {
    const list = rows.filter((r) => ids.includes(r._id));
    const again = list.filter((r) => r.status === "file_generated");
    if (
      again.length &&
      !window.confirm(
        `${again.length} of these payment${again.length === 1 ? " was" : "s were"} already put in a bank file` +
          ` (${again
            .slice(0, 5)
            .map((r) => r.paymentId)
            .join(", ")}${again.length > 5 ? "…" : ""}).\n\n` +
          "Uploading them to the bank a second time would pay the doctor twice. Download again?",
      )
    )
      return;
    setBusy(`file_${format}`);
    setError("");
    try {
      const res = await api.post(
        "/doctor-payments/bank-file",
        { paymentIds: ids, format },
        { responseType: "blob" },
      );
      saveBlob(
        res.data,
        fileNameFromHeader(
          res.headers,
          `${format === "enet" ? "Enet" : "FedOne"}_DoctorPayments_${todayIso()}.${format === "enet" ? "csv" : "xlsx"}`,
        ),
      );
      setNotice(
        `${format === "enet" ? "e-Net CSV" : "FedOne Excel"} downloaded for ${ids.length} payment${ids.length === 1 ? "" : "s"}. Record the UTRs once the bank has paid.`,
      );
      refresh();
    } catch (err) {
      setError(await readError(err, "Bank file generation failed"));
    } finally {
      setBusy("");
    }
  };

  const exportList = () => {
    const paid = tab === "paid";
    downloadExcel({
      filename: `${isRef ? "Doctor_Referral" : "Surgeon_Payment"}_${paid ? "Paid" : tab === "raise" ? "To_Raise" : "Payment_Requests"}`,
      sheets: [
        tab === "raise"
          ? {
              name: "Approved records",
              title: `${typeLabel(type)} — approved, to raise`,
              columns: [
                { header: "Record", key: "payoutId", width: 14 },
                { header: "Upload", value: (r) => r.batch?.batchId, width: 12 },
                { header: "Branch", value: (r) => r.branch?.name, width: 20 },
                { header: "Date", key: "date", fmt: "date", width: 12 },
                {
                  header: "Doctor",
                  value: (r) => r.doctor?.name || r.doctorName,
                  width: 26,
                },
                { header: "PAN", key: "panNumber", width: 13 },
                isRef
                  ? { header: "Patient", key: "patientName", width: 24 }
                  : {
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
                {
                  header: "Basic",
                  key: "basicAmount",
                  fmt: "money",
                  width: 14,
                },
                { header: "TDS", key: "tdsAmount", fmt: "money", width: 12 },
                {
                  header: "Payable",
                  key: "payableAmount",
                  fmt: "money",
                  width: 14,
                },
              ],
              rows,
            }
          : {
              name: paid ? "Paid" : "Payment requests",
              title: `${typeLabel(type)} — ${paid ? "paid" : "payment requests"}`,
              columns: [
                { header: "Payment", key: "paymentId", width: 13 },
                { header: "Branch", value: (r) => r.branch?.name, width: 20 },
                { header: "Doctor", key: "doctorName", width: 26 },
                { header: "PAN", key: "panNumber", width: 13 },
                { header: "Records", key: "payoutCount", fmt: "int", width: 9 },
                {
                  header: "Basic",
                  key: "basicAmount",
                  fmt: "money",
                  width: 14,
                },
                { header: "TDS", key: "tdsAmount", fmt: "money", width: 12 },
                {
                  header: "Amount paid",
                  key: "amount",
                  fmt: "money",
                  width: 14,
                },
                { header: "Bank", value: (r) => r.bank?.bankName, width: 20 },
                {
                  header: "Account number",
                  value: (r) => r.bank?.accountNumber,
                  width: 20,
                },
                { header: "IFSC", value: (r) => r.bank?.ifscCode, width: 13 },
                {
                  header: "Status",
                  value: (r) => PAYMENT_STATUS[r.status]?.label,
                  width: 18,
                },
                { header: "UTR", key: "utrNumber", width: 22 },
                {
                  header: "Payment date",
                  key: "paymentDate",
                  fmt: "date",
                  width: 13,
                },
              ],
              rows,
            },
      ],
    });
  };

  const count = (key) => summary?.[type]?.[key]?.count || 0;

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <DoctorNav active={type} />
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>💳 Payment Processing</h1>
            <p style={S.sub}>
              {typeLabel(type)} — raise payments, download the bank file and
              record UTRs
            </p>
          </div>
          <PaymentKindSwitch
            active={type}
            onPick={(k) =>
              k === "vendor"
                ? navigate("/payments")
                : go({ type: k, tab: "raise" })
            }
          />
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

        <div style={S.tabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              style={{ ...S.tab, ...(tab === t.key ? S.tabActive : {}) }}
              onClick={() => go({ tab: t.key })}
            >
              {t.icon} {t.label}
              {t.key !== "paid" && count(t.key) > 0 && (
                <span style={S.badge}>{count(t.key)}</span>
              )}
            </button>
          ))}
        </div>

        <div style={S.filters}>
          <input
            style={{ ...S.input, flex: "1 1 240px", maxWidth: 360 }}
            placeholder={
              tab === "raise"
                ? "Search doctor, PAN, patient or record id"
                : "Search doctor, PAN, payment id or UTR"
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            style={S.input}
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
              setPage(1);
              setSelected([]);
            }}
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 12.5, color: C.muted }}>
            {tab === "paid"
              ? "Paid"
              : tab === "raise"
                ? "Sheet date"
                : "Raised"}{" "}
            from
          </span>
          <input
            type="date"
            style={S.input}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
          <span style={{ fontSize: 12.5, color: C.muted }}>to</span>
          <input
            type="date"
            style={S.input}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
          <button
            style={{ ...S.btnGhostSm, marginLeft: "auto" }}
            onClick={exportList}
            disabled={!rows.length}
          >
            ⬇ Export list
          </button>
        </div>

        {/* ── bulk bar ── */}
        {tab === "raise" && payer && (
          <div style={S.bulkBar}>
            <strong style={{ fontSize: 13 }}>
              {selected.length
                ? `${selected.length} record${selected.length === 1 ? "" : "s"} · ${inr(selAmount)} → ${transferCount} payment${transferCount === 1 ? "" : "s"}`
                : "Select the records to pay"}
            </strong>
            <label
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 12.5,
                color: "#475569",
              }}
            >
              <input
                type="checkbox"
                checked={consolidate}
                onChange={(e) => setConsolidate(e.target.checked)}
              />
              One payment per doctor per branch
            </label>
            <label
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 12.5,
                color: "#475569",
              }}
            >
              Value date
              <input
                type="date"
                style={{ ...S.input, padding: "5px 8px" }}
                min={todayIso()}
                value={valueDate}
                onChange={(e) => setValueDate(e.target.value)}
              />
            </label>
            <button
              style={{
                ...S.btnTeal,
                marginLeft: "auto",
                ...(selected.length && !busy ? {} : S.disabled),
              }}
              disabled={!selected.length || !!busy}
              onClick={raise}
            >
              {busy === "raise" ? "Raising…" : "Raise payment"}
            </button>
          </div>
        )}
        {tab === "processing" && (payer || utrUser) && (
          <div style={S.bulkBar}>
            <strong style={{ fontSize: 13 }}>
              {selected.length
                ? `${selected.length} payment${selected.length === 1 ? "" : "s"} · ${inr(selAmount)}`
                : "Select payments for a bank file or to record UTRs"}
            </strong>
            <span
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {payer &&
                FORMATS.map((f) => (
                  <button
                    key={f.key}
                    style={{
                      ...S.btn,
                      background: f.color,
                      ...(selected.length && !busy ? {} : S.disabled),
                    }}
                    disabled={!selected.length || !!busy}
                    onClick={() => bankFile(selected, f.key)}
                  >
                    {busy === `file_${f.key}` ? "Preparing…" : `⬇ ${f.label}`}
                  </button>
                ))}
              {utrUser && (
                <button
                  style={{
                    ...S.btnTeal,
                    ...(selected.length ? {} : S.disabled),
                  }}
                  disabled={!selected.length}
                  onClick={() => setBulkUtr(true)}
                >
                  Record UTRs
                </button>
              )}
            </span>
          </div>
        )}

        <div style={S.card}>
          <div style={S.tableWrap}>
            {tab === "raise" ? (
              <table style={S.table}>
                <thead>
                  <tr>
                    {payer && (
                      <th style={{ ...S.th, width: 28 }}>
                        <input
                          type="checkbox"
                          checked={allOn}
                          disabled={!rows.length}
                          onChange={() =>
                            setSelected(allOn ? [] : rows.map((r) => r._id))
                          }
                        />
                      </th>
                    )}
                    <th style={S.th}>Record</th>
                    <th style={S.th}>Date</th>
                    <th style={S.th}>Branch</th>
                    <th style={S.th}>Doctor</th>
                    <th style={S.th}>{isRef ? "Patient" : "Surgeries"}</th>
                    <th style={{ ...S.th, ...S.thR }}>Settled</th>
                    <th style={{ ...S.th, ...S.thR }}>Basic</th>
                    <th style={{ ...S.th, ...S.thR }}>TDS</th>
                    <th style={{ ...S.th, ...S.thR }}>Payable</th>
                    <th style={S.th}>Pay to</th>
                    <th style={S.th}>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r._id}>
                      {payer && (
                        <td style={S.td}>
                          <input
                            type="checkbox"
                            checked={selected.includes(r._id)}
                            onChange={() => toggle(r._id)}
                          />
                        </td>
                      )}
                      <td style={S.td}>
                        <span style={S.id}>{r.payoutId}</span>
                        <div style={S.small}>{r.batch?.batchId}</div>
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        {fmtDate(r.date)}
                      </td>
                      <td style={S.td}>{r.branch?.name}</td>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>
                          {r.doctor?.name || r.doctorName}
                        </div>
                        <div style={{ ...S.small, ...S.mono }}>
                          {r.panNumber}
                        </div>
                        {r.doctor?.status && r.doctor.status !== "active" && (
                          <Tag tone="red">
                            DOCTOR {r.doctor.status.toUpperCase()}
                          </Tag>
                        )}
                      </td>
                      <td style={S.td}>
                        {isRef ? r.patientName : r.noOfSurgeries}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {inr(r.settledAmount)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {inr(r.basicAmount)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>{inr(r.tdsAmount)}</td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(r.payableAmount)}
                      </td>
                      <td style={S.td}>
                        <div style={S.mono}>
                          {r.doctor?.accountNumber || "—"}
                        </div>
                        <div style={S.small}>
                          {r.doctor?.ifscCode} · {r.doctor?.bankName}
                        </div>
                      </td>
                      <td style={S.td}>
                        {fmtDate(r.approvedAt)}
                        <div style={S.small}>{r.approvedBy?.name}</div>
                      </td>
                    </tr>
                  ))}
                  <EmptyRow loading={loading} rows={rows} span={12}>
                    No approved {isRef ? "referral" : "surgeon"} records are
                    waiting to be raised.
                  </EmptyRow>
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td
                        colSpan={payer ? 7 : 6}
                        style={{ ...S.td, fontWeight: 700 }}
                      >
                        {total} record{total === 1 ? "" : "s"}
                        {total > rows.length
                          ? ` (first ${rows.length} shown — narrow the filters)`
                          : ""}
                      </td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(totals.basic)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(totals.tds)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(totals.payable)}
                      </td>
                      <td colSpan={2} style={S.td} />
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr>
                    {tab === "processing" && (payer || utrUser) && (
                      <th style={{ ...S.th, width: 28 }}>
                        <input
                          type="checkbox"
                          checked={allOn}
                          disabled={!rows.length}
                          onChange={() =>
                            setSelected(allOn ? [] : rows.map((r) => r._id))
                          }
                        />
                      </th>
                    )}
                    <th style={S.th}>Payment</th>
                    <th style={S.th}>Doctor</th>
                    <th style={S.th}>Branch</th>
                    <th style={{ ...S.th, ...S.thR }}>Basic</th>
                    <th style={{ ...S.th, ...S.thR }}>TDS</th>
                    <th style={{ ...S.th, ...S.thR }}>Amount</th>
                    <th style={S.th}>Pay to</th>
                    <th style={S.th}>{tab === "paid" ? "UTR" : "Status"}</th>
                    <th style={S.th} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p._id}>
                      {tab === "processing" && (payer || utrUser) && (
                        <td style={S.td}>
                          <input
                            type="checkbox"
                            checked={selected.includes(p._id)}
                            onChange={() => toggle(p._id)}
                          />
                        </td>
                      )}
                      <td style={S.td}>
                        <button
                          style={{ ...S.link, ...S.id }}
                          onClick={() => setDetail(p._id)}
                        >
                          {p.paymentId}
                        </button>
                        <div style={S.small}>
                          {p.payoutCount} record{p.payoutCount === 1 ? "" : "s"}{" "}
                          · raised {fmtDate(p.raisedAt)}
                        </div>
                      </td>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>{p.doctorName}</div>
                        <div style={{ ...S.small, ...S.mono }}>
                          {p.panNumber}
                        </div>
                      </td>
                      <td style={S.td}>{p.branch?.name}</td>
                      <td style={{ ...S.td, ...S.tdR }}>
                        {inr(p.basicAmount)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR }}>{inr(p.tdsAmount)}</td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(p.amount)}
                      </td>
                      <td style={S.td}>
                        <div style={S.mono}>{p.bank?.accountNumber}</div>
                        <div style={S.small}>
                          {p.bank?.ifscCode} · {p.bank?.bankName}
                        </div>
                      </td>
                      <td style={S.td}>
                        {tab === "paid" ? (
                          <>
                            <div style={S.mono}>{p.utrNumber}</div>
                            <div style={S.small}>
                              Paid {fmtDate(p.paymentDate)} ·{" "}
                              {p.utrRecordedBy?.name}
                            </div>
                          </>
                        ) : (
                          <>
                            <Chip map={PAYMENT_STATUS} value={p.status} />
                            {p.status === "file_generated" && (
                              <div style={S.small}>
                                {p.fileFormat === "enet" ? "e-Net" : "FedOne"} ·{" "}
                                {fmtDate(p.fileGeneratedAt)}
                                {p.fileDownloads > 1
                                  ? ` · downloaded ${p.fileDownloads}×`
                                  : ""}
                              </div>
                            )}
                            {p.scheduledDate && (
                              <div style={S.small}>
                                Value date {fmtDate(p.scheduledDate)}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td style={{ ...S.td, width: 1 }}>
                        {tab === "processing" && (
                          <div style={ROW_ACTIONS}>
                            {payer &&
                              FORMATS.map((f) => (
                                <button
                                  key={f.key}
                                  title={`Download ${f.label} for this payment`}
                                  style={{ ...S.btnGhostSm, color: f.color }}
                                  disabled={!!busy}
                                  onClick={() => bankFile([p._id], f.key)}
                                >
                                  ⬇ {f.key === "enet" ? "e-Net" : "FedOne"}
                                </button>
                              ))}
                            {utrUser && (
                              <button
                                style={{ ...S.btnGhostSm, color: C.teal }}
                                onClick={() => setUtrFor(p)}
                              >
                                Record UTR
                              </button>
                            )}
                            {payer && (
                              <button
                                style={{ ...S.btnGhostSm, color: "#dc2626" }}
                                onClick={() => setCancelFor(p)}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        )}
                        {tab === "paid" && isAdmin && (
                          <button
                            style={S.btnGhostSm}
                            onClick={() => setUtrFor({ ...p, correct: true })}
                          >
                            Correct UTR
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <EmptyRow loading={loading} rows={rows} span={10}>
                    {tab === "paid"
                      ? "No payments recorded as paid yet."
                      : "No payments are in process."}
                  </EmptyRow>
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td
                        colSpan={
                          tab === "processing" && (payer || utrUser) ? 4 : 3
                        }
                        style={{ ...S.td, fontWeight: 700 }}
                      >
                        {total} payment{total === 1 ? "" : "s"}
                      </td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(totals.basic)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(totals.tds)}
                      </td>
                      <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                        {inr(totals.amount)}
                      </td>
                      <td colSpan={3} style={S.td} />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
          {tab !== "raise" && (
            <Pager
              page={page}
              limit={PAGE_SIZE}
              total={total}
              onPage={setPage}
            />
          )}
        </div>
      </main>

      {utrFor && (
        <UtrModal
          payment={utrFor}
          onClose={() => setUtrFor(null)}
          onDone={(msg) => {
            setUtrFor(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}
      {bulkUtr && (
        <BulkUtrModal
          payments={selRows}
          onClose={(changed) => {
            setBulkUtr(false);
            if (changed) refresh();
          }}
        />
      )}
      {cancelFor && (
        <CancelModal
          payment={cancelFor}
          onClose={() => setCancelFor(null)}
          onDone={(msg) => {
            setCancelFor(null);
            setNotice(msg);
            refresh();
          }}
        />
      )}
      {detail && <PaymentDetail id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

const EmptyRow = ({ loading, rows, span, children }) =>
  rows.length ? null : (
    <tr>
      <td colSpan={span} style={S.empty}>
        {loading ? "Loading…" : children}
      </td>
    </tr>
  );

// ── record (or correct) one UTR ───────────────────────────
function UtrModal({ payment, onClose, onDone }) {
  const correcting = Boolean(payment.correct);
  const [utr, setUtr] = useState(correcting ? payment.utrNumber || "" : "");
  const [date, setDate] = useState(
    correcting && payment.paymentDate
      ? String(payment.paymentDate).slice(0, 10)
      : todayIso(),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [dupe, setDupe] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (allowDuplicateUtr = false) => {
    setSaving(true);
    setError("");
    try {
      const { data } = correcting
        ? await api.patch(`/doctor-payments/${payment._id}/utr/correct`, {
            utrNumber: utr,
            paymentDate: date,
            reason,
          })
        : await api.patch(`/doctor-payments/${payment._id}/utr`, {
            utrNumber: utr,
            paymentDate: date,
            allowDuplicateUtr,
          });
      onDone(data.message);
    } catch (err) {
      if (err.response?.data?.code === "DUPLICATE_UTR")
        setDupe(err.response.data.message);
      else setError(err.response?.data?.message || "Could not save the UTR");
    } finally {
      setSaving(false);
    }
  };

  const ready =
    utr.trim().length >= 6 &&
    date &&
    (!correcting || reason.trim().length >= 3);
  return (
    <Modal
      title={`${correcting ? "Correct UTR" : "Record UTR"} — ${payment.paymentId}`}
      sub={`${payment.doctorName} · ${payment.branch?.name || ""} · ${inr(payment.amount)}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button style={S.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...S.btnTeal, ...(ready && !saving ? {} : S.disabled) }}
            disabled={!ready || saving}
            onClick={() => save(false)}
          >
            {saving
              ? "Saving…"
              : correcting
                ? "Save correction"
                : "Mark as paid"}
          </button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {dupe && (
        <Notice tone="warn">
          {dupe}. One transfer normally has its own UTR.{" "}
          <button style={S.link} onClick={() => save(true)}>
            Record it anyway
          </button>
        </Notice>
      )}
      <label style={S.label}>UTR / bank reference number</label>
      <input
        style={{ ...S.field, ...S.mono, textTransform: "uppercase" }}
        value={utr}
        onChange={(e) => {
          setUtr(e.target.value);
          setDupe("");
        }}
        autoFocus
      />
      <label style={S.label}>Payment date</label>
      <input
        type="date"
        style={S.field}
        max={todayIso()}
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      {correcting && (
        <>
          <label style={S.label}>Reason for the correction</label>
          <input
            style={S.field}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </>
      )}
      {!correcting && (
        <div style={S.small}>
          Paid to {payment.bank?.accountHolderName} ·{" "}
          {payment.bank?.accountNumber} · {payment.bank?.ifscCode}. Once saved,
          only a Super Admin can change the UTR.
        </div>
      )}
    </Modal>
  );
}

// ── UTRs for several payments at once ─────────────────────
function BulkUtrModal({ payments, onClose }) {
  const [entries, setEntries] = useState(() =>
    Object.fromEntries(payments.map((p) => [p._id, { utr: "", date: "" }])),
  );
  const [date, setDate] = useState(todayIso());
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  const filled = payments.filter((p) => entries[p._id]?.utr.trim());
  const resultOf = (id) => results?.find((r) => String(r._id) === String(id));

  // Paste a column of UTRs copied from the bank statement into the first
  // box and they fill downwards, one per row.
  const paste = (startId, text) => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.split("\t")[0].trim())
      .filter(Boolean);
    if (lines.length < 2) return false;
    const start = payments.findIndex((p) => p._id === startId);
    setEntries((e) => {
      const next = { ...e };
      lines.forEach((l, i) => {
        const p = payments[start + i];
        if (p) next[p._id] = { ...next[p._id], utr: l };
      });
      return next;
    });
    return true;
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.patch("/doctor-payments/bulk-utr", {
        paymentDate: date,
        entries: filled.map((p) => ({
          _id: p._id,
          utrNumber: entries[p._id].utr,
          paymentDate: entries[p._id].date || undefined,
        })),
      });
      setResults(data.results);
      if (data.updated) setChanged(true);
      if (!data.failed && !data.skipped) onClose(true);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save the UTRs");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Record UTRs — ${payments.length} payment${payments.length === 1 ? "" : "s"}`}
      sub="Type or paste the UTR against each payment. Rows left blank are not changed."
      onClose={() => onClose(changed)}
      width={860}
      footer={
        <>
          <label
            style={{ marginRight: "auto", fontSize: 13, color: "#475569" }}
          >
            Payment date for all{" "}
            <input
              type="date"
              style={{ ...S.input, padding: "6px 8px" }}
              max={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button style={S.btnGhost} onClick={() => onClose(changed)}>
            Close
          </button>
          <button
            style={{
              ...S.btnTeal,
              ...(filled.length && date && !saving ? {} : S.disabled),
            }}
            disabled={!filled.length || !date || saving}
            onClick={save}
          >
            {saving ? "Saving…" : `Mark ${filled.length} as paid`}
          </button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {results && (
        <Notice
          tone={results.some((r) => r.status !== "success") ? "warn" : "ok"}
        >
          {results.filter((r) => r.status === "success").length} recorded
          {results.some((r) => r.status !== "success")
            ? ` · ${results.filter((r) => r.status !== "success").length} not recorded — see the rows below`
            : ""}
        </Notice>
      )}
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Payment</th>
            <th style={S.th}>Doctor</th>
            <th style={{ ...S.th, ...S.thR }}>Amount</th>
            <th style={S.th}>UTR</th>
            <th style={S.th}>Date (if different)</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const r = resultOf(p._id);
            const done = r?.status === "success";
            return (
              <tr
                key={p._id}
                style={
                  done
                    ? { background: "#f0fdf4" }
                    : r
                      ? { background: "#fef2f2" }
                      : {}
                }
              >
                <td style={{ ...S.td, ...S.mono }}>{p.paymentId}</td>
                <td style={S.td}>
                  {p.doctorName}
                  <div style={S.small}>{p.branch?.name}</div>
                </td>
                <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                  {inr(p.amount)}
                </td>
                <td style={S.td}>
                  <input
                    style={{
                      ...S.input,
                      ...S.mono,
                      width: 230,
                      textTransform: "uppercase",
                    }}
                    disabled={done}
                    value={entries[p._id]?.utr || ""}
                    onChange={(e) =>
                      setEntries((s) => ({
                        ...s,
                        [p._id]: { ...s[p._id], utr: e.target.value },
                      }))
                    }
                    onPaste={(e) => {
                      if (paste(p._id, e.clipboardData.getData("text")))
                        e.preventDefault();
                    }}
                  />
                  {r && (
                    <div
                      style={{
                        ...S.small,
                        color: done ? "#15803d" : "#b91c1c",
                      }}
                    >
                      {r.message}
                    </div>
                  )}
                </td>
                <td style={S.td}>
                  <input
                    type="date"
                    style={{ ...S.input, padding: "6px 8px" }}
                    max={todayIso()}
                    disabled={done}
                    value={entries[p._id]?.date || ""}
                    onChange={(e) =>
                      setEntries((s) => ({
                        ...s,
                        [p._id]: { ...s[p._id], date: e.target.value },
                      }))
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

// ── cancel a payment before it is paid ────────────────────
function CancelModal({ payment, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const filed = payment.status === "file_generated";

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.patch(
        `/doctor-payments/${payment._id}/cancel`,
        { reason },
      );
      onDone(data.message);
    } catch (err) {
      setError(err.response?.data?.message || "Could not cancel the payment");
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Cancel ${payment.paymentId}`}
      sub={`${payment.doctorName} · ${inr(payment.amount)}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button style={S.btnGhost} onClick={onClose}>
            Keep it
          </button>
          <button
            style={{
              ...S.btnDanger,
              ...(reason.trim().length >= 3 && !saving ? {} : S.disabled),
            }}
            disabled={reason.trim().length < 3 || saving}
            onClick={save}
          >
            {saving ? "Cancelling…" : "Cancel payment"}
          </button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {filed && (
        <Notice tone="warn">
          A bank file containing this payment was already downloaded. Make sure
          that file is not uploaded to the bank (or that this line is removed
          from it) — otherwise the doctor is paid and PMS will not know.
        </Notice>
      )}
      <div style={{ fontSize: 13, color: "#475569", marginBottom: 12 }}>
        Its {payment.payoutCount} record{payment.payoutCount === 1 ? "" : "s"}{" "}
        go back to “Approved — to raise” and can be raised again.
      </div>
      <label style={S.label}>Reason</label>
      <input
        style={S.field}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoFocus
      />
    </Modal>
  );
}

// ── one payment: what it pays, and what happened to it ────
function PaymentDetail({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .get(`/doctor-payments/${id}`)
      .then((r) => setData(r.data))
      .catch((err) =>
        setError(err.response?.data?.message || "Could not open the payment"),
      );
  }, [id]);
  const p = data?.payment;
  return (
    <Modal
      title={p ? `${p.paymentId} · ${typeLabel(p.type)}` : "Payment"}
      sub={p ? `${p.doctorName} (${p.panNumber}) · ${p.branch?.name}` : ""}
      onClose={onClose}
      width={880}
      footer={
        <button style={S.btnGhost} onClick={onClose}>
          Close
        </button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <div style={S.empty}>Loading…</div>}
      {p && (
        <>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            {[
              ["Amount", inr(p.amount)],
              ["Basic", inr(p.basicAmount)],
              ["TDS", inr(p.tdsAmount)],
              ["Records", p.payoutCount],
            ].map(([l, v]) => (
              <div key={l} style={S.tile}>
                <div style={S.tileLabel}>{l}</div>
                <div style={S.tileValue}>{v}</div>
              </div>
            ))}
            <div style={{ alignSelf: "center" }}>
              <Chip map={PAYMENT_STATUS} value={p.status} />
            </div>
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#475569",
              marginBottom: 12,
              lineHeight: 1.7,
            }}
          >
            <strong>Paid to:</strong> {p.bank?.accountHolderName} ·{" "}
            <span style={S.mono}>{p.bank?.accountNumber}</span> ·{" "}
            <span style={S.mono}>{p.bank?.ifscCode}</span> · {p.bank?.bankName}
            {p.utrNumber && (
              <>
                <br />
                <strong>UTR:</strong> <span style={S.mono}>{p.utrNumber}</span>{" "}
                · paid {fmtDate(p.paymentDate)}
              </>
            )}
            {p.cancelReason && (
              <>
                <br />
                <strong>Cancelled:</strong> {p.cancelReason}
              </>
            )}
          </div>
          <table style={{ ...S.table, fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={S.th}>Record</th>
                <th style={S.th}>Date</th>
                <th style={S.th}>
                  {p.type === "referral" ? "Patient" : "Surgeries"}
                </th>
                <th style={{ ...S.th, ...S.thR }}>Settled</th>
                <th style={{ ...S.th, ...S.thR }}>Basic</th>
                <th style={{ ...S.th, ...S.thR }}>TDS</th>
                <th style={{ ...S.th, ...S.thR }}>Payable</th>
                <th style={S.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r._id}>
                  <td style={S.td}>
                    <span style={S.mono}>{r.payoutId}</span>
                    <div style={S.small}>{r.batch?.batchId}</div>
                  </td>
                  <td style={S.td}>{fmtDate(r.date)}</td>
                  <td style={S.td}>
                    {p.type === "referral" ? r.patientName : r.noOfSurgeries}
                  </td>
                  <td style={{ ...S.td, ...S.tdR }}>{inr(r.settledAmount)}</td>
                  <td style={{ ...S.td, ...S.tdR }}>{inr(r.basicAmount)}</td>
                  <td style={{ ...S.td, ...S.tdR }}>{inr(r.tdsAmount)}</td>
                  <td style={{ ...S.td, ...S.tdR, fontWeight: 700 }}>
                    {inr(r.payableAmount)}
                  </td>
                  <td style={S.td}>
                    <Chip map={ROW_STATUS} value={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 14 }}>
            {(p.history || []).map((h, i) => (
              <div
                key={i}
                style={{ fontSize: 12.5, color: "#475569", padding: "3px 0" }}
              >
                <strong>{h.action.replace(/_/g, " ")}</strong> ·{" "}
                {h.by?.name || "—"} · {fmtDateTime(h.at)}
                {h.remarks ? ` — ${h.remarks}` : ""}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
