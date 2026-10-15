// ============================================================
// FRONTEND: src/pages/FixedPayments.jsx — NEW FILE
// ------------------------------------------------------------
// Fixed (recurring) monthly payments.
//   Accounts     — set up / edit, upload agreement, pause / resume / end,
//                  generate this month now
//   Super Admin  — approve / reject (one time), pause / resume / end
// Each approved template creates that month's invoice automatically on
// its day, already approved, straight into Payment Processing.
// ============================================================
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const C = {
  primary: "#1a3c6e",
  teal: "#0f766e",
  line: "#e2e8f0",
  muted: "#64748b",
  faint: "#94a3b8",
  ink: "#0f172a",
};

const STATUS = {
  pending_approval: {
    label: "Pending approval",
    bg: "#fffbeb",
    color: "#b45309",
  },
  active: { label: "Active", bg: "#f0fdf4", color: "#16a34a" },
  paused: { label: "Paused", bg: "#f1f5f9", color: "#475569" },
  rejected: { label: "Rejected", bg: "#fef2f2", color: "#dc2626" },
  ended: { label: "Ended", bg: "#f8fafc", color: "#94a3b8" },
};
const CHIPS = ["", "pending_approval", "active", "paused", "rejected", "ended"];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const periodLabel = (p) => {
  if (!p) return "—";
  const [y, m] = p.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Same maths as the backend: GST to 2 dp, TDS rounded to the rupee.
const preview = (amount, gst, tds) => {
  const base = Math.round((Number(amount) || 0) * 100) / 100;
  const g = Math.round(((base * (Number(gst) || 0)) / 100) * 100) / 100;
  const t = Math.round((base * (Number(tds) || 0)) / 100);
  return { base, gst: g, tds: t, net: Math.round((base + g - t) * 100) / 100 };
};

const thisPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const EMPTY = {
  title: "",
  branch: "",
  vendor: "",
  expenseType: "Revenue",
  expenseCategory: "",
  description: "",
  amount: "",
  gstPercentage: "0",
  tdsPercentage: "0",
  dayOfMonth: "5",
  startPeriod: thisPeriod(),
  endPeriod: "",
};

export default function FixedPayments() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAccounts = user?.role === "accounts";
  const isAdmin = user?.role === "super_admin";

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [modal, setModal] = useState(null); // null | "create" | "edit"
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [agreementFile, setAgreementFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [branches, setBranches] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);

  const [detail, setDetail] = useState(null); // full template + invoices
  const [busy, setBusy] = useState("");
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const { data } = await api.get(`/fixed-payments?${params}`);
      setRows(data.templates || []);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err.response?.data?.message || "Could not load fixed payments");
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api
      .get("/branches")
      .then((r) =>
        setBranches(Array.isArray(r.data) ? r.data : r.data.branches || []),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!modal || !form.branch) return setVendors([]);
    api
      .get(
        `/vendors?branch=${form.branch}&status=active&approvalStatus=approved&limit=100`,
      )
      .then((r) =>
        setVendors(Array.isArray(r.data) ? r.data : r.data.vendors || []),
      )
      .catch(() => setVendors([]));
  }, [modal, form.branch]);

  useEffect(() => {
    if (!modal || !form.expenseType) return;
    api
      .get(`/expense-categories?type=${form.expenseType}`)
      .then((r) =>
        setCategories(Array.isArray(r.data) ? r.data : r.data.categories || []),
      )
      .catch(() => setCategories([]));
  }, [modal, form.expenseType]);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => {
    const single =
      user?.branches?.length === 1
        ? user.branches[0]._id || user.branches[0]
        : "";
    setForm({ ...EMPTY, branch: single });
    setEditId(null);
    setAgreementFile(null);
    setFormError("");
    setModal("create");
  };

  const openEdit = (t) => {
    setForm({
      title: t.title || "",
      branch: t.branch?._id || t.branch || "",
      vendor: t.vendor?._id || t.vendor || "",
      expenseType: t.expenseType || "Revenue",
      expenseCategory: t.expenseCategory?._id || t.expenseCategory || "",
      description: t.description || "",
      amount: String(t.amount ?? ""),
      gstPercentage: String(t.gstPercentage ?? 0),
      tdsPercentage: String(t.tdsPercentage ?? 0),
      dayOfMonth: String(t.dayOfMonth ?? 5),
      startPeriod: t.startPeriod || thisPeriod(),
      endPeriod: t.endPeriod || "",
    });
    setEditId(t._id);
    setAgreementFile(null);
    setFormError("");
    setDetail(null);
    setModal("edit");
  };

  const save = async () => {
    setSaving(true);
    setFormError("");
    try {
      const body = { ...form, endPeriod: form.endPeriod || "" };
      let saved;
      if (modal === "create") {
        if (!agreementFile) {
          setFormError("Attach the agreement / contract (PDF or image)");
          setSaving(false);
          return;
        }
        saved = (await api.post("/fixed-payments", body)).data;
      } else {
        try {
          saved = (await api.put(`/fixed-payments/${editId}`, body)).data;
        } catch (err) {
          // Only the agreement changed — not an error.
          if (
            !(
              agreementFile &&
              /Nothing has changed/.test(err.response?.data?.message || "")
            )
          )
            throw err;
          saved = { _id: editId };
        }
      }
      if (agreementFile) {
        const fd = new FormData();
        fd.append("file", agreementFile);
        await api.post(`/fixed-payments/${saved._id}/agreement`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      setModal(null);
      flash(
        modal === "create"
          ? "Fixed payment saved and sent to Super Admin for approval."
          : "Changes saved. Changes to amount, vendor, dates or the agreement need Super Admin approval again.",
      );
      load();
    } catch (err) {
      setFormError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (t) => {
    try {
      const { data } = await api.get(`/fixed-payments/${t._id}`);
      setDetail(data);
    } catch (err) {
      setError(
        err.response?.data?.message || "Could not open the fixed payment",
      );
    }
  };

  const act = async (t, action, body = {}) => {
    setBusy(`${action}_${t._id}`);
    setError("");
    try {
      if (action === "generate") {
        const { data } = await api.post(`/fixed-payments/${t._id}/generate`);
        flash(`${data.message} — it is now in Payment Processing.`);
      } else {
        const { data } = await api.patch(
          `/fixed-payments/${t._id}/${action}`,
          body,
        );
        if (action === "approve") {
          const g = data.generated;
          flash(
            g?.status === "created"
              ? `Approved. This month's invoice ${g.requestId} was created.`
              : "Approved. Invoices will be created automatically on the set day each month.",
          );
        } else {
          flash(`Fixed payment ${action === "end" ? "ended" : action + "d"}.`);
        }
      }
      if (detail?._id === t._id) openDetail(t);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Action failed");
    } finally {
      setBusy("");
    }
  };

  const confirmAct = (t, action, question) => {
    if (window.confirm(question)) act(t, action);
  };

  const p = preview(form.amount, form.gstPercentage, form.tdsPercentage);

  // Actions available for a template, for the current user.
  const actionsFor = (t) => {
    const a = [];
    if (isAdmin && t.status === "pending_approval") {
      a.push({
        key: "approve",
        label: "✓ Approve",
        tone: "primary",
        run: () => act(t, "approve"),
      });
      a.push({
        key: "reject",
        label: "✗ Reject",
        tone: "danger",
        run: () => {
          setRejectFor(t);
          setRejectReason("");
        },
      });
    }
    if (isAccounts && t.status !== "ended")
      a.push({ key: "edit", label: "Edit", run: () => openEdit(t) });
    if (t.status === "active") {
      a.push({
        key: "generate",
        label: "Generate this month now",
        run: () =>
          confirmAct(
            t,
            "generate",
            `Create ${periodLabel(thisPeriod())}'s invoice for ${t.templateId} now?`,
          ),
      });
      a.push({
        key: "pause",
        label: "Pause",
        run: () =>
          confirmAct(
            t,
            "pause",
            `Pause ${t.templateId}? No invoices will be created until it is resumed.`,
          ),
      });
    }
    if (t.status === "paused")
      a.push({ key: "resume", label: "Resume", run: () => act(t, "resume") });
    if (t.status !== "ended")
      a.push({
        key: "end",
        label: "End",
        tone: "danger",
        run: () =>
          confirmAct(
            t,
            "end",
            `End ${t.templateId} permanently? Already-created invoices are kept.`,
          ),
      });
    return a;
  };

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>🔁 Fixed Payments</h1>
            <p style={S.sub}>
              Monthly payments created automatically on their day — already
              approved, straight to Payment Processing.
            </p>
          </div>
          {isAccounts && (
            <button style={S.createBtn} onClick={openCreate}>
              + New Fixed Payment
            </button>
          )}
        </div>

        {notice && <div style={S.success}>{notice}</div>}
        {error && (
          <div style={S.error} onClick={() => setError("")}>
            {error} <span style={{ float: "right", cursor: "pointer" }}>✕</span>
          </div>
        )}

        <div style={S.filterRow}>
          <div style={S.chips}>
            {CHIPS.map((c) => {
              const n = c
                ? counts[c] || 0
                : Object.values(counts).reduce((a, b) => a + b, 0);
              const active = status === c;
              return (
                <button
                  key={c || "all"}
                  style={{ ...S.chip, ...(active ? S.chipActive : {}) }}
                  onClick={() => setStatus(c)}
                >
                  {c ? STATUS[c].label : "All"}{" "}
                  <span style={S.chipCount}>{n}</span>
                </button>
              );
            })}
          </div>
          <input
            style={S.search}
            placeholder="Search FP id or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={S.card}>
          {loading ? (
            <div style={S.empty}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={S.empty}>
              No fixed payments
              {status ? ` with status "${STATUS[status].label}"` : ""} yet.
              {isAccounts &&
                !status &&
                " Set one up for rent, AMC or any payment that repeats every month."}
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  {[
                    "Fixed Payment",
                    "Branch",
                    "Vendor",
                    "Monthly",
                    "Created on",
                    "Status",
                    "Last created",
                    "",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const st = STATUS[t.status] || STATUS.ended;
                  const amt = preview(
                    t.amount,
                    t.gstPercentage,
                    t.tdsPercentage,
                  );
                  return (
                    <tr key={t._id} style={S.tr} onClick={() => openDetail(t)}>
                      <td style={S.td}>
                        <div style={S.mono}>{t.templateId}</div>
                        <div style={{ fontWeight: 600, color: C.ink }}>
                          {t.title}
                        </div>
                      </td>
                      <td style={S.td}>{t.branch?.name || "—"}</td>
                      <td style={S.td}>{t.vendor?.vendorName || "—"}</td>
                      <td style={{ ...S.td, fontWeight: 700 }}>
                        {inr(amt.net)}
                        <div style={S.small}>net of GST/TDS</div>
                      </td>
                      <td style={S.td}>
                        {ordinal(t.dayOfMonth)} of month
                        <div style={S.small}>
                          {periodLabel(t.startPeriod)}
                          {t.endPeriod
                            ? ` → ${periodLabel(t.endPeriod)}`
                            : " onwards"}
                        </div>
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            ...S.badge,
                            background: st.bg,
                            color: st.color,
                          }}
                        >
                          {st.label}
                        </span>
                        {t.lastError?.message && t.status === "active" && (
                          <div
                            style={{ ...S.small, color: "#b45309" }}
                            title={t.lastError.message}
                          >
                            ⚠ {periodLabel(t.lastError.period)} not created
                          </div>
                        )}
                      </td>
                      <td style={S.td}>{periodLabel(t.lastGeneratedPeriod)}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        <span style={S.view}>View ›</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Detail drawer ─────────────────────────────── */}
        {detail && (
          <div style={S.overlay} onClick={() => setDetail(null)}>
            <div style={S.drawer} onClick={(e) => e.stopPropagation()}>
              <div style={S.drawerHead}>
                <div>
                  <div style={S.mono}>{detail.templateId}</div>
                  <h3 style={{ margin: "2px 0 0", color: C.primary }}>
                    {detail.title}
                  </h3>
                </div>
                <button style={S.close} onClick={() => setDetail(null)}>
                  ✕
                </button>
              </div>

              {detail.status === "rejected" && detail.rejectionReason && (
                <div style={S.warn}>
                  Rejected: {detail.rejectionReason}. Edit it to resubmit.
                </div>
              )}
              {detail.status === "pending_approval" && (
                <div style={S.info}>
                  Waiting for Super Admin approval. No invoices are created
                  until it is approved.
                </div>
              )}
              {detail.lastError?.message && detail.status === "active" && (
                <div style={S.warn}>
                  {periodLabel(detail.lastError.period)} could not be created:{" "}
                  {detail.lastError.message}. Fix it, then use "Generate this
                  month now".
                </div>
              )}

              <div style={S.grid}>
                <Row k="Status" v={(STATUS[detail.status] || {}).label} />
                <Row k="Branch" v={detail.branch?.name} />
                <Row k="Vendor" v={detail.vendor?.vendorName} />
                <Row
                  k="Category"
                  v={`${detail.expenseType} · ${detail.expenseCategory?.name || "—"}`}
                />
                <Row k="Base amount" v={inr(detail.amount)} />
                <Row
                  k="GST / TDS"
                  v={`${detail.gstPercentage || 0}% / ${detail.tdsPercentage || 0}%`}
                />
                <Row
                  k="Net payable"
                  v={inr(
                    preview(
                      detail.amount,
                      detail.gstPercentage,
                      detail.tdsPercentage,
                    ).net,
                  )}
                  bold
                />
                <Row
                  k="Created on"
                  v={`${ordinal(detail.dayOfMonth)} of every month`}
                />
                <Row
                  k="Months"
                  v={`${periodLabel(detail.startPeriod)}${detail.endPeriod ? ` → ${periodLabel(detail.endPeriod)}` : " onwards"}`}
                />
                <Row k="Set up by" v={detail.createdBy?.name} />
                <Row
                  k="Approved by"
                  v={
                    detail.approvedBy
                      ? `${detail.approvedBy.name} · ${new Date(detail.approvedAt).toLocaleDateString("en-GB")}`
                      : "—"
                  }
                />
                <Row
                  k="Agreement"
                  v={
                    detail.agreement?.url ? (
                      <a
                        href={detail.agreement.url}
                        target="_blank"
                        rel="noreferrer"
                        style={S.link}
                      >
                        {detail.agreement.name}
                      </a>
                    ) : (
                      <span style={{ color: "#dc2626" }}>Not uploaded</span>
                    )
                  }
                />
              </div>
              {detail.description && <p style={S.desc}>{detail.description}</p>}

              <div style={S.actions}>
                {actionsFor(detail).map((a) => (
                  <button
                    key={a.key}
                    disabled={!!busy}
                    onClick={a.run}
                    style={{
                      ...S.actBtn,
                      ...(a.tone === "primary" ? S.actPrimary : {}),
                      ...(a.tone === "danger" ? S.actDanger : {}),
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy === `${a.key}_${detail._id}` ? "…" : a.label}
                  </button>
                ))}
              </div>

              <div style={S.sectionTitle}>Invoices created</div>
              {!detail.invoices?.length ? (
                <div style={S.small}>None yet.</div>
              ) : (
                <table style={{ ...S.table, fontSize: 12.5 }}>
                  <tbody>
                    {detail.invoices.map((inv) => (
                      <tr
                        key={inv._id}
                        style={S.tr}
                        onClick={() => navigate(`/invoices/${inv._id}`)}
                      >
                        <td style={S.tdSm}>{periodLabel(inv.fixedPeriod)}</td>
                        <td style={{ ...S.tdSm, ...S.mono }}>
                          {inv.requestId}
                        </td>
                        <td style={S.tdSm}>{inr(inv.netPayable)}</td>
                        <td style={S.tdSm}>
                          {inv.paymentRequest?.status || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <details style={{ marginTop: 14 }}>
                <summary style={S.summary}>History</summary>
                <ul style={S.history}>
                  {[...(detail.history || [])].reverse().map((h, i) => (
                    <li key={i}>
                      <strong>
                        {h.action.replace(/_/g, " ").toLowerCase()}
                      </strong>{" "}
                      · {h.by?.name || "System"} ·{" "}
                      {new Date(h.at).toLocaleString("en-GB")}
                      {h.remarks ? ` — ${h.remarks}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        )}

        {/* ── Reject modal ──────────────────────────────── */}
        {rejectFor && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={S.modalTitle}>Reject {rejectFor.templateId}</h3>
              <textarea
                style={{ ...S.input, minHeight: 80 }}
                placeholder="Reason (required)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <div style={S.modalBtns}>
                <button style={S.cancelBtn} onClick={() => setRejectFor(null)}>
                  Cancel
                </button>
                <button
                  style={{
                    ...S.saveBtn,
                    background: "#dc2626",
                    opacity: rejectReason.trim() ? 1 : 0.5,
                  }}
                  disabled={!rejectReason.trim() || !!busy}
                  onClick={async () => {
                    await act(rejectFor, "reject", {
                      reason: rejectReason.trim(),
                    });
                    setRejectFor(null);
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Create / edit modal ───────────────────────── */}
        {modal && (
          <div style={S.overlay}>
            <div style={{ ...S.modal, maxWidth: 640 }}>
              <h3 style={S.modalTitle}>
                {modal === "create"
                  ? "New Fixed Payment"
                  : "Edit Fixed Payment"}
              </h3>
              <p style={S.small}>
                Super Admin approves this once. After that, each month's invoice
                is created automatically and appears in Payment Processing — no
                branch upload or invoice approvals needed.
              </p>

              <div style={S.formGrid}>
                <Field label="Title *" full>
                  <input
                    style={S.input}
                    value={form.title}
                    placeholder="e.g. Shop rent – Kothrud"
                    onChange={(e) => setField("title", e.target.value)}
                  />
                </Field>
                <Field label="Branch *">
                  <SearchableSelect
                    options={branches}
                    value={form.branch}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, branch: v, vendor: "" }))
                    }
                    getOptionLabel={(b) =>
                      `${b.name}${b.code ? ` (${b.code})` : ""}`
                    }
                    placeholder="Select branch"
                  />
                </Field>
                <Field label="Vendor *">
                  <SearchableSelect
                    options={vendors}
                    value={form.vendor}
                    onChange={(v) => setField("vendor", v)}
                    getOptionLabel={(v) => v.vendorName}
                    placeholder={
                      form.branch ? "Select vendor" : "Select branch first"
                    }
                    disabled={!form.branch}
                  />
                </Field>
                <Field label="Expense type *">
                  <select
                    style={S.input}
                    value={form.expenseType}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        expenseType: e.target.value,
                        expenseCategory: "",
                      }))
                    }
                  >
                    <option>Revenue</option>
                    <option>Capital</option>
                  </select>
                </Field>
                <Field label="Expense category *">
                  <SearchableSelect
                    options={categories}
                    value={form.expenseCategory}
                    onChange={(v) => setField("expenseCategory", v)}
                    getOptionLabel={(c) =>
                      `${c.name}${c.code ? ` (${c.code})` : ""}`
                    }
                    placeholder="Select category"
                  />
                </Field>
                <Field label="Monthly base amount (₹, before GST) *">
                  <input
                    style={S.input}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setField("amount", e.target.value)}
                  />
                </Field>
                <Field label="GST %">
                  <input
                    style={S.input}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.gstPercentage}
                    onChange={(e) => setField("gstPercentage", e.target.value)}
                  />
                </Field>
                <Field label="TDS %">
                  <input
                    style={S.input}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.tdsPercentage}
                    onChange={(e) => setField("tdsPercentage", e.target.value)}
                  />
                </Field>
                <Field label="Create invoice on day *">
                  <select
                    style={S.input}
                    value={form.dayOfMonth}
                    onChange={(e) => setField("dayOfMonth", e.target.value)}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {ordinal(d)}
                        {d > 28 ? " (or month end)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Start month *">
                  <input
                    style={S.input}
                    type="month"
                    value={form.startPeriod}
                    onChange={(e) => setField("startPeriod", e.target.value)}
                  />
                </Field>
                <Field label="End month (optional)">
                  <input
                    style={S.input}
                    type="month"
                    value={form.endPeriod}
                    onChange={(e) => setField("endPeriod", e.target.value)}
                  />
                </Field>
                <Field label="Description" full>
                  <input
                    style={S.input}
                    value={form.description}
                    placeholder="Shown on each month's invoice"
                    onChange={(e) => setField("description", e.target.value)}
                  />
                </Field>
                <Field
                  label={`Agreement / contract ${modal === "create" ? "*" : "(upload to replace)"}`}
                  full
                >
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) =>
                      setAgreementFile(e.target.files?.[0] || null)
                    }
                  />
                </Field>
              </div>

              <div style={S.previewBox}>
                Each month: {inr(p.base)} + GST {inr(p.gst)} − TDS {inr(p.tds)}{" "}
                = <strong>{inr(p.net)}</strong> net payable, created on the{" "}
                {ordinal(Number(form.dayOfMonth) || 1)}.
                {form.startPeriod === thisPeriod() &&
                  Number(form.dayOfMonth) <= new Date().getDate() && (
                    <div style={{ marginTop: 4, color: "#b45309" }}>
                      This month's day has passed — this month's invoice will be
                      created as soon as it is approved.
                    </div>
                  )}
              </div>

              {formError && <div style={S.error}>{formError}</div>}
              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  disabled={saving}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  style={{ ...S.saveBtn, opacity: saving ? 0.6 : 1 }}
                  disabled={saving}
                  onClick={save}
                >
                  {saving
                    ? "Saving…"
                    : modal === "create"
                      ? "Save & send for approval"
                      : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const Row = ({ k, v, bold }) => (
  <div style={S.row}>
    <span style={S.k}>{k}</span>
    <span style={{ ...S.v, fontWeight: bold ? 700 : 500 }}>{v || "—"}</span>
  </div>
);

const Field = ({ label, children, full }) => (
  <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
    <label style={S.label}>{label}</label>
    {children}
  </div>
);

const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", minWidth: 0 },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 18,
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: C.muted, marginTop: 4 },
  createBtn: {
    padding: "10px 18px",
    background: C.teal,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  success: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#166534",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  error: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  warn: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 12.5,
    marginBottom: 12,
  },
  info: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e40af",
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 12.5,
    marginBottom: 12,
  },
  filterRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  chips: { display: "flex", gap: 6, flexWrap: "wrap" },
  chip: {
    background: "#fff",
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12.5,
    cursor: "pointer",
    color: "#334155",
  },
  chipActive: { background: C.primary, borderColor: C.primary, color: "#fff" },
  chipCount: { marginLeft: 4, fontWeight: 700 },
  search: {
    padding: "8px 12px",
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    fontSize: 13,
    minWidth: 220,
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  empty: { padding: 32, textAlign: "center", color: C.muted, fontSize: 14 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 11.5,
    fontWeight: 700,
    color: C.muted,
    padding: "11px 14px",
    borderBottom: `1px solid ${C.line}`,
    background: "#f8fafc",
    whiteSpace: "nowrap",
  },
  tr: { cursor: "pointer", borderBottom: "1px solid #f1f5f9" },
  td: {
    padding: "11px 14px",
    fontSize: 13,
    color: "#334155",
    verticalAlign: "top",
  },
  tdSm: { padding: "7px 8px", color: "#334155" },
  mono: {
    fontFamily: "monospace",
    fontSize: 12,
    color: C.teal,
    fontWeight: 700,
  },
  small: { fontSize: 11.5, color: C.faint, marginTop: 2 },
  badge: {
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  view: { color: C.teal, fontSize: 12.5, fontWeight: 600 },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.5)",
    display: "flex",
    justifyContent: "flex-end",
    zIndex: 1000,
  },
  drawer: {
    background: "#fff",
    width: "100%",
    maxWidth: 520,
    height: "100%",
    overflowY: "auto",
    padding: "20px 22px",
    boxShadow: "-8px 0 30px rgba(0,0,0,0.15)",
  },
  drawerHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  close: {
    background: "none",
    border: "none",
    fontSize: 18,
    color: C.faint,
    cursor: "pointer",
  },
  grid: {
    border: `1px solid ${C.line}`,
    borderRadius: 10,
    padding: "6px 12px",
    marginBottom: 12,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "6px 0",
    fontSize: 13,
    borderBottom: "1px solid #f8fafc",
  },
  k: { color: C.muted, whiteSpace: "nowrap" },
  v: { color: C.ink, textAlign: "right" },
  link: { color: C.teal, fontWeight: 600 },
  desc: { fontSize: 12.5, color: C.muted, margin: "0 0 12px" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 },
  actBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid #cbd5e1`,
    background: "#fff",
    color: "#334155",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  actPrimary: { background: "#16a34a", borderColor: "#16a34a", color: "#fff" },
  actDanger: { color: "#dc2626", borderColor: "#fecaca" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: C.primary,
    margin: "6px 0 6px",
    letterSpacing: 0.3,
  },
  summary: {
    fontSize: 12.5,
    color: C.teal,
    fontWeight: 600,
    cursor: "pointer",
  },
  history: { fontSize: 12, color: C.muted, paddingLeft: 18, lineHeight: 1.7 },
  modal: {
    background: "#fff",
    borderRadius: 12,
    padding: "20px 22px",
    width: "100%",
    maxWidth: 460,
    margin: "auto",
    maxHeight: "92vh",
    overflowY: "auto",
    boxShadow: "0 20px 45px rgba(0,0,0,0.22)",
  },
  modalTitle: {
    margin: "0 0 6px",
    fontSize: 17,
    fontWeight: 700,
    color: C.primary,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
    marginTop: 12,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    marginBottom: 5,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 11px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13.5,
    fontFamily: "inherit",
  },
  previewBox: {
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 12.5,
    color: "#134e4a",
    margin: "14px 0",
  },
  modalBtns: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 12,
  },
  cancelBtn: {
    background: "#fff",
    color: "#475569",
    border: "1px solid #cbd5e1",
    padding: "9px 18px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  saveBtn: {
    background: C.teal,
    color: "#fff",
    border: "none",
    padding: "9px 18px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
};
