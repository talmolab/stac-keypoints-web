export interface KPMapping {
  keypointName: string;
  bodyName: string;
}

export interface KPOffset {
  keypointName: string;
  x: number;
  y: number;
  z: number;
}

export type FrameStatus = "unlabeled" | "labeled" | "validated";
export type InteractionMode = "mapping" | "offset";

export interface Bone {
  parent: string;
  child: string;
}

export interface GeomData {
  type: string;
  bodyId: number;
  bodyName: string;
  size: number[];
  position: [number, number, number];
  quaternion: [number, number, number, number];
  color: [number, number, number, number];
  // Present only when type === "mesh": the real triangle geometry in the
  // geom-local MuJoCo (Z-up) frame. `vertices` is a flat [x,y,z,...] array;
  // `faces` is a flat, mesh-local (0-based) triangle index array. The renderer
  // swizzles vertices to Three.js (Y-up) when it builds the BufferGeometry.
  vertices?: number[];
  faces?: number[];
}

export interface BodyTransform {
  bodyId: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface ACMData {
  keypointNames: string[];
  bones: Bone[];
  positions: number[];
  numFrames: number;
  numKeypoints: number;
}

export interface STACConfig {
  keypointModelPairs: Record<string, string>;
  keypointInitialOffsets: Record<string, [number, number, number]>;
  scaleFactor: number;
  mocapScaleFactor: number;
}
