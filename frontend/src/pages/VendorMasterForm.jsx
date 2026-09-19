// ============================================================
// FRONTEND: src/pages/VendorMasterForm.jsx  —  NEW FILE
// Revision 19 Sep: GSTIN field is the master's PRIMARY GSTIN; branches keep their own.
// Create (/vendor-masters/new) and edit (/vendor-masters/:id/edit).
// Documents, submission and approval happen on the detail page, which
// this form opens after saving.
// ============================================================
import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import {
  VENDOR_TYPES,
  VENDOR_TYPE_OPTIONS,
  VENDOR_MASTER,
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

const SECTIONS = ["Identity", "Business", "Bank Details"];

const INIT = {
  panNumber: "",
  vendorName: "",
  contactPerson: "",
  mobile: "",
  email: "",
  companyName: "",
  gstNumber: "",
  msmeNumber: "",
  businessAddress: "",
  vendorCategory: "",
  vendorType: "standard",
  accountHolderName: "",
  bankName: "",
  accountNumber: "",
  ifscCode: "",
  upiId: "",
};

const BANK_FIELDS = [
  "accountHolderName",
  "bankName",
  "accountNumber",
  "ifscCode",
];

// Which section each field lives in, so a save error can jump there.
const FIELD_SECTION = {
  panNumber: 0,
  vendorName: 0,
  mobile: 0,
  email: 0,
  gstNumber: 1,
  vendorType: 1,
  accountHolderName: 2,
  bankName: 2,
  accountNumber: 2,
  ifscCode: 2,
};

export default function VendorMasterForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = ["accounts", "super_admin"].includes(user?.role);

  const [form, setForm] = useState(INIT);
  const [original, setOriginal] = useState(null);
  const [section, setSection] = useState(0);
  const [errors, setErrors] = useState({});
  const [fetching, setFetching] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [confirmBank, setConfirmBank] = useState(false);

  // PAN check (create only)
  const [panCheck, setPanCheck] = useState({ state: "idle" });
  const lastCheckedPan = useRef("");

  const [chequeScanning, setChequeScanning] = useState(false);
  const [chequeError, setChequeError] = useState("");
  const chequeInputRef = useRef(null);

  useEffect(() => {
    if (!isEdit) return;
    api
      .get(`/vendor-masters/${id}`)
      .then(({ data }) => {
        setOriginal(data);
        const next = { ...INIT };
        Object.keys(INIT).forEach((k) => {
          next[k] = data[k] ?? INIT[k];
        });
        setForm(next);
      })
      .catch((err) =>
        setErrors({
          submit: err.response?.data?.message || "Failed to load vendor master",
        }),
      )
      .finally(() => setFetching(false));
  }, [id, isEdit]);

  // Who may edit: accounts / super admin always; the creator only while
  // their own record is draft or rejected. Mirrors updateMaster.
  const isCreator =
    original &&
    String(original.createdBy?._id || original.createdBy) === String(user?._id);
  const canEdit =
    !isEdit ||
    isAdmin ||
    (isCreator && ["draft", "rejected"].includes(original?.approvalStatus));

  // Only a super admin may re-key an approved vendor.
  const panLocked =
    isEdit &&
    original?.approvalStatus === "approved" &&
    user?.role !== "super_admin";

  const setField = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: "" }));
  };
  const onInput = (field, transform) => (e) =>
    setField(field, transform ? transform(e.target.value) : e.target.value);
  const upper = (v) => v.toUpperCase();

  // ── PAN lookup: stop a duplicate before any other field is typed ──
  const checkPan = async (raw) => {
    const pan = String(raw || "")
      .trim()
      .toUpperCase();
    if (isEdit || !VENDOR_MASTER.PAN_REGEX.test(pan)) return;
    if (pan === lastCheckedPan.current) return;
    lastCheckedPan.current = pan;
    setPanCheck({ state: "checking" });
    try {
      const { data } = await api.get(
        `/vendor-masters/lookup?pan=${encodeURIComponent(pan)}`,
      );
      setPanCheck(
        data.found
          ? { state: "exists", master: data.master }
          : { state: "new", localRows: data.localRows || [] },
      );
    } catch (err) {
      lastCheckedPan.current = "";
      setPanCheck({
        state: "error",
        message: err.response?.data?.message || "Could not check PAN",
      });
    }
  };

  useEffect(() => {
    if (!isEdit && form.panNumber.length === 10) checkPan(form.panNumber);
    if (!isEdit && form.panNumber.length < 10) {
      lastCheckedPan.current = "";
      setPanCheck({ state: "idle" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.panNumber, isEdit]);

  const computeErrors = () => {
    const e = {};
    const profile = VENDOR_TYPES[form.vendorType] || VENDOR_TYPES.standard;
    if (!form.panNumber.trim()) e.panNumber = "PAN is required";
    else if (!VENDOR_MASTER.PAN_REGEX.test(form.panNumber))
      e.panNumber = "Invalid PAN (e.g. ABCDE1234F)";
    if (!form.vendorName.trim()) e.vendorName = "Vendor name is required";
    if (!form.mobile.trim()) e.mobile = "Mobile is required";
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email))
      e.email = "Invalid email";
    if (form.gstNumber && !VENDOR_MASTER.GST_REGEX.test(form.gstNumber))
      e.gstNumber = "Invalid GST format";
    else if (form.gstNumber && !gstMatchesPan(form.gstNumber, form.panNumber))
      e.gstNumber =
        "This GSTIN does not belong to the PAN above (characters 3–12 must be the PAN)";
    if (profile.requireBank) {
      if (!form.accountHolderName.trim())
        e.accountHolderName = "Account holder name is required";
      if (!form.bankName.trim()) e.bankName = "Bank name is required";
      if (!form.accountNumber.trim())
        e.accountNumber = "Account number is required";
      if (!form.ifscCode.trim()) e.ifscCode = "IFSC code is required";
    }
    if (form.ifscCode && !VENDOR_MASTER.IFSC_REGEX.test(form.ifscCode))
      e.ifscCode = "Invalid IFSC (e.g. SBIN0001234)";
    return e;
  };

  const bankChanged =
    isEdit &&
    original &&
    BANK_FIELDS.some(
      (f) => String(original[f] || "").trim() !== String(form[f] || "").trim(),
    );

  const save = async (bankConfirmed = false) => {
    const e = computeErrors();
    if (!isEdit && panCheck.state === "exists")
      e.panNumber = "This PAN is already in the Vendor Master";
    if (Object.keys(e).length) {
      const first = Object.keys(FIELD_SECTION).find((f) => e[f]);
      if (first !== undefined) setSection(FIELD_SECTION[first]);
      setErrors({ ...e, submit: "Please fix the highlighted fields." });
      return;
    }
    // Changing bank details of a vendor that branches already pay is the
    // single most consequential edit on this screen — confirm it.
    if (
      bankChanged &&
      (original?.linkedBranchCount || 0) > 0 &&
      !bankConfirmed
    ) {
      setConfirmBank(true);
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      if (isEdit) {
        const { data } = await api.put(`/vendor-masters/${id}`, form);
        navigate(`/vendor-masters/${id}`, {
          state: {
            flash: data.branchRowsUpdated
              ? `Saved. Details synced to ${data.branchRowsUpdated} branch vendor record${data.branchRowsUpdated === 1 ? "" : "s"}.`
              : "Saved.",
          },
        });
      } else {
        const { data } = await api.post("/vendor-masters", form);
        navigate(`/vendor-masters/${data.master._id}`, {
          state: {
            flash:
              "Vendor master created. Upload the required documents, then submit it for approval." +
              (data.unlinkedLocalCount
                ? ` ${data.unlinkedLocalCount} branch record(s) with this PAN already exist — attach them from Linked Branches once approved.`
                : ""),
          },
        });
      }
    } catch (err) {
      const d = err.response?.data || {};
      if (d.code === "PAN_EXISTS" && d.masterId) {
        setPanCheck({ state: "exists", master: { _id: d.masterId } });
      }
      setErrors({ submit: d.message || "Save failed" });
    } finally {
      setSaving(false);
      setConfirmBank(false);
    }
  };

  const handleChequeScan = async (file) => {
    if (!file) return;
    setChequeScanning(true);
    setChequeError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/parse-cheque", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const b = data.bankDetails || {};
      setForm((f) => ({
        ...f,
        accountHolderName: b.accountHolderName || f.accountHolderName,
        bankName: b.bankName || f.bankName,
        accountNumber: b.accountNumber || f.accountNumber,
        ifscCode: b.ifscCode || f.ifscCode,
      }));
    } catch (err) {
      setChequeError(
        err.response?.data?.message ||
          "Could not read cheque. Please fill bank details manually.",
      );
    } finally {
      setChequeScanning(false);
    }
  };

  if (fetching)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>Loading...</div>
        </main>
      </div>
    );

  const input = (field, props = {}) => (
    <input
      style={{
        ...S.input,
        ...(errors[field] ? S.inputError : {}),
        ...(props.mono ? { fontFamily: "monospace" } : {}),
        ...(props.upper ? { textTransform: "uppercase" } : {}),
        ...(props.disabled ? S.inputDisabled : {}),
      }}
      value={form[field]}
      onChange={onInput(field, props.upper ? upper : undefined)}
      onBlur={props.onBlur}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      type={props.type || "text"}
      disabled={props.disabled || !canEdit}
    />
  );

  const requireBank = (VENDOR_TYPES[form.vendorType] || VENDOR_TYPES.standard)
    .requireBank;

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <button
            style={S.backBtn}
            onClick={() =>
              navigate(isEdit ? `/vendor-masters/${id}` : "/vendor-masters")
            }
          >
            ← Back
          </button>
          <h1 style={S.title}>
            {isEdit
              ? `Edit ${original?.vendorName || "Vendor Master"}`
              : "New Vendor Master"}
          </h1>
          <p style={S.sub}>
            {isEdit
              ? "Changes apply to every branch that uses this vendor."
              : "One record per PAN, shared by every branch. Documents are uploaded on the next screen."}
          </p>
        </div>

        <div style={S.formCard}>
          <div style={S.tabs}>
            {SECTIONS.map((label, i) => (
              <button
                key={label}
                style={{ ...S.tab, ...(section === i ? S.tabActive : {}) }}
                onClick={() => setSection(i)}
              >
                <span
                  style={{
                    ...S.tabNum,
                    background: section === i ? C.accent : "#e2e8f0",
                    color: section === i ? "#fff" : "#94a3b8",
                  }}
                >
                  {i + 1}
                </span>
                {label}
              </button>
            ))}
          </div>

          {errors.submit && <div style={S.errorBox}>{errors.submit}</div>}

          <div style={S.formBody}>
            {!canEdit && (
              <div style={S.warnBox}>
                🔒 This vendor master can only be edited by the accounts team.
              </div>
            )}
            {isEdit && (original?.linkedBranchCount || 0) > 0 && canEdit && (
              <div style={S.infoBox}>
                Used by {original.linkedBranchCount} branch
                {original.linkedBranchCount === 1 ? "" : "es"}. Saving updates
                every one of them, including the bank account used for payments.
              </div>
            )}

            {section === 0 && (
              <div style={S.grid2}>
                <Field label="PAN Number *" error={errors.panNumber}>
                  {input("panNumber", {
                    upper: true,
                    mono: true,
                    maxLength: 10,
                    placeholder: "ABCDE1234F",
                    disabled: panLocked,
                  })}
                  {panLocked && (
                    <span style={S.hint}>
                      Only a super admin can change the PAN of an approved
                      vendor.
                    </span>
                  )}
                  {!isEdit && panCheck.state === "checking" && (
                    <span style={S.hint}>Checking the Vendor Master…</span>
                  )}
                  {!isEdit && panCheck.state === "new" && (
                    <span style={{ ...S.hint, color: "#16a34a" }}>
                      ✓ New PAN — not in the Vendor Master
                      {panCheck.localRows?.length
                        ? ` (exists as a branch-level record in ${panCheck.localRows.length} of your branches)`
                        : ""}
                    </span>
                  )}
                  {!isEdit && panCheck.state === "error" && (
                    <span style={{ ...S.hint, color: "#dc2626" }}>
                      {panCheck.message}
                    </span>
                  )}
                </Field>
                <Field label="Vendor Name *" error={errors.vendorName}>
                  {input("vendorName", { placeholder: "Full vendor name" })}
                </Field>

                {!isEdit && panCheck.state === "exists" && (
                  <div style={{ ...S.existsBox, gridColumn: "1 / -1" }}>
                    <div>
                      <strong>
                        {panCheck.master?.vendorName || "A vendor"} already uses
                        this PAN.
                      </strong>{" "}
                      A PAN can be registered only once.
                    </div>
                    <button
                      style={S.linkBtn}
                      onClick={() =>
                        navigate(`/vendor-masters/${panCheck.master._id}`)
                      }
                    >
                      Open existing →
                    </button>
                  </div>
                )}

                <Field label="Contact Person">
                  {input("contactPerson", { placeholder: "Contact person" })}
                </Field>
                <Field label="Mobile *" error={errors.mobile}>
                  {input("mobile", {
                    placeholder: "10-digit mobile",
                    maxLength: 10,
                  })}
                </Field>
                <Field label="Email" error={errors.email}>
                  {input("email", {
                    placeholder: "vendor@email.com",
                    type: "email",
                  })}
                </Field>
              </div>
            )}

            {section === 1 && (
              <div style={S.grid2}>
                <Field label="Vendor Type *">
                  <select
                    style={{ ...S.input, ...(!canEdit ? S.inputDisabled : {}) }}
                    value={form.vendorType}
                    disabled={!canEdit}
                    onChange={(e) => setField("vendorType", e.target.value)}
                  >
                    {VENDOR_TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Default Category">
                  <SearchableSelect
                    options={VENDOR_CATEGORIES}
                    value={form.vendorCategory}
                    onChange={(v) => setField("vendorCategory", v)}
                    getOptionValue={(c) => c}
                    getOptionLabel={(c) => c}
                    placeholder="Select (optional)"
                    disabled={!canEdit}
                  />
                  <span style={S.hint}>
                    Suggested when a branch adds this vendor; each branch may
                    choose its own.
                  </span>
                </Field>
                <Field label="Company Name">
                  {input("companyName", {
                    placeholder: "Registered company name",
                  })}
                </Field>
                <Field label="Primary GSTIN" error={errors.gstNumber}>
                  {input("gstNumber", {
                    upper: true,
                    mono: true,
                    maxLength: 15,
                    placeholder: "27AAAAA0000A1Z5",
                  })}
                  <span style={S.hint}>
                    {form.gstNumber.length >= 2 && gstState(form.gstNumber)
                      ? `${gstState(form.gstNumber)} registration. `
                      : ""}
                    Each branch keeps its own GSTIN for its state; all of them
                    are listed on the vendor master page.
                  </span>
                </Field>
                <Field label="MSME Number">
                  {input("msmeNumber", { placeholder: "UDYAM-XX-00-0000000" })}
                </Field>
                <Field label="Business Address" fullWidth>
                  <textarea
                    style={{
                      ...S.input,
                      ...S.textarea,
                      ...(!canEdit ? S.inputDisabled : {}),
                    }}
                    value={form.businessAddress}
                    disabled={!canEdit}
                    onChange={onInput("businessAddress")}
                    placeholder="Complete business address"
                  />
                </Field>
              </div>
            )}

            {section === 2 && (
              <div>
                {canEdit && (
                  <div style={S.scanBox}>
                    <div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 13,
                          color: "#0369a1",
                        }}
                      >
                        🤖 Auto-fill from Cancelled Cheque
                      </div>
                      <div
                        style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
                      >
                        Reads the account details from a clear photo. Upload the
                        cheque itself as a document on the next screen.
                      </div>
                      {chequeError && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#dc2626",
                            marginTop: 4,
                          }}
                        >
                          ⚠️ {chequeError}
                        </div>
                      )}
                    </div>
                    <input
                      ref={chequeInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleChequeScan(f);
                        e.target.value = "";
                      }}
                    />
                    <button
                      style={{
                        ...S.scanBtn,
                        opacity: chequeScanning ? 0.6 : 1,
                      }}
                      disabled={chequeScanning}
                      onClick={() => chequeInputRef.current?.click()}
                    >
                      {chequeScanning ? "🔍 Reading..." : "📷 Scan Cheque"}
                    </button>
                  </div>
                )}
                <div style={S.grid2}>
                  <Field
                    label={`Account Holder Name${requireBank ? " *" : ""}`}
                    error={errors.accountHolderName}
                  >
                    {input("accountHolderName", {
                      placeholder: "As per bank records",
                    })}
                  </Field>
                  <Field
                    label={`Bank Name${requireBank ? " *" : ""}`}
                    error={errors.bankName}
                  >
                    {input("bankName", { placeholder: "Bank name" })}
                  </Field>
                  <Field
                    label={`Account Number${requireBank ? " *" : ""}`}
                    error={errors.accountNumber}
                  >
                    {input("accountNumber", {
                      mono: true,
                      placeholder: "Account number",
                    })}
                  </Field>
                  <Field
                    label={`IFSC Code${requireBank ? " *" : ""}`}
                    error={errors.ifscCode}
                  >
                    {input("ifscCode", {
                      upper: true,
                      mono: true,
                      maxLength: 11,
                      placeholder: "SBIN0001234",
                    })}
                  </Field>
                  <Field label="UPI ID">
                    {input("upiId", { placeholder: "vendor@upi" })}
                  </Field>
                </div>
              </div>
            )}
          </div>

          <div style={S.footer}>
            <button
              style={S.cancelBtn}
              onClick={() =>
                navigate(isEdit ? `/vendor-masters/${id}` : "/vendor-masters")
              }
            >
              Cancel
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              {section > 0 && (
                <button
                  style={S.prevBtn}
                  onClick={() => setSection((s) => s - 1)}
                >
                  ← Previous
                </button>
              )}
              {section < SECTIONS.length - 1 ? (
                <button
                  style={S.nextBtn}
                  onClick={() => setSection((s) => s + 1)}
                >
                  Next →
                </button>
              ) : (
                <button
                  style={{
                    ...S.submitBtn,
                    opacity: saving || !canEdit ? 0.6 : 1,
                    cursor: saving || !canEdit ? "not-allowed" : "pointer",
                  }}
                  disabled={saving || !canEdit}
                  onClick={() => save(false)}
                >
                  {saving
                    ? "Saving..."
                    : isEdit
                      ? "💾 Save Changes"
                      : "💾 Save & Upload Documents"}
                </button>
              )}
            </div>
          </div>
        </div>

        {confirmBank && (
          <div style={S.overlay}>
            <div style={S.modal}>
              <h3 style={S.modalTitle}>Change bank details?</h3>
              <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.5 }}>
                {original?.linkedBranchCount} branch
                {original?.linkedBranchCount === 1 ? "" : "es"} pay this vendor.
                After saving, every future payment from all of them goes to the
                new account:
              </p>
              <div style={S.diffBox}>
                {BANK_FIELDS.filter(
                  (f) =>
                    String(original?.[f] || "").trim() !==
                    String(form[f] || "").trim(),
                ).map((f) => (
                  <div key={f} style={{ fontSize: 13, marginBottom: 4 }}>
                    <strong>{f}:</strong>{" "}
                    <span
                      style={{
                        color: "#dc2626",
                        textDecoration: "line-through",
                      }}
                    >
                      {f === "accountNumber"
                        ? `****${String(original?.[f] || "").slice(-4)}`
                        : original?.[f] || "—"}
                    </span>{" "}
                    →{" "}
                    <span style={{ color: "#16a34a" }}>
                      {f === "accountNumber"
                        ? `****${String(form[f] || "").slice(-4)}`
                        : form[f] || "—"}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: "#94a3b8" }}>
                Replace the cancelled cheque document to match.
              </p>
              <div style={S.modalBtns}>
                <button
                  style={S.cancelBtn}
                  onClick={() => setConfirmBank(false)}
                >
                  Cancel
                </button>
                <button
                  style={S.dangerBtn}
                  onClick={() => save(true)}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Yes, change for all branches"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const Field = ({ label, error, children, fullWidth }) => (
  <div
    style={{
      gridColumn: fullWidth ? "1 / -1" : undefined,
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}
  >
    <label style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>
      {label}
    </label>
    {children}
    {error && <span style={{ fontSize: 12, color: "#dc2626" }}>{error}</span>}
  </div>
);

const C = { primary: "#1a3c6e", accent: "#2563eb", border: "#e2e8f0" };
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", minWidth: 0 },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  topBar: { marginBottom: 20 },
  backBtn: {
    background: "none",
    border: "none",
    color: C.accent,
    cursor: "pointer",
    fontSize: 14,
    padding: 0,
    marginBottom: 8,
    display: "block",
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: "#64748b", marginTop: 4 },
  formCard: {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
    overflow: "hidden",
  },
  tabs: {
    display: "flex",
    borderBottom: `1px solid ${C.border}`,
    overflowX: "auto",
  },
  tab: {
    flex: 1,
    padding: "14px 12px",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    color: "#64748b",
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    whiteSpace: "nowrap",
    minWidth: 130,
  },
  tabActive: {
    color: C.accent,
    borderBottom: `2px solid ${C.accent}`,
    fontWeight: 700,
  },
  tabNum: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    fontSize: 11,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  formBody: { padding: 28 },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 18,
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
    background: "#fff",
  },
  inputError: { borderColor: "#dc2626", background: "#fef2f2" },
  inputDisabled: {
    background: "#f1f5f9",
    color: "#64748b",
    cursor: "not-allowed",
  },
  textarea: { minHeight: 80, resize: "vertical", fontFamily: "inherit" },
  hint: { fontSize: 11, color: "#94a3b8" },
  infoBox: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#1d4ed8",
    marginBottom: 18,
  },
  warnBox: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#92400e",
    marginBottom: 18,
  },
  existsBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 8,
    padding: "12px 14px",
    fontSize: 13,
    color: "#92400e",
  },
  linkBtn: {
    padding: "7px 14px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  errorBox: {
    margin: "16px 28px 0",
    padding: "10px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#dc2626",
    fontSize: 13,
  },
  scanBox: {
    background: "#f0f9ff",
    border: "1px solid #bae6fd",
    borderRadius: 10,
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 18,
  },
  scanBtn: {
    padding: "9px 18px",
    background: "#0369a1",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 28px",
    borderTop: `1px solid ${C.border}`,
    background: "#f8fafc",
  },
  cancelBtn: {
    padding: "10px 18px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    color: "#475569",
  },
  prevBtn: {
    padding: "10px 18px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    color: "#475569",
  },
  nextBtn: {
    padding: "10px 18px",
    border: "none",
    borderRadius: 8,
    background: C.primary,
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  submitBtn: {
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    background: C.accent,
    color: "#fff",
    fontWeight: 700,
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
    margin: "0 0 8px",
  },
  diffBox: {
    background: "#f8fafc",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 14px",
    margin: "12px 0",
    fontFamily: "monospace",
  },
  modalBtns: { display: "flex", gap: 10, marginTop: 16 },
  dangerBtn: {
    flex: 1,
    padding: "10px",
    border: "none",
    borderRadius: 8,
    background: "#dc2626",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
};
