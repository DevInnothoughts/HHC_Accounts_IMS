import { useState, useEffect } from "react";
import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/axios";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import DuplicateInvoiceChecker from "../components/DuplicateInvoiceChecker.jsx";
import FileUpload from "../components/FileUpload.jsx";
import InvoiceItemsEditor from "../components/InvoiceItemsEditor.jsx";

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
  "Invoice Details",
  "Review & Submit",
];

export default function EditPaymentRequest() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState(null);
  const [step, setStep] = useState(0);
  const [branches, setBranches] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState("");
  const [dupResult, setDupResult] = useState(null);
  const [showItemErrors, setShowItemErrors] = useState(false);
  const [attachments, setAttachments] = useState([]);

  // ── Load existing request ──────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const [reqRes, branchRes] = await Promise.all([
          api.get(`/invoices/${id}`),
          api.get("/branches"),
        ]);

        const r = reqRes.data;
        setBranches(
          Array.isArray(branchRes.data)
            ? branchRes.data
            : branchRes.data.branches || [],
        );

        // ✅ Load existing attachments
        setAttachments(r.attachments || []);

        setForm({
          branch: r.branch?._id || r.branch || "",
          vendor: r.vendor?._id || r.vendor || "",
          expenseType: r.expenseType || "Revenue",
          expenseCategory: r.expenseCategory?._id || r.expenseCategory || "",
          amount: r.amount || "",
          gstPercentage:
            r.amount && r.gstAmount
              ? parseFloat(((r.gstAmount / r.amount) * 100).toFixed(2))
              : 0,
          gstAmount: r.gstAmount ?? 0,
          // ✅ Load line items; synthesize one from legacy amount/GST if absent
          items:
            r.items && r.items.length > 0
              ? r.items
              : r.amount
                ? [
                    {
                      description: r.description || "Invoice amount",
                      amount: r.amount,
                      gstPercentage:
                        r.amount && r.gstAmount
                          ? parseFloat(
                              ((r.gstAmount / r.amount) * 100).toFixed(2),
                            )
                          : 0,
                      gstAmount: r.gstAmount ?? 0,
                      total: (r.amount || 0) + (r.gstAmount || 0),
                    },
                  ]
                : [],
          tdsAmount: r.tdsAmount ?? 0,
          netPayable: r.netPayable || "",
          invoiceNumber: r.invoiceNumber || "",
          invoiceDate: r.invoiceDate ? r.invoiceDate.split("T")[0] : "",
          dueDate: r.dueDate ? r.dueDate.split("T")[0] : "",
          description: r.description || "",
          priority: r.priority || "Normal",
          remarks: r.remarks || "",
        });
      } catch (err) {
        setErrors({
          load:
            "Failed to load request. " + (err.response?.data?.message || ""),
        });
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [id]);

  // ── Load vendors when branch is set ───────────────────
  useEffect(() => {
    if (!form?.branch) return;
    api
      .get(
        `/vendors?branch=${form.branch}&status=active&approvalStatus=approved&limit=100`,
      )
      .then((r) =>
        setVendors(Array.isArray(r.data) ? r.data : r.data.vendors || []),
      )
      .catch(console.error);
  }, [form?.branch]);

  // ── Load categories when expenseType changes ──────────
  useEffect(() => {
    if (!form?.expenseType) return;
    api
      .get(`/expense-categories?type=${form.expenseType}`)
      .then((r) =>
        setCategories(Array.isArray(r.data) ? r.data : r.data.categories || []),
      )
      .catch(console.error);
  }, [form?.expenseType]);

  // ── Recompute gstAmount from gstPercentage and recalculate netPayable ──
  useEffect(() => {
    if (!form) return;
    if (form.items && form.items.length > 0) return; // items drive totals
    const amount = parseFloat(form.amount) || 0;
    const gstPct = parseFloat(form.gstPercentage) || 0;
    const gstAmount = parseFloat(((amount * gstPct) / 100).toFixed(2));
    const tds = parseFloat(form.tdsAmount) || 0;
    setForm((f) => ({
      ...f,
      gstAmount: gstAmount,
      netPayable: (amount + gstAmount - tds).toFixed(2),
    }));
  }, [form?.amount, form?.gstPercentage, form?.items]);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors((err) => ({ ...err, [field]: "" }));
  };

  // ✅ Items drive base amount + total GST; net payable = base + GST − TDS
  const handleItemsChange = (items, totals) => {
    setForm((f) => ({
      ...f,
      items,
      amount: totals.amount,
      gstAmount: totals.gstAmount,
      itemsValid: totals.valid,
      gstPercentage:
        totals.amount > 0
          ? parseFloat(((totals.gstAmount / totals.amount) * 100).toFixed(2))
          : 0,
      netPayable: (totals.grandTotal - (parseFloat(f.tdsAmount) || 0)).toFixed(
        2,
      ),
    }));
    if (errors.items) setErrors((er) => ({ ...er, items: "" }));
  };

  const validateStep = (s) => {
    const e = {};
    if (s === 0) {
      if (!form.branch) e.branch = "Branch is required";
      if (!form.vendor) e.vendor = "Vendor is required";
      if (!form.expenseType) e.expenseType = "Expense type is required";
      if (!form.expenseCategory)
        e.expenseCategory = "Expense category is required";
      if (!form.priority) e.priority = "Priority is required";
    }
    if (s === 1) {
      if (!form.itemsValid) {
        e.items =
          "Please add at least one item and fix the highlighted errors below";
        setShowItemErrors(true);
      } else {
        setShowItemErrors(false);
      }
    }
    if (s === 2) {
      if (!form.invoiceNumber?.trim())
        e.invoiceNumber = "Invoice number is required";
      if (!form.invoiceDate) e.invoiceDate = "Invoice date is required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (validateStep(step)) setStep((s) => s + 1);
  };

  // ── Save as Draft ─────────────────────────────────────
  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await api.put(`/invoices/${id}`, form);
      setSuccess("Draft saved successfully!");
      setTimeout(() => navigate(`/payments/${id}`), 1500);
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  // ── Save + Submit ──────────────────────────────────────
  const REQUIRED_DOC_TYPES = ["invoice", "quotation"];

  const handleSaveAndSubmit = async () => {
    if (dupResult?.isDuplicate) {
      setErrors({ submit: "Cannot submit: duplicate invoice detected." });
      return;
    }
    const missingDocs = REQUIRED_DOC_TYPES.filter(
      (t) => !attachments.some((a) => a.type === t),
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
      // First save the edits
      await api.put(`/invoices/${id}`, form);
      // Then submit
      await api.patch(`/invoices/${id}/submit`);
      setSuccess("Request submitted successfully!");
      setTimeout(() => navigate(`/payments/${id}`), 1800);
    } catch (err) {
      setErrors({ submit: err.response?.data?.message || "Submit failed" });
    } finally {
      setSubmitting(false);
    }
  };

  // ✅ Re-fetch attachments from server after upload/delete
  const handleAttachmentUpdate = async () => {
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setAttachments(data.attachments || []);
    } catch (err) {
      console.error("Failed to refresh attachments:", err.message);
    }
  };

  // ── Helpers ───────────────────────────────────────────
  const selectedVendor = vendors.find((v) => v._id === form?.vendor);
  const selectedBranch = branches.find((b) => b._id === form?.branch);
  const selectedCategory = categories.find(
    (c) => c._id === form?.expenseCategory,
  );

  if (loading)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.loading}>Loading request...</div>
        </main>
      </div>
    );

  if (errors.load)
    return (
      <div style={S.layout}>
        <Sidebar />
        <main style={S.main}>
          <div style={S.errorBox}>{errors.load}</div>
          <button style={S.backBtn2} onClick={() => navigate("/payments")}>
            ← Back
          </button>
        </main>
      </div>
    );

  if (!form) return null;

  return (
    <div style={S.layout}>
      <Sidebar />
      <main style={S.main}>
        {/* Header */}
        <div style={S.topBar}>
          <button style={S.backBtn} onClick={() => navigate(`/payments/${id}`)}>
            ← Back to Request
          </button>
          <h1 style={S.title}>Edit Payment Request</h1>
          <p style={S.sub}>
            Make your changes and save as draft or submit directly.
          </p>
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
          {success && <div style={S.success}>{success}</div>}
          {errors.submit && <div style={S.errorBox}>{errors.submit}</div>}

          {/* ── Step 0: Basic Info ─────────────────────── */}
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

                {/* Vendor preview card */}
                {selectedVendor && (
                  <div style={{ ...S.vendorPreview, gridColumn: "1 / -1" }}>
                    <div style={S.vendorPreviewTitle}>
                      Selected Vendor Details
                    </div>
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

          {/* ── Step 1: Financial Details ──────────────── */}
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
                ℹ️ Add each line item with its value and GST %. The base amount
                and total GST are calculated automatically from the items below.
                TDS will be applied by the accounts team during approval.
              </div>

              <InvoiceItemsEditor
                value={form.items}
                onChange={handleItemsChange}
                showErrors={showItemErrors}
              />
              {errors.items && (
                <div style={{ fontSize: 13, color: "#dc2626", marginTop: 8 }}>
                  {errors.items}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <div style={S.netPayableBox}>
                  <div>
                    <div style={S.netLabel}>Estimated Net Payable</div>
                    <div style={S.netFormula}>
                      Base (₹
                      {parseFloat(form.amount || 0).toLocaleString("en-IN")}) +
                      GST (₹
                      {parseFloat(form.gstAmount || 0).toLocaleString("en-IN")})
                      − TDS (set by accounts)
                    </div>
                  </div>
                  <div style={S.netValue}>
                    ₹
                    {parseFloat(form.netPayable || 0).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Invoice Details ────────────────────────── */}
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

                {/* Live duplicate checker */}
                <div style={{ gridColumn: "1 / -1" }}>
                  <DuplicateInvoiceChecker
                    branchId={form.branch}
                    vendorId={form.vendor}
                    invoiceNumber={form.invoiceNumber}
                    amount={form.netPayable}
                    excludeId={id}
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
                    placeholder="Brief description of the payment request..."
                  />
                </Field>

                <Field label="Remarks" fullWidth>
                  <textarea
                    style={{ ...S.input, ...S.textarea }}
                    value={form.remarks}
                    onChange={set("remarks")}
                    placeholder="Any additional remarks..."
                  />
                </Field>
              </div>

              {/* ✅ File Upload Section */}
              <div style={S.uploadSection}>
                <div style={S.uploadSectionTitle}>
                  📎 Attachments
                  <span style={S.uploadSectionSub}>
                    Invoice and Quotation are required before submission
                  </span>
                </div>
                <FileUpload
                  entityType="payment"
                  entityId={id}
                  existingDocs={attachments}
                  onUploadSuccess={handleAttachmentUpdate}
                />
              </div>
            </div>
          )}

          {/* ── Step 3: Review ────────────────────────── */}
          {step === 3 && (
            <div>
              <h2 style={S.sectionTitle}>✅ Review & Submit</h2>
              <div style={S.reviewGrid}>
                <ReviewSection title="Request Details">
                  <ReviewRow label="Branch" value={selectedBranch?.name} />
                  <ReviewRow
                    label="Vendor"
                    value={selectedVendor?.vendorName}
                  />
                  <ReviewRow label="Expense Type" value={form.expenseType} />
                  <ReviewRow
                    label="Expense Category"
                    value={selectedCategory?.name}
                  />
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
                    label={`Total GST${
                      form.items?.length
                        ? ` (${form.items.length} item${
                            form.items.length > 1 ? "s" : ""
                          })`
                        : ""
                    }`}
                    value={`₹${parseFloat(form.gstAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                  />
                  <ReviewRow label="TDS Deduction" value="Set by accounts" />
                  <div style={S.reviewDivider} />
                  <div style={S.reviewNetRow}>
                    <span>Net Payable</span>
                    <span
                      style={{
                        color: "#1a3c6e",
                        fontSize: 20,
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
                  <ReviewRow
                    label="Invoice Number"
                    value={form.invoiceNumber}
                  />
                  <ReviewRow label="Invoice Date" value={form.invoiceDate} />
                  <ReviewRow label="Due Date" value={form.dueDate || "—"} />
                  <ReviewRow
                    label="Description"
                    value={form.description || "—"}
                  />
                </ReviewSection>

                <ReviewSection title="Payment Destination">
                  <ReviewRow
                    label="Account Holder"
                    value={selectedVendor?.accountHolderName}
                  />
                  <ReviewRow label="Bank" value={selectedVendor?.bankName} />
                  <ReviewRow
                    label="Account"
                    value={`****${selectedVendor?.accountNumber?.slice(-4)}`}
                  />
                  <ReviewRow label="IFSC" value={selectedVendor?.ifscCode} />
                </ReviewSection>
              </div>
              {/* ── Add this inside Step 3, after the reviewGrid div ── */}

              {/* Attachment checklist on review */}
              <div style={S.reviewAttachments}>
                <div style={S.reviewAttachTitle}>📎 Attachment Status</div>
                <div style={S.reviewAttachGrid}>
                  {[
                    { type: "invoice", label: "🧾 Invoice", required: true },
                    {
                      type: "quotation",
                      label: "📋 Quotation",
                      required: true,
                    },
                    { type: "po", label: "📦 Purchase Order", required: false },
                    { type: "challan", label: "🚚 Challan", required: false },
                  ].map((doc) => {
                    const uploaded = attachments.some(
                      (a) => a.type === doc.type,
                    );
                    return (
                      <div
                        key={doc.type}
                        style={{
                          ...S.reviewAttachItem,
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
                        <span style={{ fontSize: 14 }}>
                          {uploaded ? "✓" : doc.required ? "✗" : "—"}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: uploaded
                              ? "#16a34a"
                              : doc.required
                                ? "#dc2626"
                                : "#94a3b8",
                          }}
                        >
                          {doc.label}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "#94a3b8",
                            marginLeft: "auto",
                          }}
                        >
                          {uploaded
                            ? "Uploaded"
                            : doc.required
                              ? "Missing"
                              : "Optional"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Warn if required attachments are missing */}
                {["invoice", "quotation"].some(
                  (type) => !attachments.some((a) => a.type === type),
                ) && (
                  <div style={S.attachWarning}>
                    ⚠️ Invoice and Quotation are required. Please go back to
                    Step 3 and upload them before submitting.
                  </div>
                )}
              </div>

              {/* Duplicate warning on review step */}
              {dupResult?.isDuplicate && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1.5px solid #fecaca",
                    borderRadius: 10,
                    padding: 14,
                    marginTop: 12,
                  }}
                >
                  🚨{" "}
                  <strong style={{ color: "#dc2626" }}>
                    Duplicate invoice detected.
                  </strong>{" "}
                  Please go back and change the invoice number before
                  submitting.
                </div>
              )}
            </div>
          )}

          {/* ── Footer navigation ─────────────────────── */}
          <div style={S.footer}>
            <button
              style={S.cancelBtn}
              onClick={() => navigate(`/payments/${id}`)}
            >
              Cancel
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              {step > 0 && (
                <button style={S.prevBtn} onClick={() => setStep((s) => s - 1)}>
                  ← Previous
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button style={S.nextBtn} onClick={handleNext}>
                  Next →
                </button>
              ) : (
                <>
                  <button
                    style={{ ...S.draftBtn, opacity: saving ? 0.7 : 1 }}
                    onClick={handleSaveDraft}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "💾 Save as Draft"}
                  </button>
                  {(() => {
                    const missingDocs = ["invoice", "quotation"].filter(
                      (t) => !attachments.some((a) => a.type === t),
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
                          onClick={handleSaveAndSubmit}
                          disabled={blocked}
                        >
                          {submitting ? "Submitting..." : "🚀 Save & Submit"}
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

// ── Small reusable components ──────────────────────────────
const ReviewSection = ({ title, children }) => (
  <div style={RS.section}>
    <div style={RS.title}>{title}</div>
    {children}
  </div>
);

const ReviewRow = ({ label, value, children }) => (
  <div style={RS.row}>
    <span style={RS.label}>{label}</span>
    <span style={RS.value}>{children || value || "—"}</span>
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

const RS = {
  section: {
    background: "#f8fafc",
    borderRadius: 10,
    padding: 18,
    border: "1px solid #e2e8f0",
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "7px 0",
    borderBottom: "1px solid #f1f5f9",
  },
  label: { fontSize: 13, color: "#64748b" },
  value: {
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
    textAlign: "right",
    maxWidth: "55%",
  },
};

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
    marginBottom: 6,
    display: "block",
  },
  backBtn2: {
    padding: "9px 16px",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    marginTop: 12,
  },
  title: { fontSize: 24, fontWeight: 700, color: C.primary, margin: 0 },
  sub: { fontSize: 13, color: "#888", marginTop: 4 },
  loading: { padding: 60, textAlign: "center", color: "#94a3b8" },
  stepBar: {
    display: "flex",
    alignItems: "flex-start",
    marginBottom: 24,
    overflowX: "auto",
    paddingBottom: 4,
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
  reviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  reviewDivider: { borderTop: `1px solid ${C.border}`, margin: "8px 0" },
  reviewNetRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
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
  success: {
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
  // ── Add to existing S = { ... } style object ──────────────
  uploadSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTop: "1px solid #e2e8f0",
  },
  uploadSectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#1a3c6e",
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  uploadSectionSub: {
    fontSize: 12,
    fontWeight: 400,
    color: "#94a3b8",
  },
  reviewAttachments: {
    marginTop: 16,
    background: "#f8fafc",
    borderRadius: 10,
    padding: 16,
    border: "1px solid #e2e8f0",
  },
  reviewAttachTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  reviewAttachGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  reviewAttachItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid",
  },
  attachWarning: {
    marginTop: 12,
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#92400e",
    fontWeight: 500,
  },
};
