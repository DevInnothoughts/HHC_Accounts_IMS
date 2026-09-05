import React, { useState, useEffect, useCallback } from "react";

export const ATTACHMENT_META = {
  invoice: { icon: "🧾", label: "Invoice", color: "#2563eb" },
  quotation: { icon: "📋", label: "Quotation", color: "#7c3aed" },
  po: { icon: "📦", label: "Purchase Order", color: "#d97706" },
  challan: { icon: "🚚", label: "Challan", color: "#0891b2" },
  other: { icon: "📎", label: "Document", color: "#64748b" },
};

const metaFor = (t) => ATTACHMENT_META[t] || ATTACHMENT_META.other;

// Prefer the stored key/url for the extension — `name` is the user's original
// filename and is not guaranteed to carry one.
const extOf = (att) => {
  const src = att?.key || att?.url || att?.name || "";
  const m = src.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
};
const isPdf = (att) => extOf(att) === "pdf";
const isImage = (att) =>
  ["png", "jpg", "jpeg", "webp", "gif"].includes(extOf(att));

// Single place that turns a stored attachment into a browser-openable URL.
// When /files gets locked down behind auth, only this function changes.
export const resolveUrl = (att) => att?.url || "";

// ── Row chips ─────────────────────────────────────────────
export function AttachmentChips({ attachments = [], onOpen }) {
  if (!attachments.length) {
    return <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>;
  }

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {attachments.map((att, i) => {
        const meta = metaFor(att.type);
        return (
          <button
            key={att._id || i}
            title={`${meta.label} — ${att.name || "view"}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(i);
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              border: `1px solid ${meta.color}35`,
              background: `${meta.color}12`,
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            {meta.icon}
          </button>
        );
      })}
    </div>
  );
}

// ── Preview overlay ───────────────────────────────────────
export function AttachmentPreview({
  title,
  attachments = [],
  index,
  onIndex,
  onClose,
}) {
  const att = attachments[index];

  const step = useCallback(
    (delta) => {
      const next = index + delta;
      if (next >= 0 && next < attachments.length) onIndex(next);
    },
    [index, attachments.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  if (!att) return null;

  const meta = metaFor(att.type);
  const url = resolveUrl(att);

  return (
    <div style={P.overlay} onClick={onClose}>
      <div style={P.shell} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={P.header}>
          <div style={{ minWidth: 0 }}>
            <div style={P.title}>
              {meta.icon} {meta.label}
              <span style={P.counter}>
                {index + 1} of {attachments.length}
              </span>
            </div>
            <div style={P.subtitle} title={att.name}>
              {title} · {att.name}
              {att.uploadedAt &&
                ` · ${new Date(att.uploadedAt).toLocaleDateString("en-GB")}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={P.linkBtn}
            >
              ↗ New tab
            </a>
            <a href={url} download={att.name} style={P.linkBtn}>
              ⬇ Download
            </a>
            <button style={P.closeBtn} onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={P.body}>
          {attachments.length > 1 && (
            <button
              style={{ ...P.navBtn, left: 12, opacity: index === 0 ? 0.3 : 1 }}
              disabled={index === 0}
              onClick={() => step(-1)}
            >
              ‹
            </button>
          )}

          {isPdf(att) ? (
            <iframe src={url} title={att.name} style={P.frame} />
          ) : isImage(att) ? (
            <img src={url} alt={att.name} style={P.image} />
          ) : (
            <div style={P.fallback}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📎</div>
              <div style={{ marginBottom: 14 }}>
                This file type can't be previewed in the browser.
              </div>
              <a href={url} download={att.name} style={P.fallbackBtn}>
                ⬇ Download {att.name}
              </a>
            </div>
          )}

          {attachments.length > 1 && (
            <button
              style={{
                ...P.navBtn,
                right: 12,
                opacity: index === attachments.length - 1 ? 0.3 : 1,
              }}
              disabled={index === attachments.length - 1}
              onClick={() => step(1)}
            >
              ›
            </button>
          )}
        </div>

        {/* Thumb strip */}
        {attachments.length > 1 && (
          <div style={P.strip}>
            {attachments.map((a, i) => {
              const m = metaFor(a.type);
              return (
                <button
                  key={a._id || i}
                  onClick={() => onIndex(i)}
                  style={{
                    ...P.stripBtn,
                    border:
                      i === index
                        ? `1.5px solid ${m.color}`
                        : "1px solid #e2e8f0",
                    background: i === index ? `${m.color}12` : "#fff",
                    fontWeight: i === index ? 700 : 500,
                  }}
                >
                  {m.icon} {m.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const P = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
    padding: 24,
  },
  shell: {
    background: "#fff",
    borderRadius: 14,
    width: "100%",
    maxWidth: 980,
    height: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    padding: "14px 18px",
    borderBottom: "1px solid #e2e8f0",
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: "#1a3c6e",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  counter: { fontSize: 11, fontWeight: 600, color: "#94a3b8" },
  subtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  linkBtn: {
    padding: "7px 12px",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
    color: "#475569",
  },
  body: {
    flex: 1,
    position: "relative",
    background: "#f1f5f9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "auto",
    minHeight: 0,
  },
  frame: { width: "100%", height: "100%", border: "none", background: "#fff" },
  image: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
  fallback: {
    textAlign: "center",
    color: "#64748b",
    fontSize: 14,
    padding: 40,
  },
  fallbackBtn: {
    display: "inline-block",
    padding: "10px 18px",
    background: "#2563eb",
    color: "#fff",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
  },
  navBtn: {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    width: 38,
    height: 38,
    borderRadius: "50%",
    border: "none",
    background: "rgba(255,255,255,0.95)",
    boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
    cursor: "pointer",
    fontSize: 22,
    lineHeight: 1,
    color: "#1a3c6e",
    zIndex: 2,
  },
  strip: {
    display: "flex",
    gap: 8,
    padding: "10px 18px",
    borderTop: "1px solid #e2e8f0",
    overflowX: "auto",
  },
  stripBtn: {
    padding: "6px 12px",
    borderRadius: 8,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
    color: "#475569",
  },
};
