import React, { useMemo, useEffect } from "react";
import * as THREE from "three";
import { Line, Html } from "@react-three/drei";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";
import { errorToColor } from "../errorColor";

const EMPTY_ERRORS: { keypointName: string; errorMm: number }[] = [];

/**
 * Draws line segments from each MuJoCo body+offset position to the corresponding
 * ACM keypoint position. Line color encodes error magnitude:
 *   green (<5mm) → yellow (5-20mm) → red (>20mm)
 * Also shows error distance as a label at the midpoint.
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

  // Compute error pairs whenever the underlying data is present, regardless
  // of the visibility toggle — downstream consumers (ACMSkeleton "color by
  // error", ErrorDistribution) read perKeypointErrors and need it kept fresh.
  const lines = useMemo(() => {
    if (bodyTransforms.length === 0 || !positions || numKp === 0) return [];

    const nameToBodyIdx = Object.fromEntries(bodyNames.map((n, i) => [n, i]));
    const nameToKpIdx = Object.fromEntries(kpNames.map((n, i) => [n, i]));
    const offsetMap = Object.fromEntries(offsets.map((o) => [o.keypointName, o]));

    return mappings.map((m) => {
      const bodyIdx = nameToBodyIdx[m.bodyName];
      const kpIdx = nameToKpIdx[m.keypointName];
      if (bodyIdx === undefined || kpIdx === undefined) return null;
      const bt = bodyTransforms[bodyIdx];
      if (!bt) return null;

      // ACM keypoint position — bail before any math when missing in this
      // frame, so we don't emit an error pair, a NaN line, or a NaN
      // contribution to the mean.
      const frameOffset = currentFrame * numKp * 3;
      const rawX = positions[frameOffset + kpIdx * 3 + 0];
      const rawY = positions[frameOffset + kpIdx * 3 + 1];
      const rawZ = positions[frameOffset + kpIdx * 3 + 2];
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !Number.isFinite(rawZ)) return null;
      const acmX = rawX * mocapScale;
      const acmY = rawY * mocapScale;
      const acmZ = rawZ * mocapScale;
      const acmPos = mjToThree([acmX, acmY, acmZ]);

      // MuJoCo body + offset position (in Three.js coords)
      const offset = offsetMap[m.keypointName] || { x: 0, y: 0, z: 0 };
      const mjWorld: [number, number, number] = [
        bt.position[0] + offset.x, bt.position[1] + offset.y, bt.position[2] + offset.z,
      ];
      const bodyPos = mjToThree(mjWorld);

      // Error distance in mm
      const dx = mjWorld[0] - acmX;
      const dy = mjWorld[1] - acmY;
      const dz = mjWorld[2] - acmZ;
      const errorM = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const errorMm = errorM * 1000;

      const color = errorToColor(errorMm);

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
  }, [mappings, offsets, bodyTransforms, bodyNames, positions, numKp, currentFrame, mocapScale, kpNames]);

  const setPerKeypointErrors = useStore((s) => s.setPerKeypointErrors);

  useEffect(() => {
    if (lines.length === 0) {
      setPerKeypointErrors(EMPTY_ERRORS);
      return;
    }
    setPerKeypointErrors(
      lines.map((l) => ({ keypointName: l.keypointName, errorMm: l.errorMm }))
    );
  }, [lines, setPerKeypointErrors]);

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
      {/* Summary label at origin */}
      <Html position={[0, 0.15, 0]} center style={{ pointerEvents: "none" }}>
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
