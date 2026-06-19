const AuditLog = require("../models/AuditLog");

const toPlain = (v) =>
  v && typeof v.toObject === "function" ? v.toObject() : v;

const isPlainObject = (v) =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

// When both old and new are objects, keep only the changed keys.
const diffValues = (oldVal, newVal) => {
  const o = toPlain(oldVal);
  const n = toPlain(newVal);
  if (!isPlainObject(o) || !isPlainObject(n))
    return { oldValue: o, newValue: n };

  const changedOld = {};
  const changedNew = {};
  const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
  for (const k of keys) {
    if (["_id", "__v", "createdAt", "updatedAt"].includes(k)) continue;
    if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) {
      changedOld[k] = o[k];
      changedNew[k] = n[k];
    }
  }
  return { oldValue: changedOld, newValue: changedNew };
};

const logAction = async ({
  userId,
  action,
  module,
  targetId,
  oldValue,
  newValue,
  req,
}) => {
  try {
    const { oldValue: oldDiff, newValue: newDiff } = diffValues(
      oldValue,
      newValue,
    );

    await AuditLog.create({
      user: userId,
      action,
      module,
      targetId,
      oldValue: oldDiff,
      newValue: newDiff,
      ipAddress: req?.ip,
      deviceInfo: req?.headers?.["user-agent"]?.slice(0, 120), // ✅ truncate UA
    });
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
};

module.exports = { logAction };
