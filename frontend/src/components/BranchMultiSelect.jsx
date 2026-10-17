// ============================================================
// FRONTEND: src/components/BranchMultiSelect.jsx — NEW FILE
// ------------------------------------------------------------
// Branch filter for the Reports section: pick none (= all branches),
// one, or several.
//
// The value is a comma-separated string of branch ids ("" = all), which
// is exactly what every report endpoint already accepts as ?branch=a,b,c
// (resolveBranchIds in the report controllers). Keeping it a string means
// the pages' draft/applied filter state, query building and "dirty"
// checks need no change.
//
// Usage:
//   <BranchMultiSelect
//     options={branches.map((b) => ({ value: b._id, label: b.name }))}
//     value={draft.branch}
//     onChange={(csv) => setDraft((d) => ({ ...d, branch: csv }))}
//   />
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from "react";

export const csvToIds = (csv) =>
  String(csv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Names for the selected ids, e.g. "Sangamvadi, Bopal" — null when "All".
// Used for the "Showing … only" tags and the Excel "Branch" meta row.
export const branchNamesOf = (options, csv, { max = 3 } = {}) => {
  const ids = csvToIds(csv);
  if (!ids.length) return null;
  const byId = new Map(options.map((o) => [String(o.value), o.label]));
  const names = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!names.length) return `${ids.length} branch${ids.length > 1 ? "es" : ""}`;
  return names.length > max
    ? `${names.slice(0, max).join(", ")} +${names.length - max} more`
    : names.join(", ");
};

export default function BranchMultiSelect({
  options = [],
  value = "",
  onChange,
  style,
  placeholder = "All branches",
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef(null);

  const selected = useMemo(() => new Set(csvToIds(value)), [value]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? options.filter((o) => String(o.label || "").toLowerCase().includes(s))
      : options;
  }, [options, q]);

  // Keep the order of the option list, not the click order.
  const emit = (set) =>
    onChange?.(
      options
        .map((o) => String(o.value))
        .filter((id) => set.has(id))
        .join(","),
    );

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Every branch ticked is the same as "All branches"
    if (next.size === options.length && options.length > 1) return onChange?.("");
    emit(next);
  };

  const selectVisible = () => {
    const next = new Set(selected);
    visible.forEach((o) => next.add(String(o.value)));
    if (next.size === options.length) return onChange?.("");
    emit(next);
  };

  const count = selected.size;
  const label =
    count === 0
      ? placeholder
      : count === 1
        ? options.find((o) => selected.has(String(o.value)))?.label || "1 branch"
        : `${count} branches`;

  return (
    <div ref={wrapRef} style={{ position: "relative", ...(style?.width ? { width: style.width } : {}) }}>
      <button
        type="button"
        style={{ ...style, ...M.trigger, ...(count ? M.triggerActive : {}) }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={count > 1 ? branchNamesOf(options, value, { max: 50 }) : undefined}
      >
        <span style={M.triggerText}>{label}</span>
        <span style={M.caret}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={M.panel} role="listbox" aria-multiselectable="true">
          {options.length > 6 && (
            <input
              autoFocus
              style={M.search}
              placeholder="Search branches…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}

          <div style={M.actions}>
            <button type="button" style={M.linkBtn} onClick={selectVisible}>
              {q ? "Select shown" : "Select all"}
            </button>
            <button
              type="button"
              style={{ ...M.linkBtn, color: count ? "#dc2626" : "#94a3b8" }}
              disabled={!count}
              onClick={() => onChange?.("")}
            >
              Clear ({count})
            </button>
          </div>

          <div style={M.list}>
            <label style={{ ...M.item, ...(count === 0 ? M.itemOn : {}) }}>
              <input
                type="checkbox"
                style={M.box}
                checked={count === 0}
                onChange={() => onChange?.("")}
              />
              <span style={{ fontWeight: 600 }}>{placeholder}</span>
            </label>
            {visible.map((o) => {
              const id = String(o.value);
              const on = selected.has(id);
              return (
                <label key={id} style={{ ...M.item, ...(on ? M.itemOn : {}) }}>
                  <input
                    type="checkbox"
                    style={M.box}
                    checked={on}
                    onChange={() => toggle(id)}
                  />
                  <span>{o.label}</span>
                </label>
              );
            })}
            {!visible.length && <div style={M.none}>No branch matches “{q}”</div>}
          </div>

          <div style={M.footer}>
            <span style={{ color: "#64748b" }}>
              {count ? `${count} selected` : "All branches"}
            </span>
            <button type="button" style={M.doneBtn} onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const M = {
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minWidth: 170,
    textAlign: "left",
    cursor: "pointer",
    background: "#fff",
  },
  triggerActive: { borderColor: "#0198A3", color: "#066A92", fontWeight: 600 },
  triggerText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 200,
  },
  caret: { fontSize: 11, color: "#94a3b8" },
  panel: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 50,
    width: 280,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    boxShadow: "0 12px 30px rgba(15,23,42,0.14)",
    padding: 8,
  },
  search: {
    width: "100%",
    boxSizing: "border-box",
    padding: "7px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 7,
    fontSize: 13,
    marginBottom: 6,
    outline: "none",
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    padding: "2px 4px 6px",
  },
  linkBtn: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12,
    fontWeight: 600,
    color: "#066A92",
    cursor: "pointer",
  },
  list: { maxHeight: 260, overflowY: "auto" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 6px",
    borderRadius: 6,
    fontSize: 13,
    color: "#334155",
    cursor: "pointer",
  },
  itemOn: { background: "#f0fdfa" },
  box: { width: 15, height: 15, accentColor: "#0198A3", cursor: "pointer", margin: 0 },
  none: { padding: 10, fontSize: 12, color: "#94a3b8", textAlign: "center" },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderTop: "1px solid #f1f5f9",
    marginTop: 6,
    paddingTop: 8,
    fontSize: 12,
  },
  doneBtn: {
    background: "#066A92",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
};
