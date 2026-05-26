import { useState, useEffect } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import DuplicateInvoiceChecker from "../components/DuplicateInvoiceChecker.jsx";
import FileUpload from "../components/FileUpload.jsx";

const PRIORITY_OPTIONS = ["Normal", "Urgent", "Critical"];
const EXPENSE_TYPES = ["Revenue", "Capital"];
const PRIORITY_INFO = {
  Normal: {
    color: "#2563eb",
    bg: "#eff6ff",
    desc: "Standard processing timeline",
  },
  Urgent: {
    color: "#d97706",
    bg: "#fffbeb",
    desc: "Needs processing within 24–48 hrs",
  },
  Critical: {
    color: "#dc2626",
    bg: "#fef2f2",
    desc: "Requires immediate attention",
  },
};
const STEPS = [
  "Basic Info",
  "Financial Details",
  "Invoice & Attachments",
  "Review & Submit",
];

const INIT = {
  branch: "",
  vendor: "",
  expenseType: "Revenue",
  expenseCategory: "",
  amount: "",
  gstPercentage: "0", // ✅ branch enters GST % not amount
  gstAmount: "0", // computed from amount × gstPercentage
  tdsAmount: "0", // set by accounts during approval — sent as 0 initially
  netPayable: "",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  description: "",
  priority: "Normal",
  remarks: "",
};

export default function CreatePaymentRequest() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState(INIT);
  const [step, setStep] = useState(0);
  const [branches, setBranches] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState("");
  const [dupResult, setDupResult] = useState(null);

  // ✅ Two-phase: save draft first to get ID, then allow uploads
  const [savedInvoiceId, setSavedInvoiceId] = useState(null);
  const [savedAttachments, setSavedAttachments] = useState([]);

  useEffect(() => {
    api
      .get("/branches")
      .then((r) =>
        setBranches(Array.isArray(r.data) ? r.data : r.data.branches || []),
      )
      .catch(console.error);
    if (user?.role === "branch_user" && user.branches?.length === 1) {
      setForm((f) => ({
        ...f,
        branch: user.branches[0]._id || user.branches[0],
      }));
    }
  }, [user]);

  useEffect(() => {
    if (!form.branch) return;
    api
      .get(
        `/vendors?branch=${form.branch}&status=active&approvalStatus=approved&limit=100`,
      )
      .then((r) =>
        setVendors(Array.isArray(r.data) ? r.data : r.data.vendors || []),
      )
      .catch(console.error);
  }, [form.branch]);

  useEffect(() => {
    if (!form.expenseType) return;
    api
      .get(`/expense-categories?type=${form.expenseType}`)
      .then((r) =>
        setCategories(Array.isArray(r.data) ? r.data : r.data.categories || []),
      )
      .catch(console.error);
  }, [form.expenseType]);

  // Recompute gstAmount from gstPercentage and recalculate netPayable
  useEffect(() => {
    const amount = parseFloat(form.amount) || 0;
    const gstPct = parseFloat(form.gstPercentage) || 0;
    const gstAmount = parseFloat(((amount * gstPct) / 100).toFixed(2));
    const tds = parseFloat(form.tdsAmount) || 0;
    setForm((f) => ({
      ...f,
      gstAmount: gstAmount.toString(),
      netPayable: (amount + gstAmount - tds).toFixed(2),
    }));
  }, [form.amount, form.gstPercentage]);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors((er) => ({ ...er, [field]: "" }));
  };

  const validateStep = (s) => {
    const e = {};
    if (s === 0) {
      if (!form.branch) e.branch = "Branch is required";
      if (!form.vendor) e.vendor = "Vendor is required";
      if (!form.expenseType) e.expenseType = "Expense type is required";
      if (!form.expenseCategory)
        e.expenseCategory = "Expense category is required";
    }
    if (s === 1) {
      if (!form.amount || parseFloat(form.amount) <= 0)
        e.amount = "Valid amount is required";
    }
    if (s === 2) {
      if (!form.invoiceNumber?.trim())
        e.invoiceNumber = "Invoice number is required";
      if (!form.invoiceDate) e.invoiceDate = "Invoice date is required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ✅ Step 2 — save as draft first to get invoice ID, then show uploads
  const handleSaveAsDraftForUploads = async () => {
    if (!validateStep(2)) return;
    if (dupResult?.isDuplicate) {
      setErrors({ invoiceNumber: "Duplicate invoice number detected" });
      return;
    }
    setLoading(true);
    try {
      if (savedInvoiceId) {
        // Update existing draft
        await api.put(`/invoices/${savedInvoiceId}`, form);
      } else {
        // Create new draft
        const { data } = await api.post("/invoices", form);
        const invoiceId = data.invoice?._id || data._id;
        setSavedInvoiceId(invoiceId);
      }
      setSuccess("Invoice details saved! Upload your documents below.");
      setStep(3); // move to review+upload step
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Save failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (!validateStep(step)) return;
    if (step === 2) {
      handleSaveAsDraftForUploads();
    } else {
      setStep((s) => s + 1);
    }
  };

  const refreshAttachments = async () => {
    if (!savedInvoiceId) return;
    const { data } = await api.get(`/invoices/${savedInvoiceId}`);
    setSavedAttachments(data.attachments || []);
  };

  // ✅ Final submit
  const REQUIRED_DOC_TYPES = ["invoice", "quotation"];

  const handleSubmit = async () => {
    if (dupResult?.isDuplicate) {
      setErrors({ submit: "Cannot submit: duplicate invoice detected" });
      return;
    }
    const missingDocs = REQUIRED_DOC_TYPES.filter(
      (t) => !savedAttachments.some((a) => a.type === t),
    );
    if (missingDocs.length > 0) {
      setErrors({
        submit: `Please upload required documents before submitting: ${missingDocs
          .map((t) => (t === "invoice" ? "Invoice" : "Quotation"))
          .join(", ")}`,
      });
      return;
    }
    setSubmitting(true);
    try {
      // Update form data on existing draft
      if (savedInvoiceId) {
        await api.put(`/invoices/${savedInvoiceId}`, form);
        await api.patch(`/invoices/${savedInvoiceId}/submit`);
      }
      setSuccess("Invoice submitted successfully!");
      setTimeout(() => navigate("/invoices"), 1800);
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Submit failed" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    setLoading(true);
    try {
      if (savedInvoiceId) {
        await api.put(`/invoices/${savedInvoiceId}`, form);
      } else {
        const { data } = await api.post("/invoices", form);
        setSavedInvoiceId(data.invoice?._id || data._id);
      }
      setSuccess("Saved as draft!");
      setTimeout(() => navigate("/invoices"), 1500);
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Save failed" });
    } finally {
      setLoading(false);
    }
  };

  const selectedVendor = vendors.find((v) => v._id === form.vendor);
  const selectedBranch = branches.find((b) => b._id === form.branch);
  const selectedCategory = categories.find(
    (c) => c._id === form.expenseCategory,
  );

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        <div style={S.topBar}>
          <button style={S.backBtn} onClick={() => navigate("/invoices")}>
            ← Back
          </button>
          <h1 style={S.title}>New Invoice Request</h1>
        </div>

        {/* Step indicator */}
        <div style={S.stepBar}>
          {STEPS.map((label, i) => (
            <div key={label} style={S.stepWrap}>
              <div
                style={{
                  ...S.stepCircle,
                  ...(i < step
                    ? S.stepDone
                    : i === step
                      ? S.stepActive
                      : S.stepPending),
                }}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <div
                style={{
                  ...S.stepLabel,
                  color:
                    i === step ? "#2563eb" : i < step ? "#16a34a" : "#94a3b8",
                }}
              >
                {label}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  style={{
                    ...S.stepLine,
                    background: i < step ? "#16a34a" : "#e2e8f0",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div style={S.formCard}>
          {success && <div style={S.successBox}>{success}</div>}
          {errors.submit && <div style={S.errorBox}>{errors.submit}</div>}

          {/* Step 0 — Basic Info */}
          {step === 0 && (
            <div>
              <h2 style={S.sectionTitle}>📋 Basic Information</h2>
              <div style={S.grid2}>
                <Field label="Branch *" error={errors.branch}>
                  <select
                    style={{
                      ...S.input,
                      ...(errors.branch ? S.inputError : {}),
                    }}
                    value={form.branch}
                    onChange={set("branch")}
                    disabled={
                      user?.role === "branch_user" &&
                      user.branches?.length === 1
                    }
                  >
                    <option value="">Select Branch</option>
                    {branches.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Vendor *" error={errors.vendor}>
                  <select
                    style={{
                      ...S.input,
                      ...(errors.vendor ? S.inputError : {}),
                    }}
                    value={form.vendor}
                    onChange={set("vendor")}
                    disabled={!form.branch}
                  >
                    <option value="">
                      {form.branch ? "Select Vendor" : "Select branch first"}
                    </option>
                    {vendors.map((v) => (
                      <option key={v._id} value={v._id}>
                        {v.vendorName}
                        {v.companyName ? ` — ${v.companyName}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                {selectedVendor && (
                  <div style={{ ...S.vendorPreview, gridColumn: "1 / -1" }}>
                    <div style={S.vendorPreviewTitle}>Selected Vendor</div>
                    <div style={S.vendorPreviewGrid}>
                      <div>
                        <span style={S.previewLabel}>Category</span>
                        <span style={S.previewVal}>
                          {selectedVendor.vendorCategory}
                        </span>
                      </div>
                      <div>
                        <span style={S.previewLabel}>Bank</span>
                        <span style={S.previewVal}>
                          {selectedVendor.bankName}
                        </span>
                      </div>
                      <div>
                        <span style={S.previewLabel}>Account</span>
                        <span style={S.previewVal}>
                          ****{selectedVendor.accountNumber?.slice(-4)}
                        </span>
                      </div>
                      <div>
                        <span style={S.previewLabel}>IFSC</span>
                        <span style={S.previewVal}>
                          {selectedVendor.ifscCode}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                <Field label="Expense Type *" error={errors.expenseType}>
                  <div style={S.radioGroup}>
                    {EXPENSE_TYPES.map((t) => (
                      <label
                        key={t}
                        style={{
                          ...S.radioOption,
                          ...(form.expenseType === t ? S.radioSelected : {}),
                        }}
                      >
                        <input
                          type="radio"
                          name="expenseType"
                          value={t}
                          checked={form.expenseType === t}
                          onChange={set("expenseType")}
                          style={{ display: "none" }}
                        />
                        {t === "Revenue" ? "📊" : "🏗️"} {t}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field
                  label="Expense Category *"
                  error={errors.expenseCategory}
                >
                  <select
                    style={{
                      ...S.input,
                      ...(errors.expenseCategory ? S.inputError : {}),
                    }}
                    value={form.expenseCategory}
                    onChange={set("expenseCategory")}
                  >
                    <option value="">Select Category</option>
                    {categories.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority *" error={errors.priority} fullWidth>
                  <div style={S.radioGroup}>
                    {PRIORITY_OPTIONS.map((p) => {
                      const pi = PRIORITY_INFO[p];
                      return (
                        <label
                          key={p}
                          style={{
                            ...S.priorityOption,
                            ...(form.priority === p
                              ? {
                                  ...S.prioritySelected,
                                  background: pi.bg,
                                  borderColor: pi.color,
                                  color: pi.color,
                                }
                              : {}),
                          }}
                        >
                          <input
                            type="radio"
                            name="priority"
                            value={p}
                            checked={form.priority === p}
                            onChange={set("priority")}
                            style={{ display: "none" }}
                          />
                          <div style={{ fontWeight: 700, fontSize: 14 }}>
                            {p}
                          </div>
                          <div
                            style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}
                          >
                            {pi.desc}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </Field>
              </div>
            </div>
          )}

          {/* Step 1 — Financial */}
          {step === 1 && (
            <div>
              <h2 style={S.sectionTitle}>💰 Financial Details</h2>
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 13,
                  color: "#1d4ed8",
                  marginBottom: 18,
                }}
              >
                ℹ️ Enter the base amount and GST percentage. TDS will be applied
                by the accounts team during invoice approval.
              </div>
              <div style={S.grid2}>
                <Field label="Base Amount (₹) *" error={errors.amount}>
                  <div style={S.inputPrefix}>
                    <span style={S.prefix}>₹</span>
                    <input
                      style={{
                        ...S.input,
                        ...S.inputWithPrefix,
                        ...(errors.amount ? S.inputError : {}),
                      }}
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      onChange={set("amount")}
                      placeholder="0.00"
                    />
                  </div>
                </Field>
                <Field label="GST Percentage (%)">
                  <div style={S.inputPrefix}>
                    <span style={S.prefix}>%</span>
                    <input
                      style={{ ...S.input, ...S.inputWithPrefix }}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={form.gstPercentage}
                      onChange={set("gstPercentage")}
                      placeholder="0"
                    />
                  </div>
                  {parseFloat(form.gstPercentage) > 0 && form.amount && (
                    <span
                      style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}
                    >
                      GST Amount: ₹
                      {parseFloat(form.gstAmount || 0).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  )}
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={S.netPayableBox}>
                    <div>
                      <div style={S.netLabel}>Estimated Net Payable</div>
                      <div style={S.netFormula}>
                        Base (₹
                        {parseFloat(form.amount || 0).toLocaleString("en-IN")})
                        + GST {form.gstPercentage || 0}% (₹
                        {parseFloat(form.gstAmount || 0).toLocaleString(
                          "en-IN",
                        )}
                        ) − TDS (set by accounts)
                      </div>
                    </div>
                    <div style={S.netValue}>
                      ₹
                      {parseFloat(form.netPayable || 0).toLocaleString(
                        "en-IN",
                        { minimumFractionDigits: 2 },
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Invoice Details */}
          {step === 2 && (
            <div>
              <h2 style={S.sectionTitle}>🧾 Invoice Details</h2>
              <div style={S.grid2}>
                <Field label="Invoice Number *" error={errors.invoiceNumber}>
                  <input
                    style={{
                      ...S.input,
                      ...(errors.invoiceNumber ? S.inputError : {}),
                    }}
                    value={form.invoiceNumber}
                    onChange={set("invoiceNumber")}
                    placeholder="INV-2025-001"
                  />
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  <DuplicateInvoiceChecker
                    branchId={form.branch}
                    vendorId={form.vendor}
                    invoiceNumber={form.invoiceNumber}
                    amount={form.netPayable}
                    excludeId={savedInvoiceId}
                    onChange={setDupResult}
                  />
                </div>
                <Field label="Invoice Date *" error={errors.invoiceDate}>
                  <input
                    style={{
                      ...S.input,
                      ...(errors.invoiceDate ? S.inputError : {}),
                    }}
                    type="date"
                    value={form.invoiceDate}
                    onChange={set("invoiceDate")}
                  />
                </Field>
                <Field label="Due Date">
                  <input
                    style={S.input}
                    type="date"
                    value={form.dueDate}
                    onChange={set("dueDate")}
                  />
                </Field>
                <Field label="Description" fullWidth>
                  <textarea
                    style={{ ...S.input, ...S.textarea }}
                    value={form.description}
                    onChange={set("description")}
                    placeholder="Brief description..."
                  />
                </Field>
                <Field label="Remarks" fullWidth>
                  <textarea
                    style={{ ...S.input, ...S.textarea }}
                    value={form.remarks}
                    onChange={set("remarks")}
                    placeholder="Additional remarks..."
                  />
                </Field>
              </div>
              <div style={S.uploadNotice}>
                ℹ️ Click <strong>"Save & Upload Documents"</strong> to save this
                invoice as a draft and upload required attachments on the next
                step.
              </div>
            </div>
          )}

          {/* Step 3 — Upload & Review */}
          {step === 3 && (
            <div>
              <h2 style={S.sectionTitle}>📎 Upload Documents & Review</h2>

              {/* File Upload — now has a real invoice ID */}
              {savedInvoiceId && (
                <div style={{ marginBottom: 24 }}>
                  <FileUpload
                    entityType="payment"
                    entityId={savedInvoiceId}
                    existingDocs={savedAttachments}
                    onUploadSuccess={refreshAttachments}
                  />
                </div>
              )}

              {/* Review summary */}
              <div style={S.reviewGrid}>
                <ReviewSection title="Request Details">
                  <ReviewRow label="Branch" value={selectedBranch?.name} />
                  <ReviewRow
                    label="Vendor"
                    value={selectedVendor?.vendorName}
                  />
                  <ReviewRow label="Category" value={selectedCategory?.name} />
                  <ReviewRow label="Priority">
                    <span
                      style={{
                        color: PRIORITY_INFO[form.priority]?.color,
                        fontWeight: 700,
                      }}
                    >
                      {form.priority}
                    </span>
                  </ReviewRow>
                </ReviewSection>
                <ReviewSection title="Financial Summary">
                  <ReviewRow
                    label="Base Amount"
                    value={`₹${parseFloat(form.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                  />
                  <ReviewRow
                    label={`GST (${form.gstPercentage || 0}%)`}
                    value={`₹${parseFloat(form.gstAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                  />
                  <ReviewRow label="TDS" value="Set by accounts" />
                  <div
                    style={{ borderTop: "2px solid #e2e8f0", margin: "8px 0" }}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 0",
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>Net Payable</span>
                    <span
                      style={{
                        color: "#1a3c6e",
                        fontSize: 18,
                        fontWeight: 700,
                      }}
                    >
                      ₹
                      {parseFloat(form.netPayable || 0).toLocaleString(
                        "en-IN",
                        { minimumFractionDigits: 2 },
                      )}
                    </span>
                  </div>
                </ReviewSection>
                <ReviewSection title="Invoice Details">
                  <ReviewRow label="Invoice No." value={form.invoiceNumber} />
                  <ReviewRow label="Invoice Date" value={form.invoiceDate} />
                  <ReviewRow label="Due Date" value={form.dueDate || "—"} />
                </ReviewSection>
                <ReviewSection title="Payment Destination">
                  <ReviewRow
                    label="Account Holder"
                    value={selectedVendor?.accountHolderName}
                  />
                  <ReviewRow label="Bank" value={selectedVendor?.bankName} />
                  <ReviewRow
                    label="Account No."
                    value={`****${selectedVendor?.accountNumber?.slice(-4)}`}
                  />
                  <ReviewRow label="IFSC" value={selectedVendor?.ifscCode} />
                </ReviewSection>
              </div>

              {/* Attachment checklist */}
              <div style={S.attachChecklist}>
                <div style={S.checklistTitle}>📋 Required Documents Status</div>
                {[
                  { type: "invoice", label: "🧾 Invoice", required: true },
                  { type: "quotation", label: "📋 Quotation", required: true },
                  { type: "po", label: "📦 PO", required: false },
                  { type: "challan", label: "🚚 Challan", required: false },
                ].map((doc) => {
                  const uploaded = savedAttachments.some(
                    (a) => a.type === doc.type,
                  );
                  return (
                    <div
                      key={doc.type}
                      style={{
                        ...S.checklistItem,
                        background: uploaded
                          ? "#f0fdf4"
                          : doc.required
                            ? "#fef2f2"
                            : "#f8fafc",
                        borderColor: uploaded
                          ? "#bbf7d0"
                          : doc.required
                            ? "#fecaca"
                            : "#e2e8f0",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          color: uploaded
                            ? "#16a34a"
                            : doc.required
                              ? "#dc2626"
                              : "#94a3b8",
                        }}
                      >
                        {uploaded ? "✓" : doc.required ? "✗" : "—"}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          flex: 1,
                          color: uploaded
                            ? "#16a34a"
                            : doc.required
                              ? "#dc2626"
                              : "#94a3b8",
                        }}
                      >
                        {doc.label}
                      </span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        {uploaded
                          ? "Uploaded"
                          : doc.required
                            ? "Required"
                            : "Optional"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {dupResult?.isDuplicate && (
                <div style={{ ...S.errorBox, margin: "12px 0 0" }}>
                  🚨 Duplicate invoice detected. Please go back and change the
                  invoice number.
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div style={S.footer}>
            <button style={S.cancelBtn} onClick={() => navigate("/invoices")}>
              Cancel
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              {step > 0 && (
                <button style={S.prevBtn} onClick={() => setStep((s) => s - 1)}>
                  ← Previous
                </button>
              )}
              {step < 2 && (
                <button style={S.nextBtn} onClick={handleNext}>
                  Next →
                </button>
              )}
              {step === 2 && (
                <button
                  style={{ ...S.nextBtn, opacity: loading ? 0.7 : 1 }}
                  onClick={handleNext}
                  disabled={loading}
                >
                  {loading ? "Saving..." : "💾 Save & Upload Documents"}
                </button>
              )}
              {step === 3 && (
                <>
                  <button
                    style={{ ...S.draftBtn, opacity: loading ? 0.7 : 1 }}
                    onClick={handleSaveDraft}
                    disabled={loading}
                  >
                    {loading ? "Saving..." : "💾 Save as Draft"}
                  </button>
                  {(() => {
                    const missingDocs = ["invoice", "quotation"].filter(
                      (t) => !savedAttachments.some((a) => a.type === t),
                    );
                    const blocked =
                      submitting ||
                      dupResult?.isDuplicate ||
                      missingDocs.length > 0;
                    return (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 6,
                        }}
                      >
                        {missingDocs.length > 0 && (
                          <span
                            style={{
                              fontSize: 12,
                              color: "#dc2626",
                              fontWeight: 500,
                            }}
                          >
                            Upload required:{" "}
                            {missingDocs
                              .map((t) =>
                                t === "invoice" ? "Invoice" : "Quotation",
                              )
                              .join(", ")}
                          </span>
                        )}
                        <button
                          style={{
                            ...S.submitBtn,
                            opacity: blocked ? 0.5 : 1,
                            cursor: blocked ? "not-allowed" : "pointer",
                          }}
                          onClick={handleSubmit}
                          disabled={blocked}
                        >
                          {submitting ? "Submitting..." : "🚀 Submit Invoice"}
                        </button>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const ReviewSection = ({ title, children }) => (
  <div
    style={{
      background: "#f8fafc",
      borderRadius: 10,
      padding: 18,
      border: "1px solid #e2e8f0",
    }}
  >
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: "#475569",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 12,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);
const ReviewRow = ({ label, value, children }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "7px 0",
      borderBottom: "1px solid #f1f5f9",
    }}
  >
    <span style={{ fontSize: 13, color: "#64748b" }}>{label}</span>
    <span
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: "#334155",
        textAlign: "right",
        maxWidth: "55%",
      }}
    >
      {children || value || "—"}
    </span>
  </div>
);
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

const C = {
  primary: "#1a3c6e",
  accent: "#2563eb",
  border: "#e2e8f0",
  success: "#16a34a",
};
const S = {
  layout: { display: "flex", minHeight: "100vh", background: "#f8fafc" },
  main: { flex: 1, padding: "24px 28px", overflowY: "auto" },
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
  stepBar: {
    display: "flex",
    alignItems: "flex-start",
    marginBottom: 24,
    overflowX: "auto",
  },
  stepWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    position: "relative",
    flex: 1,
    minWidth: 80,
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
    marginBottom: 6,
    zIndex: 1,
  },
  stepActive: {
    background: C.accent,
    color: "#fff",
    boxShadow: "0 0 0 4px #dbeafe",
  },
  stepDone: { background: C.success, color: "#fff" },
  stepPending: { background: "#e2e8f0", color: "#94a3b8" },
  stepLabel: {
    fontSize: 12,
    fontWeight: 600,
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  stepLine: {
    position: "absolute",
    top: 16,
    left: "60%",
    width: "80%",
    height: 2,
    zIndex: 0,
  },
  formCard: {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
    padding: 28,
  },
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
  inputPrefix: { position: "relative", display: "flex", alignItems: "center" },
  prefix: {
    position: "absolute",
    left: 12,
    color: "#64748b",
    fontSize: 15,
    fontWeight: 600,
    pointerEvents: "none",
  },
  inputWithPrefix: { paddingLeft: 28 },
  radioGroup: { display: "flex", gap: 10, flexWrap: "wrap" },
  radioOption: {
    flex: 1,
    minWidth: 100,
    padding: "10px 14px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    textAlign: "center",
    color: "#475569",
  },
  radioSelected: {
    borderColor: C.accent,
    background: "#eff6ff",
    color: C.accent,
    fontWeight: 700,
  },
  priorityOption: {
    flex: 1,
    minWidth: 140,
    padding: "12px 16px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 10,
    cursor: "pointer",
    color: "#475569",
  },
  prioritySelected: { fontWeight: 700 },
  vendorPreview: {
    background: "#f0f9ff",
    border: "1px solid #bae6fd",
    borderRadius: 10,
    padding: 14,
  },
  vendorPreviewTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#0369a1",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  vendorPreviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 10,
  },
  previewLabel: {
    display: "block",
    fontSize: 11,
    color: "#64748b",
    marginBottom: 2,
  },
  previewVal: {
    fontSize: 13,
    fontWeight: 600,
    color: "#1a3c6e",
    fontFamily: "monospace",
  },
  netPayableBox: {
    background: "linear-gradient(135deg, #1a3c6e, #2563eb)",
    borderRadius: 12,
    padding: "18px 22px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  netLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: "#a8c4e0",
    marginBottom: 4,
  },
  netFormula: { fontSize: 12, color: "#7ba8d4" },
  netValue: { fontSize: 28, fontWeight: 700, color: "#fff" },
  uploadNotice: {
    marginTop: 16,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#1d4ed8",
  },
  reviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
    marginBottom: 16,
  },
  attachChecklist: {
    background: "#f8fafc",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: 16,
    marginTop: 16,
  },
  checklistTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#475569",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  checklistItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid",
    marginBottom: 6,
  },
  footer: {
    padding: "20px 0 0",
    borderTop: `1px solid ${C.border}`,
    marginTop: 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
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
    padding: "10px 22px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  draftBtn: {
    padding: "10px 18px",
    background: "#f1f5f9",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    color: "#475569",
  },
  submitBtn: {
    padding: "10px 24px",
    background: C.success,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  successBox: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    padding: "12px 16px",
    color: C.success,
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 20,
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "12px 16px",
    color: "#dc2626",
    fontSize: 14,
    marginBottom: 20,
  },
};
