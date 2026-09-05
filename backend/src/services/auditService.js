// ============================================================
// BACKEND: src/services/auditService.js — REPLACE WHOLE FILE
// ------------------------------------------------------------
// Backwards compatible: every existing logAction call keeps working
// unchanged. Pass `targetDoc` as well and the label, branch and
// amount are derived automatically.
//
//   Before:  logAction({ userId, action, module, targetId, req })
//   After:   logAction({ userId, action, module, targetDoc: invoice,
//                        statusFrom, statusTo, reason, req })
// ============================================================
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

// module string (as already passed by the controllers) → model name
const MODULE_TO_MODEL = {
  Invoice: "InvoiceRequest",
  Payment: "PaymentProcessing",
  Vendor: "Vendor",
  Branch: "Branch",
  Budget: "Budget",
  User: "User",
  ExpenseCategory: "ExpenseCategory",
  SLA: "SLAConfig",
};

// Pull a human reference out of whatever document was acted on.
const labelOf = (doc) =>
  doc?.requestId ||
  doc?.paymentId ||
  doc?.vendorName ||
  doc?.name ||
  doc?.stageLabel ||
  doc?.stage ||
  doc?.code ||
  null;

const branchOf = (doc) => {
  const b = doc?.branch;
  if (!b) return null;
  return b._id || b;
};

const amountOf = (doc) =>
  doc?.netPayable ??
  doc?.totalAmount ??
  doc?.paymentAmount ??
  doc?.amount ??
  null;

const logAction = async ({
  userId,
  action,
  module,
  targetId,
  targetDoc, // optional — pass the document and the rest is derived
  targetLabel,
  branch,
  statusFrom,
  statusTo,
  amount,
  reason,
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
      targetId: targetId || targetDoc?._id,
      targetModel: MODULE_TO_MODEL[module] || undefined,
      targetLabel: targetLabel || labelOf(targetDoc) || undefined,
      branch: branch || branchOf(targetDoc) || undefined,
      statusFrom: statusFrom || undefined,
      statusTo: statusTo || undefined,
      amount: amount ?? amountOf(targetDoc) ?? undefined,
      reason: reason ? String(reason).slice(0, 500) : undefined,
      oldValue: oldDiff,
      newValue: newDiff,
      ipAddress: req?.ip,
      deviceInfo: req?.headers?.["user-agent"]?.slice(0, 120),
    });
  } catch (err) {
    // Never let an audit failure break the request it is recording.
    console.error("Audit log error:", err.message);
  }
};

module.exports = { logAction };
