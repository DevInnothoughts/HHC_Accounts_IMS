// ============================================================
// FRONTEND: src/pages/VendorForm.jsx  —  REPLACE WHOLE FILE (Phase 4)
// ------------------------------------------------------------
// Add Vendor starts with the PAN (components/PanLookupGate.jsx).
// The form then runs in one of four modes:
//
//   "new-master"  New PAN. Saves create a Vendor Master + this branch's
//                 vendor together (POST /vendor-masters with branch).
//                 Documents go to the master, once for the whole group.
//                 Also used when the creator re-opens their own draft /
//                 rejected vendor to fix it.
//   "linked"      Branch vendor that mirrors a Vendor Master. Name, bank,
//                 PAN and documents are read-only (accounts changes them
//                 in the master). The branch edits its category & GSTIN.
//   "local"       Branch-level record from before the Vendor Master.
//                 Behaves exactly as this screen always has.
//   "no-pan"      Utility / tax / statutory payee without a PAN. Stays a
//                 branch-level record (POST /vendors).
// ============================================================
import { useState, useEffect, useRef } from "react";
import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import FileUpload from "../components/FileUpload.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import PanLookupGate from "../components/PanLookupGate.jsx";
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

// Fields a branch may still change on a master-linked vendor.
const BRANCH_EDITABLE = ["vendorCategory", "gstNumber"];

// Body for POST/PUT /vendor-masters (server whitelists again).
const MASTER_BODY_FIELDS = Object.keys(INIT).filter((k) => k !== "branch");

const DOC_LABEL = { pan: "PAN Card", gst: "GST Certificate", cheque: "Cancelled Cheque" };
const idOf = (v) => String(v?._id || v || "");

export default function VendorForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = ["accounts", "super_admin"].includes(user?.role);

  const [mode, setMode] = useState(isEdit ? null : "gate");
  const [form, setForm] = useState(INIT);
  const [branches, setBranches] = useState([]);
  const [activeSection, setActiveSection] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [savedVendorId, setSavedVendorId] = useState(id || null); // branch vendor row
  const [savedVendor, setSavedVendor] = useState(null);
  const [masterId, setMasterId] = useState(null);
  const [success, setSuccess] = useState("");
  const [chequeScanning, setChequeScanning] = useState(false);
  const [chequeError, setChequeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const chequeInputRef = useRef(null);

  const singleBranchUser =
    user?.role === "branch_user" && user.branches?.length === 1;

  // Approved vendors are edited only by accounts (unchanged rule).
  const editLocked =
    isEdit &&
    savedVendor?.approvalStatus === "approved" &&
    !isAdmin;

  // ── Load ────────────────────────────────────────────────
  useEffect(() => {
    api
      .get("/branches")
      .then((r) =>
        setBranches(Array.isArray(r.data) ? r.data : r.data.branches || []),
      )
      .catch(console.error);

    if (!isEdit && singleBranchUser) {
      setForm((f) => ({ ...f, branch: idOf(user.branches[0]) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, user]);

  const formFromVendor = (v) => {
    const next = { ...INIT };
    Object.keys(INIT).forEach((k) => {
      next[k] = k === "branch" ? idOf(v.branch) : (v[k] ?? INIT[k]);
    });
    return next;
  };

  useEffect(() => {
    if (!isEdit) return;
    api
      .get(`/vendors/${id}`)
      .then((r) => {
        const v = r.data;
        setSavedVendor(v);
        setForm(formFromVendor(v));
        const m = v.vendorMaster;
        if (m && v.sourceOfTruth === "master") {
          setMasterId(idOf(m));
          // The creator of a still-draft (or rejected) NEW vendor edits it
          // fully, as they did when adding it. Everyone else sees the
          // master's details read-only.
          const creatorOfDraft =
            idOf(m.createdBy) === String(user?._id) &&
            ["draft", "rejected"].includes(m.approvalStatus);
          setMode(creatorOfDraft ? "new-master" : "linked");
        } else {
          setMode("local");
        }
      })
      .catch((err) =>
        setErrors({ submit: err.response?.data?.message || "Failed to load vendor" }),
      )
      .finally(() => setFetching(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  const refreshVendor = async (vid = savedVendorId) => {
    if (!vid) return;
    const { data } = await api.get(`/vendors/${vid}`);
    setSavedVendor(data);
    if (data.vendorMaster) setMasterId(idOf(data.vendorMaster));
  };

  // ── Field helpers ───────────────────────────────────────
  const fieldDisabled = (f) => {
    if (editLocked) return true;
    if (mode === "linked") return !BRANCH_EDITABLE.includes(f);
    // A branch-level record without a PAN can't be given one here: a PAN
    // vendor is registered through the Vendor Master (the server refuses
    // too). Accounts may still correct a legacy record.
    const panlessLocal = mode === "local" && !savedVendor?.panNumber && !isAdmin;
    if (f === "panNumber") return mode === "new-master" || panlessLocal;
    if (f === "vendorType") return mode === "no-pan" || panlessLocal;
    if (f === "branch")
      return (
        mode === "new-master" ||
        (mode === "no-pan" && Boolean(savedVendorId)) ||
        singleBranchUser ||
        Boolean(masterId)
      );
    return false;
  };

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors((er) => ({ ...er, [field]: "" }));
  };
  const setField = (field, val) => {
    setForm((f) => ({ ...f, [field]: val }));
    if (errors[field]) setErrors((er) => ({ ...er, [field]: "" }));
  };
  const setUpper = (field) => (e) =>
    setField(field, e.target.value.toUpperCase());

  // ── Validation ──────────────────────────────────────────
  const computeErrors = () => {
    const e = {};
    const profile = VENDOR_TYPES[form.vendorType] || VENDOR_TYPES.standard;

    if (!form.branch) e.branch = "Branch is required";

    if (mode !== "linked") {
      if (!form.vendorName?.trim()) e.vendorName = "Vendor name is required";
      if (!form.mobile?.trim()) e.mobile = "Mobile is required";

      if (mode === "new-master" && !form.panNumber?.trim())
        e.panNumber = "PAN number is required";
      else if (mode === "local" && profile.requirePAN && !form.panNumber?.trim())
        e.panNumber = "PAN number is required";
      else if (form.panNumber?.trim() && !VENDOR_MASTER.PAN_REGEX.test(form.panNumber))
        e.panNumber = "Invalid PAN (e.g. ABCDE1234F)";

      if (profile.requireBank) {
        if (!form.accountHolderName?.trim())
          e.accountHolderName = "Account holder name is required";
        if (!form.bankName?.trim()) e.bankName = "Bank name is required";
        if (!form.accountNumber?.trim())
          e.accountNumber = "Account number is required";
        if (!form.ifscCode?.trim()) e.ifscCode = "IFSC code is required";
      }
      if (form.ifscCode?.trim() && !VENDOR_MASTER.IFSC_REGEX.test(form.ifscCode))
        e.ifscCode = "Invalid IFSC (e.g. SBIN0001234)";
    }

    // GSTIN — the branch's own, must belong to the PAN. Checked only when
    // it changes (same rule as the server), so a legacy record with an old
    // mismatched GSTIN can still be saved for other edits.
    const gstChanged =
      String(form.gstNumber || "").toUpperCase() !==
      String(savedVendor?.gstNumber || "").toUpperCase();
    if (form.gstNumber && gstChanged) {
      if (!VENDOR_MASTER.GST_REGEX.test(form.gstNumber))
        e.gstNumber = "Invalid GST format";
      else if (form.panNumber && !gstMatchesPan(form.gstNumber, form.panNumber))
        e.gstNumber = "This GSTIN does not belong to the vendor's PAN";
    }
    return e;
  };

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

  const pick = (keys) =>
    keys.reduce((o, k) => ({ ...o, [k]: form[k] }), {});

  // ── Save ────────────────────────────────────────────────
  const handleSaveDetails = async () => {
    if (editLocked) {
      setErrors({ submit: "Approved vendors can only be edited by the accounts team." });
      return;
    }
    const e = computeErrors();
    if (Object.keys(e).length > 0) {
      const first = Object.keys(FIELD_SECTION).find((f) => e[f]);
      if (first !== undefined) setActiveSection(FIELD_SECTION[first]);
      setErrors({ ...e, submit: `Please fix the errors above: ${Object.values(e).join(", ")}` });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      if (mode === "new-master") {
        if (!masterId) {
          // One request creates the master AND this branch's vendor.
          const { data } = await api.post("/vendor-masters", {
            ...pick(MASTER_BODY_FIELDS),
            branch: form.branch,
          });
          setMasterId(idOf(data.master));
          setSavedVendorId(idOf(data.branchVendor));
          await refreshVendor(idOf(data.branchVendor));
        } else {
          // Still a draft: the creator may correct it (server enforces).
          await api.put(`/vendor-masters/${masterId}`, pick(MASTER_BODY_FIELDS));
          await api.put(`/vendors/${savedVendorId}`, pick(BRANCH_EDITABLE));
          await refreshVendor();
        }
      } else if (mode === "linked") {
        await api.put(`/vendors/${savedVendorId}`, pick(BRANCH_EDITABLE));
        await refreshVendor();
      } else {
        // "local" and "no-pan": the branch-level record, as before
        const body = { ...form };
        if (mode === "no-pan") delete body.panNumber;
        if (savedVendorId) {
          const { data } = await api.put(`/vendors/${savedVendorId}`, body);
          setSavedVendor(data);
        } else {
          const { data } = await api.post("/vendors", body);
          setSavedVendorId(data._id);
          setSavedVendor(data);
        }
      }
      if (mode === "linked") {
        setSuccess("Saved.");
      } else {
        setSuccess("Vendor details saved! Now upload the required documents.");
        setActiveSection(3);
      }
    } catch (err) {
      const d = err.response?.data || {};
      const adding = !isEdit && !savedVendorId;
      if ((d.code === "PAN_EXISTS" || d.code === "PAN_IN_MASTER") && adding) {
        setErrors({
          submit: `${d.message} Go back to Step 1 to add it to your branch instead.`,
          backToGate: true,
        });
      } else {
        setErrors({ submit: d.message || "Save failed" });
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Submit for approval ─────────────────────────────────
  const masterStatus = savedVendor?.vendorMaster?.approvalStatus;
  const rowStatus = savedVendor?.approvalStatus;
  const submitsMaster =
    mode === "new-master" && ["draft", "rejected"].includes(masterStatus);
  // A linked row whose master is itself still draft/rejected is submitted
  // WITH the master by its creator (or accounts) — not from here.
  const waitsOnMaster =
    mode === "linked" && ["draft", "rejected"].includes(masterStatus);
  const needsSubmit =
    submitsMaster ||
    (!waitsOnMaster && ["draft", "rejected"].includes(rowStatus));

  const handleFinish = async () => {
    if (needsSubmit) {
      setSubmitting(true);
      try {
        if (submitsMaster) {
          // Submits the master and this branch's vendor together.
          await api.patch(`/vendor-masters/${masterId}/submit`);
        } else {
          await api.patch(`/vendors/${savedVendorId}/submit`);
        }
      } catch (err) {
        setErrors({ submit: err.response?.data?.message || "Submit failed" });
        setSubmitting(false);
        return;
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

  // ── Gate callbacks ──────────────────────────────────────
  const startNewMaster = (pan) => {
    setForm((f) => ({ ...INIT, branch: f.branch, panNumber: pan }));
    setErrors({});
    setActiveSection(0);
    setMode("new-master");
  };
  const startNoPan = () => {
    setForm((f) => ({ ...INIT, branch: f.branch, vendorType: "statutory" }));
    setErrors({});
    setActiveSection(0);
    setMode("no-pan");
  };
  const backToGate = () => {
    setErrors({});
    setSuccess("");
    setMode("gate");
  };

  // ── Render ──────────────────────────────────────────────
  if (fetching || mode === null)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>{errors.submit || "Loading..."}</div>
        </main>
      </div>
    );

  const docsFromMaster = mode === "new-master" || mode === "linked";
  const masterGst = savedVendor?.vendorMaster?.gstNumber;
  // GST certificate is required when a GSTIN is recorded. For documents held
  // in the master that is the MASTER's primary GSTIN (what the server
  // checks on submit); for a branch-level record, the record's own.
  const gstForDocs = docsFromMaster
    ? savedVendor?.vendorMaster
      ? masterGst // exactly what the server checks
      : form.gstNumber // new vendor, before its first save
    : form.gstNumber;
  const requiredDocs = [
    ...(VENDOR_TYPES[form.vendorType] || VENDOR_TYPES.standard).requiredDocs,
    ...(String(gstForDocs || "").trim() ? ["gst"] : []),
  ];
  const uploadedTypes = (savedVendor?.documents || []).map((d) => d.type);
  const missingDocs = requiredDocs.filter((t) => !uploadedTypes.includes(t));
  const allUploaded = missingDocs.length === 0;

  const input = (field, props = {}) => (
    <input
      style={{
        ...S.input,
        ...(errors[field] ? S.inputError : {}),
        ...(props.mono ? { fontFamily: "monospace" } : {}),
        ...(props.upper ? { textTransform: "uppercase" } : {}),
        ...(fieldDisabled(field) ? S.inputDisabled : {}),
      }}
      type={props.type || "text"}
      value={form[field] || ""}
      onChange={props.upper ? setUpper(field) : set(field)}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      disabled={fieldDisabled(field)}
    />
  );

  const title = isEdit ? "Edit Vendor" : "Add New Vendor";

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <button style={S.backBtn} onClick={() => navigate("/vendors")}>
            ← Back
          </button>
          <h1 style={S.title}>{title}</h1>
        </div>

        <div style={S.formCard}>
          {mode === "gate" ? (
            <div style={S.formBody}>
              <PanLookupGate
                branches={branches}
                branch={form.branch}
                onBranchChange={(v) => setField("branch", v)}
                branchLocked={singleBranchUser}
                onNewPan={startNewMaster}
                onNoPan={startNoPan}
                onOpenVendor={(vid) => navigate(`/vendors/${vid}`)}
                onLinked={(data) => {
                  const flash = data.autoApproved
                    ? "Vendor added to the branch and ready for payment requests."
                    : "Vendor added to the branch. It becomes usable once the accounts team approves it.";
                  // Accounts may add for any branch (masters are group-wide)
                  // but the branch vendor page is still branch-scoped for
                  // them — show the master, which lists every branch.
                  if (isAdmin && data.vendor?.vendorMaster) {
                    navigate(`/vendor-masters/${idOf(data.vendor.vendorMaster)}`, { state: { flash } });
                  } else {
                    navigate(`/vendors/${idOf(data.vendor)}`, { state: { flash } });
                  }
                }}
              />
            </div>
          ) : (
            <>
              {/* Section Tabs */}
              <div style={S.tabs}>
                {SECTIONS.map((sec, i) => (
                  <button
                    key={sec}
                    style={{ ...S.tab, ...(activeSection === i ? S.tabActive : {}) }}
                    onClick={() => {
                      if (i === 3 && !savedVendorId) {
                        setErrors({
                          submit: "Please save vendor details first before uploading documents.",
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
                    {i === 3 && savedVendor?.documents?.length > 0 && (
                      <span style={S.docCountBadge}>{savedVendor.documents.length}</span>
                    )}
                  </button>
                ))}
              </div>

              {success && <div style={S.successBox}>{success}</div>}
              {errors.submit && (
                <div style={S.errorBox}>
                  {errors.submit}
                  {errors.backToGate && (
                    <button style={S.inlineLink} onClick={backToGate}>
                      ← Back to Step 1
                    </button>
                  )}
                </div>
              )}

              <div style={S.formBody}>
                {/* ── Mode banners ─────────────────────── */}
                {mode === "linked" && (
                  <div style={S.masterBanner}>
                    <div>
                      <strong>🗂 Linked to the Vendor Master</strong>
                      <div style={{ marginTop: 3 }}>
                        Name, PAN, bank details and documents are shared by
                        every branch and managed by the accounts team. You can
                        change this branch's category and GSTIN.
                      </div>
                    </div>
                    {masterId && (
                      <button
                        style={S.bannerBtn}
                        onClick={() => navigate(`/vendor-masters/${masterId}`)}
                      >
                        {isAdmin ? "Edit in Vendor Master →" : "View master →"}
                      </button>
                    )}
                  </div>
                )}
                {mode === "new-master" && (
                  <div style={S.infoBox}>
                    New vendor for the whole group · PAN{" "}
                    <strong style={{ fontFamily: "monospace" }}>{form.panNumber}</strong>.
                    Documents are uploaded once and shared by every branch.
                    {!masterId && (
                      <button style={S.inlineLink} onClick={backToGate}>
                        Change PAN
                      </button>
                    )}
                  </div>
                )}
                {mode === "no-pan" && (
                  <div style={S.infoBox}>
                    Payee without a PAN (utility / tax / statutory). It stays a
                    branch-level record; bank details and documents are
                    optional.
                    {!savedVendorId && (
                      <button style={S.inlineLink} onClick={backToGate}>
                        It has a PAN
                      </button>
                    )}
                  </div>
                )}
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
                          disabled={fieldDisabled("branch")}
                        />
                      </Field>
                      <Field label="Vendor Name *" error={errors.vendorName}>
                        {input("vendorName", { placeholder: "Full vendor name" })}
                      </Field>
                      <Field label="Contact Person">
                        {input("contactPerson", { placeholder: "Contact person" })}
                      </Field>
                      <Field label="Mobile *" error={errors.mobile}>
                        {input("mobile", { placeholder: "10-digit mobile", maxLength: 10 })}
                      </Field>
                      <Field label="Email">
                        {input("email", { placeholder: "vendor@email.com", type: "email" })}
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
                            ...(fieldDisabled("vendorType") ? S.inputDisabled : {}),
                          }}
                          value={form.vendorType}
                          disabled={fieldDisabled("vendorType")}
                          onChange={(e) => setField("vendorType", e.target.value)}
                        >
                          {VENDOR_TYPE_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <span style={S.hint}>
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
                          disabled={fieldDisabled("vendorCategory")}
                        />
                      </Field>
                      <Field label="MSME Number (Optional)">
                        {input("msmeNumber", { placeholder: "UDYAM-XX-00-0000000" })}
                      </Field>
                      <Field label="Company Name">
                        {input("companyName", { placeholder: "Registered company name" })}
                      </Field>
                      {mode !== "no-pan" && (
                        <Field
                          label={`PAN Number${mode === "linked" ? "" : " *"}`}
                          error={errors.panNumber}
                        >
                          {input("panNumber", {
                            upper: true,
                            mono: true,
                            maxLength: 10,
                            placeholder: "ABCDE1234F",
                          })}
                        </Field>
                      )}
                      <Field
                        label={mode === "new-master" ? "GSTIN (this branch; also the primary GSTIN)" : "GSTIN for this branch"}
                        error={errors.gstNumber}
                      >
                        {input("gstNumber", {
                          upper: true,
                          mono: true,
                          maxLength: 15,
                          placeholder: "27AAAAA0000A1Z5",
                        })}
                        <span style={S.hint}>
                          {form.gstNumber?.length >= 2 && gstState(form.gstNumber)
                            ? `${gstState(form.gstNumber)} registration. `
                            : ""}
                          GST is registered per state — use the GSTIN this
                          branch is invoiced under.
                        </span>
                      </Field>
                      <Field label="Business Address" fullWidth>
                        <textarea
                          style={{
                            ...S.input,
                            ...S.textarea,
                            ...(fieldDisabled("businessAddress") ? S.inputDisabled : {}),
                          }}
                          value={form.businessAddress || ""}
                          disabled={fieldDisabled("businessAddress")}
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
                      🔒 Bank details are used for payment processing. Ensure accuracy.
                    </div>

                    {mode !== "linked" && !editLocked && (
                      <div style={S.scanBox}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "#0369a1" }}>
                            🤖 Auto-fill from Cancelled Cheque
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                            Upload a clear photo of the cancelled cheque to auto-fill bank details
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
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
                              ...S.scanBtn,
                              background: chequeScanning ? "#64748b" : "#0369a1",
                              cursor: chequeScanning ? "not-allowed" : "pointer",
                            }}
                            disabled={chequeScanning}
                            onClick={() => chequeInputRef.current?.click()}
                          >
                            {chequeScanning ? "🔍 Reading cheque..." : "📷 Scan Cheque"}
                          </button>
                          {chequeError && (
                            <span style={{ fontSize: 12, color: "#dc2626" }}>⚠️ {chequeError}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {(() => {
                      const req =
                        (VENDOR_TYPES[form.vendorType] || VENDOR_TYPES.standard).requireBank &&
                        mode !== "linked";
                      const star = req ? " *" : "";
                      return (
                        <div style={S.grid2}>
                          <Field label={`Account Holder Name${star}`} error={errors.accountHolderName}>
                            {input("accountHolderName", { placeholder: "As per bank records" })}
                          </Field>
                          <Field label={`Bank Name${star}`} error={errors.bankName}>
                            {input("bankName", { placeholder: "Bank name" })}
                          </Field>
                          <Field label={`Account Number${star}`} error={errors.accountNumber}>
                            {input("accountNumber", { mono: true, placeholder: "Account number" })}
                          </Field>
                          <Field label={`IFSC Code${star}`} error={errors.ifscCode}>
                            {input("ifscCode", {
                              upper: true,
                              mono: true,
                              maxLength: 11,
                              placeholder: "SBIN0001234",
                            })}
                          </Field>
                          <Field label="UPI ID (Optional)">
                            {input("upiId", { placeholder: "vendor@upi" })}
                          </Field>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Section 3: Documents */}
                {activeSection === 3 && (
                  <div>
                    <h2 style={S.sectionTitle}>📄 Documents</h2>
                    {!savedVendorId ? (
                      <div style={S.warnBox}>
                        ⚠️ Please save vendor details first (click "Save & Continue" below)
                        before uploading documents.
                      </div>
                    ) : docsFromMaster ? (
                      <FileUpload
                        entityType="vendormaster"
                        entityId={masterId}
                        existingDocs={savedVendor?.documents || []}
                        onUploadSuccess={() => refreshVendor()}
                        requiredTypes={requiredDocs}
                        canUpload={mode === "new-master" && !editLocked}
                        readOnlyMessage="These documents are held once in the Vendor Master and shared by every branch. Only the accounts team can change them."
                      />
                    ) : (
                      <FileUpload
                        entityType="vendor"
                        entityId={savedVendorId}
                        existingDocs={savedVendor?.documents || []}
                        onUploadSuccess={() => refreshVendor()}
                        requiredTypes={requiredDocs}
                        canUpload={!editLocked}
                        readOnlyMessage="Approved vendors' documents can only be changed by the accounts team."
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
                    <button style={S.prevBtn} onClick={() => setActiveSection((s) => s - 1)}>
                      ← Previous
                    </button>
                  )}
                  {activeSection < 2 && (
                    <button style={S.nextBtn} onClick={() => setActiveSection((s) => s + 1)}>
                      Next →
                    </button>
                  )}
                  {activeSection === 2 && (
                    <button
                      style={{ ...S.submitBtn, opacity: loading || editLocked ? 0.6 : 1 }}
                      onClick={handleSaveDetails}
                      disabled={loading || editLocked}
                    >
                      {loading
                        ? "Saving..."
                        : mode === "linked"
                          ? "💾 Save"
                          : savedVendorId
                            ? "💾 Save & Go to Documents"
                            : "💾 Save & Upload Documents"}
                    </button>
                  )}
                  {activeSection === 3 && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      {waitsOnMaster && (
                        <span style={{ fontSize: 12, color: "#6d28d9", fontWeight: 500 }}>
                          Submitted together with the vendor master by the
                          person who registered it, or by accounts.
                        </span>
                      )}
                      {!allUploaded && needsSubmit && (
                        <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 500 }}>
                          Missing required docs:{" "}
                          {missingDocs.map((t) => DOC_LABEL[t] || t).join(", ")}
                        </span>
                      )}
                      <button
                        style={{
                          ...S.submitBtn,
                          opacity: (allUploaded || !needsSubmit) && !submitting ? 1 : 0.45,
                          cursor: (allUploaded || !needsSubmit) && !submitting ? "pointer" : "not-allowed",
                        }}
                        disabled={(needsSubmit && !allUploaded) || submitting}
                        onClick={handleFinish}
                      >
                        {submitting ? "⏳ Submitting..." : needsSubmit ? "✓ Submit for Approval" : "✓ Done"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
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
    <label style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>{label}</label>
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
  tabs: { display: "flex", borderBottom: `1px solid ${C.border}`, overflowX: "auto" },
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
  tabActive: { color: C.accent, borderBottom: `2px solid ${C.accent}`, fontWeight: 700 },
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
    background: "#fff",
  },
  inputError: { borderColor: "#dc2626", background: "#fef2f2" },
  inputDisabled: { background: "#f1f5f9", color: "#64748b", cursor: "not-allowed" },
  textarea: { minHeight: 80, resize: "vertical", fontFamily: "inherit" },
  hint: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  infoBox: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#1d4ed8",
    marginBottom: 18,
  },
  masterBanner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    background: "#f5f3ff",
    border: "1px solid #ddd6fe",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 13,
    color: "#4c1d95",
    marginBottom: 18,
  },
  bannerBtn: {
    padding: "8px 14px",
    background: "#fff",
    color: "#5b21b6",
    border: "1px solid #ddd6fe",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  inlineLink: {
    background: "none",
    border: "none",
    color: C.accent,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    marginLeft: 8,
    padding: 0,
  },
  warnBox: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 10,
    padding: "16px 18px",
    fontSize: 14,
    color: "#92400e",
    textAlign: "center",
    marginBottom: 18,
  },
  scanBox: {
    background: "#f0f9ff",
    border: "1px solid #bae6fd",
    borderRadius: 10,
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  scanBtn: {
    padding: "9px 18px",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 6,
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
