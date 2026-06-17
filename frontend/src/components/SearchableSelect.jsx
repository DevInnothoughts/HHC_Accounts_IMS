import React, { useState, useRef, useEffect } from "react";

export default function SearchableSelect({
  options = [],
  value,
  onChange,
  getOptionLabel = (o) => o.label,
  getOptionValue = (o) => o._id,
  placeholder = "Select...",
  disabled = false,
  error = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState(null);
  const ref = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click
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

  // Focus the search box when opened
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const selected = options.find((o) => getOptionValue(o) === value);
  const q = search.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => getOptionLabel(o).toLowerCase().includes(q))
    : options;

  const pick = (o) => {
    onChange(getOptionValue(o));
    setOpen(false);
    setSearch("");
  };

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
            color: selected ? "#0f172a" : "#94a3b8",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {selected ? getOptionLabel(selected) : placeholder}
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
          <div style={st.list}>
            {filtered.length === 0 ? (
              <div style={st.empty}>No matches</div>
            ) : (
              filtered.map((o) => {
                const v = getOptionValue(o);
                const isActive = v === value;
                return (
                  <div
                    key={v}
                    onClick={() => pick(o)}
                    onMouseEnter={() => setHovered(v)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      ...st.option,
                      ...(hovered === v ? st.optionHover : {}),
                      ...(isActive ? st.optionActive : {}),
                    }}
                  >
                    {getOptionLabel(o)}
                  </div>
                );
              })
            )}
          </div>
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
  list: { maxHeight: 240, overflowY: "auto" },
  option: {
    padding: "10px 12px",
    fontSize: 14,
    cursor: "pointer",
    color: "#0f172a",
  },
  optionHover: { background: "#f8fafc" },
  optionActive: { background: "#eff6ff", color: "#2563eb", fontWeight: 600 },
  empty: { padding: 12, fontSize: 13, color: "#94a3b8", textAlign: "center" },
};
