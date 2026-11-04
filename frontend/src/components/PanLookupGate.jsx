// ============================================================
// FRONTEND: src/components/PanLookupGate.jsx  —  NEW FILE (Phase 4)
// ------------------------------------------------------------
// Step 1 of "Add Vendor" (requirement 4): the PAN is checked against the
// Vendor Master before anything else can be typed.
//
//   PAN not in master        → onNewPan(pan)      full form, new master
//   PAN in master, not here  → read-only card + "Add to my branch"
//                              (approved master → usable immediately)
//   PAN already in branch    → link to the existing vendor
//   No PAN (utility/tax)     → onNoPan()           branch-level payee
//
// Multi-branch (accounts only, multiBranch=true): the Branch field is a
// multi-select. With ONE branch picked everything works exactly as above.
// With several:
//   New PAN            → onNewPan(pan); the form creates the master and a
//                        row for every selected branch (POST /vendor-masters
//                        with `branches`).
//   PAN in master      → per-branch table (GSTIN per branch, since GST is
//                        per state) + "Add to N branches" →
//                        POST /vendor-masters/:id/link-branches.
//                        Branches that already have it are shown and skipped.
//   No PAN             → one branch at a time (each payee is branch-level).
// ============================================================
import React, { useState } from "react";
import api from "../api/axios";
import SearchableSelect from "./SearchableSelect.jsx";
import MultiSearchableSelect from "./MultiSearchableSelect.jsx";
import {
  VENDOR_MASTER,
  APPROVAL_STATUS_STYLES,
  gstState,
  gstMatchesPan,
} from "../config/constants.js";

const VENDOR_CATEGORIES = [
  "Service Vendors",
  "Equipment Vendors",
  "Utility Vendors",
  "Consultant Vendors",
  "Medical Suppliers",
  "Miscellaneous Vendors",
];

const idOf = (v) => String(v?._id || v || "");
const mask = (n) => (n ? `****${String(n).slice(-4)}` : "—");

export default function PanLookupGate({
  branches = [],
  branch: singleBranch,
  onBranchChange,
  branchLocked = false,
  onNewPan,
  onNoPan,
  onOpenVendor,
  onLinked,
  // Multi-branch mode (accounts only)
  multiBranch = false,
  selectedBranches = [],
  onBranchesChange,
  onLinkedMulti,
}) {
  const [pan, setPan] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [linkGst, setLinkGst] = useState("");
  const [linkCategory, setLinkCategory] = useState("");
  const [linking, setLinking] = useState(false);
  const [multiGst, setMultiGst] = useState({}); // branchId → GSTIN

  const panValid = VENDOR_MASTER.PAN_REGEX.test(pan);

  // In multi-branch mode a single pick behaves exactly like the old flow.
  const picked = selectedBranches.map(String);
  const isMulti = multiBranch && picked.length > 1;
  const branch = multiBranch
    ? picked.length === 1
      ? picked[0]
      : ""
    : singleBranch;
  const hasBranch = multiBranch ? picked.length > 0 : Boolean(branch);

  const check = async () => {
    setError("");
    setResult(null);
    if (!hasBranch) {
      setError("Select the branch first.");
      return;
    }
    if (!panValid) {
      setError("Enter a valid PAN (e.g. ABCDE1234F).");
      return;
    }
    setChecking(true);
    try {
      const { data } = await api.get(
        `/vendor-masters/lookup?pan=${encodeURIComponent(pan)}`,
      );
      setResult(data);
      setLinkGst(data.master?.gstNumber || "");
      setLinkCategory(data.master?.vendorCategory || "");
      setMultiGst({});
    } catch (err) {
      setError(
        err.response?.data?.message || "Could not check the PAN. Try again.",
      );
    } finally {
      setChecking(false);
    }
  };

  // Everything below depends on WHICH branch the vendor is being added for.
  const myLink = result?.myLinks?.find(
    (l) => idOf(l.branch) === String(branch),
  );
  const myLocal = result?.localRows?.find(
    (r) => idOf(r.branch) === String(branch),
  );
  const branchName =
    branches.find((b) => idOf(b) === String(branch))?.name || "this branch";

  const gstError =
    linkGst && !VENDOR_MASTER.GST_REGEX.test(linkGst.toUpperCase())
      ? "Invalid GSTIN format"
      : linkGst && !gstMatchesPan(linkGst, result?.pan)
        ? "This GSTIN does not belong to this PAN"
        : "";

  const link = async () => {
    if (gstError) return;
    setLinking(true);
    setError("");
    try {
      const { data } = await api.post(
        `/vendor-masters/${result.master._id}/link`,
        {
          branch,
          gstNumber: linkGst.toUpperCase(),
          vendorCategory: linkCategory,
        },
      );
      onLinked?.(data);
    } catch (err) {
      const d = err.response?.data || {};
      if (d.code === "ALREADY_LINKED" && d.vendorId) onOpenVendor?.(d.vendorId);
      else setError(d.message || "Could not add the vendor to your branch.");
    } finally {
      setLinking(false);
    }
  };

  // ── Multi-branch link ───────────────────────────────────
  const nameOf = (bid) => {
    const b = branches.find((x) => idOf(x) === String(bid));
    return b ? `${b.name}${b.code ? ` (${b.code})` : ""}` : "Branch";
  };
  const multiRows = isMulti
    ? picked.map((bid) => {
        const linkRow = result?.myLinks?.find((l) => idOf(l.branch) === bid);
        const localRow = result?.localRows?.find((r) => idOf(r.branch) === bid);
        const gst = (
          multiGst[bid] ??
          result?.master?.gstNumber ??
          ""
        ).toUpperCase();
        const err =
          linkRow || localRow
            ? ""
            : gst && !VENDOR_MASTER.GST_REGEX.test(gst)
              ? "Invalid GSTIN format"
              : gst && !gstMatchesPan(gst, result?.pan)
                ? "GSTIN does not belong to this PAN"
                : "";
        return { bid, linkRow, localRow, gst, err };
      })
    : [];
  const addable = multiRows.filter((r) => !r.linkRow && !r.localRow);
  const multiHasError = addable.some((r) => r.err);

  const linkMulti = async () => {
    if (!addable.length || multiHasError) return;
    setLinking(true);
    setError("");
    try {
      const { data } = await api.post(
        `/vendor-masters/${result.master._id}/link-branches`,
        {
          items: addable.map((r) => ({
            branch: r.bid,
            gstNumber: r.gst,
            vendorCategory: linkCategory,
          })),
        },
      );
      onLinkedMulti?.(data);
    } catch (err) {
      const d = err.response?.data || {};
      if (d.problems?.length) {
        setError(
          d.problems
            .map((p) => `${nameOf(p.branch)}: ${p.message}`)
            .join(" · "),
        );
      } else if (d.skipped?.length) {
        setError(
          d.skipped.map((x) => `${nameOf(x.branch)}: ${x.message}`).join(" · "),
        );
      } else {
        setError(d.message || "Could not add the vendor to the branches.");
      }
    } finally {
      setLinking(false);
    }
  };

  const m = result?.master;
  const ap = m
    ? APPROVAL_STATUS_STYLES[m.approvalStatus] || APPROVAL_STATUS_STYLES.draft
    : null;

  return (
    <div>
      <h2 style={S.title}>Step 1 — Check the vendor's PAN</h2>
      <p style={S.lead}>
        A vendor is registered once for the whole group. If another branch
        already uses it, you can add it here without uploading documents again.
      </p>

      <div style={S.row}>
        <div style={{ flex: "1 1 220px" }}>
          <label style={S.label}>
            {multiBranch ? "Branches *" : "Branch *"}
          </label>
          {multiBranch ? (
            <MultiSearchableSelect
              options={branches}
              value={picked}
              onChange={(v) => {
                onBranchesChange?.(v);
                setError("");
              }}
              getOptionLabel={(b) => `${b.name}${b.code ? ` (${b.code})` : ""}`}
              placeholder="Select one or more branches"
            />
          ) : (
            <SearchableSelect
              options={branches}
              value={branch}
              onChange={(v) => {
                onBranchChange?.(v);
                setError("");
              }}
              getOptionLabel={(b) => `${b.name}${b.code ? ` (${b.code})` : ""}`}
              placeholder="Select Branch"
              disabled={branchLocked}
            />
          )}
          {multiBranch && (
            <span style={S.hint}>
              You can add the vendor to several branches at once.
            </span>
          )}
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <label style={S.label}>PAN *</label>
          <input
            style={{
              ...S.input,
              fontFamily: "monospace",
              textTransform: "uppercase",
            }}
            value={pan}
            maxLength={10}
            placeholder="ABCDE1234F"
            autoFocus
            onChange={(e) => {
              setPan(e.target.value.toUpperCase().replace(/\s/g, ""));
              setResult(null);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && check()}
          />
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button
            style={{
              ...S.primaryBtn,
              opacity: checking || !panValid || !hasBranch ? 0.55 : 1,
            }}
            disabled={checking || !panValid || !hasBranch}
            onClick={check}
          >
            {checking ? "Checking…" : "Check PAN"}
          </button>
        </div>
      </div>

      <button
        style={{
          ...S.linkBtn,
          ...(!branch ? { color: "#94a3b8", cursor: "not-allowed" } : {}),
        }}
        disabled={!branch}
        title={
          isMulti
            ? "A payee without a PAN is added to one branch at a time — select a single branch"
            : !branch
              ? "Select the branch first"
              : ""
        }
        onClick={() => onNoPan?.()}
      >
        This payee has no PAN (electricity board, municipal tax, government
        challan…) →
      </button>

      {error && <div style={S.errorBox}>{error}</div>}

      {result && (
        <div style={{ marginTop: 20 }}>
          {isMulti && result.found && result.canLink ? (
            /* ── Multi-branch: existing master → several branches ── */
            <div style={S.card}>
              <div style={S.cardHead}>
                <div>
                  <div style={S.cardName}>{m.vendorName}</div>
                  <div style={S.cardSub}>
                    {m.companyName || m.vendorCategory || "—"} · PAN{" "}
                    <span style={{ fontFamily: "monospace" }}>
                      {result.pan}
                    </span>
                    {" · "}Bank {m.bankName || "—"}{" "}
                    {m.accountNumberMasked || mask(m.accountNumber)}
                  </div>
                </div>
                <span
                  style={{ ...S.badge, background: ap.bg, color: ap.color }}
                >
                  {ap.label}
                </span>
              </div>

              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Branch</th>
                      <th style={S.th}>GSTIN for this branch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {multiRows.map((r) => (
                      <tr key={r.bid}>
                        <td style={S.td}>{nameOf(r.bid)}</td>
                        <td style={S.td}>
                          {r.linkRow ? (
                            <span style={S.skipNote}>
                              Already in this branch —{" "}
                              <button
                                style={S.inlineLink}
                                onClick={() => onOpenVendor?.(r.linkRow._id)}
                              >
                                open
                              </button>
                            </span>
                          ) : r.localRow ? (
                            <span style={S.skipNote}>
                              Has a branch-level record with this PAN — will be
                              skipped (attach it from the Vendor Master)
                            </span>
                          ) : (
                            <>
                              <input
                                style={{
                                  ...S.input,
                                  padding: "7px 10px",
                                  fontSize: 13,
                                  fontFamily: "monospace",
                                  textTransform: "uppercase",
                                  ...(r.err ? S.inputError : {}),
                                }}
                                value={r.gst}
                                maxLength={15}
                                placeholder="Blank if not GST-registered"
                                onChange={(e) =>
                                  setMultiGst((g) => ({
                                    ...g,
                                    [r.bid]: e.target.value.toUpperCase(),
                                  }))
                                }
                              />
                              {(r.err || (r.gst && gstState(r.gst))) && (
                                <span
                                  style={{
                                    ...S.hint,
                                    ...(r.err ? { color: "#dc2626" } : {}),
                                  }}
                                >
                                  {r.err || `${gstState(r.gst)} registration`}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ ...S.row, marginTop: 16 }}>
                <div style={{ flex: "1 1 220px", maxWidth: 360 }}>
                  <label style={S.label}>
                    Category (all selected branches)
                  </label>
                  <SearchableSelect
                    options={VENDOR_CATEGORIES}
                    value={linkCategory}
                    onChange={setLinkCategory}
                    getOptionValue={(c) => c}
                    getOptionLabel={(c) => c}
                    placeholder="Select (optional)"
                  />
                </div>
              </div>

              <div style={S.cardFoot}>
                <span style={S.hint}>
                  {addable.length === 0
                    ? "Every selected branch already has this vendor."
                    : result.autoApproveOnLink
                      ? "Already approved by the accounts team — it will be ready for payment requests in these branches immediately."
                      : "This vendor is still awaiting accounts approval. It becomes usable in these branches as soon as it is approved."}
                </span>
                <button
                  style={{
                    ...S.addBtn,
                    opacity:
                      linking || multiHasError || !addable.length ? 0.55 : 1,
                  }}
                  disabled={linking || multiHasError || !addable.length}
                  onClick={linkMulti}
                >
                  {linking
                    ? "Adding…"
                    : `+ Add to ${addable.length} branch${addable.length === 1 ? "" : "es"}`}
                </button>
              </div>
            </div>
          ) : isMulti && !result.found ? (
            <div style={S.successBox}>
              <div>
                <strong>New vendor.</strong> PAN {result.pan} is not registered
                in the group yet. Enter the details and documents once; the
                vendor is created for all {picked.length} selected branches and
                the accounts team approves it once.
              </div>
              <button
                style={S.primaryBtn}
                onClick={() => onNewPan?.(result.pan)}
              >
                Continue to vendor details →
              </button>
            </div>
          ) : isMulti && !result.canLink ? (
            <div style={S.warnBox}>
              <div>
                <strong>{m?.vendorName}</strong> (PAN {result.pan}) is already
                registered, but it can't be added right now.
                <div style={{ marginTop: 4 }}>{result.cannotLinkReason}</div>
              </div>
            </div>
          ) : /* ── Already in this branch ───────────────────── */
          myLink ? (
            <div style={S.infoBox}>
              <div>
                <strong>{m?.vendorName}</strong> is already in {branchName}'s
                vendor list.
              </div>
              <button
                style={S.primaryBtn}
                onClick={() => onOpenVendor?.(myLink._id)}
              >
                Open vendor →
              </button>
            </div>
          ) : myLocal ? (
            /* ── Pre-master record with this PAN in this branch ── */
            <div style={S.warnBox}>
              <div>
                {branchName} already has <strong>{myLocal.vendorName}</strong>{" "}
                with this PAN as a branch record. Use that one — the accounts
                team can connect it to the Vendor Master.
              </div>
              <button
                style={S.secondaryBtn}
                onClick={() => onOpenVendor?.(myLocal._id)}
              >
                Open it
              </button>
            </div>
          ) : !result.found ? (
            /* ── New PAN ──────────────────────────────────── */
            <div style={S.successBox}>
              <div>
                <strong>New vendor.</strong> PAN {result.pan} is not registered
                in the group yet. Enter the details and documents; the accounts
                team approves it once for every branch.
              </div>
              <button
                style={S.primaryBtn}
                onClick={() => onNewPan?.(result.pan)}
              >
                Continue to vendor details →
              </button>
            </div>
          ) : !result.canLink ? (
            /* ── In master but not usable ─────────────────── */
            <div style={S.warnBox}>
              <div>
                <strong>{m?.vendorName}</strong> (PAN {result.pan}) is already
                registered, but it can't be added right now.
                <div style={{ marginTop: 4 }}>{result.cannotLinkReason}</div>
              </div>
            </div>
          ) : (
            /* ── In master → read-only card + Add to my branch ── */
            <div style={S.card}>
              <div style={S.cardHead}>
                <div>
                  <div style={S.cardName}>{m.vendorName}</div>
                  <div style={S.cardSub}>
                    {m.companyName || m.vendorCategory || "—"} · PAN{" "}
                    <span style={{ fontFamily: "monospace" }}>
                      {result.pan}
                    </span>
                  </div>
                </div>
                <span
                  style={{ ...S.badge, background: ap.bg, color: ap.color }}
                >
                  {ap.label}
                </span>
              </div>

              <div style={S.grid}>
                <Info label="Primary GSTIN" value={m.gstNumber} mono />
                <Info label="Category" value={m.vendorCategory} />
                <Info label="Bank" value={m.bankName} />
                <Info
                  label="Account"
                  value={m.accountNumberMasked || mask(m.accountNumber)}
                  mono
                />
                <Info
                  label="Used by"
                  value={`${m.linkedBranchCount || 0} branch${m.linkedBranchCount === 1 ? "" : "es"}`}
                />
                <Info label="Documents" value="Held in the Vendor Master" />
                {m.businessAddress && (
                  <Info label="Address" value={m.businessAddress} full />
                )}
              </div>

              <div style={S.divider} />

              <div style={S.row}>
                <div style={{ flex: "1 1 220px" }}>
                  <label style={S.label}>GSTIN for {branchName}</label>
                  <input
                    style={{
                      ...S.input,
                      fontFamily: "monospace",
                      textTransform: "uppercase",
                      ...(gstError ? S.inputError : {}),
                    }}
                    value={linkGst}
                    maxLength={15}
                    placeholder="Leave blank if not GST-registered"
                    onChange={(e) => setLinkGst(e.target.value.toUpperCase())}
                  />
                  <span
                    style={{
                      ...S.hint,
                      ...(gstError ? { color: "#dc2626" } : {}),
                    }}
                  >
                    {gstError ||
                      (linkGst && gstState(linkGst)
                        ? `${gstState(linkGst)} registration. Change it if this branch is invoiced from another state.`
                        : "Change it if this branch is invoiced from another state.")}
                  </span>
                </div>
                <div style={{ flex: "1 1 220px" }}>
                  <label style={S.label}>Category for {branchName}</label>
                  <SearchableSelect
                    options={VENDOR_CATEGORIES}
                    value={linkCategory}
                    onChange={setLinkCategory}
                    getOptionValue={(c) => c}
                    getOptionLabel={(c) => c}
                    placeholder="Select (optional)"
                  />
                </div>
              </div>

              <div style={S.cardFoot}>
                <span style={S.hint}>
                  {result.autoApproveOnLink
                    ? "Already approved by the accounts team — it will be ready for payment requests immediately."
                    : "This vendor is still awaiting accounts approval. It becomes usable in your branch as soon as it is approved."}
                </span>
                <button
                  style={{
                    ...S.addBtn,
                    opacity: linking || gstError ? 0.55 : 1,
                  }}
                  disabled={linking || Boolean(gstError)}
                  onClick={link}
                >
                  {linking ? "Adding…" : `+ Add to ${branchName}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const Info = ({ label, value, mono, full }) => (
  <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>
      {label}
    </div>
    <div
      style={{
        fontSize: 13,
        color: "#1e293b",
        fontWeight: 500,
        fontFamily: mono ? "monospace" : "inherit",
      }}
    >
      {value || "—"}
    </div>
  </div>
);

const C = { primary: "#1a3c6e", accent: "#2563eb", border: "#e2e8f0" };
const S = {
  title: { fontSize: 16, fontWeight: 700, color: C.primary, margin: "0 0 6px" },
  lead: { fontSize: 13, color: "#64748b", margin: "0 0 18px", lineHeight: 1.5 },
  row: { display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    marginBottom: 6,
  },
  input: {
    padding: "10px 13px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    color: "#334155",
  },
  inputError: { borderColor: "#dc2626", background: "#fef2f2" },
  hint: { display: "block", fontSize: 11, color: "#94a3b8", marginTop: 4 },
  primaryBtn: {
    padding: "10px 18px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  secondaryBtn: {
    padding: "9px 16px",
    background: "#fff",
    color: "#334155",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  addBtn: {
    padding: "10px 20px",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: C.accent,
    fontSize: 13,
    cursor: "pointer",
    padding: 0,
    marginTop: 14,
    textAlign: "left",
  },
  errorBox: {
    marginTop: 14,
    padding: "10px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#dc2626",
    fontSize: 13,
  },
  infoBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "14px 16px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 10,
    fontSize: 14,
    color: "#1e3a8a",
  },
  warnBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "14px 16px",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 10,
    fontSize: 14,
    color: "#92400e",
  },
  successBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "14px 16px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 10,
    fontSize: 14,
    color: "#166534",
  },
  card: {
    border: `1.5px solid ${C.border}`,
    borderRadius: 12,
    padding: 20,
    background: "#fff",
  },
  cardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  cardName: { fontSize: 17, fontWeight: 700, color: C.primary },
  cardSub: { fontSize: 13, color: "#64748b", marginTop: 2 },
  badge: {
    padding: "3px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 14,
  },
  divider: { borderTop: "1px solid #f1f5f9", margin: "18px 0" },
  tableWrap: {
    overflowX: "auto",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "9px 12px",
    background: "#f8fafc",
    color: "#475569",
    fontWeight: 600,
    borderBottom: `1px solid ${C.border}`,
  },
  td: {
    padding: "8px 12px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "top",
    color: "#1e293b",
  },
  skipNote: { fontSize: 12, color: "#92400e" },
  inlineLink: {
    background: "none",
    border: "none",
    color: C.accent,
    fontSize: 12,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
  },
  cardFoot: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    marginTop: 18,
  },
};
