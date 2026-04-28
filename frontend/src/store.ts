import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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
  // Original basename of the uploaded XML, for producing a portable
  // MJCF_PATH on export (xmlPath may be a server-side /tmp path).
  xmlBasename: string | null;
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

  // Raw template from a loaded stac-mjx config — used on export to preserve
  // fields the UI doesn't manage (N_ITERS, ROOT_OPTIMIZATION_KEYPOINT, ...).
  rawTemplate: Record<string, unknown> | null;

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

  // Model opacity (0-1)
  modelOpacity: number;

  // Global controls visibility
  showGlobalControls: boolean;

  // Error visualization toggle
  showErrorLines: boolean;

  // Offset markers always-visible toggle
  showOffsetMarkers: boolean;
  setShowOffsetMarkers: (show: boolean) => void;

  // Segment scales (skeleton editor)
  segmentScales: Record<string, number>;
  adjustedPositions: Float32Array | null;
  hoveredSegment: string | null; // "parent→child" key

  // IK status message (inline, replaces alert popups)
  ikStatus: string | null;

  // Auto IK toggle
  autoIk: boolean;

  // Hover tooltip
  hoveredName: string | null;
  hoveredPosition: [number, number, number] | null;

  // Per-keypoint errors (transient, not persisted)
  perKeypointErrors: { keypointName: string; errorMm: number }[];
  setPerKeypointErrors: (errors: { keypointName: string; errorMm: number }[]) => void;

  // Follow camera
  followCamera: boolean;
  setFollowCamera: (follow: boolean) => void;

  // Actions
  setXmlData: (data: { geoms: GeomData[]; bodyNames: string[]; nq: number; xmlPath: string; xmlBasename?: string | null }) => void;
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
  setMocapScaleFactor: (scale: number) => void;
  setModelOpacity: (opacity: number) => void;
  setShowGlobalControls: (show: boolean) => void;
  setShowErrorLines: (show: boolean) => void;
  setSegmentScale: (key: string, value: number) => void;
  resetSegmentScales: () => void;
  setHoveredSegment: (key: string | null) => void;
  setAutoIk: (enabled: boolean) => void;
  setHover: (name: string | null, position?: [number, number, number]) => void;
  setIkStatus: (status: string | null) => void;
  setStacResults: (qpos: number[][], frameIndices?: number[], bodyTransforms?: BodyTransform[][]) => void;
  loadConfig: (config: {
    keypointModelPairs: Record<string, string>;
    keypointInitialOffsets: Record<string, [number, number, number]>;
    scaleFactor: number;
    mocapScaleFactor: number;
    _rawTemplate?: Record<string, unknown>;
  }) => void;
}

export const useStore = create<AppState>()(persist((set) => ({
  xmlPath: null,
  xmlBasename: null,
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
  rawTemplate: null,
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
  modelOpacity: 0.5,
  showGlobalControls: false,
  showErrorLines: false,
  showOffsetMarkers: true,
  segmentScales: {},
  adjustedPositions: null,
  hoveredSegment: null,
  ikStatus: null,
  autoIk: true,
  hoveredName: null,
  hoveredPosition: null,
  perKeypointErrors: [],
  setPerKeypointErrors: (errors) => set({ perKeypointErrors: errors }),
  followCamera: true,
  setFollowCamera: (follow) => set({ followCamera: follow }),

  setXmlData: (data) => set({
    geoms: data.geoms,
    bodyNames: data.bodyNames,
    nq: data.nq,
    xmlPath: data.xmlPath,
    xmlBasename: data.xmlBasename ?? null,
  }),
  setAcmData: (data) => set({
    acmKeypointNames: data.keypointNames,
    acmBones: data.bones,
    acmPositions: new Float32Array(data.positions),
    acmNumFrames: data.numFrames,
    acmNumKeypoints: data.numKeypoints,
    frameStatuses: new Array(data.numFrames).fill("unlabeled") as FrameStatus[],
    // Clear derived positions — they were computed from the OLD dataset
    adjustedPositions: null,
    alignedPositions: null,
    isAligned: false,
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
  setMocapScaleFactor: (scale) => set({ mocapScaleFactor: scale }),
  setModelOpacity: (opacity) => set({ modelOpacity: opacity }),
  setShowGlobalControls: (show) => set({ showGlobalControls: show }),
  setShowErrorLines: (show) => set({ showErrorLines: show }),
  setShowOffsetMarkers: (show) => set({ showOffsetMarkers: show }),
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
  resetSegmentScales: () => set({ segmentScales: {}, adjustedPositions: null }),
  setHoveredSegment: (key) => set({ hoveredSegment: key }),
  setAutoIk: (enabled) => set({ autoIk: enabled }),
  setHover: (name, position) => set({ hoveredName: name, hoveredPosition: position || null }),
  setIkStatus: (status) => set({ ikStatus: status }),
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
    rawTemplate: config._rawTemplate ?? null,
  }),
}), {
  name: "stac-retarget-ui-state",
  storage: createJSONStorage(() => localStorage),
  // Only persist settings that should survive refresh — NOT transient state
  partialize: (state) => ({
    // User's work
    mappings: state.mappings,
    offsets: state.offsets,
    segmentScales: state.segmentScales,
    rawTemplate: state.rawTemplate,
    // Model transform
    modelRotationY: state.modelRotationY,
    modelPosition: state.modelPosition,
    modelScale: state.modelScale,
    modelOpacity: state.modelOpacity,
    // Preferences
    showGlobalControls: state.showGlobalControls,
    showErrorLines: state.showErrorLines,
    showOffsetMarkers: state.showOffsetMarkers,
    autoIk: state.autoIk,
    followCamera: state.followCamera,
    mode: state.mode,
    // Scale factors
    scaleFactor: state.scaleFactor,
    mocapScaleFactor: state.mocapScaleFactor,
    // Current frame position
    currentFrame: state.currentFrame,
    // Labeled frames (convert Set to array for JSON)
    labeledFrames: Array.from(state.labeledFrames) as unknown as Set<number>,
    frameStatuses: state.frameStatuses,
  }),
  // Handle Set<number> deserialization
  merge: (persisted: any, current: AppState) => {
    const merged = { ...current, ...(persisted as Partial<AppState>) };
    // Restore Set from array
    if (persisted && Array.isArray((persisted as any).labeledFrames)) {
      merged.labeledFrames = new Set((persisted as any).labeledFrames);
    }
    return merged;
  },
}));
