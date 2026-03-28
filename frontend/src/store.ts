import { create } from "zustand";
import type {
  KPMapping,
  KPOffset,
  InteractionMode,
  FrameStatus,
  Bone,
  GeomData,
  BodyTransform,
} from "./types";
import { adjustAllFrames } from "./skeletonEditor";

interface AppState {
  // MuJoCo model
  xmlPath: string | null;
  geoms: GeomData[];
  bodyNames: string[];
  bodyTransforms: BodyTransform[];
  nq: number;
  currentQpos: number[] | null;

  // ACM data
  acmKeypointNames: string[];
  acmBones: Bone[];
  acmPositions: Float32Array | null;
  acmNumFrames: number;
  acmNumKeypoints: number;

  // Alignment
  alignedPositions: Float32Array | null;
  isAligned: boolean;

  // Mappings & offsets
  mappings: KPMapping[];
  offsets: KPOffset[];
  scaleFactor: number;
  mocapScaleFactor: number;

  // Interaction
  mode: InteractionMode;
  selectedKeypoint: string | null;
  selectedBody: string | null;

  // Timeline
  currentFrame: number;
  isPlaying: boolean;
  frameStatuses: FrameStatus[];
  labeledFrames: Set<number>;

  // STAC
  stacQpos: number[][] | null;
  stacFrameIndices: number[] | null;
  stacBodyTransforms: BodyTransform[][] | null;
  stacRunning: boolean;
  stacProgress: number;

  // Model rotation (Y-axis in Three.js = yaw)
  modelRotationY: number;

  // Model position offset [x, y, z]
  modelPosition: [number, number, number];

  // Model scale (uniform)
  modelScale: number;

  // Global controls visibility
  showGlobalControls: boolean;

  // Segment scales (skeleton editor)
  segmentScales: Record<string, number>;
  adjustedPositions: Float32Array | null;

  // Hover tooltip
  hoveredName: string | null;
  hoveredPosition: [number, number, number] | null;

  // Actions
  setXmlData: (data: { geoms: GeomData[]; bodyNames: string[]; nq: number; xmlPath: string }) => void;
  setAcmData: (data: { keypointNames: string[]; bones: Bone[]; positions: number[]; numFrames: number; numKeypoints: number }) => void;
  setAlignedPositions: (positions: number[]) => void;
  setCurrentFrame: (frame: number) => void;
  setMode: (mode: InteractionMode) => void;
  setSelectedKeypoint: (name: string | null) => void;
  setSelectedBody: (name: string | null) => void;
  addMapping: (kp: string, body: string) => void;
  removeMapping: (kp: string) => void;
  updateOffset: (kp: string, x: number, y: number, z: number) => void;
  togglePlay: () => void;
  labelCurrentFrame: () => void;
  setBodyTransforms: (transforms: BodyTransform[]) => void;
  setModelRotationY: (radians: number) => void;
  setModelPosition: (pos: [number, number, number]) => void;
  setModelScale: (scale: number) => void;
  setShowGlobalControls: (show: boolean) => void;
  setSegmentScale: (key: string, value: number) => void;
  setHover: (name: string | null, position?: [number, number, number]) => void;
  setStacResults: (qpos: number[][], frameIndices?: number[], bodyTransforms?: BodyTransform[][]) => void;
  loadConfig: (config: {
    keypointModelPairs: Record<string, string>;
    keypointInitialOffsets: Record<string, [number, number, number]>;
    scaleFactor: number;
    mocapScaleFactor: number;
  }) => void;
}

export const useStore = create<AppState>((set) => ({
  xmlPath: null,
  geoms: [],
  bodyNames: [],
  bodyTransforms: [],
  nq: 0,
  currentQpos: null,
  acmKeypointNames: [],
  acmBones: [],
  acmPositions: null,
  acmNumFrames: 0,
  acmNumKeypoints: 0,
  alignedPositions: null,
  isAligned: false,
  mappings: [],
  offsets: [],
  scaleFactor: 0.9,
  mocapScaleFactor: 0.01,
  mode: "mapping",
  selectedKeypoint: null,
  selectedBody: null,
  currentFrame: 0,
  isPlaying: false,
  frameStatuses: [],
  labeledFrames: new Set(),
  stacQpos: null,
  stacFrameIndices: null,
  stacBodyTransforms: null,
  stacRunning: false,
  stacProgress: 0,
  modelRotationY: 0,
  modelPosition: [0, 0, 0] as [number, number, number],
  modelScale: 1.0,
  showGlobalControls: true,
  segmentScales: {},
  adjustedPositions: null,
  hoveredName: null,
  hoveredPosition: null,

  setXmlData: (data) => set({ geoms: data.geoms, bodyNames: data.bodyNames, nq: data.nq, xmlPath: data.xmlPath }),
  setAcmData: (data) => set({
    acmKeypointNames: data.keypointNames,
    acmBones: data.bones,
    acmPositions: new Float32Array(data.positions),
    acmNumFrames: data.numFrames,
    acmNumKeypoints: data.numKeypoints,
    frameStatuses: new Array(data.numFrames).fill("unlabeled") as FrameStatus[],
  }),
  setAlignedPositions: (positions) => set({ alignedPositions: new Float32Array(positions), isAligned: true }),
  setCurrentFrame: (frame) => set({ currentFrame: frame }),
  setMode: (mode) => set({ mode }),
  setSelectedKeypoint: (name) => set({ selectedKeypoint: name }),
  setSelectedBody: (name) => set({ selectedBody: name }),
  addMapping: (kp, body) => set((state) => {
    const filtered = state.mappings.filter((m) => m.keypointName !== kp);
    return { mappings: [...filtered, { keypointName: kp, bodyName: body }] };
  }),
  removeMapping: (kp) => set((state) => ({
    mappings: state.mappings.filter((m) => m.keypointName !== kp),
  })),
  updateOffset: (kp, x, y, z) => set((state) => {
    const filtered = state.offsets.filter((o) => o.keypointName !== kp);
    return { offsets: [...filtered, { keypointName: kp, x, y, z }] };
  }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  labelCurrentFrame: () => set((state) => {
    const newStatuses = [...state.frameStatuses];
    newStatuses[state.currentFrame] = "labeled";
    const newLabeled = new Set(state.labeledFrames);
    newLabeled.add(state.currentFrame);
    return { frameStatuses: newStatuses as FrameStatus[], labeledFrames: newLabeled };
  }),
  setBodyTransforms: (transforms) => set({ bodyTransforms: transforms }),
  setModelRotationY: (radians) => set({ modelRotationY: radians }),
  setModelPosition: (pos) => set({ modelPosition: pos }),
  setModelScale: (scale) => set({ modelScale: scale }),
  setShowGlobalControls: (show) => set({ showGlobalControls: show }),
  setSegmentScale: (key, value) => set((state) => {
    const newScales = { ...state.segmentScales, [key]: value };
    const source = state.alignedPositions ?? state.acmPositions;
    if (!source || state.acmNumKeypoints === 0) return { segmentScales: newScales };
    const hasNonDefault = Object.values(newScales).some((v) => Math.abs(v - 1.0) > 0.001);
    if (!hasNonDefault) return { segmentScales: newScales, adjustedPositions: null };
    const adjusted = adjustAllFrames(
      source, state.acmNumFrames, state.acmNumKeypoints,
      state.acmKeypointNames, newScales,
    );
    return { segmentScales: newScales, adjustedPositions: adjusted };
  }),
  setHover: (name, position) => set({ hoveredName: name, hoveredPosition: position || null }),
  setStacResults: (qpos, frameIndices, bodyTransforms) => set({
    stacQpos: qpos,
    stacFrameIndices: frameIndices || null,
    stacBodyTransforms: bodyTransforms || null,
    stacRunning: false,
    stacProgress: 1.0,
  }),
  loadConfig: (config) => set({
    mappings: Object.entries(config.keypointModelPairs).map(([kp, body]) => ({ keypointName: kp, bodyName: body })),
    offsets: Object.entries(config.keypointInitialOffsets).map(([kp, [x, y, z]]) => ({ keypointName: kp, x, y, z })),
    scaleFactor: config.scaleFactor,
    mocapScaleFactor: config.mocapScaleFactor,
  }),
}));
