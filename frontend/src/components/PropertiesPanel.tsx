import React from "react";
import { useStore } from "../store";
import type { InteractionMode } from "../types";
import { PRIMARY_SEGMENTS, segmentKey, RETARGET_TREE } from "../skeletonEditor";
import ErrorDistribution from "./ErrorDistribution";

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
  const mocapScaleFactor = useStore((s) => s.mocapScaleFactor);
  const setMocapScaleFactor = useStore((s) => s.setMocapScaleFactor);
  const showGlobalControls = useStore((s) => s.showGlobalControls);
  const setShowGlobalControls = useStore((s) => s.setShowGlobalControls);
  const segmentScales = useStore((s) => s.segmentScales);
  const setSegmentScale = useStore((s) => s.setSegmentScale);
  const resetSegmentScales = useStore((s) => s.resetSegmentScales);
  const setHoveredSegment = useStore((s) => s.setHoveredSegment);
  const followCamera = useStore((s) => s.followCamera);
  const setFollowCamera = useStore((s) => s.setFollowCamera);
  const autoIk = useStore((s) => s.autoIk);
  const setAutoIk = useStore((s) => s.setAutoIk);
  const modelOpacity = useStore((s) => s.modelOpacity);
  const setModelOpacity = useStore((s) => s.setModelOpacity);
  const showErrorLines = useStore((s) => s.showErrorLines);
  const setShowErrorLines = useStore((s) => s.setShowErrorLines);
  const showOffsetMarkers = useStore((s) => s.showOffsetMarkers);
  const setShowOffsetMarkers = useStore((s) => s.setShowOffsetMarkers);

  const currentOffset = selectedKp ? offsets.find((o) => o.keypointName === selectedKp) : null;
  const currentMapping = selectedKp ? mappings.find((m) => m.keypointName === selectedKp) : null;

  const [showGuide, setShowGuide] = React.useState(true);

  const segmentSlider = (bone: { parent: string; child: string }, small?: boolean) => {
    const key = segmentKey(bone.parent, bone.child);
    const value = segmentScales[key] ?? 1.0;
    const isModified = Math.abs(value - 1.0) > 0.01;
    return (
      <div
        key={key}
        style={{ marginBottom: 2, padding: "2px 4px", borderRadius: 3 }}
        onMouseEnter={() => setHoveredSegment(key)}
        onMouseLeave={() => setHoveredSegment(null)}
      >
        <label style={{ fontSize: small ? 10 : 11, color: isModified ? "#ffaa00" : small ? "#777" : "#888" }}>
          {bone.parent} {"\u2192"} {bone.child}: {value.toFixed(2)}x
        </label>
        <input type="range" min={0.1} max={2.0} step={0.01}
          value={value}
          onChange={(e) => setSegmentScale(key, parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingBottom: 20 }}>
      {/* Workflow Guide */}
      <div>
        <h3
          style={{ margin: "0 0 4px", fontSize: 14, color: "#aaa", cursor: "pointer", userSelect: "none" }}
          onClick={() => setShowGuide(!showGuide)}
        >
          {showGuide ? "\u25be" : "\u25b8"} Workflow Guide
        </h3>
        {showGuide && (
          <div style={{ fontSize: 11, color: "#999", lineHeight: 1.6, padding: "4px 0" }}>
            <div style={{ color: "#ffcc00", fontWeight: 600, marginBottom: 2 }}>Step 1: Skeleton Editor</div>
            <div>Adjust ACM spine proportions to match the MuJoCo model. Shorten <code>SpineL→SpineM</code> and <code>SpineM→SpineF</code> (typically ~0.6x).</div>
            <div style={{ color: "#ffcc00", fontWeight: 600, marginTop: 6, marginBottom: 2 }}>Step 2: Mapping (press 1)</div>
            <div>Verify each <span style={{ color: "#ffaa00" }}>ACM keypoint</span> is assigned to the correct <span style={{ color: "#66bbff" }}>MuJoCo body</span>. Click a keypoint → click a body or pick from the list.</div>
            <div style={{ color: "#ffcc00", fontWeight: 600, marginTop: 6, marginBottom: 2 }}>Step 3: Offsets (press 2)</div>
            <div>Drag <span style={{ color: "#00ff88" }}>green offset markers</span> (on the MuJoCo model) to align with the stationary <span style={{ color: "#ffaa00" }}>ACM keypoints</span>. IK auto-runs to show the result.</div>
            <div style={{ color: "#ffcc00", fontWeight: 600, marginTop: 6, marginBottom: 2 }}>Step 4: Validate</div>
            <div>Click <b>IK Sequence</b> to run IK on all frames. Scrub the timeline and use Follow Rodent to evaluate. Iterate steps 1-3 as needed.</div>
            <div style={{ color: "#ffcc00", fontWeight: 600, marginTop: 6, marginBottom: 2 }}>Step 5: Export</div>
            <div>Click <b>Export</b> to save the config (mappings, offsets, segment scales) for use with the STAC pipeline.</div>
          </div>
        )}
      </div>

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

      {/* Toggle options + sliders (always visible) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#888", cursor: "pointer" }}>
          <input type="checkbox" checked={followCamera} onChange={(e) => setFollowCamera(e.target.checked)} />
          Follow Rodent
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: autoIk ? "#8f8" : "#888", cursor: "pointer" }}>
          <input type="checkbox" checked={autoIk} onChange={(e) => setAutoIk(e.target.checked)} />
          Auto IK <span style={{ fontSize: 10, color: "#666" }}>(live on changes)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: showErrorLines ? "#ff8844" : "#888", cursor: "pointer" }}>
          <input type="checkbox" checked={showErrorLines} onChange={(e) => setShowErrorLines(e.target.checked)} />
          Show Error Lines
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: showOffsetMarkers ? "#00cccc" : "#888", cursor: "pointer" }}>
          <input type="checkbox" checked={showOffsetMarkers} onChange={(e) => setShowOffsetMarkers(e.target.checked)} />
          Show Offset Points
        </label>
        {/* Model scale — always visible */}
        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 11, color: "#888" }}>
            Model Scale: {modelScale.toFixed(2)}x
          </label>
          <input type="range" min={0.3} max={3.0} step={0.01}
            value={modelScale}
            onChange={(e) => setModelScale(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>
        {/* Mocap scale — live skeleton-vs-cloud size match, no backend call */}
        <div>
          <label
            style={{ fontSize: 11, color: Math.abs(mocapScaleFactor - 0.01) > 1e-5 ? "#ffaa00" : "#888" }}
            title="Multiplier from raw mocap units to meters. Default 0.01 assumes cm input."
          >
            Mocap Scale: {mocapScaleFactor.toFixed(4)}
          </label>
          <input type="range" min={0.001} max={0.05} step={0.0005}
            value={mocapScaleFactor}
            onChange={(e) => setMocapScaleFactor(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>
        {/* Model opacity — always visible */}
        <div>
          <label style={{ fontSize: 11, color: "#888" }}>
            Model Opacity: {Math.round(modelOpacity * 100)}%
          </label>
          <input type="range" min={0.05} max={1.0} step={0.05}
            value={modelOpacity}
            onChange={(e) => setModelOpacity(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>
      </div>

      {showErrorLines && <ErrorDistribution />}

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: "#aaa" }}>Skeleton Editor</h3>
          <button
            onClick={resetSegmentScales}
            style={{ ...btnStyle, padding: "2px 8px", fontSize: 10 }}
          >
            Reset
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#77aaff", marginBottom: 6 }}>
          Adjust segment lengths. Downstream keypoints propagate.
        </div>
        {RETARGET_TREE.filter((b) => PRIMARY_SEGMENTS.has(segmentKey(b.parent, b.child))).map((bone) => segmentSlider(bone))}
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: "pointer", color: "#777", fontSize: 11 }}>Fine-tune limb segments</summary>
          <div style={{ marginTop: 4 }}>
            {RETARGET_TREE.filter((b) => !PRIMARY_SEGMENTS.has(segmentKey(b.parent, b.child))).map((bone) => segmentSlider(bone, true))}
          </div>
        </details>
      </div>

      {/* Keyboard shortcuts reference */}
      <details style={{ fontSize: 11, color: "#666" }}>
        <summary style={{ cursor: "pointer", color: "#888", fontSize: 12 }}>Shortcuts</summary>
        <pre style={{ margin: "4px 0 0", lineHeight: 1.6, whiteSpace: "pre", fontFamily: "monospace" }}>
{`Space     Play/Pause
\u2190 \u2192       Prev/Next (Shift: \u00b110)
WASD      Pan camera
QE        Orbit camera
RF        Camera up/down
1/2       Mapping/Offset mode
L         Label frame
Esc       Deselect`}
        </pre>
      </details>

      {/* Global Controls (rotation/position — collapsible) */}
      <details>
        <summary style={{ cursor: "pointer", color: "#888", fontSize: 12 }}>
          Global Controls (rotation/position)
        </summary>
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "#888" }}>
              Rotation: {Math.round(modelRotationY * 180 / Math.PI)}°
            </label>
            <input type="range" min={0} max={360} step={1}
              value={Math.round(modelRotationY * 180 / Math.PI)}
              onChange={(e) => setModelRotationY(parseFloat(e.target.value) * Math.PI / 180)}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>Position:</div>
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
        </div>
      </details>
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
