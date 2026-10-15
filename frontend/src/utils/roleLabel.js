// ============================================================
// FRONTEND: src/utils/roleLabel.js — NEW FILE
// ------------------------------------------------------------
// "Department Head" is a Cluster Head under another title. The user's
// role stays "cluster_head" (same rights everywhere); only the label
// differs, via the optional `designation` field. Use these helpers
// wherever a role is shown to a person — never for permission checks,
// which must keep using user.role.
// ============================================================
export const ROLE_LABELS = {
  branch_user: "Branch User",
  branch_partner: "Branch Partner",
  cluster_head: "Cluster Head",
  department_head: "Department Head",
  accounts: "Accounts",
  director: "Director",
  super_admin: "Super Admin",
};

// The key the UI shows/selects for a user: "department_head" for a
// Cluster Head designated Department Head, otherwise the real role.
export const uiRoleOf = (u) =>
  u?.role === "cluster_head" && u?.designation === "Department Head"
    ? "department_head"
    : u?.role;

// Human label for a user (or for an audit actor { role, designation }).
export const roleLabel = (u) => {
  const key = uiRoleOf(u);
  return ROLE_LABELS[key] || (key ? key.replace(/_/g, " ") : "");
};
