import React from "react";
import { useStore } from "../store";
import type { InteractionMode } from "../types";
import { SPINE_SEGMENTS, segmentKey, RETARGET_TREE } from "../skeletonEditor";

export default function PropertiesPanel() {
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const offsets = useStore((s) => s.offsets);
  const mappings = useStore((s) => s.mappings);
  const updateOffset = useStore((s) => s.updateOffset);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const modelRotationY = useStore((s) => s.modelRotationY);
  const setModelRotationY = useStore((s) => s.setModelRotationY);
  const modelPosition = useStore((s) => s.modelPosition);
  const setModelPosition = useStore((s) => s.setModelPosition);
  const modelScale = useStore((s) => s.modelScale);
  const setModelScale = useStore((s) => s.setModelScale);
  const showGlobalControls = useStore((s) => s.showGlobalControls);
  const setShowGlobalControls = useStore((s) => s.setShowGlobalControls);
  const segmentScales = useStore((s) => s.segmentScales);
  const setSegmentScale = useStore((s) => s.setSegmentScale);
  const followCamera = useStore((s) => s.followCamera);
  const setFollowCamera = useStore((s) => s.setFollowCamera);

  const currentOffset = selectedKp ? offsets.find((o) => o.keypointName === selectedKp) : null;
  const currentMapping = selectedKp ? mappings.find((m) => m.keypointName === selectedKp) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "auto" }}>
      {/* Mode toggle */}
      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>Mode</h3>
        <div style={{ display: "flex", gap: 4 }}>
          {(["mapping", "offset"] as InteractionMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              ...btnStyle,
              background: mode === m ? "#4444aa" : "#2a2a4a",
              fontWeight: mode === m ? 600 : 400,
            }}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        {/* Alignment direction hint */}
        {mode === "offset" && (
          <div style={{ fontSize: 11, color: "#77aaff", marginTop: 6, lineHeight: 1.4 }}>
            Drag the <span style={{ color: "#00ff88" }}>green offset markers</span> on the MuJoCo model to align with the <span style={{ color: "#ffaa00" }}>ACM keypoints</span> (stationary).
          </div>
        )}
        {mode === "mapping" && (
          <div style={{ fontSize: 11, color: "#77aaff", marginTop: 6, lineHeight: 1.4 }}>
            Click an ACM keypoint, then click a MuJoCo body (or pick from the body list).
          </div>
        )}
      </div>

      {/* Follow camera toggle */}
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#888", cursor: "pointer" }}>
        <input type="checkbox" checked={followCamera} onChange={(e) => setFollowCamera(e.target.checked)} />
        Follow Rodent
      </label>

      {/* Selected keypoint info */}
      {selectedKp && (
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>
            Selected: <span style={{ color: "#ffaa00" }}>{selectedKp}</span>
          </h3>
          {currentMapping && (
            <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
              Mapped to: <span style={{ color: "#66bbff" }}>{currentMapping.bodyName}</span>
            </div>
          )}
          {currentMapping && (
            <div>
              <div style={{ fontSize: 12, color: "#aaa", marginBottom: 4 }}>Offset (meters):</div>
              {(["x", "y", "z"] as const).map((axis) => (
                <div key={axis} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <label style={{ color: "#888", fontSize: 12, width: 12 }}>{axis.toUpperCase()}</label>
                  <input
                    type="number" step={0.001}
                    value={currentOffset?.[axis] ?? 0}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      const o = currentOffset || { x: 0, y: 0, z: 0 };
                      updateOffset(selectedKp,
                        axis === "x" ? val : o.x,
                        axis === "y" ? val : o.y,
                        axis === "z" ? val : o.z
                      );
                    }}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Skeleton Editor */}
      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>Skeleton Editor</h3>
        <div style={{ fontSize: 11, color: "#77aaff", marginBottom: 6 }}>
          Adjust segment lengths. Downstream keypoints propagate.
        </div>
        {RETARGET_TREE.filter((b) => SPINE_SEGMENTS.has(segmentKey(b.parent, b.child))).map((bone) => {
          const key = segmentKey(bone.parent, bone.child);
          const value = segmentScales[key] ?? 1.0;
          return (
            <div key={key} style={{ marginBottom: 4 }}>
              <label style={{ fontSize: 11, color: "#888" }}>
                {bone.parent} {"\u2192"} {bone.child}: {value.toFixed(2)}x
              </label>
              <input type="range" min={0.3} max={2.0} step={0.01}
                value={value}
                onChange={(e) => setSegmentScale(key, parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          );
        })}
      </div>

      {/* Keyboard shortcuts reference */}
      <details style={{ fontSize: 11, color: "#666", marginTop: 8 }}>
        <summary style={{ cursor: "pointer", color: "#888", fontSize: 12 }}>Shortcuts</summary>
        <pre style={{ margin: "4px 0 0", lineHeight: 1.6, whiteSpace: "pre", fontFamily: "monospace" }}>
{`Space     Play/Pause
\u2190 \u2192       Prev/Next frame (Shift: \u00b110)
WASD      Pan camera
QE        Orbit camera
RF        Camera up/down
1/2       Mapping/Offset mode
L         Label frame
Esc       Deselect`}
        </pre>
      </details>

      {/* Model transform controls */}
      <div style={{ marginTop: "auto" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, color: "#aaa" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showGlobalControls}
              onChange={(e) => setShowGlobalControls(e.target.checked)}
            />
            Show Global Controls
          </label>
        </h3>

        {showGlobalControls && (
          <>
            {/* Scale */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: "#888" }}>
                Scale: {modelScale.toFixed(2)}x
              </label>
              <input type="range" min={0.5} max={2.0} step={0.01}
                value={modelScale}
                onChange={(e) => setModelScale(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            {/* Rotation */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: "#888" }}>
                Rotation: {Math.round(modelRotationY * 180 / Math.PI)}°
              </label>
              <input type="range" min={0} max={360} step={1}
                value={Math.round(modelRotationY * 180 / Math.PI)}
                onChange={(e) => setModelRotationY(parseFloat(e.target.value) * Math.PI / 180)}
                style={{ width: "100%" }}
              />
            </div>

            {/* Position */}
            <div>
              <div style={{ fontSize: 12, color: "#aaa", marginBottom: 4 }}>Position:</div>
              {(["x", "y", "z"] as const).map((axis, i) => (
                <div key={axis} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <label style={{ color: "#888", fontSize: 12, width: 12 }}>{axis.toUpperCase()}</label>
                  <input
                    type="number" step={0.01}
                    value={modelPosition[i]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      const newPos: [number, number, number] = [...modelPosition];
                      newPos[i] = val;
                      setModelPosition(newPos);
                    }}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#2a2a4a", border: "1px solid #444", color: "#ccc",
  padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 12,
};
const inputStyle: React.CSSProperties = {
  background: "#1a1a2e", border: "1px solid #444", color: "#ccc",
  padding: "2px 6px", borderRadius: 3, width: 80, fontSize: 12,
};
