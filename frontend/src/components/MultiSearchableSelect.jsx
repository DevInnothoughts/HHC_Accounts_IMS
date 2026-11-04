// ============================================================
// FRONTEND: src/components/MultiSearchableSelect.jsx  —  NEW FILE
// ------------------------------------------------------------
// Multi-select twin of SearchableSelect (same look): a searchable
// dropdown with checkboxes, "Select all (filtered)" / "Clear", and the
// chosen items shown as removable chips under the control.
// value: array of option values. onChange receives the new array.
// ============================================================
import React, { useState, useRef, useEffect } from "react";

export default function MultiSearchableSelect({
  options = [],
  value = [],
  onChange,
  getOptionLabel = (o) => o.label,
  getOptionValue = (o) => o._id,
  placeholder = "Select...",
  disabled = false,
  error = false,
  showChips = true,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const chosen = value.map(String);
  const isOn = (o) => chosen.includes(String(getOptionValue(o)));
  const selectedOpts = options.filter(isOn);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => getOptionLabel(o).toLowerCase().includes(q))
    : options;

  const toggle = (o) => {
    const v = String(getOptionValue(o));
    onChange(
      chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v],
    );
  };
  const allFilteredOn = filtered.length > 0 && filtered.every(isOn);
  const toggleAllFiltered = () => {
    const ids = filtered.map((o) => String(getOptionValue(o)));
    onChange(
      allFilteredOn
        ? chosen.filter((x) => !ids.includes(x))
        : [...new Set([...chosen, ...ids])],
    );
  };

  const summary =
    selectedOpts.length === 0
      ? placeholder
      : selectedOpts.length === 1
        ? getOptionLabel(selectedOpts[0])
        : `${selectedOpts.length} selected`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          ...st.control,
          ...(error ? st.controlError : {}),
          ...(disabled ? st.controlDisabled : {}),
        }}
      >
        <span
          style={{
            color: selectedOpts.length ? "#0f172a" : "#94a3b8",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        <span style={{ color: "#94a3b8", marginLeft: 8 }}>▾</span>
      </button>

      {open && (
        <div style={st.menu}>
          <div style={st.searchWrap}>
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              style={st.searchInput}
            />
          </div>
          <div style={st.toolbar}>
            <button
              type="button"
              style={st.toolBtn}
              onClick={toggleAllFiltered}
            >
              {allFilteredOn
                ? q
                  ? "Unselect matches"
                  : "Unselect all"
                : q
                  ? "Select matches"
                  : "Select all"}
            </button>
            {chosen.length > 0 && (
              <button
                type="button"
                style={st.toolBtn}
                onClick={() => onChange([])}
              >
                Clear ({chosen.length})
              </button>
            )}
          </div>
          <div style={st.list}>
            {filtered.length === 0 ? (
              <div style={st.empty}>No matches</div>
            ) : (
              filtered.map((o) => {
                const v = String(getOptionValue(o));
                const on = isOn(o);
                return (
                  <label
                    key={v}
                    style={{ ...st.option, ...(on ? st.optionActive : {}) }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(o)}
                      style={{ marginRight: 10, cursor: "pointer" }}
                    />
                    {getOptionLabel(o)}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      {showChips && selectedOpts.length > 1 && (
        <div style={st.chips}>
          {selectedOpts.map((o) => (
            <span key={String(getOptionValue(o))} style={st.chip}>
              {getOptionLabel(o)}
              {!disabled && (
                <button
                  type="button"
                  style={st.chipX}
                  onClick={() => toggle(o)}
                  aria-label={`Remove ${getOptionLabel(o)}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const st = {
  control: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    background: "#fff",
    fontSize: 14,
    cursor: "pointer",
    textAlign: "left",
  },
  controlError: { borderColor: "#dc2626" },
  controlDisabled: { background: "#f1f5f9", cursor: "not-allowed" },
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    zIndex: 50,
    overflow: "hidden",
  },
  searchWrap: { padding: 8, borderBottom: "1px solid #f1f5f9" },
  searchInput: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  },
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 10px",
    borderBottom: "1px solid #f1f5f9",
  },
  toolBtn: {
    background: "none",
    border: "none",
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    padding: 2,
  },
  list: { maxHeight: 240, overflowY: "auto" },
  option: {
    display: "flex",
    alignItems: "center",
    padding: "9px 12px",
    fontSize: 14,
    cursor: "pointer",
    color: "#0f172a",
  },
  optionActive: { background: "#eff6ff", color: "#1d4ed8" },
  empty: { padding: 12, fontSize: 13, color: "#94a3b8", textAlign: "center" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 6px 3px 10px",
    background: "#eff6ff",
    color: "#1e3a8a",
    border: "1px solid #bfdbfe",
    borderRadius: 14,
    fontSize: 12,
    fontWeight: 500,
  },
  chipX: {
    background: "none",
    border: "none",
    color: "#64748b",
    fontSize: 15,
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 2px",
  },
};
