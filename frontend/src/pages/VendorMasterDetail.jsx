// ============================================================
// FRONTEND: src/pages/VendorMasterDetail.jsx  —  NEW FILE
// Revision 19 Sep: GST registrations panel; per-branch GSTIN in Linked Branches.
// One vendor master: details, KYC documents (stored once), approval,
// group-level status, and the branches that use it (requirement 8).
// ============================================================
import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import FileUpload from "../components/FileUpload.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  VENDOR_TYPES,
  APPROVAL_STATUS_STYLES,
  VENDOR_STATUS_STYLES,
  gstState,
} from "../config/constants.js";

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const FIELD_LABELS = {
  accountNumber: "Account number",
  ifscCode: "IFSC",
  accountHolderName: "Account holder",
  vendorName: "Vendor name",
  gstNumber: "GST",
  bankName: "Bank",
  mobile: "Mobile",
  email: "Email",
  companyName: "Company",
  contactPerson: "Contact person",
  businessAddress: "Address",
  msmeNumber: "MSME",
  vendorType: "Vendor type",
  upiId: "UPI",
  panNumber: "PAN",
};

export default function VendorMasterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = ["accounts", "super_admin"].includes(user?.role);
  const canSeeBranches = [
    "accounts",
    "super_admin",
    "cluster_head",
    "director",
  ].includes(user?.role);

  const [master, setMaster] = useState(null);
  const [links, setLinks] = useState({ links: [], candidates: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(location.state?.flash || "");
  const [busy, setBusy] = useState(false);

  // modal: null | "approve" | "reject" | "status" | { attach: candidate, differences? }
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState("");
  const [nextStatus, setNextStatus] = useState("active");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/vendor-masters/${id}`);
      setMaster(data);
      if (canSeeBranches) {
        const b = await api.get(`/vendor-masters/${id}/branches`);
        setLinks(b.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load vendor master");
    } finally {
      setLoading(false);
    }
  }, [id, canSeeBranches]);

  useEffect(() => {
    load();
  }, [load]);

  // Clear the one-time message from history so a refresh doesn't repeat it.
  useEffect(() => {
    if (location.state?.flash) {
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn, successMsg) => {
    setBusy(true);
    setError("");
    try {
      const res = await fn();
      setModal(null);
      setReason("");
      if (successMsg)
        setFlash(
          typeof successMsg === "function" ? successMsg(res) : successMsg,
        );
      await load();
      return res;
    } catch (err) {
      setError(err.response?.data?.message || "Action failed");
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    act(
      () => api.patch(`/vendor-masters/${id}/submit`),
      "Submitted to the accounts team for approval.",
    ).catch(() => {});

  const approve = () =>
    act(
      () => api.patch(`/vendor-masters/${id}/approve`),
      (res) =>
        `Approved.${
          res.data.branchRowsApproved
            ? ` ${res.data.branchRowsApproved} waiting branch vendor${res.data.branchRowsApproved === 1 ? " was" : "s were"} approved with it.`
            : ""
        }`,
    ).catch(() => {});

  const reject = () =>
    act(
      () => api.patch(`/vendor-masters/${id}/reject`, { reason }),
      "Rejected. The creator has been notified.",
    ).catch(() => {});

  const changeStatus = () =>
    act(
      () =>
        api.patch(`/vendor-masters/${id}/status`, {
          status: nextStatus,
          blacklistReason: reason,
        }),
      (res) =>
        `Status set to ${nextStatus}. Applies to ${res.data.affectedBranches} branch${res.data.affectedBranches === 1 ? "" : "es"}.`,
    ).catch(() => {});

  const attach = async (candidate, confirmBankChange = false) => {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/vendor-masters/${id}/attach`, {
        vendorId: candidate._id,
        confirmBankChange,
      });
      setModal(null);
      setFlash(
        `${candidate.branch?.name || "Branch"} record attached.${
          data.fieldsChanged?.length
            ? ` Updated: ${data.fieldsChanged.map((f) => FIELD_LABELS[f] || f).join(", ")}.`
            : ""
        }`,
      );
      await load();
    } catch (err) {
      const d = err.response?.data || {};
      if (d.code === "CONFIRM_BANK_CHANGE") {
        setModal({
          attach: candidate,
          differences: d.differences,
          message: d.message,
        });
      } else {
        setError(d.message || "Attach failed");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <Shell>
        <div style={S.loading}>Loading vendor master...</div>
      </Shell>
    );
  if (!master)
    return (
      <Shell>
        <div style={S.loading}>{error || "Vendor master not found."}</div>
      </Shell>
    );

  const isCreator =
    String(master.createdBy?._id || master.createdBy) === String(user?._id);
  const editableByCreator =
    isCreator && ["draft", "rejected"].includes(master.approvalStatus);
  const canEdit = isAdmin || editableByCreator;
  const canSubmit =
    (isAdmin || isCreator) &&
    ["draft", "rejected"].includes(master.approvalStatus);
  const canDecide = isAdmin && master.approvalStatus === "pending_approval";

  const ap =
    APPROVAL_STATUS_STYLES[master.approvalStatus] ||
    APPROVAL_STATUS_STYLES.draft;
  const st = VENDOR_STATUS_STYLES[master.status] || VENDOR_STATUS_STYLES.active;

  const requiredTypes = [
    ...((VENDOR_TYPES[master.vendorType] || VENDOR_TYPES.standard)
      .requiredDocs || []),
    ...(master.gstNumber ? ["gst"] : []),
  ];
  const uploaded = (master.documents || []).map((d) => d.type);
  const missingDocs = requiredTypes.filter((t) => !uploaded.includes(t));

  return (
    <Shell>
      <div style={S.topBar}>
        <div>
          <button
            style={S.backBtn}
            onClick={() => navigate(canSeeBranches ? "/vendor-masters" : -1)}
          >
            ← Back
          </button>
          <div style={S.titleRow}>
            <h1 style={S.title}>{master.vendorName}</h1>
            <span style={{ ...S.badge, background: ap.bg, color: ap.color }}>
              {ap.label}
            </span>
            <span style={{ ...S.badge, background: st.bg, color: st.color }}>
              {st.label}
            </span>
          </div>
          <div style={S.meta}>
            PAN <span style={S.mono}>{master.panNumber}</span>
            {master.companyName ? ` · ${master.companyName}` : ""}
            {typeof master.linkedBranchCount === "number"
              ? ` · used by ${master.linkedBranchCount} branch${master.linkedBranchCount === 1 ? "" : "es"}`
              : ""}
          </div>
        </div>

        {!master.masked && (
          <div style={S.actionRow}>
            {canEdit && (
              <button
                style={S.secondaryBtn}
                onClick={() => navigate(`/vendor-masters/${id}/edit`)}
              >
                ✏️ Edit
              </button>
            )}
            {isAdmin && master.approvalStatus === "approved" && (
              <button
                style={S.secondaryBtn}
                onClick={() => {
                  setNextStatus(master.status);
                  setReason(master.blacklistReason || "");
                  setModal("status");
                }}
              >
                Change Status
              </button>
            )}
            {canSubmit && (
              <button
                style={{
                  ...S.primaryBtn,
                  opacity: missingDocs.length || busy ? 0.5 : 1,
                  cursor: missingDocs.length ? "not-allowed" : "pointer",
                }}
                disabled={Boolean(missingDocs.length) || busy}
                title={
                  missingDocs.length
                    ? "Upload the required documents first"
                    : ""
                }
                onClick={submit}
              >
                {busy ? "⏳ Submitting..." : "Submit for Approval"}
              </button>
            )}
            {canDecide && (
              <>
                <button style={S.rejectBtn} onClick={() => setModal("reject")}>
                  ✗ Reject
                </button>
                <button
                  style={{
                    ...S.approveBtn,
                    opacity: missingDocs.length ? 0.5 : 1,
                  }}
                  disabled={Boolean(missingDocs.length)}
                  title={
                    missingDocs.length ? "Required documents are missing" : ""
                  }
                  onClick={() => setModal("approve")}
                >
                  ✓ Approve
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {flash && (
        <div style={S.flashBox}>
          <span>{flash}</span>
          <button style={S.closeX} onClick={() => setFlash("")}>
            ✕
          </button>
        </div>
      )}
      {error && (
        <div style={S.errorBox}>
          <span>{error}</span>
          <button
            style={{ ...S.closeX, color: "#dc2626" }}
            onClick={() => setError("")}
          >
            ✕
          </button>
        </div>
      )}

      {master.masked && (
        <div style={S.infoBox}>
          Limited view. Your branch does not use this vendor yet, so bank
          details and documents are hidden.
        </div>
      )}

      {master.approvalStatus === "rejected" && master.rejectionReason && (
        <div style={S.rejectionBanner}>
          <strong>Rejected:</strong> {master.rejectionReason}
          {master.rejectedBy?.name && (
            <span style={{ color: "#94a3b8" }}>
              {" "}
              · by {master.rejectedBy.name} on {fmtDate(master.rejectedAt)}
            </span>
          )}
        </div>
      )}
      {master.status === "blacklisted" && master.blacklistReason && (
        <div style={S.rejectionBanner}>
          <strong>Blacklisted:</strong> {master.blacklistReason}
        </div>
      )}
      {master.approvalStatus === "draft" && canSubmit && (
        <div style={S.infoBox}>
          Draft — not yet visible to the accounts team.
          {missingDocs.length
            ? ` Upload: ${missingDocs
                .map(
                  (t) =>
                    ({
                      pan: "PAN Card",
                      gst: "GST Certificate",
                      cheque: "Cancelled Cheque",
                    })[t] || t,
                )
                .join(", ")}, then submit.`
            : " All required documents are uploaded — submit it for approval."}
        </div>
      )}

      <div style={S.grid}>
        <InfoCard title="Identity">
          <Row label="Vendor Name" value={master.vendorName} />
          {!master.masked && (
            <>
              <Row label="Contact Person" value={master.contactPerson} />
              <Row label="Mobile" value={master.mobile} />
              <Row label="Email" value={master.email} />
            </>
          )}
          <Row label="Company" value={master.companyName} />
        </InfoCard>

        <InfoCard title="Business">
          <Row label="PAN" value={master.panNumber} mono />
          <Row label="Primary GSTIN" value={master.gstNumber} mono />
          <Row label="MSME" value={master.msmeNumber} />
          <Row
            label="Vendor Type"
            value={VENDOR_TYPES[master.vendorType]?.label || master.vendorType}
          />
          <Row label="Default Category" value={master.vendorCategory} />
          <Row label="Address" value={master.businessAddress} />
        </InfoCard>

        {(master.gstins || []).length > 0 && (
          <InfoCard title={`GST Registrations (${master.gstins.length})`}>
            {master.gstins.map((g) => {
              const names = (g.branches || [])
                .map(
                  (b) =>
                    links.links.find((l) => String(l.branch?._id) === String(b))
                      ?.branch?.name,
                )
                .filter(Boolean);
              return (
                <div key={g.gstNumber} style={S.row}>
                  <span style={S.rowLabel}>
                    {gstState(g.gstNumber) || `State ${g.stateCode}`}
                    {g.isPrimary && <span style={S.primaryTag}>Primary</span>}
                  </span>
                  <span style={{ ...S.rowValue, fontFamily: "monospace" }}>
                    {g.gstNumber}
                    {names.length > 0 && (
                      <div
                        style={{
                          fontFamily: "inherit",
                          fontSize: 11,
                          color: "#94a3b8",
                          fontWeight: 400,
                        }}
                      >
                        {names.join(", ")}
                      </div>
                    )}
                  </span>
                </div>
              );
            })}
          </InfoCard>
        )}

        <InfoCard title="Bank Details">
          <Row label="Bank" value={master.bankName} />
          {master.masked ? (
            <Row label="Account" value={master.accountNumberMasked} mono />
          ) : (
            <>
              <Row label="Account Holder" value={master.accountHolderName} />
              <Row label="Account Number" value={master.accountNumber} mono />
              <Row label="IFSC" value={master.ifscCode} mono />
              <Row label="UPI" value={master.upiId} />
            </>
          )}
        </InfoCard>

        {!master.masked && (
          <InfoCard title="System">
            <Row label="Created By" value={master.createdBy?.name} />
            <Row label="Created On" value={fmtDate(master.createdAt)} />
            <Row label="Approved By" value={master.approvedBy?.name} />
            <Row label="Approved On" value={fmtDate(master.approvedAt)} />
            <Row
              label="Verified"
              value={master.verifiedByAccounts ? "✓ Yes" : "✗ No"}
            />
          </InfoCard>
        )}
      </div>

      {!master.masked && (
        <div style={{ marginBottom: 16 }}>
          <FileUpload
            entityType="vendormaster"
            entityId={id}
            existingDocs={master.documents || []}
            onUploadSuccess={load}
            requiredTypes={requiredTypes}
            canUpload={canEdit}
            readOnlyMessage={
              master.approvalStatus === "pending_approval" ||
              master.approvalStatus === "approved"
                ? "Documents of a submitted vendor can only be changed by the accounts team."
                : "Only the accounts team or the person who registered this vendor can change its documents."
            }
          />
        </div>
      )}

      {canSeeBranches && (
        <InfoCard title={`Linked Branches (${links.links.length})`}>
          {links.links.length === 0 ? (
            <div style={S.emptyRow}>No branch uses this vendor yet.</div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  {[
                    "Branch",
                    "GSTIN",
                    "Category",
                    "Approval",
                    "Status",
                    "Invoices",
                    "Added",
                    "",
                  ].map((h, i) => (
                    <th key={i} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {links.links.map((l) => {
                  const la =
                    APPROVAL_STATUS_STYLES[l.approvalStatus] ||
                    APPROVAL_STATUS_STYLES.draft;
                  const ls =
                    VENDOR_STATUS_STYLES[l.status] ||
                    VENDOR_STATUS_STYLES.active;
                  return (
                    <tr key={l._id} style={S.tr}>
                      <td style={S.td}>
                        <strong>{l.branch?.name || "—"}</strong>
                        {l.branch?.code ? (
                          <span style={{ color: "#94a3b8" }}>
                            {" "}
                            ({l.branch.code})
                          </span>
                        ) : null}
                      </td>
                      <td style={S.td}>
                        {l.gstNumber ? (
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 12,
                              color: l.gstinMismatch ? "#dc2626" : "#334155",
                            }}
                            title={
                              l.gstinMismatch
                                ? "This GSTIN does not belong to the vendor's PAN — correct it on the branch vendor"
                                : gstState(l.gstNumber)
                            }
                          >
                            {l.gstinMismatch ? "⚠ " : ""}
                            {l.gstNumber}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={S.td}>{l.vendorCategory || "—"}</td>
                      <td style={S.td}>
                        <span
                          style={{
                            ...S.badge,
                            background: la.bg,
                            color: la.color,
                          }}
                        >
                          {la.label}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span
                          style={{
                            ...S.badge,
                            background: ls.bg,
                            color: ls.color,
                          }}
                        >
                          {ls.label}
                        </span>
                      </td>
                      <td style={S.td}>{l.invoiceCount}</td>
                      <td style={S.td}>{fmtDate(l.createdAt)}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>
                        <button
                          style={S.smallBtn}
                          onClick={() => navigate(`/vendors/${l._id}`)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {links.candidates.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={S.subhead}>
                Branch records with this PAN, not yet linked (
                {links.candidates.length})
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                These were created before the Vendor Master, or skipped during
                the migration. Attaching one makes it use this master's details
                and documents from now on. Past invoices are not affected.
              </div>
              {links.candidates.map((c) => (
                <div key={c._id} style={S.candidate}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>
                      <strong>{c.branch?.name || "—"}</strong>
                      <span style={{ color: "#94a3b8" }}>
                        {" "}
                        · {c.vendorName}
                        {c.gstNumber
                          ? ` · GSTIN ${c.gstNumber} (kept)`
                          : ""} · {c.approvalStatus?.replace("_", " ")} ·{" "}
                        {c.status}
                      </span>
                    </div>
                    {c.differences.length > 0 ? (
                      <div
                        style={{
                          fontSize: 12,
                          marginTop: 4,
                          color: c.bankDiffers ? "#b45309" : "#64748b",
                        }}
                      >
                        {c.bankDiffers
                          ? "⚠ Different bank details. "
                          : "Differs in: "}
                        {c.differences
                          .map((d) => FIELD_LABELS[d.field] || d.field)
                          .join(", ")}
                      </div>
                    ) : (
                      <div
                        style={{ fontSize: 12, marginTop: 4, color: "#16a34a" }}
                      >
                        ✓ Matches the master exactly
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      style={S.smallBtn}
                      onClick={() => navigate(`/vendors/${c._id}`)}
                    >
                      View
                    </button>
                    {isAdmin &&
                      master.approvalStatus === "approved" &&
                      c.canAttach && (
                        <button
                          style={{
                            ...S.smallBtn,
                            color: C.accent,
                            borderColor: "#bfdbfe",
                          }}
                          disabled={busy}
                          onClick={() => attach(c, false)}
                        >
                          Attach
                        </button>
                      )}
                  </div>
                </div>
              ))}
              {isAdmin && master.approvalStatus !== "approved" && (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  Approve this vendor master before attaching branch records.
                </div>
              )}
            </div>
          )}
        </InfoCard>
      )}

      {/* ── Modals ── */}
      {modal === "approve" && (
        <Modal title="Approve vendor master?" onClose={() => setModal(null)}>
          <p style={S.modalText}>
            Confirms the KYC documents and bank details for{" "}
            <strong>{master.vendorName}</strong>. Branch vendors waiting on this
            master are approved with it, and any branch can then add it without
            re-uploading documents.
          </p>
          <div style={S.modalBtns}>
            <button style={S.cancelBtn} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button style={S.approveModalBtn} disabled={busy} onClick={approve}>
              {busy ? "Approving..." : "✓ Approve"}
            </button>
          </div>
        </Modal>
      )}

      {modal === "reject" && (
        <Modal title="Reject vendor master" onClose={() => setModal(null)}>
          <label style={S.fieldLabel}>Reason *</label>
          <textarea
            style={S.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Cancelled cheque is not legible"
            autoFocus
          />
          <div style={S.modalBtns}>
            <button style={S.cancelBtn} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              style={{
                ...S.rejectModalBtn,
                opacity: !reason.trim() || busy ? 0.5 : 1,
              }}
              disabled={!reason.trim() || busy}
              onClick={reject}
            >
              {busy ? "Rejecting..." : "✗ Reject"}
            </button>
          </div>
        </Modal>
      )}

      {modal === "status" && (
        <Modal title="Change vendor status" onClose={() => setModal(null)}>
          <p style={S.modalText}>
            Applies to <strong>every branch</strong> that uses this vendor.
            Anything other than Active removes it from the payment-request
            vendor list in all of them.
          </p>
          <select
            style={S.select}
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value)}
          >
            {Object.entries(VENDOR_STATUS_STYLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          {nextStatus === "blacklisted" && (
            <>
              <label style={{ ...S.fieldLabel, marginTop: 12 }}>Reason *</label>
              <textarea
                style={S.textarea}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </>
          )}
          <div style={S.modalBtns}>
            <button style={S.cancelBtn} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              style={{
                ...S.approveModalBtn,
                background: nextStatus === "active" ? "#16a34a" : "#d97706",
                opacity:
                  busy ||
                  nextStatus === master.status ||
                  (nextStatus === "blacklisted" && !reason.trim())
                    ? 0.5
                    : 1,
              }}
              disabled={
                busy ||
                nextStatus === master.status ||
                (nextStatus === "blacklisted" && !reason.trim())
              }
              onClick={changeStatus}
            >
              {busy ? "Saving..." : "Apply to all branches"}
            </button>
          </div>
        </Modal>
      )}

      {modal && modal.attach && (
        <Modal title="Bank details will change" onClose={() => setModal(null)}>
          <p style={S.modalText}>
            {modal.message} Branch: <strong>{modal.attach.branch?.name}</strong>
          </p>
          <div style={S.diffBox}>
            {(modal.differences || []).map((d) => (
              <div key={d.field} style={{ marginBottom: 4 }}>
                <strong>{FIELD_LABELS[d.field] || d.field}:</strong>{" "}
                <span
                  style={{ color: "#dc2626", textDecoration: "line-through" }}
                >
                  {d.branchValue || "—"}
                </span>{" "}
                →{" "}
                <span style={{ color: "#16a34a" }}>{d.masterValue || "—"}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#94a3b8" }}>
            Confirm with the vendor which account is current before attaching.
          </p>
          <div style={S.modalBtns}>
            <button style={S.cancelBtn} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              style={S.rejectModalBtn}
              disabled={busy}
              onClick={() => attach(modal.attach, true)}
            >
              {busy ? "Attaching..." : "Use master's account"}
            </button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}

// ── Small building blocks ──────────────────────────────────
const Shell = ({ children }) => (
  <div style={S.layout}>
    <Sidebar />
    <main style={S.main}>{children}</main>
  </div>
);

const InfoCard = ({ title, children }) => (
  <div style={S.card}>
    <div style={S.cardTitle}>{title}</div>
    {children}
  </div>
);

const Row = ({ label, value, mono }) => (
  <div style={S.row}>
    <span style={S.rowLabel}>{label}</span>
    <span style={{ ...S.rowValue, fontFamily: mono ? "monospace" : "inherit" }}>
      {value || "—"}
    </span>
  </div>
);

const Modal = ({ title, children, onClose }) => (
  <div style={S.overlay} onClick={onClose}>
    <div style={S.modal} onClick={(e) => e.stopPropagation()}>
      <h3 style={S.modalTitle}>{title}</h3>
      {children}
    </div>
  </div>
);

const C = { primary: "#1a3c6e", accent: "#2563eb", border: "#e2e8f0" };
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", minWidth: 0 },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    flexWrap: "wrap",
    gap: 12,
  },
  backBtn: {
    background: "none",
    border: "none",
    color: C.accent,
    cursor: "pointer",
    fontSize: 14,
    padding: 0,
    marginBottom: 6,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  title: { fontSize: 22, fontWeight: 700, color: C.primary, margin: 0 },
  meta: { fontSize: 13, color: "#64748b", marginTop: 6 },
  mono: { fontFamily: "monospace", color: "#334155" },
  badge: {
    display: "inline-block",
    padding: "3px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  actionRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  primaryBtn: {
    padding: "9px 18px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
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
  },
  approveBtn: {
    padding: "9px 18px",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  rejectBtn: {
    padding: "9px 18px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#dc2626",
  },
  flashBox: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#15803d",
    fontSize: 13,
    marginBottom: 14,
  },
  errorBox: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 14,
  },
  closeX: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#15803d",
    fontWeight: 700,
  },
  infoBox: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#1d4ed8",
    marginBottom: 14,
  },
  rejectionBanner: {
    background: "#fef2f2",
    border: "1.5px solid #fecaca",
    borderRadius: 10,
    padding: "12px 16px",
    marginBottom: 14,
    fontSize: 13,
    color: "#7f1d1d",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: "1px solid #f1f5f9",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "7px 0",
    borderBottom: "1px solid #f8fafc",
    fontSize: 13,
  },
  rowLabel: { color: "#64748b", flexShrink: 0 },
  primaryTag: {
    marginLeft: 6,
    padding: "1px 6px",
    borderRadius: 10,
    background: "#eff6ff",
    color: "#2563eb",
    fontSize: 10,
    fontWeight: 700,
  },
  rowValue: {
    color: "#1e293b",
    fontWeight: 500,
    textAlign: "right",
    wordBreak: "break-word",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    padding: "8px 10px",
    borderBottom: `1px solid ${C.border}`,
  },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "10px", fontSize: 13, color: "#334155" },
  emptyRow: { fontSize: 13, color: "#94a3b8", padding: "8px 0" },
  subhead: { fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 4 },
  candidate: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    marginBottom: 8,
    fontSize: 13,
    flexWrap: "wrap",
  },
  smallBtn: {
    padding: "5px 12px",
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    background: "#fff",
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    cursor: "pointer",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
    padding: 20,
  },
  modal: {
    background: "#fff",
    borderRadius: 14,
    padding: 28,
    width: "100%",
    maxWidth: 480,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.primary,
    margin: "0 0 10px",
  },
  modalText: { fontSize: 14, color: "#475569", lineHeight: 1.5 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    display: "block",
    marginBottom: 6,
  },
  textarea: {
    width: "100%",
    minHeight: 80,
    padding: "10px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    resize: "vertical",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
  },
  diffBox: {
    background: "#f8fafc",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 14px",
    margin: "12px 0",
    fontSize: 13,
    fontFamily: "monospace",
  },
  modalBtns: { display: "flex", gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    padding: "10px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    color: "#475569",
  },
  approveModalBtn: {
    flex: 1,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: "#16a34a",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  rejectModalBtn: {
    flex: 1,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: "#dc2626",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
};
