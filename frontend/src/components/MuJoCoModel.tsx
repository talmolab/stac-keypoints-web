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
  const setHover = useStore((s) => s.setHover);
  const [hoveredBody, setHoveredBody] = React.useState<number | null>(null);

  // In offset mode, make bodies semi-transparent so keypoints are visible
  const isOffsetMode = mode === "offset";

  const bodyGroups = useMemo(() => {
    if (geoms.length === 0) return [];
    const byBody = new Map<number, GeomData[]>();
    for (const geom of geoms) {
      if (!byBody.has(geom.bodyId)) byBody.set(geom.bodyId, []);
      byBody.get(geom.bodyId)!.push(geom);
    }
    return Array.from(byBody.entries()).map(([bodyId, bodyGeoms]) => ({
      bodyId,
      geoms: bodyGeoms,
    }));
  }, [geoms]);

  useEffect(() => {
    for (const t of bodyTransforms) {
      const group = bodyRefs.current.get(t.bodyId);
      if (group) {
        const pos = mjToThree(t.position as [number, number, number]);
        const quat = mjQuatToThree(t.quaternion as [number, number, number, number]);
        group.position.copy(pos);
        group.quaternion.copy(quat);
      }
    }
  }, [bodyTransforms]);

  // Model center for pivot rotation + scale
  const modelCenter = useMemo(() => {
    if (bodyTransforms.length === 0) return new THREE.Vector3(0, 0, 0);
    let sx = 0, sy = 0, sz = 0;
    for (const t of bodyTransforms) {
      const p = mjToThree(t.position as [number, number, number]);
      sx += p.x; sy += p.y; sz += p.z;
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
              {bodyGroups.map(({ bodyId, geoms: bodyGeoms }) => (
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
                    const bodyName = storeBodyNames[bodyId] || "";
                    setHoveredBody(bodyId);
                    if (e.point) setHover(`Body: ${bodyName}`, [e.point.x, e.point.y, e.point.z]);
                  }}
                  onPointerOut={() => { setHoveredBody(null); setHover(null); }}
                >
                  {bodyGeoms.map((geom, i) => {
                    const geometry = buildGeomGeometry(geom);
                    if (!geometry) return null;
                    const localPos = mjToThree(geom.position as [number, number, number]);
                    const localQuat = mjQuatToThree(geom.quaternion as [number, number, number, number]);
                    // Semi-transparent in offset mode
                    const baseOpacity = geom.color[3];
                    const opacity = isOffsetMode ? Math.min(baseOpacity, 0.3) : baseOpacity;
                    return (
                      <mesh key={i} geometry={geometry} position={localPos} quaternion={localQuat}>
                        <meshStandardMaterial
                          color={new THREE.Color(geom.color[0], geom.color[1], geom.color[2])}
                          opacity={opacity}
                          transparent={true}
                          depthWrite={!isOffsetMode}
                          roughness={0.7}
                          emissive={hoveredBody === bodyId && mode === "mapping" && selectedKp ? "#444400" : "#000000"}
                          emissiveIntensity={hoveredBody === bodyId ? 0.5 : 0}
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
