// ============================================================
// BACKEND: src/services/vendorMasterService.js  —  NEW FILE
// ============================================================
// Logic shared by vendorMasterController, vendorController and (in
// Phase 3) scripts/buildVendorMaster.js. Anything that copies master
// data onto branch Vendor rows lives here, so there is exactly one
// implementation of "what a master-owned branch row looks like".
// ============================================================
const Vendor = require("../models/Vendor");
const VendorMaster = require("../models/VendorMaster");
const { logAction } = require("./auditService");
const { MASTER_OWNED_FIELDS, VENDOR_MASTER } = require("../config/constants");

const DOC_LABELS = {
  pan: "PAN Card",
  gst: "GST Certificate",
  cheque: "Cancelled Cheque",
  agreement: "Agreement Copy",
  msme: "MSME Certificate",
  other: "Other",
};

const ALLOWED_DOC_TYPES = Object.keys(DOC_LABELS);

// The master's value for every master-owned field. `undefined` becomes
// null so that $set clears a field the master no longer has, instead of
// leaving a stale value behind on the branch row.
const pickMasterFields = (master) => {
  const src =
    master && typeof master.toObject === "function"
      ? master.toObject()
      : master;
  const out = {};
  for (const f of MASTER_OWNED_FIELDS) {
    out[f] = src[f] === undefined ? null : src[f];
  }
  return out;
};

// Null, undefined and "" are the same "empty"; strings are trimmed.
const normVal = (v) => (v == null ? "" : String(v).trim());

// Field-by-field difference between a branch row and its master.
const diffFromMaster = (row, master) => {
  const m = pickMasterFields(master);
  const oldValue = {};
  const newValue = {};
  for (const f of MASTER_OWNED_FIELDS) {
    if (normVal(row[f]) !== normVal(m[f])) {
      oldValue[f] = row[f] ?? null;
      newValue[f] = m[f];
    }
  }
  return { changed: Object.keys(newValue), oldValue, newValue };
};

// "" is not a valid enum value; the forms send "" for an unchosen option.
// Normalise enum fields so a blank optional select means "not set".
const blankEnumsToUndefined = (
  data,
  fields = ["vendorCategory", "vendorType"],
) => {
  for (const f of fields) {
    if (f in data && (data[f] === "" || data[f] === null)) data[f] = undefined;
  }
  return data;
};

// Plain object ready for Vendor.create(): a branch row whose master-owned
// fields are a copy of the master and which holds no documents of its own.
const buildBranchRow = (
  master,
  {
    branch,
    vendorCategory,
    createdBy,
    approvalStatus = "draft",
    approvedBy = null,
    approvedAt = null,
    verifiedByAccounts = false,
    // The branch's own GSTIN (GST is per state). undefined → start from
    // the master's primary GSTIN; "" / null → the branch has none.
    gstNumber,
  },
) => ({
  ...pickMasterFields(master),
  branch,
  vendorCategory: vendorCategory || master.vendorCategory || undefined,
  gstNumber:
    gstNumber === undefined
      ? master.gstNumber || undefined
      : normVal(gstNumber).toUpperCase() || undefined,
  vendorMaster: master._id,
  sourceOfTruth: "master",
  documents: [],
  approvalStatus,
  approvedBy,
  approvedAt,
  verifiedByAccounts,
  status: "active",
  createdBy,
});

// ── The fan-out ─────────────────────────────────────────────
// Re-copies the master's fields onto every branch row that mirrors it.
// Must run after ANY change to a master's MASTER_OWNED_FIELDS, otherwise
// the FedOne file and the bulk payment Excel — which read bank details
// from the branch row via populate("vendor") — pay the old account.
//
// updateMany deliberately skips Vendor's validators: the values were
// validated on the master, and one atomic write beats a per-row save()
// loop that could fail half-way across 20 branches.
//
// Every row whose data actually changes gets its own audit entry, so a
// branch vendor's trail shows the bank account change even though nobody
// edited that row directly.
const syncMasterToBranchVendors = async (masterOrId, req, reason) => {
  // Always copy from the DATABASE, never from the caller's in-memory doc.
  // Two accounts users saving at once, or a link racing an edit, would
  // otherwise let a late sync write an older bank account over a newer
  // one. Re-reading makes every sync converge on what the master holds now.
  const master = await VendorMaster.findById(
    masterOrId && masterOrId._id ? masterOrId._id : masterOrId,
  ).lean();
  if (!master) return { matched: 0, modified: 0 };

  const rows = await Vendor.find({
    vendorMaster: master._id,
    sourceOfTruth: "master",
  })
    .select(`${MASTER_OWNED_FIELDS.join(" ")} branch`)
    .lean();

  const changedRows = rows
    .map((row) => ({ row, diff: diffFromMaster(row, master) }))
    .filter((x) => x.diff.changed.length > 0);

  if (changedRows.length) {
    await Vendor.updateMany(
      { _id: { $in: changedRows.map((x) => x.row._id) } },
      { $set: pickMasterFields(master) },
    );

    await Promise.all(
      changedRows.map(({ row, diff }) =>
        logAction({
          userId: req?.user?._id,
          action: "SYNC_FROM_VENDOR_MASTER",
          module: "Vendor",
          targetId: row._id,
          targetLabel: master.vendorName,
          branch: row.branch,
          reason: reason || "Vendor master details updated",
          oldValue: diff.oldValue,
          newValue: diff.newValue,
          req,
        }),
      ),
    );
  }

  // Branch GSTINs are not synced (they are per state), but the master's
  // list of them is rebuilt on every sync so it always reflects the links.
  await refreshMasterGstins(master._id);

  return { matched: rows.length, modified: changedRows.length };
};

// Documents a master must hold before it can be submitted or approved.
// Same rule as vendorController.submitVendor: PAN + cheque for standard
// vendors, plus the GST certificate whenever a GST number is recorded.
const requiredDocsFor = (master) => {
  const byType = VENDOR_MASTER.requiredDocsByType || {};
  const req = [...(byType[master.vendorType] || byType.standard || [])];
  if (normVal(master.gstNumber)) req.push("gst");
  return req;
};

const missingDocsFor = (master) => {
  const have = (master.documents || []).map((d) => d.type);
  return requiredDocsFor(master).filter((t) => !have.includes(t));
};

// ── GSTIN (kept per branch) ─────────────────────────────────
// A GSTIN belongs to a PAN when characters 3–12 are that PAN.
const gstMatchesPan = (gst, pan) =>
  normVal(gst).toUpperCase().slice(2, 12) === normVal(pan).toUpperCase();

// Validate a GSTIN for this PAN. Returns an error message or null.
const gstError = (gst, pan) => {
  const g = normVal(gst).toUpperCase();
  if (!g) return null; // optional
  if (!VENDOR_MASTER.GST_REGEX.test(g)) return "Invalid GSTIN format";
  if (pan && !gstMatchesPan(g, pan))
    return `GSTIN ${g} does not belong to PAN ${normVal(pan).toUpperCase()} (characters 3–12 must be the PAN)`;
  return null;
};

// Rebuild master.gstins from the master's primary GSTIN and the GSTINs of
// every branch vendor linked to it. Idempotent: always derived from the
// rows, so it can never drift. GSTINs that do not belong to the master's
// PAN are left out (they are data errors, shown on the Linked Branches
// panel instead).
const refreshMasterGstins = async (masterId) => {
  const master = await VendorMaster.findById(masterId)
    .select("panNumber gstNumber")
    .lean();
  if (!master) return [];
  const rows = await Vendor.find({ vendorMaster: masterId })
    .select("branch gstNumber")
    .lean();
  const primary = normVal(master.gstNumber).toUpperCase();
  const byGst = new Map();
  const add = (gst, branch) => {
    const g = normVal(gst).toUpperCase();
    if (!g || gstError(g, master.panNumber)) return;
    if (!byGst.has(g)) byGst.set(g, new Set());
    if (branch) byGst.get(g).add(String(branch));
  };
  add(primary, null);
  rows.forEach((r) => add(r.gstNumber, r.branch));
  const gstins = [...byGst.entries()]
    .map(([g, branches]) => ({
      gstNumber: g,
      stateCode: g.slice(0, 2),
      isPrimary: g === primary,
      branches: [...branches],
    }))
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.stateCode.localeCompare(b.stateCode),
    );
  await VendorMaster.updateOne({ _id: masterId }, { $set: { gstins } });
  return gstins;
};

const docLabels = (types) => types.map((t) => DOC_LABELS[t] || t).join(", ");

const maskAccount = (n) => (n ? `****${String(n).slice(-4)}` : null);

// What a branch user sees for a master none of their branches uses yet:
// enough to recognise the vendor and decide to link it. No documents, no
// full account number, no IFSC, no UPI, no personal contact details.
// Scope of the protection: this stops browsing, not a determined insider.
// With auto-approve on, a branch user who links an approved master sees
// full details from then on — every such link is audit-logged
// (LINK_VENDOR_MASTER), which is the real control.
const maskedView = (master) => {
  const m =
    master && typeof master.toObject === "function"
      ? master.toObject()
      : master;
  return {
    _id: m._id,
    vendorName: m.vendorName,
    companyName: m.companyName,
    vendorCategory: m.vendorCategory,
    vendorType: m.vendorType,
    panNumber: m.panNumber,
    gstNumber: m.gstNumber,
    msmeNumber: m.msmeNumber,
    businessAddress: m.businessAddress,
    bankName: m.bankName,
    accountNumberMasked: maskAccount(m.accountNumber),
    approvalStatus: m.approvalStatus,
    status: m.status,
    linkedBranchCount: m.linkedBranchCount,
    documentCount: (m.documents || []).length,
    masked: true,
  };
};

// Authoritative recount — $inc/$dec drift whenever a request dies half-way,
// so the counter is always rebuilt from the mapping rows themselves.
const recountLinks = async (masterId) => {
  const n = await Vendor.countDocuments({ vendorMaster: masterId });
  await VendorMaster.updateOne(
    { _id: masterId },
    { $set: { linkedBranchCount: n } },
  );
  return n;
};

// Masters frozen / blacklisted / inactive at group level. Their branch
// rows must drop out of every "active vendors" list. Small set, cheap.
const blockedMasterIds = () =>
  VendorMaster.distinct("_id", { status: { $ne: "active" } });

module.exports = {
  DOC_LABELS,
  ALLOWED_DOC_TYPES,
  pickMasterFields,
  diffFromMaster,
  buildBranchRow,
  syncMasterToBranchVendors,
  requiredDocsFor,
  missingDocsFor,
  docLabels,
  maskAccount,
  maskedView,
  recountLinks,
  blockedMasterIds,
  normVal,
  blankEnumsToUndefined,
  gstMatchesPan,
  gstError,
  refreshMasterGstins,
};
