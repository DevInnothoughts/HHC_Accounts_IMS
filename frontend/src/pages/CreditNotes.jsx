// ============================================================
// FRONTEND: src/pages/CreditNotes.jsx — NEW FILE
// ------------------------------------------------------------
// All credit notes in the user's branches, and the approval queue for
// Accounts / Super Admin. Credit notes are recorded from the invoice page
// (Invoice → Credit Notes → Add) by branch users, Accounts or Super Admin.
// ============================================================
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS = {
  pending_approval: {
    label: "Pending approval",
    bg: "#fffbeb",
    color: "#b45309",
  },
  approved: { label: "Approved", bg: "#f0fdf4", color: "#16a34a" },
  rejected: { label: "Rejected", bg: "#fef2f2", color: "#dc2626" },
  cancelled: { label: "Cancelled", bg: "#f8fafc", color: "#94a3b8" },
};
const CHIPS = ["pending_approval", "approved", "rejected", "cancelled", ""];
const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CreditNotes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canApprove = ["accounts", "super_admin"].includes(user?.role);
  const me = String(user?._id || user?.id || "");

  const [status, setStatus] = useState("pending_approval");
  const [notes, setNotes] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const canAdd = ["branch_user", "accounts", "super_admin"].includes(
    user?.role,
  );
  // "+ New Credit Note": pick a fully approved invoice, then open its form.
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!picker) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          status: "Cluster Head Approved",
          limit: "15",
          page: "1",
        });
        if (q.trim()) params.set("search", q.trim());
        const { data } = await api.get(`/invoices?${params}`);
        setFound(
          data.invoices || data.requests || (Array.isArray(data) ? data : []),
        );
      } catch {
        setFound([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [picker, q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(
        `/credit-notes${status ? `?status=${status}` : ""}`,
      );
      setNotes(data.notes || []);
      setCounts(data.counts || {});
    } catch (err) {
      setMsg(err.response?.data?.message || "Could not load credit notes");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (cn, action) => {
    let body = {};
    if (action === "reject") {
      const reason = window.prompt(`Reason for rejecting ${cn.creditNoteId}:`);
      if (!reason?.trim()) return;
      body = { reason: reason.trim() };
    } else if (
      !window.confirm(
        action === "approve"
          ? `Approve ${cn.creditNoteId}? ${cn.invoice?.requestId} net payable reduces by ${inr(cn.netReduction)}.`
          : `Cancel ${cn.creditNoteId}?`,
      )
    )
      return;
    setBusy(`${action}_${cn._id}`);
    setMsg("");
    try {
      await api.patch(`/credit-notes/${cn._id}/${action}`, body);
      setMsg(
        `${cn.creditNoteId} ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "cancelled"}.`,
      );
      load();
    } catch (err) {
      setMsg(err.response?.data?.message || "Action failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h1 style={S.title}>🧾 Credit Notes</h1>
          {canAdd && (
            <button
              style={S.newBtn}
              onClick={() => {
                setQ("");
                setPicker(true);
              }}
            >
              + New Credit Note
            </button>
          )}
        </div>
        <p style={S.sub}>
          Goods returned against approved invoices. Record a credit note from
          the invoice page; it reduces the invoice only after it is approved by
          Accounts.
        </p>

        {msg && (
          <div style={S.msg} onClick={() => setMsg("")}>
            {msg}
          </div>
        )}

        <div style={S.chips}>
          {CHIPS.map((c) => {
            const n = c
              ? counts[c] || 0
              : Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <button
                key={c || "all"}
                style={{ ...S.chip, ...(status === c ? S.chipOn : {}) }}
                onClick={() => setStatus(c)}
              >
                {c ? STATUS[c].label : "All"}{" "}
                <strong style={{ marginLeft: 4 }}>{n}</strong>
              </button>
            );
          })}
        </div>

        <div style={S.card}>
          {loading ? (
            <div style={S.empty}>Loading…</div>
          ) : !notes.length ? (
            <div style={S.empty}>No credit notes here.</div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  {[
                    "Credit note",
                    "Invoice",
                    "Branch / Vendor",
                    "Returned",
                    "Net reduction",
                    "Status",
                    "",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {notes.map((cn) => {
                  const st = STATUS[cn.status] || STATUS.cancelled;
                  const mine = String(cn.createdBy?._id) === me;
                  return (
                    <tr key={cn._id} style={S.tr}>
                      <td style={S.td}>
                        <div style={S.mono}>{cn.creditNoteId}</div>
                        <div style={S.small}>
                          Vendor CN {cn.vendorCreditNoteNumber} ·{" "}
                          {new Date(cn.creditNoteDate).toLocaleDateString(
                            "en-GB",
                          )}
                        </div>
                        <div style={S.small}>
                          by {cn.createdBy?.name || "—"}
                        </div>
                      </td>
                      <td style={S.td}>
                        <span
                          style={S.link}
                          onClick={() =>
                            navigate(`/invoices/${cn.invoice?._id}`)
                          }
                        >
                          {cn.invoice?.requestId}
                        </span>
                        <div style={S.small}>{cn.invoice?.invoiceNumber}</div>
                      </td>
                      <td style={S.td}>
                        {cn.branch?.name}
                        <div style={S.small}>{cn.vendor?.vendorName}</div>
                      </td>
                      <td style={S.td}>
                        {inr(cn.baseAmount)}
                        <div style={S.small}>
                          {cn.lines?.map((l) => l.description).join(", ")}
                        </div>
                      </td>
                      <td
                        style={{ ...S.td, fontWeight: 700, color: "#dc2626" }}
                      >
                        − {inr(cn.netReduction)}
                        {cn.applied?.refundDue > 0 && (
                          <div style={{ ...S.small, color: "#b45309" }}>
                            refund due {inr(cn.applied.refundDue)}
                          </div>
                        )}
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
                        <div style={S.small}>{cn.reason}</div>
                        {cn.document?.url && (
                          <a
                            href={cn.document.url}
                            target="_blank"
                            rel="noreferrer"
                            style={S.docLink}
                          >
                            Vendor document
                          </a>
                        )}
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        {cn.status === "pending_approval" &&
                          canApprove &&
                          !mine && (
                            <>
                              <button
                                style={S.ok}
                                disabled={!!busy}
                                onClick={() => decide(cn, "approve")}
                              >
                                Approve
                              </button>
                              <button
                                style={S.no}
                                disabled={!!busy}
                                onClick={() => decide(cn, "reject")}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        {cn.status === "pending_approval" &&
                          canApprove &&
                          mine && (
                            <div style={S.small}>
                              To be approved by another Accounts user
                            </div>
                          )}
                        {cn.status === "pending_approval" && mine && (
                          <button
                            style={S.no}
                            disabled={!!busy}
                            onClick={() => decide(cn, "cancel")}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {picker && (
          <div style={S.overlay} onClick={() => setPicker(false)}>
            <div style={S.modal} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ margin: 0, fontSize: 17, color: "#1a3c6e" }}>
                Select the invoice
              </h3>
              <p
                style={{
                  fontSize: 12.5,
                  color: "#64748b",
                  margin: "6px 0 10px",
                }}
              >
                Credit notes can be added to fully approved (Cluster Head
                Approved) invoices.
              </p>
              <input
                autoFocus
                style={S.search}
                placeholder="Search invoice ID, invoice no. or vendor…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div style={{ maxHeight: 340, overflowY: "auto", marginTop: 8 }}>
                {searching ? (
                  <div style={S.empty}>Searching…</div>
                ) : !found.length ? (
                  <div style={S.empty}>No approved invoices found.</div>
                ) : (
                  found.map((inv) => (
                    <div
                      key={inv._id}
                      style={S.pick}
                      onClick={() =>
                        navigate(`/invoices/${inv._id}?creditNote=new`)
                      }
                    >
                      <div>
                        <span style={S.mono}>{inv.requestId}</span>{" "}
                        <span style={{ color: "#334155" }}>
                          {inv.invoiceNumber}
                        </span>
                        <div style={S.small}>
                          {inv.vendor?.vendorName} · {inv.branch?.name}
                        </div>
                      </div>
                      <strong>{inr(inv.netPayable)}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", minWidth: 0 },
  title: { fontSize: 24, fontWeight: 700, color: "#1a3c6e", margin: 0 },
  newBtn: {
    background: "#0f766e",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
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
    padding: "20px 22px",
    width: "100%",
    maxWidth: 520,
    boxShadow: "0 20px 45px rgba(0,0,0,0.22)",
  },
  search: {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13.5,
  },
  pick: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px",
    borderBottom: "1px solid #f1f5f9",
    cursor: "pointer",
    fontSize: 13,
  },
  sub: { fontSize: 13, color: "#64748b", margin: "4px 0 16px" },
  msg: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e40af",
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
    cursor: "pointer",
  },
  chips: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 },
  chip: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12.5,
    cursor: "pointer",
    color: "#334155",
  },
  chipOn: { background: "#1a3c6e", borderColor: "#1a3c6e", color: "#fff" },
  card: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  empty: { padding: 32, textAlign: "center", color: "#64748b", fontSize: 14 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 11.5,
    fontWeight: 700,
    color: "#64748b",
    padding: "11px 14px",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
    whiteSpace: "nowrap",
  },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: {
    padding: "11px 14px",
    fontSize: 13,
    color: "#334155",
    verticalAlign: "top",
  },
  mono: {
    fontFamily: "monospace",
    fontWeight: 700,
    color: "#0f766e",
    fontSize: 12.5,
  },
  small: { fontSize: 11.5, color: "#94a3b8", marginTop: 2 },
  badge: {
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  link: { color: "#2563eb", fontWeight: 600, cursor: "pointer" },
  docLink: {
    display: "inline-block",
    marginTop: 3,
    fontSize: 11.5,
    color: "#0f766e",
    fontWeight: 600,
  },
  ok: {
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 11px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    marginRight: 6,
  },
  no: {
    background: "#fff",
    color: "#dc2626",
    border: "1px solid #fecaca",
    borderRadius: 6,
    padding: "5px 11px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    marginRight: 6,
  },
};
