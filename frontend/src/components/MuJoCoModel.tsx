import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree, mjQuatToThree, buildGeomGeometry } from "../mujocoLoader";
import type { GeomData } from "../types";
import OffsetMarkers from "./OffsetMarkers";
import OffsetGizmo from "./OffsetGizmo";

export default function MuJoCoModel() {
  const geoms = useStore((s) => s.geoms);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const bodyRefs = useRef<Map<number, THREE.Group>>(new Map());

  const mode = useStore((s) => s.mode);
  const selectedKp = useStore((s) => s.selectedKeypoint);
  const addMapping = useStore((s) => s.addMapping);
  const updateOffset = useStore((s) => s.updateOffset);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);
  const storeBodyNames = useStore((s) => s.bodyNames);
  const modelRotationY = useStore((s) => s.modelRotationY);
  const modelPosition = useStore((s) => s.modelPosition);
  const modelScale = useStore((s) => s.modelScale);
  const modelOpacity = useStore((s) => s.modelOpacity);
  const setHover = useStore((s) => s.setHover);
  const mappings = useStore((s) => s.mappings);
  const [hoveredBody, setHoveredBody] = React.useState<number | null>(null);

  // Make bodies semi-transparent in both mapping and offset modes so keypoints are always visible
  const isTransparentMode = mode === "offset" || mode === "mapping";

  // Pre-build geometry + local transforms once (they never change)
  const bodyGroups = useMemo(() => {
    if (geoms.length === 0) return [];
    const byBody = new Map<number, { geom: GeomData; geometry: THREE.BufferGeometry; localPos: THREE.Vector3; localQuat: THREE.Quaternion }[]>();
    for (const geom of geoms) {
      const geometry = buildGeomGeometry(geom);
      if (!geometry) continue;
      const localPos = mjToThree(geom.position as [number, number, number]);
      const localQuat = mjQuatToThree(geom.quaternion as [number, number, number, number]);
      if (!byBody.has(geom.bodyId)) byBody.set(geom.bodyId, []);
      byBody.get(geom.bodyId)!.push({ geom, geometry, localPos, localQuat });
    }
    return Array.from(byBody.entries()).map(([bodyId, items]) => ({
      bodyId,
      items,
    }));
  }, [geoms]);

  // Reusable objects for imperative updates (avoid per-frame allocation)
  const _pos = useMemo(() => new THREE.Vector3(), []);
  const _quat = useMemo(() => new THREE.Quaternion(), []);

  useEffect(() => {
    if (!Array.isArray(bodyTransforms)) return;
    for (const t of bodyTransforms) {
      const group = bodyRefs.current.get(t.bodyId);
      if (group) {
        // Inline coordinate conversion to avoid creating new Vector3/Quaternion
        _pos.set(t.position[0], t.position[2], -t.position[1]);
        _quat.set(t.quaternion[1], t.quaternion[3], -t.quaternion[2], t.quaternion[0]);
        group.position.copy(_pos);
        group.quaternion.copy(_quat);
      }
    }
  }, [bodyTransforms, _pos, _quat]);

  // Model center for pivot rotation + scale
  const modelCenter = useMemo(() => {
    if (!Array.isArray(bodyTransforms) || bodyTransforms.length === 0) return new THREE.Vector3(0, 0, 0);
    let sx = 0, sy = 0, sz = 0;
    for (const t of bodyTransforms) {
      // Inline mjToThree: (x, z, -y)
      sx += t.position[0]; sy += t.position[2]; sz += -t.position[1];
    }
    const n = bodyTransforms.length;
    return new THREE.Vector3(sx / n, sy / n, sz / n);
  }, [bodyTransforms]);

  const cx = modelCenter.x + modelPosition[0];
  const cy = modelCenter.y + modelPosition[1];
  const cz = modelCenter.z + modelPosition[2];

  return (
    <group position={[cx, cy, cz]}>
      <group rotation={[0, modelRotationY, 0]}>
        <group scale={[modelScale, modelScale, modelScale]}>
          <group position={[-cx, -cy, -cz]}>
            <group position={modelPosition}>
              {bodyGroups.map(({ bodyId, items }) => (
                <group
                  key={bodyId}
                  ref={(ref: THREE.Group | null) => {
                    if (ref) bodyRefs.current.set(bodyId, ref);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (mode === "mapping" && selectedKp) {
                      const bodyName = storeBodyNames[bodyId] || "";
                      addMapping(selectedKp, bodyName);
                      if (e.point && bodyTransforms[bodyId]) {
                        const pt = e.point;
                        const clickMj = [pt.x, -pt.z, pt.y];
                        const bodyMj = bodyTransforms[bodyId].position;
                        updateOffset(
                          selectedKp,
                          clickMj[0] - bodyMj[0],
                          clickMj[1] - bodyMj[1],
                          clickMj[2] - bodyMj[2]
                        );
                      }
                      setSelectedKp(null);
                    }
                  }}
                  onPointerOver={(e) => {
                    e.stopPropagation();
                    setHoveredBody(bodyId);
                  }}
                  onPointerOut={() => { setHoveredBody(null); setHover(null); }}
                >
                  {items.map(({ geom, geometry, localPos, localQuat }, i) => {
                    const baseOpacity = geom.color[3];
                    const opacity = isTransparentMode ? Math.min(baseOpacity, modelOpacity) : baseOpacity;

                    const isHighlighted = (() => {
                      if (hoveredBody === bodyId && mode === "mapping" && selectedKp) return "hover";
                      if (selectedKp) {
                        const mapping = mappings.find((m) => m.keypointName === selectedKp);
                        if (mapping && storeBodyNames[bodyId] === mapping.bodyName) return "selected";
                      }
                      return null;
                    })();

                    const geomLabel = `${storeBodyNames[bodyId] || "?"} [${geom.type}${items.length > 1 ? " #" + i : ""}]`;
                    return (
                      <mesh
                        key={i}
                        geometry={geometry}
                        position={localPos}
                        quaternion={localQuat}
                        onPointerOver={(e) => {
                          e.stopPropagation();
                          if (e.point) setHover(geomLabel, [e.point.x, e.point.y, e.point.z]);
                        }}
                        onPointerOut={(e) => { e.stopPropagation(); setHover(null); }}
                      >
                        <meshStandardMaterial
                          color={new THREE.Color(geom.color[0], geom.color[1], geom.color[2])}
                          opacity={opacity}
                          transparent={true}
                          depthWrite={!isTransparentMode}
                          roughness={0.7}
                          emissive={isHighlighted === "hover" ? "#444400" : isHighlighted === "selected" ? "#004400" : "#000000"}
                          emissiveIntensity={isHighlighted ? 0.6 : 0}
                        />
                      </mesh>
                    );
                  })}
                </group>
              ))}
              <OffsetMarkers />
              <OffsetGizmo />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
