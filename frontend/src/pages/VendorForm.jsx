import { useState, useEffect, useRef } from "react";
import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import FileUpload from "../components/FileUpload.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { VENDOR_TYPES, VENDOR_TYPE_OPTIONS } from "../config/constants.js";

const VENDOR_CATEGORIES = [
  "Service Vendors",
  "Equipment Vendors",
  "Utility Vendors",
  "Consultant Vendors",
  "Medical Suppliers",
  "Miscellaneous Vendors",
];

const SECTIONS = [
  "Personal Details",
  "Business Details",
  "Bank Details",
  "Documents",
];

const INIT = {
  branch: "",
  vendorName: "",
  contactPerson: "",
  mobile: "",
  email: "",
  companyName: "",
  gstNumber: "",
  panNumber: "",
  businessAddress: "",
  vendorCategory: "",
  vendorType: "standard",
  msmeNumber: "",
  accountHolderName: "",
  bankName: "",
  accountNumber: "",
  ifscCode: "",
  upiId: "",
};

export default function VendorForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState(INIT);
  const [branches, setBranches] = useState([]);
  const [activeSection, setActiveSection] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [savedVendorId, setSavedVendorId] = useState(id || null); // ✅ track saved vendor ID
  const [savedVendor, setSavedVendor] = useState(null);
  const [success, setSuccess] = useState("");
  const [chequeScanning, setChequeScanning] = useState(false);
  const [chequeError, setChequeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const chequeInputRef = useRef(null);

  const editLocked =
    isEdit &&
    savedVendor?.approvalStatus === "approved" &&
    !["accounts", "super_admin"].includes(user?.role);

  useEffect(() => {
    api
      .get("/branches")
      .then((r) =>
        setBranches(Array.isArray(r.data) ? r.data : r.data.branches || []),
      )
      .catch(console.error);

    if (isEdit) {
      api
        .get(`/vendors/${id}`)
        .then((r) => {
          const v = r.data;
          setSavedVendor(v);
          setForm({
            branch: v.branch?._id || "",
            vendorName: v.vendorName || "",
            contactPerson: v.contactPerson || "",
            mobile: v.mobile || "",
            email: v.email || "",
            companyName: v.companyName || "",
            gstNumber: v.gstNumber || "",
            panNumber: v.panNumber || "",
            businessAddress: v.businessAddress || "",
            vendorCategory: v.vendorCategory || "",
            vendorType: v.vendorType || "standard",
            accountHolderName: v.accountHolderName || "",
            bankName: v.bankName || "",
            accountNumber: v.accountNumber || "",
            ifscCode: v.ifscCode || "",
            upiId: v.upiId || "",
            msmeNumber: v.msmeNumber || "",
          });
        })
        .catch(console.error)
        .finally(() => setFetching(false));
    }

    if (
      !isEdit &&
      user?.role === "branch_user" &&
      user.branches?.length === 1
    ) {
      setForm((f) => ({
        ...f,
        branch: user.branches[0]._id || user.branches[0],
      }));
    }
  }, [id, isEdit, user]);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors((er) => ({ ...er, [field]: "" }));
  };

  const setField = (field, val) => {
    setForm((f) => ({ ...f, [field]: val }));
    if (errors[field]) setErrors((er) => ({ ...er, [field]: "" }));
  };
  const computeErrors = () => {
    const e = {};
    const profile = VENDOR_TYPES[form.vendorType] || VENDOR_TYPES.standard;

    if (!form.branch) e.branch = "Branch is required";
    if (!form.vendorName?.trim()) e.vendorName = "Vendor name is required";
    if (!form.mobile?.trim()) e.mobile = "Mobile is required";

    // PAN — required only for standard; format-checked whenever a value is present
    if (profile.requirePAN && !form.panNumber?.trim())
      e.panNumber = "PAN number is required";
    else if (
      form.panNumber?.trim() &&
      !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.panNumber)
    )
      e.panNumber = "Invalid PAN (e.g. ABCDE1234F)";

    if (
      form.gstNumber &&
      !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Z][A-Z\d]$/.test(form.gstNumber)
    )
      e.gstNumber = "Invalid GST format";

    // Bank details — required only for standard
    if (profile.requireBank && !form.accountHolderName?.trim())
      e.accountHolderName = "Account holder name is required";
    if (profile.requireBank && !form.bankName?.trim())
      e.bankName = "Bank name is required";
    if (profile.requireBank && !form.accountNumber?.trim())
      e.accountNumber = "Account number is required";
    if (profile.requireBank && !form.ifscCode?.trim())
      e.ifscCode = "IFSC code is required";
    else if (
      form.ifscCode?.trim() &&
      !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifscCode)
    )
      e.ifscCode = "Invalid IFSC (e.g. SBIN0001234)";

    return e;
  };

  const validate = () => {
    const e = computeErrors();
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Map each field to its section index so we can jump there on error
  const FIELD_SECTION = {
    branch: 0,
    vendorName: 0,
    mobile: 0,
    vendorType: 1,
    panNumber: 1,
    gstNumber: 1,
    msmeNumber: 1,
    accountHolderName: 2,
    bankName: 2,
    accountNumber: 2,
    ifscCode: 2,
  };

  // ✅ Save details first, then go to Documents tab
  const handleSaveDetails = async () => {
    if (editLocked) {
      setErrors({
        submit: "Approved vendors can only be edited by the accounts team.",
      });
      return;
    }
    const e = computeErrors();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      const firstBadField = Object.keys(FIELD_SECTION).find((f) => e[f]);
      if (firstBadField !== undefined) {
        setActiveSection(FIELD_SECTION[firstBadField]);
      }
      setErrors({
        ...e,
        submit: `Please fix the errors above: ${Object.values(e).join(", ")}`,
      });
      return;
    }
    setLoading(true);
    try {
      let response;
      if (isEdit || savedVendorId) {
        const vid = savedVendorId || id;
        response = await api.put(`/vendors/${vid}`, form);
      } else {
        response = await api.post("/vendors", form);
        setSavedVendorId(response.data._id);
      }
      setSavedVendor(response.data);
      setSuccess("Vendor details saved! Now upload the required documents.");
      setActiveSection(3); // jump to documents
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Save failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    const status = savedVendor?.approvalStatus;
    if (status === "draft" || status === "rejected") {
      setSubmitting(true);
      try {
        const vid = savedVendorId || id;
        const { data } = await api.patch(`/vendors/${vid}/submit`);
        setSavedVendor(data);
      } catch (err) {
        setErrors({ submit: err.response?.data?.message || "Submit failed" });
        setSubmitting(false);
        return; // stay on the page so the error shows
      }
    }
    navigate("/vendors");
  };

  const handleChequeScan = async (file) => {
    if (!file) return;
    setChequeScanning(true);
    setChequeError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/uploads/parse-cheque", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const b = data.bankDetails;
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

  const refreshVendor = async () => {
    if (!savedVendorId) return;
    const { data } = await api.get(`/vendors/${savedVendorId}`);
    setSavedVendor(data);
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

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <button style={S.backBtn} onClick={() => navigate("/vendors")}>
            ← Back
          </button>
          <h1 style={S.title}>{isEdit ? "Edit Vendor" : "Add New Vendor"}</h1>
        </div>

        <div style={S.formCard}>
          {/* Section Tabs */}
          <div style={S.tabs}>
            {SECTIONS.map((sec, i) => (
              <button
                key={sec}
                style={{
                  ...S.tab,
                  ...(activeSection === i ? S.tabActive : {}),
                }}
                onClick={() => {
                  // Only allow documents tab if vendor is saved
                  if (i === 3 && !savedVendorId) {
                    setErrors({
                      submit:
                        "Please save vendor details first before uploading documents.",
                    });
                    return;
                  }
                  setActiveSection(i);
                }}
              >
                <span
                  style={{
                    ...S.tabNum,
                    background:
                      activeSection === i
                        ? "#2563eb"
                        : savedVendorId && i === 3
                          ? "#16a34a"
                          : "#e2e8f0",
                    color:
                      activeSection === i || (savedVendorId && i === 3)
                        ? "#fff"
                        : "#94a3b8",
                  }}
                >
                  {i + 1}
                </span>
                {sec}
                {i === 3 &&
                  savedVendorId &&
                  savedVendor?.documents?.length > 0 && (
                    <span style={S.docCountBadge}>
                      {savedVendor.documents.length}
                    </span>
                  )}
              </button>
            ))}
          </div>

          {success && <div style={S.successBox}>{success}</div>}
          {errors.submit && <div style={S.errorBox}>{errors.submit}</div>}

          <div style={S.formBody}>
            {editLocked && (
              <div style={S.warnBox}>
                🔒 This vendor is approved. Only the accounts team can edit it.
              </div>
            )}
            {/* Section 0: Personal */}
            {activeSection === 0 && (
              <div>
                <h2 style={S.sectionTitle}>👤 Personal Details</h2>
                <div style={S.grid2}>
                  <Field label="Branch *" error={errors.branch}>
                    <SearchableSelect
                      options={branches}
                      value={form.branch}
                      onChange={(val) => setField("branch", val)}
                      getOptionLabel={(b) => `${b.name} (${b.code})`}
                      placeholder="Select Branch"
                      error={!!errors.branch}
                      disabled={
                        user?.role === "branch_user" &&
                        user.branches?.length === 1
                      }
                    />
                  </Field>
                  <Field label="Vendor Name *" error={errors.vendorName}>
                    <input
                      style={{
                        ...S.input,
                        ...(errors.vendorName ? S.inputError : {}),
                      }}
                      value={form.vendorName}
                      onChange={set("vendorName")}
                      placeholder="Full vendor name"
                    />
                  </Field>
                  <Field label="Contact Person">
                    <input
                      style={S.input}
                      value={form.contactPerson}
                      onChange={set("contactPerson")}
                      placeholder="Contact person"
                    />
                  </Field>
                  <Field label="Mobile *" error={errors.mobile}>
                    <input
                      style={{
                        ...S.input,
                        ...(errors.mobile ? S.inputError : {}),
                      }}
                      value={form.mobile}
                      onChange={set("mobile")}
                      placeholder="10-digit mobile"
                      maxLength={10}
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      style={S.input}
                      type="email"
                      value={form.email}
                      onChange={set("email")}
                      placeholder="vendor@email.com"
                    />
                  </Field>
                </div>
              </div>
            )}

            {/* Section 1: Business */}
            {activeSection === 1 && (
              <div>
                <h2 style={S.sectionTitle}>🏢 Business Details</h2>
                <div style={S.grid2}>
                  <Field label="Vendor Type *" error={errors.vendorType}>
                    <select
                      style={{
                        ...S.input,
                        ...(errors.vendorType ? S.inputError : {}),
                      }}
                      value={form.vendorType}
                      onChange={(e) => setField("vendorType", e.target.value)}
                    >
                      {VENDOR_TYPE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <span
                      style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}
                    >
                      {form.vendorType === "statutory"
                        ? "Bank details, PAN & PAN/cheque documents are optional for this type."
                        : "Bank details and PAN are required."}
                    </span>
                  </Field>
                  <Field label="Vendor Category" error={errors.vendorCategory}>
                    <SearchableSelect
                      options={VENDOR_CATEGORIES}
                      value={form.vendorCategory}
                      onChange={(val) => setField("vendorCategory", val)}
                      getOptionValue={(c) => c}
                      getOptionLabel={(c) => c}
                      placeholder="Select Category (Optional)"
                      error={!!errors.vendorCategory}
                    />
                  </Field>
                  <Field label="MSME Number (Optional)">
                    <input
                      style={S.input}
                      value={form.msmeNumber}
                      onChange={set("msmeNumber")}
                      placeholder="UDYAM-XX-00-0000000"
                    />
                  </Field>
                  <Field label="Company Name">
                    <input
                      style={S.input}
                      value={form.companyName}
                      onChange={set("companyName")}
                      placeholder="Registered company name"
                    />
                  </Field>
                  <Field label="PAN Number *" error={errors.panNumber}>
                    <input
                      style={{
                        ...S.input,
                        ...(errors.panNumber ? S.inputError : {}),
                        textTransform: "uppercase",
                      }}
                      value={form.panNumber}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          panNumber: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="ABCDE1234F"
                      maxLength={10}
                    />
                  </Field>
                  <Field label="GST Number" error={errors.gstNumber}>
                    <input
                      style={{
                        ...S.input,
                        ...(errors.gstNumber ? S.inputError : {}),
                        textTransform: "uppercase",
                      }}
                      value={form.gstNumber}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          gstNumber: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="22AAAAA0000A1Z5"
                      maxLength={15}
                    />
                  </Field>
                  <Field label="Business Address" fullWidth>
                    <textarea
                      style={{ ...S.input, ...S.textarea }}
                      value={form.businessAddress}
                      onChange={set("businessAddress")}
                      placeholder="Complete business address"
                    />
                  </Field>
                </div>
              </div>
            )}

            {/* Section 2: Bank */}
            {activeSection === 2 && (
              <div>
                <h2 style={S.sectionTitle}>🏦 Bank Details</h2>
                <div style={S.infoBox}>
                  🔒 Bank details are used for payment processing. Ensure
                  accuracy.
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <div
                    style={{
                      background: "#f0f9ff",
                      border: "1px solid #bae6fd",
                      borderRadius: 10,
                      padding: "14px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 10,
                    }}
                  >
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
                        Upload a clear photo of the cancelled cheque to
                        auto-fill bank details
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 6,
                      }}
                    >
                      <input
                        ref={chequeInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleChequeScan(file);
                          e.target.value = "";
                        }}
                      />
                      <button
                        style={{
                          padding: "9px 18px",
                          background: chequeScanning ? "#64748b" : "#0369a1",
                          color: "#fff",
                          border: "none",
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: chequeScanning ? "not-allowed" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                        disabled={chequeScanning}
                        onClick={() => chequeInputRef.current?.click()}
                      >
                        {chequeScanning
                          ? "🔍 Reading cheque..."
                          : "📷 Scan Cheque"}
                      </button>
                      {chequeError && (
                        <span style={{ fontSize: 12, color: "#dc2626" }}>
                          ⚠️ {chequeError}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={S.grid2}>
                  <Field
                    label="Account Holder Name *"
                    error={errors.accountHolderName}
                  >
                    <input
                      style={{
                        ...S.input,
                        ...(errors.accountHolderName ? S.inputError : {}),
                      }}
                      value={form.accountHolderName}
                      onChange={set("accountHolderName")}
                      placeholder="As per bank records"
                    />
                  </Field>
                  <Field label="Bank Name *" error={errors.bankName}>
                    <input
                      style={{
                        ...S.input,
                        ...(errors.bankName ? S.inputError : {}),
                      }}
                      value={form.bankName}
                      onChange={set("bankName")}
                      placeholder="Bank name"
                    />
                  </Field>
                  <Field label="Account Number *" error={errors.accountNumber}>
                    <input
                      style={{
                        ...S.input,
                        ...(errors.accountNumber ? S.inputError : {}),
                        fontFamily: "monospace",
                      }}
                      value={form.accountNumber}
                      onChange={set("accountNumber")}
                      placeholder="Account number"
                    />
                  </Field>
                  <Field label="IFSC Code *" error={errors.ifscCode}>
                    <input
                      style={{
                        ...S.input,
                        ...(errors.ifscCode ? S.inputError : {}),
                        textTransform: "uppercase",
                        fontFamily: "monospace",
                      }}
                      value={form.ifscCode}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          ifscCode: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="SBIN0001234"
                      maxLength={11}
                    />
                  </Field>
                  <Field label="UPI ID (Optional)">
                    <input
                      style={S.input}
                      value={form.upiId}
                      onChange={set("upiId")}
                      placeholder="vendor@upi"
                    />
                  </Field>
                </div>
              </div>
            )}

            {/* Section 3: Documents — ✅ FileUpload with real vendor ID */}
            {activeSection === 3 && (
              <div>
                <h2 style={S.sectionTitle}>📄 Documents</h2>
                {!savedVendorId ? (
                  <div style={S.warnBox}>
                    ⚠️ Please save vendor details first (click "Save & Continue"
                    below) before uploading documents.
                  </div>
                ) : (
                  <FileUpload
                    entityType="vendor"
                    entityId={savedVendorId}
                    existingDocs={savedVendor?.documents || []}
                    onUploadSuccess={refreshVendor}
                    requiredTypes={[
                      ...(VENDOR_TYPES[form.vendorType]?.requiredDocs || []),
                      ...(form.gstNumber?.trim() ? ["gst"] : []),
                    ]}
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={S.footer}>
            <button style={S.cancelBtn} onClick={() => navigate("/vendors")}>
              Cancel
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              {activeSection > 0 && (
                <button
                  style={S.prevBtn}
                  onClick={() => setActiveSection((s) => s - 1)}
                >
                  ← Previous
                </button>
              )}
              {activeSection < 2 && (
                <button
                  style={S.nextBtn}
                  onClick={() => setActiveSection((s) => s + 1)}
                >
                  Next →
                </button>
              )}
              {activeSection === 2 && (
                <button
                  style={{ ...S.submitBtn, opacity: loading ? 0.7 : 1 }}
                  onClick={handleSaveDetails}
                  disabled={loading || editLocked}
                >
                  {loading
                    ? "Saving..."
                    : savedVendorId
                      ? "💾 Save & Go to Documents"
                      : "💾 Save & Upload Documents"}
                </button>
              )}
              {activeSection === 3 &&
                (() => {
                  const REQUIRED_DOCS = [
                    ...(VENDOR_TYPES[form.vendorType] || VENDOR_TYPES.standard)
                      .requiredDocs,
                  ];
                  if (form.gstNumber?.trim()) REQUIRED_DOCS.push("gst");

                  const uploadedTypes = (savedVendor?.documents || []).map(
                    (d) => d.type,
                  );
                  const missingDocs = REQUIRED_DOCS.filter(
                    (t) => !uploadedTypes.includes(t),
                  );
                  const allUploaded = missingDocs.length === 0;
                  return (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 6,
                      }}
                    >
                      {!allUploaded && (
                        <span
                          style={{
                            fontSize: 12,
                            color: "#dc2626",
                            fontWeight: 500,
                          }}
                        >
                          Missing required docs:{" "}
                          {missingDocs
                            .map((t) =>
                              t === "pan"
                                ? "PAN Card"
                                : t === "gst"
                                  ? "GST Certificate"
                                  : "Cancelled Cheque",
                            )
                            .join(", ")}
                        </span>
                      )}
                      <button
                        style={{
                          ...S.submitBtn,
                          opacity: allUploaded && !submitting ? 1 : 0.45,
                          cursor:
                            allUploaded && !submitting
                              ? "pointer"
                              : "not-allowed",
                        }}
                        disabled={!allUploaded || submitting}
                        onClick={handleFinish}
                      >
                        {submitting ? (
                          "⏳ Submitting..."
                        ) : (
                          <>
                            ✓{" "}
                            {savedVendor?.approvalStatus === "draft" ||
                            savedVendor?.approvalStatus === "rejected"
                              ? "Submit for Approval"
                              : "Done"}
                          </>
                        )}
                      </button>
                    </div>
                  );
                })()}
            </div>
          </div>
        </div>
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
  main: { flex: 1, padding: "24px 28px" },
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
    position: "relative",
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
    flexShrink: 0,
  },
  docCountBadge: {
    background: "#16a34a",
    color: "#fff",
    borderRadius: 20,
    padding: "1px 6px",
    fontSize: 10,
    fontWeight: 700,
  },
  formBody: { padding: 28 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: C.primary,
    marginBottom: 20,
    paddingBottom: 10,
    borderBottom: `1px solid ${C.border}`,
  },
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
  },
  inputError: { borderColor: "#dc2626", background: "#fef2f2" },
  textarea: { minHeight: 80, resize: "vertical", fontFamily: "inherit" },
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
    borderRadius: 10,
    padding: "16px 18px",
    fontSize: 14,
    color: "#92400e",
    textAlign: "center",
  },
  successBox: {
    margin: "16px 28px 0",
    padding: "12px 16px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    color: "#16a34a",
    fontSize: 14,
    fontWeight: 600,
  },
  errorBox: {
    margin: "16px 28px 0",
    padding: "12px 16px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#dc2626",
    fontSize: 14,
  },
  footer: {
    padding: "16px 28px",
    borderTop: `1px solid ${C.border}`,
    display: "flex",
    justifyContent: "space-between",
    background: "#f8fafc",
  },
  cancelBtn: {
    padding: "10px 18px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    color: "#475569",
  },
  prevBtn: {
    padding: "10px 18px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    color: C.primary,
  },
  nextBtn: {
    padding: "10px 20px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  submitBtn: {
    padding: "10px 24px",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
};
