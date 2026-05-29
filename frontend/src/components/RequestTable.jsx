import { useNavigate } from "react-router-dom";
import React from "react";

const STATUS_COLORS = {
  Draft: { bg: "#f1f5f9", color: "#475569" },
  Submitted: { bg: "#eff6ff", color: "#2563eb" },
  "Accounts Approved": { bg: "#f0fdf4", color: "#16a34a" },
  "Partner Approved": { bg: "#f0fdf4", color: "#16a34a" },
  "Cluster Head Approved": { bg: "#f0fdf4", color: "#16a34a" },
  "XML Generated": { bg: "#fefce8", color: "#d97706" },
  "Director Approved": { bg: "#f0fdf4", color: "#15803d" },
  Rejected: { bg: "#fef2f2", color: "#dc2626" },
  Closed: { bg: "#f8fafc", color: "#64748b" },
};

const PRIORITY_COLORS = {
  Normal: "#2563eb",
  Urgent: "#d97706",
  Critical: "#dc2626",
};

export default function RequestTable({ requests }) {
  const navigate = useNavigate();

  if (!requests?.length)
    return <div style={styles.empty}>No payment requests found.</div>;

  return (
    <div style={styles.wrapper}>
      <table style={styles.table}>
        <thead>
          <tr style={styles.thead}>
            {[
              "Request ID",
              "Branch",
              "Vendor",
              "Amount",
              "Priority",
              "Status",
              "Date",
            ].map((h) => (
              <th key={h} style={styles.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const sc = STATUS_COLORS[r.status] || {
              bg: "#f1f5f9",
              color: "#475569",
            };
            return (
              <tr
                key={r._id}
                style={styles.tr}
                onClick={() => navigate(`/payments/${r._id}`)}
              >
                <td style={styles.td}>
                  <span style={styles.reqId}>{r.requestId}</span>
                </td>
                <td style={styles.td}>{r.branch?.name || "-"}</td>
                <td style={styles.td}>{r.vendor?.vendorName || "-"}</td>
                <td style={{ ...styles.td, fontWeight: 600 }}>
                  ₹{r.netPayable?.toLocaleString("en-IN")}
                </td>
                <td style={styles.td}>
                  <span
                    style={{
                      ...styles.badge,
                      color: PRIORITY_COLORS[r.priority],
                      background: PRIORITY_COLORS[r.priority] + "18",
                      border: `1px solid ${PRIORITY_COLORS[r.priority]}30`,
                    }}
                  >
                    {r.priority}
                  </span>
                </td>
                <td style={styles.td}>
                  <span
                    style={{
                      ...styles.badge,
                      background: sc.bg,
                      color: sc.color,
                    }}
                  >
                    {r.status}
                  </span>
                </td>
                <td style={{ ...styles.td, color: "#888", fontSize: 12 }}>
                  {new Date(r.createdAt).toLocaleDateString("en-GB")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  wrapper: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  thead: { background: "#f8fafc" },
  th: {
    padding: "10px 14px",
    textAlign: "left",
    fontWeight: 600,
    color: "#475569",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    borderBottom: "1px solid #e2e8f0",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
    cursor: "pointer",
    transition: "background .1s",
  },
  td: { padding: "12px 14px", color: "#334155" },
  badge: {
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  reqId: {
    fontFamily: "monospace",
    fontWeight: 700,
    color: "#1a3c6e",
    fontSize: 13,
  },
  empty: { textAlign: "center", padding: "40px", color: "#94a3b8" },
};
