import React from "react";
import { Html } from "@react-three/drei";
import { useStore } from "../store";

/**
 * Shows a floating label at the hovered point position in 3D space.
 */
export default function HoverTooltip() {
  const name = useStore((s) => s.hoveredName);
  const position = useStore((s) => s.hoveredPosition);

  if (!name || !position) return null;

  return (
    <Html position={position} center style={{ pointerEvents: "none" }}>
      <div
        style={{
          background: "rgba(0, 0, 0, 0.85)",
          color: "#fff",
          padding: "3px 8px",
          borderRadius: 4,
          fontSize: 11,
          fontFamily: "monospace",
          whiteSpace: "nowrap",
          border: "1px solid #555",
          transform: "translateY(-20px)",
        }}
      >
        {name}
      </div>
    </Html>
  );
}
