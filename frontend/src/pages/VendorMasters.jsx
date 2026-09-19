// ============================================================
// FRONTEND: src/pages/VendorMasters.jsx  —  NEW FILE
// Group-level vendor list (one row per PAN). Accounts / super admin.
// ============================================================
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  APPROVAL_STATUS_STYLES,
  VENDOR_STATUS_STYLES,
} from "../config/constants.js";

const PAGE_SIZE = 15;
const STATE_KEY = "vendorMasterListState";
const EMPTY_FILTERS = { approvalStatus: "", status: "", linked: "" };

const readSaved = () => {
  try {
    return JSON.parse(sessionStorage.getItem(STATE_KEY)) || {};
  } catch {
    return {};
  }
};

export default function VendorMasters() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = ["accounts", "super_admin"].includes(user?.role);

  const saved = useMemo(readSaved, []);
  const [search, setSearch] = useState(saved.search || "");
  const [debounced, setDebounced] = useState(saved.search || "");
  const [filters, setFilters] = useState({
    ...EMPTY_FILTERS,
    ...(saved.filters || {}),
  });
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  // One request per pause in typing, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ search, filters }));
    } catch {
      /* private mode — persistence is a convenience only */
    }
  }, [search, filters]);

  const params = useCallback(
    (extra = {}) =>
      new URLSearchParams({
        ...(debounced && { search: debounced }),
        ...(filters.approvalStatus && {
          approvalStatus: filters.approvalStatus,
        }),
        ...(filters.status && { status: filters.status }),
        ...(filters.linked && { linked: filters.linked }),
        ...extra,
      }),
    [debounced, filters],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(
        `/vendor-masters?${params({ page, limit: PAGE_SIZE })}`,
      );
      setRows(data.masters || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load vendor masters");
    } finally {
      setLoading(false);
    }
  }, [params, page]);

  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      const res = await api.get(`/vendor-masters/export/excel?${params()}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(
        new Blob([res.data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Vendor_Master_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      let msg = `Export failed (${err.response?.status ?? "network error"})`;
      try {
        const raw = await err.response.data.text();
        msg = JSON.parse(raw).message || raw.slice(0, 120);
      } catch {
        /* keep status message */
      }
      setError(msg);
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    Boolean(search) || Object.values(filters).some((v) => Boolean(v));

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <h1 style={S.title}>Vendor Master</h1>
            <p style={S.sub}>
              {total} vendor{total === 1 ? "" : "s"} across the group · one
              record per PAN, shared by every branch
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              style={{
                ...S.exportBtn,
                opacity: exporting || loading || !total ? 0.55 : 1,
                cursor: exporting || !total ? "not-allowed" : "pointer",
              }}
              disabled={exporting || loading || !total}
              onClick={handleExport}
              title="Downloads the vendor masters matching your filters"
            >
              {exporting ? "⏳ Preparing..." : "📊 Download Excel"}
            </button>
            {isAdmin && (
              <button
                style={S.createBtn}
                onClick={() => navigate("/vendor-masters/new")}
              >
                + New Vendor Master
              </button>
            )}
          </div>
        </div>

        {error && <div style={S.errorBox}>{error}</div>}

        <div style={S.filterBar}>
          <input
            style={S.searchInput}
            placeholder="Search name, company, PAN, GST..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            style={S.select}
            value={filters.approvalStatus}
            onChange={setFilter("approvalStatus")}
          >
            <option value="">All Approval Status</option>
            {Object.entries(APPROVAL_STATUS_STYLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label.replace(/^[^A-Za-z]+/, "")}
              </option>
            ))}
          </select>
          <select
            style={S.select}
            value={filters.status}
            onChange={setFilter("status")}
          >
            <option value="">All Statuses</option>
            {Object.entries(VENDOR_STATUS_STYLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <select
            style={S.select}
            value={filters.linked}
            onChange={setFilter("linked")}
          >
            <option value="">Any branch usage</option>
            <option value="yes">Used by a branch</option>
            <option value="no">Not linked to any branch</option>
          </select>
          {hasFilters && (
            <button
              style={S.resetBtn}
              onClick={() => {
                setSearch("");
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              Reset
            </button>
          )}
        </div>

        <div style={S.tableCard}>
          {loading ? (
            <div style={S.empty}>Loading vendor masters...</div>
          ) : rows.length === 0 ? (
            <div style={S.empty}>
              {hasFilters
                ? "No vendor masters match these filters."
                : "No vendor masters yet."}
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  {[
                    "Vendor",
                    "PAN / GST",
                    "Bank",
                    "Branches",
                    "Approval",
                    "Status",
                    "",
                  ].map((h, i) => (
                    <th key={i} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const ap =
                    APPROVAL_STATUS_STYLES[m.approvalStatus] ||
                    APPROVAL_STATUS_STYLES.draft;
                  const st =
                    VENDOR_STATUS_STYLES[m.status] ||
                    VENDOR_STATUS_STYLES.active;
                  return (
                    <tr
                      key={m._id}
                      style={S.tr}
                      onClick={() => navigate(`/vendor-masters/${m._id}`)}
                    >
                      <td style={S.td}>
                        <div style={S.name}>{m.vendorName}</div>
                        <div style={S.subText}>
                          {m.companyName || m.vendorCategory || "—"}
                        </div>
                      </td>
                      <td style={S.td}>
                        <div style={S.mono}>{m.panNumber || "—"}</div>
                        {m.gstNumber && (
                          <div style={{ ...S.mono, color: "#94a3b8" }}>
                            {m.gstNumber}
                          </div>
                        )}
                      </td>
                      <td style={S.td}>
                        <div style={{ fontSize: 12 }}>{m.bankName || "—"}</div>
                        {m.accountNumber && (
                          <div style={{ ...S.mono, color: "#94a3b8" }}>
                            ****{String(m.accountNumber).slice(-4)}
                          </div>
                        )}
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            ...S.countBadge,
                            ...(m.linkedBranchCount
                              ? {}
                              : { background: "#f8fafc", color: "#94a3b8" }),
                          }}
                        >
                          {m.linkedBranchCount || 0}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            ...S.badge,
                            background: ap.bg,
                            color: ap.color,
                          }}
                        >
                          {ap.label}
                        </span>
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
                      </td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        {isAdmin && (
                          <button
                            style={S.actionBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/vendor-masters/${m._id}/edit`);
                            }}
                          >
                            ✏️ Edit
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

        {total > PAGE_SIZE && (
          <div style={S.pagination}>
            <button
              style={S.pageBtn}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span style={S.pageInfo}>
              Page {page} of {pages} · {total} results
            </span>
            <button
              style={S.pageBtn}
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

const C = { primary: "#1a3c6e", accent: "#2563eb", border: "#e2e8f0" };
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", minWidth: 0 },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    flexWrap: "wrap",
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: "#64748b", marginTop: 4 },
  createBtn: {
    padding: "10px 18px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  exportBtn: {
    padding: "10px 18px",
    background: "#fff",
    color: "#16a34a",
    border: "1.5px solid #bbf7d0",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  filterBar: {
    display: "flex",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  searchInput: {
    flex: 1,
    minWidth: 220,
    padding: "9px 14px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
  },
  select: {
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    background: "#fff",
    color: "#334155",
  },
  resetBtn: {
    padding: "9px 14px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    fontSize: 13,
    color: "#64748b",
    cursor: "pointer",
  },
  tableCard: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  thead: { background: "#f8fafc" },
  th: {
    padding: "11px 14px",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  },
  tr: { borderBottom: "1px solid #f1f5f9", cursor: "pointer" },
  td: { padding: "12px 14px", fontSize: 13, color: "#334155" },
  name: { fontWeight: 600, color: C.primary },
  subText: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  mono: { fontFamily: "monospace", fontSize: 12 },
  countBadge: {
    display: "inline-block",
    minWidth: 26,
    textAlign: "center",
    padding: "2px 8px",
    borderRadius: 20,
    background: "#eff6ff",
    color: C.accent,
    fontWeight: 700,
    fontSize: 12,
  },
  badge: {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  actionBtn: {
    padding: "5px 10px",
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    background: "#fff",
    fontSize: 12,
    color: "#475569",
    cursor: "pointer",
  },
  empty: { padding: 50, textAlign: "center", color: "#94a3b8", fontSize: 14 },
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    marginTop: 16,
  },
  pageBtn: {
    padding: "7px 14px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  },
  pageInfo: { fontSize: 13, color: "#64748b" },
};
