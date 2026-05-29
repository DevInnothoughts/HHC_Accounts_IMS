import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: "🏠", roles: ["all"] },
  {
    label: "Invoice Processing",
    path: "/invoices",
    icon: "📋",
    roles: ["all"],
  },
  {
    label: "Payment Processing",
    path: "/payments",
    icon: "💳",
    roles: ["all"],
  },
  {
    label: "Vendors",
    path: "/vendors",
    icon: "🏢",
    roles: ["branch_user", "accounts", "super_admin"],
  },
  {
    label: "Branches",
    path: "/branches",
    icon: "🏥",
    roles: ["super_admin", "accounts"],
  },
  { label: "Users", path: "/users", icon: "👥", roles: ["super_admin"] },
  {
    label: "Expense Categories",
    path: "/expense-categories",
    icon: "📂",
    roles: ["super_admin", "accounts"],
  },
  {
    label: "Budget Management",
    path: "/budgets",
    icon: "💰",
    roles: ["super_admin", "accounts"],
  },
  // ✅ SLA now visible to accounts, branch_partner, cluster_head, super_admin
  {
    label: "SLA Dashboard",
    path: "/sla",
    icon: "⏱️",
    roles: ["super_admin", "accounts"],
  },
  {
    label: "Reports",
    path: "/reports",
    icon: "📊",
    roles: ["accounts", "super_admin"],
  },
  {
    label: "Audit Logs",
    path: "/audit-logs",
    icon: "🔍",
    roles: ["super_admin", "accounts"],
  },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const visible = navItems.filter(
    (item) => item.roles.includes("all") || item.roles.includes(user?.role),
  );

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>
        <div style={styles.logo}>HHC</div>
        <div>
          <div style={styles.brandName}>PMS</div>
          <div style={styles.brandSub}>Healing Hands Clinic</div>
        </div>
      </div>

      <nav style={styles.nav}>
        {visible.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              style={{ ...styles.navItem, ...(active ? styles.navActive : {}) }}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div style={styles.footer}>
        <div style={styles.userInfo}>
          <div style={styles.avatar}>{user?.name?.[0]?.toUpperCase()}</div>
          <div>
            <div style={styles.userName}>{user?.name}</div>
            <div style={styles.userRole}>{user?.role?.replace(/_/g, " ")}</div>
          </div>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn}>
          Logout
        </button>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: 240,
    background: "#1a3c6e",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    position: "sticky",
    top: 0,
    flexShrink: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "20px 18px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: "#2563eb",
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  brandName: { color: "#fff", fontWeight: 700, fontSize: 15 },
  brandSub: { color: "#a8c4e0", fontSize: 11 },
  nav: {
    flex: 1,
    padding: "12px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    color: "#a8c4e0",
    textDecoration: "none",
    fontSize: 14,
    transition: "all .15s",
  },
  navActive: {
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    fontWeight: 600,
  },
  navIcon: { fontSize: 16, width: 20, textAlign: "center" },
  footer: {
    padding: "12px 10px 16px",
    borderTop: "1px solid rgba(255,255,255,0.1)",
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    marginBottom: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#2563eb",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
    flexShrink: 0,
  },
  userName: { color: "#fff", fontSize: 13, fontWeight: 600 },
  userRole: { color: "#a8c4e0", fontSize: 11, textTransform: "capitalize" },
  logoutBtn: {
    width: "100%",
    padding: "8px",
    background: "rgba(220,38,38,0.15)",
    border: "1px solid rgba(220,38,38,0.3)",
    borderRadius: 8,
    color: "#fca5a5",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600,
  },
};
