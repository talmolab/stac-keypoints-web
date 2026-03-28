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
