import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { mjToThree, mjQuatToThree, buildGeomGeometry } from "../mujocoLoader";
import type { GeomData } from "../types";

export default function MuJoCoModel() {
  const geoms = useStore((s) => s.geoms);
  const bodyTransforms = useStore((s) => s.bodyTransforms);
  const bodyRefs = useRef<Map<number, THREE.Group>>(new Map());

  // Group geoms by bodyId
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

  // Update body world transforms when they change
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

  return (
    <group>
      {bodyGroups.map(({ bodyId, geoms: bodyGeoms }) => (
        <group
          key={bodyId}
          ref={(ref: THREE.Group | null) => {
            if (ref) bodyRefs.current.set(bodyId, ref);
          }}
        >
          {bodyGeoms.map((geom, i) => {
            const geometry = buildGeomGeometry(geom);
            if (!geometry) return null;
            const localPos = mjToThree(geom.position as [number, number, number]);
            const localQuat = mjQuatToThree(geom.quaternion as [number, number, number, number]);
            return (
              <mesh key={i} geometry={geometry} position={localPos} quaternion={localQuat}>
                <meshStandardMaterial
                  color={new THREE.Color(geom.color[0], geom.color[1], geom.color[2])}
                  opacity={geom.color[3]}
                  transparent={geom.color[3] < 1}
                  roughness={0.7}
                />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}
