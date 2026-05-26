import { useState, useRef } from "react";
import React from "react";
import api from "../api/axios";

const DOC_TYPES = {
  payment: [
    { value: "invoice", label: "🧾 Invoice", required: true },
    { value: "quotation", label: "📋 Quotation", required: true },
    { value: "po", label: "📦 Purchase Order", required: false },
    { value: "challan", label: "🚚 Delivery Challan", required: false },
    { value: "other", label: "📎 Other", required: false },
  ],
  vendor: [
    { value: "pan", label: "🪪 PAN Card", required: true },
    { value: "gst", label: "📄 GST Certificate", required: true },
    { value: "cheque", label: "🏦 Cancelled Cheque", required: true },
    { value: "agreement", label: "📝 Agreement Copy", required: false },
    { value: "msme", label: "🏭 MSME Certificate", required: false },
    { value: "other", label: "📎 Other", required: false },
  ],
};

export default function FileUpload({
  entityType = "payment", // 'payment' | 'vendor'
  entityId,
  existingDocs = [],
  onUploadSuccess,
  canUpload = true,
}) {
  const [selectedDocType, setSelectedDocType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingType, setDeletingType] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // One ref per doc type so each button opens file dialog independently
  const inputRefs = useRef({});

  const docTypes = DOC_TYPES[entityType] || DOC_TYPES.payment;

  const uploadEndpoint =
    entityType === "payment"
      ? `/uploads/payment/${entityId}/attachment`
      : `/uploads/vendor/${entityId}/document`;

  // ── Core upload function ─────────────────────────────
  const doUpload = async (file, docType) => {
    if (!docType) {
      setError("Please select a document type before uploading.");
      return;
    }
    if (!file) return;
    if (!entityId) {
      setError("Entity ID is missing. Cannot upload.");
      return;
    }

    // Client-side validation
    const maxMB = 3;
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf",
    ];

    if (file.size > maxMB * 1024 * 1024) {
      setError(`File too large. Maximum size is ${maxMB}MB.`);
      return;
    }
    if (!allowedTypes.includes(file.type)) {
      setError("Invalid file type. Only PDF, JPG, and PNG are allowed.");
      return;
    }

    setError("");
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docType", docType);

      const { data } = await api.post(uploadEndpoint, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      onUploadSuccess?.(data);

      // Reset the file input for this docType so same file can be re-uploaded
      if (inputRefs.current[docType]) {
        inputRefs.current[docType].value = "";
      }
    } catch (err) {
      setError(
        err.response?.data?.message || "Upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  };

  // ── Triggered when user picks a file via input ───────
  const handleFileInputChange = (docType) => (e) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file, docType);
  };

  // ── Drag and drop ────────────────────────────────────
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!selectedDocType) {
      setError("Please select a document type first.");
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file) doUpload(file, selectedDocType);
  };

  // ── Delete ───────────────────────────────────────────
  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;

    const deleteEndpoint =
      entityType === "payment"
        ? `/uploads/payment/${entityId}/attachment/${doc._id}`
        : `/uploads/vendor/${entityId}/document/${doc.type}`;

    setDeletingType(doc.type);
    try {
      await api.delete(deleteEndpoint);
      onUploadSuccess?.();
    } catch (err) {
      setError(err.response?.data?.message || "Delete failed.");
    } finally {
      setDeletingType("");
    }
  };

  const isUploaded = (type) => existingDocs.some((d) => d.type === type);
  const getDoc = (type) => existingDocs.find((d) => d.type === type);

  return (
    <div style={S.wrapper}>
      <div style={S.title}>📎 Document Management</div>

      {!canUpload && (
        <div style={S.readOnlyBanner}>
          Upload controls are only available to the branch user while editing
          this request.
        </div>
      )}

      {error && (
        <div style={S.errorBanner}>
          ⚠️ {error}
          <button style={S.errorClose} onClick={() => setError("")}>
            ✕
          </button>
        </div>
      )}

      {/* ── Document type buttons ── */}
      <div style={S.sectionLabel}>
        {canUpload ? "Select Document Type & Upload" : "Uploaded Documents"}
      </div>
      <div style={S.docGrid}>
        {docTypes.map((dt) => {
          const uploaded = isUploaded(dt.value);
          const doc = getDoc(dt.value);
          const isActive = selectedDocType === dt.value;
          const isDeleting = deletingType === dt.value;

          return (
            <div
              key={dt.value}
              style={{
                ...S.docCard,
                ...(uploaded ? S.docCardUploaded : {}),
                ...(isActive && !uploaded ? S.docCardActive : {}),
              }}
            >
              {/* Hidden file input — one per doc type */}
              <input
                ref={(el) => {
                  inputRefs.current[dt.value] = el;
                }}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                style={{ display: "none" }}
                onChange={handleFileInputChange(dt.value)}
              />

              <div style={S.docCardTop}>
                <div style={S.docCardLabel}>
                  {dt.label}
                  {dt.required && !uploaded && (
                    <span style={S.requiredBadge}>Required</span>
                  )}
                  {uploaded && <span style={S.uploadedBadge}>✓ Uploaded</span>}
                </div>
              </div>

              {uploaded && doc ? (
                /* Uploaded state — show file name + view + optional actions */
                <div style={S.uploadedRow}>
                  <span style={S.uploadedFileName} title={doc.name}>
                    📄{" "}
                    {doc.name.length > 20
                      ? doc.name.slice(0, 20) + "…"
                      : doc.name}
                  </span>
                  <div style={S.uploadedActions}>
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      style={S.viewLink}
                    >
                      View
                    </a>
                    {canUpload && (
                      <>
                        <button
                          style={S.replaceBtn}
                          disabled={uploading}
                          onClick={() => {
                            setSelectedDocType(dt.value);
                            inputRefs.current[dt.value]?.click();
                          }}
                        >
                          Replace
                        </button>
                        <button
                          style={S.deleteBtn}
                          disabled={isDeleting}
                          onClick={() => handleDelete(doc)}
                        >
                          {isDeleting ? "…" : "Delete"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : canUpload ? (
                /* Not uploaded — show Upload button */
                <button
                  style={{
                    ...S.uploadBtn,
                    opacity: uploading ? 0.6 : 1,
                    cursor: uploading ? "not-allowed" : "pointer",
                  }}
                  disabled={uploading}
                  onClick={() => {
                    setSelectedDocType(dt.value);
                    setError("");
                    // Direct programmatic click on THIS doc type's input
                    inputRefs.current[dt.value]?.click();
                  }}
                >
                  {uploading && selectedDocType === dt.value ? (
                    <>
                      <span style={S.spinnerSmall} /> Uploading…
                    </>
                  ) : (
                    "⬆ Upload File"
                  )}
                </button>
              ) : (
                <div style={S.uploadDisabled}>
                  Upload unavailable in this view.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Drag & Drop zone (optional convenience) ── */}
      {canUpload && selectedDocType && (
        <div
          style={{
            ...S.dropZone,
            ...(dragOver ? S.dropZoneActive : {}),
            ...(uploading ? S.dropZoneUploading : {}),
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {uploading ? (
            <div style={S.uploadingState}>
              <span style={S.spinner} />
              <span>Uploading to server…</span>
            </div>
          ) : (
            <div style={S.dropContent}>
              <div style={{ fontSize: 28 }}>☁️</div>
              <div style={S.dropText}>
                Or drag & drop here for{" "}
                <strong>
                  {docTypes.find((d) => d.value === selectedDocType)?.label}
                </strong>
              </div>
              <div style={S.dropHint}>PDF, JPG, PNG · Max 3MB</div>
            </div>
          )}
        </div>
      )}

      {/* ── Required docs checklist ── */}
      <div style={{ marginTop: 16 }}>
        <div style={S.sectionLabel}>Required Documents Checklist</div>
        <div style={S.checklist}>
          {docTypes
            .filter((d) => d.required)
            .map((dt) => {
              const uploaded = isUploaded(dt.value);
              return (
                <div key={dt.value} style={S.checkRow}>
                  <span
                    style={{
                      ...S.checkIcon,
                      color: uploaded ? "#16a34a" : "#dc2626",
                    }}
                  >
                    {uploaded ? "✓" : "✗"}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: uploaded ? "#16a34a" : "#dc2626",
                      flex: 1,
                    }}
                  >
                    {dt.label}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    {uploaded ? "Uploaded" : "Missing"}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

const S = {
  wrapper: {
    background: "#fff",
    borderRadius: 12,
    padding: 20,
    border: "1px solid #e2e8f0",
  },
  title: { fontSize: 14, fontWeight: 700, color: "#1a3c6e", marginBottom: 16 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  errorBanner: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#dc2626",
    marginBottom: 14,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorClose: {
    background: "none",
    border: "none",
    color: "#dc2626",
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 700,
    padding: "0 4px",
  },
  readOnlyBanner: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 10,
    padding: "12px 14px",
    color: "#1d4ed8",
    fontSize: 13,
    marginBottom: 14,
  },
  uploadDisabled: {
    padding: "14px 12px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    borderRadius: 8,
    color: "#64748b",
    fontSize: 13,
    textAlign: "center",
  },

  docGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  docCard: {
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    padding: "12px 14px",
    background: "#f8fafc",
    transition: "all .15s",
  },
  docCardActive: { borderColor: "#2563eb", background: "#eff6ff" },
  docCardUploaded: { borderColor: "#16a34a", background: "#f0fdf4" },
  docCardTop: { marginBottom: 10 },
  docCardLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },

  requiredBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: "#fef2f2",
    color: "#dc2626",
    padding: "1px 6px",
    borderRadius: 10,
    border: "1px solid #fecaca",
  },
  uploadedBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: "#f0fdf4",
    color: "#16a34a",
    padding: "1px 6px",
    borderRadius: 10,
    border: "1px solid #bbf7d0",
  },

  uploadBtn: {
    width: "100%",
    padding: "9px 0",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  uploadedRow: { display: "flex", flexDirection: "column", gap: 8 },
  uploadedFileName: { fontSize: 12, color: "#475569", fontWeight: 500 },
  uploadedActions: { display: "flex", gap: 6 },
  viewLink: {
    padding: "4px 10px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 6,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 600,
    textDecoration: "none",
  },
  replaceBtn: {
    padding: "4px 10px",
    background: "#fefce8",
    border: "1px solid #fde68a",
    borderRadius: 6,
    color: "#d97706",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  deleteBtn: {
    padding: "4px 10px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    color: "#dc2626",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },

  dropZone: {
    border: "2px dashed #e2e8f0",
    borderRadius: 10,
    padding: "24px 20px",
    textAlign: "center",
    transition: "all .2s",
    marginBottom: 16,
  },
  dropZoneActive: { borderColor: "#2563eb", background: "#eff6ff" },
  dropZoneUploading: { background: "#f8fafc", opacity: 0.7 },
  uploadingState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    color: "#2563eb",
    fontSize: 14,
  },
  dropContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  dropText: { fontSize: 13, color: "#475569" },
  dropHint: { fontSize: 12, color: "#94a3b8" },

  spinner: {
    width: 28,
    height: 28,
    border: "3px solid #dbeafe",
    borderTop: "3px solid #2563eb",
    borderRadius: "50%",
    display: "inline-block",
    animation: "spin 0.7s linear infinite",
  },
  spinnerSmall: {
    width: 14,
    height: 14,
    border: "2px solid #ffffff50",
    borderTop: "2px solid #fff",
    borderRadius: "50%",
    display: "inline-block",
    animation: "spin 0.7s linear infinite",
  },

  checklist: { display: "flex", flexDirection: "column", gap: 6 },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 0",
    borderBottom: "1px solid #f8fafc",
  },
  checkIcon: { fontSize: 14, fontWeight: 700, width: 16, flexShrink: 0 },
};
