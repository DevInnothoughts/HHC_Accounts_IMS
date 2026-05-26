import React from "react";

export default function StatCard({ label, value, color, icon }) {
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${color}` }}>
      <div style={styles.top}>
        <span style={{ fontSize: 24 }}>{icon}</span>
        <span style={{ ...styles.value, color }}>{value}</span>
      </div>
      <div style={styles.label}>{label}</div>
    </div>
  );
}

const styles = {
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "18px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  top: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  value: { fontSize: 22, fontWeight: 700 },
  label: { fontSize: 13, color: "#666", fontWeight: 500 },
};
