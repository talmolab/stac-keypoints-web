import { useStore } from "../store";

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["Space", "Play / pause"],
  ["← →", "Prev / next frame (Shift: ±10)"],
  ["Home / End", "Jump to first / last frame"],
  ["1 / 2", "Mapping / Offset mode"],
  ["L", "Label current frame"],
  ["Esc", "Deselect keypoint (or close this help)"],
  ["⌘/Ctrl + Z", "Undo mapping or offset edit"],
  ["⌘/Ctrl + ⇧Z, ⌘Y", "Redo"],
  ["⌘/Ctrl + S", "Save / re-save YAML config (Chrome/Edge: in place)"],
  ["⌘/Ctrl + ⇧S", "Save As… (re-prompt save location)"],
  ["WASD", "Pan camera"],
  ["Q E", "Orbit camera"],
  ["R F", "Camera up / down"],
  ["Shift (held)", "Move camera faster"],
  ["? or H", "Toggle this help"],
];

export default function HelpOverlay() {
  const open = useStore((s) => s.helpOpen);
  const setOpen = useStore((s) => s.setHelpOpen);
  if (!open) return null;
  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0, 0, 0, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1a1a2e", border: "1px solid #444",
          borderRadius: 8, padding: "20px 28px",
          color: "#ccc", fontSize: 13, minWidth: 360, maxWidth: 520,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: "#eee" }}>Keyboard shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            style={{
              background: "transparent", border: "none", color: "#888",
              fontSize: 18, cursor: "pointer", padding: "0 4px",
            }}
            aria-label="Close"
          >×</button>
        </div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {SHORTCUTS.map(([keys, desc]) => (
              <tr key={keys}>
                <td style={{
                  padding: "4px 12px 4px 0", color: "#ddd",
                  fontFamily: "monospace", whiteSpace: "nowrap",
                  verticalAlign: "top",
                }}>{keys}</td>
                <td style={{ padding: "4px 0", color: "#aaa" }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
