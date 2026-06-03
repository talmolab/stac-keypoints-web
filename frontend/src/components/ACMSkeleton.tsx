import React, { useMemo, useCallback, useRef } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useStore } from "../store";
import { mjToThree } from "../mujocoLoader";
import { segmentKey } from "../skeletonEditor";
import { errorToColor } from "../errorColor";
import { markerRadius } from "../sceneScale";

// Canonical hues for the rat keypoint set. Anything not listed here falls
// back to a hash-derived hue (see colorForKp), so other species still get
// stable per-keypoint colors without us having to enumerate them.
const KP_COLORS: Record<string, string> = {
  Snout: "#ffcc00", SpineF: "#ffaa00", SpineM: "#ff8800", SpineL: "#ff6600", TailBase: "#ee5500",
  ShoulderL: "#4488ff", ElbowL: "#3399ff", WristL: "#22aaff", HandL: "#11bbff",
  HipL: "#44aadd", KneeL: "#33bbcc", AnkleL: "#22ccbb", FootL: "#11ddaa",
  ShoulderR: "#ff4466", ElbowR: "#ff3377", WristR: "#ff2288", HandR: "#ff1199",
  HipR: "#ff6644", KneeR: "#ff5533", AnkleR: "#ff4422", FootR: "#ff3311",
};

function colorForKp(name: string): string {
  const explicit = KP_COLORS[name];
  if (explicit) return explicit;
  // FNV-1a-ish 32-bit hash → hue in [0, 360). Saturation and lightness
  // fixed so the unknown-name colors sit in the same brightness band as
  // the rat palette above.
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hue = ((h >>> 0) % 360);
  return `hsl(${hue}, 75%, 60%)`;
}

// Unit-radius shared geometry — meshes scale this to the bbox-derived size
// (see sceneScale.ts). Selection / highlight bumps the mesh `scale` by 1.6x
// rather than swapping to a fatter geometry.
const _unitSphere = new THREE.SphereGeometry(1, 12, 8);

// Shared material cache (by color string)
const _materialCache = new Map<string, THREE.MeshBasicMaterial>();
function getMaterial(color: string): THREE.MeshBasicMaterial {
  let mat = _materialCache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    _materialCache.set(color, mat);
  }
  return mat;
}

// Tint a base color by confidence ∈ [0, 1]. We darken low-confidence markers
// rather than tinting hue, so they read as "less reliable" without losing
// the per-keypoint color identity. Quantize to 6 levels to bound the
// material cache (per kp × per level).
const _tintScratch = new THREE.Color();
const _tintCache = new Map<string, string>();
function tintByConfidence(hex: string, confidence: number): string {
  const clamped = Math.max(0, Math.min(1, confidence));
  const factor = 0.4 + 0.6 * clamped;            // [0.4, 1.0]
  const quantized = Math.round(factor * 5) / 5;  // 0.4, 0.6, 0.8, 1.0
  // Cache by (basecolor, level) — at most 4–6 levels × N_kp colors.
  const key = `${hex}|${quantized}`;
  const cached = _tintCache.get(key);
  if (cached !== undefined) return cached;
  const out = "#" + _tintScratch.set(hex).multiplyScalar(quantized).getHexString();
  _tintCache.set(key, out);
  return out;
}

export default function ACMSkeleton() {
  const kpNames = useStore((s) => s.acmKeypointNames);
  const bones = useStore((s) => s.acmBones);
  const positions = useStore((s) => s.adjustedPositions ?? s.alignedPositions ?? s.acmPositions);
  const numKp = useStore((s) => s.acmNumKeypoints);
  const currentFrame = useStore((s) => s.currentFrame);
  const mocapScale = useStore((s) => s.mocapScaleFactor);
  const mode = useStore((s) => s.mode);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);
  const setHover = useStore((s) => s.setHover);
  const hoveredSegment = useStore((s) => s.hoveredSegment);
  const colorByError = useStore((s) => s.colorByError);
  const perKeypointErrors = useStore((s) => s.perKeypointErrors);
  const confidences = useStore((s) => s.acmConfidences);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const markerSizeMult = useStore((s) => s.markerSize);
  // Bbox-derived radius: ~3.6mm for a rat, ~2mm for a stick bug. Recomputes
  // when the model loads (and per-frame after IK, but the diagonal is stable
  // since IK changes pose, not extent).
  const baseRadius = useMemo(
    () => markerRadius(bodyTransforms, markerSizeMult),
    [bodyTransforms, markerSizeMult],
  );

  // Cache mesh refs for imperative position updates (avoids re-render)
  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());

  // framePositions[i] is null for keypoints missing in the current frame
  // (NaN coords). Three.js renders NaN as origin or breaks bounding-volume
  // checks, so we skip those keypoints entirely downstream.
  const framePositions = useMemo<(THREE.Vector3 | null)[] | null>(() => {
    if (!positions || numKp === 0) return null;
    const offset = currentFrame * numKp * 3;
    const pts: (THREE.Vector3 | null)[] = [];
    for (let i = 0; i < numKp; i++) {
      const rx = positions[offset + i * 3 + 0];
      const ry = positions[offset + i * 3 + 1];
      const rz = positions[offset + i * 3 + 2];
      if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)) {
        pts.push(null);
        continue;
      }
      pts.push(mjToThree([rx * mocapScale, ry * mocapScale, rz * mocapScale]));
    }
    return pts;
  }, [positions, currentFrame, numKp, mocapScale]);

  const handleClick = useCallback(
    (name: string) => {
      if (mode === "mapping") setSelectedKp(name);
    },
    [mode, setSelectedKp]
  );

  // Stable map of keypoint name to index. Only changes when kpNames changes.
  const nameToIdx = useMemo(() => {
    const m: Record<string, number> = {};
    kpNames.forEach((n, i) => { m[n] = i; });
    return m;
  }, [kpNames]);

  // Lookup table for per-keypoint error so render is O(1) per marker.
  const errorByName = useMemo(() => {
    if (!colorByError) return null;
    const m: Record<string, number> = {};
    for (const e of perKeypointErrors) m[e.keypointName] = e.errorMm;
    return m;
  }, [colorByError, perKeypointErrors]);

  const highlightedKps = useMemo(() => {
    const out = new Set<string>();
    if (!hoveredSegment) return out;
    const parts = hoveredSegment.split("\u2192");
    if (parts.length === 2) {
      out.add(parts[0].trim());
      out.add(parts[1].trim());
    }
    return out;
  }, [hoveredSegment]);

  const boneData = useMemo(() => {
    if (!framePositions) return [];
    return bones.map((bone) => {
      const pi = nameToIdx[bone.parent];
      const ci = nameToIdx[bone.child];
      if (pi === undefined || ci === undefined) return null;
      const p = framePositions[pi];
      const c = framePositions[ci];
      if (!p || !c) return null;
      const key = segmentKey(bone.parent, bone.child);
      const isHl = key === hoveredSegment;
      return { points: [[p.x, p.y, p.z], [c.x, c.y, c.z]] as [number, number, number][], color: isHl ? "#ffffff" : "#999999", lineWidth: isHl ? 3 : 1.5 };
    }).filter(Boolean) as { points: [number, number, number][]; color: string; lineWidth: number }[];
  }, [bones, framePositions, nameToIdx, hoveredSegment]);

  if (!framePositions || framePositions.length === 0) return null;

  return (
    <group>
      {kpNames.map((name, i) => {
        const pos = framePositions[i];
        if (!pos) return null;  // missing in this frame → don't render
        const isSelected = selectedKp === name;
        const isHighlighted = highlightedKps.has(name);
        const errorMm = errorByName ? errorByName[name] : undefined;
        const errorColor = errorMm !== undefined ? errorToColor(errorMm) : null;
        let color = isSelected
          ? "#ffff00"
          : isHighlighted
          ? "#ffffff"
          : errorColor ?? colorForKp(name);
        // Confidence tint applies only to the base color, not to selection /
        // highlight / error overlays (which carry their own meaning).
        if (!isSelected && !isHighlighted && !errorColor && confidences) {
          const c = confidences[currentFrame * numKp + i];
          if (Number.isFinite(c)) color = tintByConfidence(color, c);
        }
        const r = baseRadius * ((isSelected || isHighlighted) ? 1.6 : 1.0);
        return (
          <mesh
            key={name}
            ref={(ref: THREE.Mesh | null) => { if (ref) meshRefs.current.set(name, ref); }}
            position={pos}
            scale={[r, r, r]}
            geometry={_unitSphere}
            material={getMaterial(color)}
            renderOrder={11}
            onClick={(e) => { e.stopPropagation(); handleClick(name); }}
            onPointerOver={(e) => { e.stopPropagation(); setHover(`KP: ${name}`, [pos.x, pos.y, pos.z]); }}
            onPointerOut={() => setHover(null)}
          />
        );
      })}
      {boneData.map((b, i) => (
        <Line
          key={i}
          points={b.points}
          color={b.color}
          lineWidth={b.lineWidth}
          depthTest={false}
          renderOrder={10}
        />
      ))}
    </group>
  );
}
