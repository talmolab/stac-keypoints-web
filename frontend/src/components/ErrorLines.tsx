import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { Line, Html } from "@react-three/drei";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";

const EMPTY_ERRORS: { keypointName: string; errorMm: number }[] = [];

// Reusable objects for model transform computation
const _pivot = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _euler = new THREE.Euler();
const _q = new THREE.Quaternion();

/**
 * Draws line segments from each MuJoCo body+offset position to the corresponding
 * ACM keypoint position. Line color encodes error magnitude:
 *   green (<5mm) → yellow (5-20mm) → red (>20mm)
 * Also shows error distance as a label at the midpoint.
 *
 * Body endpoints follow the model's visual transform (position/rotation/scale)
 * so error lines stay attached to the rendered model when the user adjusts it.
 */
export default function ErrorLines() {
  const showErrorLines = useStore((s) => s.showErrorLines);
  const mappings = useStore((s) => s.mappings);
  const offsets = useStore((s) => s.offsets);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const bodyNames = useStore((s) => s.bodyNames);
  const positions = useStore((s) => s.adjustedPositions ?? s.alignedPositions ?? s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const currentFrame = useStore((s) => s.currentFrame);
  const mocapScale = useStore((s) => s.mocapScaleFactor);
  const kpNames = useStore((s) => s.acmKeypointNames);
  const modelScale = useStore((s) => s.modelScale);
  const modelPosition = useStore((s) => s.modelPosition);
  const modelRotationY = useStore((s) => s.modelRotationY);

  // Compute model center (same as MuJoCoModel.tsx)
  const modelCenter = useMemo(() => {
    if (!Array.isArray(bodyTransforms) || bodyTransforms.length === 0)
      return new THREE.Vector3(0, 0, 0);
    let sx = 0, sy = 0, sz = 0;
    for (const t of bodyTransforms) {
      sx += t.position[0]; sy += t.position[2]; sz += -t.position[1];
    }
    const n = bodyTransforms.length;
    return new THREE.Vector3(sx / n, sy / n, sz / n);
  }, [bodyTransforms]);

  const lines = useMemo(() => {
    if (!showErrorLines || bodyTransforms.length === 0 || !positions || numKp === 0) return [];

    const nameToBodyIdx = Object.fromEntries(bodyNames.map((n, i) => [n, i]));
    const nameToKpIdx = Object.fromEntries(kpNames.map((n, i) => [n, i]));
    const offsetMap = Object.fromEntries(offsets.map((o) => [o.keypointName, o]));

    // Precompute model transform: P' = rotateY((P - center) * scale) + center + mPos
    const cx = modelCenter.x + modelPosition[0];
    const cy = modelCenter.y + modelPosition[1];
    const cz = modelCenter.z + modelPosition[2];
    _euler.set(0, modelRotationY, 0);
    _q.setFromEuler(_euler);

    return mappings.map((m) => {
      const bodyIdx = nameToBodyIdx[m.bodyName];
      const kpIdx = nameToKpIdx[m.keypointName];
      if (bodyIdx === undefined || kpIdx === undefined) return null;
      const bt = bodyTransforms[bodyIdx];
      if (!bt) return null;

      // MuJoCo body + offset position → Three.js coords
      const offset = offsetMap[m.keypointName] || { x: 0, y: 0, z: 0 };
      const mjWorld: [number, number, number] = [
        bt.position[0] + offset.x, bt.position[1] + offset.y, bt.position[2] + offset.z,
      ];
      const rawBodyPos = mjToThree(mjWorld);

      // Apply model transform so error line follows the rendered model
      _pt.copy(rawBodyPos);
      _pt.x -= cx; _pt.y -= cy; _pt.z -= cz; // translate to pivot
      _pt.x += modelPosition[0]; _pt.y += modelPosition[1]; _pt.z += modelPosition[2];
      _pt.multiplyScalar(modelScale);
      _pt.applyQuaternion(_q);
      _pt.x += cx; _pt.y += cy; _pt.z += cz;
      const bodyPos = { x: _pt.x, y: _pt.y, z: _pt.z };

      // ACM keypoint position (in Three.js coords, NOT transformed by model)
      const frameOffset = currentFrame * numKp * 3;
      const acmX = positions[frameOffset + kpIdx * 3 + 0] * mocapScale;
      const acmY = positions[frameOffset + kpIdx * 3 + 1] * mocapScale;
      const acmZ = positions[frameOffset + kpIdx * 3 + 2] * mocapScale;
      const acmPos = mjToThree([acmX, acmY, acmZ]);

      // Error distance in mm (from RAW positions, not model-transformed)
      const dx = mjWorld[0] - acmX;
      const dy = mjWorld[1] - acmY;
      const dz = mjWorld[2] - acmZ;
      const errorM = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const errorMm = errorM * 1000;

      // Color: green → yellow → red based on error
      let color: string;
      if (errorMm < 5) color = "#00ff44";
      else if (errorMm < 10) color = "#88ff00";
      else if (errorMm < 20) color = "#ffaa00";
      else if (errorMm < 40) color = "#ff4400";
      else color = "#ff0000";

      // Midpoint for label
      const mid: [number, number, number] = [
        (bodyPos.x + acmPos.x) / 2,
        (bodyPos.y + acmPos.y) / 2,
        (bodyPos.z + acmPos.z) / 2,
      ];

      return {
        keypointName: m.keypointName,
        points: [[bodyPos.x, bodyPos.y, bodyPos.z], [acmPos.x, acmPos.y, acmPos.z]] as [number, number, number][],
        color,
        errorMm,
        mid,
      };
    }).filter(Boolean) as {
      keypointName: string;
      points: [number, number, number][];
      color: string;
      errorMm: number;
      mid: [number, number, number];
    }[];
  }, [showErrorLines, mappings, offsets, bodyTransforms, bodyNames, positions, numKp, currentFrame, mocapScale, kpNames, modelScale, modelPosition, modelRotationY, modelCenter]);

  const setPerKeypointErrors = useStore((s) => s.setPerKeypointErrors);

  useEffect(() => {
    if (!showErrorLines || lines.length === 0) {
      setPerKeypointErrors(EMPTY_ERRORS);
      return;
    }
    setPerKeypointErrors(
      lines.map((l) => ({ keypointName: l.keypointName, errorMm: l.errorMm }))
    );
  }, [lines, showErrorLines, setPerKeypointErrors]);

  if (!showErrorLines || lines.length === 0) return null;

  // Compute mean error for summary
  const meanError = lines.reduce((s, l) => s + l.errorMm, 0) / lines.length;

  return (
    <group>
      {lines.map((l) => (
        <React.Fragment key={l.keypointName}>
          <Line
            points={l.points}
            color={l.color}
            lineWidth={2}
            depthTest={false}
            renderOrder={15}
          />
          {l.errorMm > 1 && (
            <Html position={l.mid} center style={{ pointerEvents: "none" }}>
              <div style={{
                background: "rgba(0,0,0,0.7)",
                color: l.color,
                padding: "1px 4px",
                borderRadius: 3,
                fontSize: 9,
                fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}>
                {l.keypointName}: {l.errorMm.toFixed(1)}mm
              </div>
            </Html>
          )}
        </React.Fragment>
      ))}
      {/* Summary label above the model center */}
      <Html position={[modelCenter.x + modelPosition[0], modelCenter.y + modelPosition[1] + 0.02, modelCenter.z + modelPosition[2]]} center style={{ pointerEvents: "none" }}>
        <div style={{
          background: "rgba(0,0,0,0.8)",
          color: "#fff",
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: 11,
          fontFamily: "monospace",
        }}>
          Mean error: {meanError.toFixed(1)}mm ({lines.length} pairs)
        </div>
      </Html>
    </group>
  );
}
