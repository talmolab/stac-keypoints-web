import React, { useEffect, useRef, useState } from "react";

// Lightweight dropdown menu for the toolbar. The header is a fixed-height,
// non-wrapping row, so the many "Load …" / export actions are collapsed into a
// couple of these menus to keep the row uncluttered. Closes on outside-click,
// on Escape, and after an item fires (children get a `close` callback).

export function ToolbarMenu({
  label,
  children,
  title,
}: {
  label: string;
  title?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        style={open ? { ...triggerStyle, ...triggerOpenStyle } : triggerStyle}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} {"▾"}
      </button>
      {open && (
        <div role="menu" style={popoverStyle}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One clickable row. `run` is wrapped so the menu closes before the action. */
export function MenuItem({
  label,
  onSelect,
  close,
  disabled,
  title,
}: {
  label: string;
  onSelect: () => void;
  close: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={() => { close(); onSelect(); }}
      style={{ ...itemStyle, color: disabled ? "#666" : "#ccc", cursor: disabled ? "default" : "pointer" }}
      onMouseOver={(e) => { if (!disabled) e.currentTarget.style.background = "#2f2f52"; }}
      onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}

export function MenuDivider() {
  return <div style={{ height: 1, background: "#3a3a5a", margin: "4px 2px" }} />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: "#777", padding: "2px 10px", textTransform: "uppercase", letterSpacing: 0.5 }}>
      {children}
    </div>
  );
}

const triggerStyle: React.CSSProperties = {
  background: "#2a2a4a", border: "1px solid #555", color: "#ccc",
  padding: "6px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12,
};
const triggerOpenStyle: React.CSSProperties = {
  background: "#3a3a5a", borderColor: "#77f",
};

const popoverStyle: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, marginTop: 4,
  display: "flex", flexDirection: "column", gap: 1,
  background: "#20203a", border: "1px solid #555", borderRadius: 4,
  padding: 4, minWidth: 190, maxHeight: "70vh", overflowY: "auto",
  zIndex: 1000, boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
};

const itemStyle: React.CSSProperties = {
  background: "transparent", border: "none", textAlign: "left",
  padding: "5px 10px", borderRadius: 3, fontSize: 12, whiteSpace: "nowrap",
};
