// ============================================================
// BACKEND: src/utils/doctorAccess.js — NEW FILE
// ------------------------------------------------------------
// Branch scope and small shared helpers for the doctor payout module.
// Accounts, Cluster / Department Heads (and branch roles) only ever see
// rows of their assigned branches; Super Admin and Director see all.
// ============================================================
const mongoose = require("mongoose");
const cfg = require("../config/doctorPayoutConfig");

const idStr = (v) => {
  const id = v && v._id ? v._id : v;
  return id == null ? "" : String(id);
};

const isScoped = (user) => cfg.BRANCH_SCOPED_ROLES.includes(user?.role);

const branchIdsOf = (user) => (user?.branches || []).map(idStr).filter(Boolean);

const toObjectIds = (ids) =>
  ids
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

// Value for a `branch` filter. `picked` is an optional branch chosen in
// the UI; a scoped user can only narrow to one of their own branches.
// Returns undefined when no branch condition applies (unscoped, no pick).
const branchCondition = (user, picked) => {
  const want = mongoose.isValidObjectId(picked) ? String(picked) : null;
  if (isScoped(user)) {
    const mine = branchIdsOf(user);
    if (want && mine.includes(want)) return new mongoose.Types.ObjectId(want);
    return { $in: toObjectIds(mine) };
  }
  return want ? new mongoose.Types.ObjectId(want) : undefined;
};

const inScope = (user, branchId) =>
  !isScoped(user) || branchIdsOf(user).includes(idStr(branchId));

const hasRole = (user, roles) => roles.includes(user?.role);

// Query-string values can arrive as objects (?x[$ne]=1); only plain,
// non-empty strings are ever used in a filter.
const qstr = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const paging = (query, fallback = 25, max = 200) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(
    max,
    Math.max(1, parseInt(query.limit, 10) || fallback),
  );
  return { page, limit, skip: (page - 1) * limit };
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Today in IST as YYYY-MM-DD (the server may run in UTC).
const istToday = () =>
  new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

// "2026-11-26" → Date at UTC midnight; anything else → null.
const isoToDate = (iso) => {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

module.exports = {
  idStr,
  isScoped,
  branchIdsOf,
  toObjectIds,
  branchCondition,
  inScope,
  hasRole,
  qstr,
  escapeRx,
  paging,
  round2,
  istToday,
  isoToDate,
};
