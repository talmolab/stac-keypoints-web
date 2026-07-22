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

// Backend serializes missing keypoints (NaN) as `null` because the JSON spec
// disallows the NaN literal. Restore as NaN here so downstream NaN-aware
// rendering and math (Number.isNaN checks) just work.
function nullsToNaNFloat32(arr: ReadonlyArray<number | null>): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    out[i] = v === null ? NaN : v;
  }
  return out;
}

interface AppState {
  // MuJoCo model
  xmlPath: string | null;
  // Original basename of the uploaded XML, for producing a portable
  // MJCF_PATH on export (xmlPath may be a server-side /tmp path).
  xmlBasename: string | null;
  // True iff the loaded model ships in-browser ACM demo data. Gates "Load ACM"
  // in standalone mode, where that's the only thing it can pull in.
  modelHasDemoData: boolean;
  geoms: GeomData[];
  bodyNames: string[];
  bodyTransforms: BodyTransform[];
  nq: number;
  currentQpos: number[] | null;

  // ACM data
  acmKeypointNames: string[];
  acmBones: Bone[];
  acmPositions: Float32Array | null;
  // Per-frame, per-keypoint tracker confidence (SLEAP `point_scores`),
  // flat (frames * numKp). NaN where the tracker reported nothing.
  acmConfidences: Float32Array | null;
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
  helpOpen: boolean;

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

  // Most recent single-frame IK solution. Survives mapping/offset edits so
  // subsequent auto-IK passes can warm-start instead of restarting from
  // default pose + Procrustes. Cleared on XML reload (qpos length may change).
  liveQpos: number[] | null;

  // The frame index `liveQpos` was solved for. Warm-start is only valid when
  // re-solving that same frame (an edit); on a frame change (a scrub) the seed
  // is stale and auto-IK must cold-start so the per-frame trunk Procrustes
  // re-seeds the root. null = unknown frame ⇒ never warm-start.
  liveQposFrame: number | null;

  // Model rotation (Y-axis in Three.js = yaw)
  modelRotationY: number;

  // Model position offset [x, y, z]
  modelPosition: [number, number, number];

  // Model scale (uniform)
  modelScale: number;

  // Model opacity (0-1)
  modelOpacity: number;

  // Marker size multiplier (UI sphere radii are bbox-derived; this is a
  // user-facing tweak on top). 1.0 = derived default; range 0.1–5.0.
  markerSize: number;

  // Global controls visibility
  showGlobalControls: boolean;

  // Error visualization toggle
  showErrorLines: boolean;

  // Tint ACM keypoint markers by error magnitude (independent of showErrorLines).
  colorByError: boolean;
  setColorByError: (enabled: boolean) => void;

  // Offset markers always-visible toggle
  showOffsetMarkers: boolean;
  setShowOffsetMarkers: (show: boolean) => void;

  // Segment scales (skeleton editor)
  segmentScales: Record<string, number>;
  adjustedPositions: Float32Array | null;
  hoveredSegment: string | null; // "parent→child" key

  // IK status message (inline, replaces alert popups)
  ikStatus: string | null;

  // IK Sequence progress + cooperative cancellation (transient, not persisted).
  // ikRunning gates the progress UI; ikProgress drives the bar; the chunked
  // solver loop polls ikCancelRequested between frames and stops early.
  ikRunning: boolean;
  ikProgress: { current: number; total: number } | null;
  ikCancelRequested: boolean;

  // Auto IK toggle
  autoIk: boolean;

  // Hover tooltip
  hoveredName: string | null;
  hoveredPosition: [number, number, number] | null;

  // Per-keypoint errors (transient, not persisted)
  perKeypointErrors: { keypointName: string; errorMm: number }[];
  setPerKeypointErrors: (errors: { keypointName: string; errorMm: number }[]) => void;

  // Undo/redo for mapping work (mappings + offsets). Capped at 50 entries
  // each. Session-only — not partialized into localStorage.
  _undoStack: { mappings: KPMapping[]; offsets: KPOffset[] }[];
  _redoStack: { mappings: KPMapping[]; offsets: KPOffset[] }[];
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // Follow camera
  followCamera: boolean;
  setFollowCamera: (follow: boolean) => void;

  // Actions
  setXmlData: (data: { geoms: GeomData[]; bodyNames: string[]; nq: number; xmlPath: string; xmlBasename?: string | null; hasDemoData?: boolean }) => void;
  setAcmData: (data: { keypointNames: string[]; bones: Bone[]; positions: ReadonlyArray<number | null>; numFrames: number; numKeypoints: number; confidences?: ReadonlyArray<number | null> }) => void;
  clearAcmData: () => void;
  setAlignedPositions: (positions: ReadonlyArray<number | null>) => void;
  setCurrentFrame: (frame: number) => void;
  setMode: (mode: InteractionMode) => void;
  setSelectedKeypoint: (name: string | null) => void;
  setSelectedBody: (name: string | null) => void;
  setHelpOpen: (open: boolean) => void;
  toggleHelp: () => void;
  addMapping: (kp: string, body: string) => void;
  setMappingsBulk: (pairs: Record<string, string>) => void;
  removeMapping: (kp: string) => void;
  updateOffset: (kp: string, x: number, y: number, z: number) => void;
  setOffsetsBulk: (offsets: Record<string, [number, number, number]>) => void;
  togglePlay: () => void;
  labelCurrentFrame: () => void;
  setBodyTransforms: (transforms: BodyTransform[]) => void;
  setModelRotationY: (radians: number) => void;
  setModelPosition: (pos: [number, number, number]) => void;
  setModelScale: (scale: number) => void;
  setMocapScaleFactor: (scale: number) => void;
  setModelOpacity: (opacity: number) => void;
  setMarkerSize: (size: number) => void;
  setShowGlobalControls: (show: boolean) => void;
  setShowErrorLines: (show: boolean) => void;
  setSegmentScale: (key: string, value: number) => void;
  resetSegmentScales: () => void;
  setHoveredSegment: (key: string | null) => void;
  setAutoIk: (enabled: boolean) => void;
  setHover: (name: string | null, position?: [number, number, number]) => void;
  setIkStatus: (status: string | null) => void;
  setIkRunning: (running: boolean) => void;
  setIkProgress: (progress: { current: number; total: number } | null) => void;
  requestIkCancel: () => void;
  resetIkCancel: () => void;
  setStacResults: (qpos: number[][], frameIndices?: number[], bodyTransforms?: BodyTransform[][]) => void;
  setLiveQpos: (qpos: number[] | null, frame?: number | null) => void;
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
  modelHasDemoData: false,
  geoms: [],
  bodyNames: [],
  bodyTransforms: [],
  nq: 0,
  currentQpos: null,
  acmKeypointNames: [],
  acmBones: [],
  acmPositions: null,
  acmConfidences: null,
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
  helpOpen: false,
  currentFrame: 0,
  isPlaying: false,
  frameStatuses: [],
  labeledFrames: new Set(),
  stacQpos: null,
  stacFrameIndices: null,
  stacBodyTransforms: null,
  stacRunning: false,
  stacProgress: 0,
  liveQpos: null,
  liveQposFrame: null,
  modelRotationY: 0,
  modelPosition: [0, 0, 0] as [number, number, number],
  modelScale: 1.0,
  modelOpacity: 0.5,
  markerSize: 1.0,
  showGlobalControls: false,
  showErrorLines: false,
  colorByError: false,
  setColorByError: (enabled) => set({ colorByError: enabled }),
  showOffsetMarkers: true,
  segmentScales: {},
  adjustedPositions: null,
  hoveredSegment: null,
  ikStatus: null,
  ikRunning: false,
  ikProgress: null,
  ikCancelRequested: false,
  autoIk: true,
  hoveredName: null,
  hoveredPosition: null,
  perKeypointErrors: [],
  setPerKeypointErrors: (errors) => set({ perKeypointErrors: errors }),

  _undoStack: [],
  _redoStack: [],
  pushHistory: () => set((state) => ({
    _undoStack: [...state._undoStack, { mappings: state.mappings, offsets: state.offsets }].slice(-50),
    _redoStack: [],
  })),
  undo: () => set((state) => {
    if (state._undoStack.length === 0) return {};
    const snap = state._undoStack[state._undoStack.length - 1];
    return {
      mappings: snap.mappings,
      offsets: snap.offsets,
      _undoStack: state._undoStack.slice(0, -1),
      _redoStack: [...state._redoStack, { mappings: state.mappings, offsets: state.offsets }].slice(-50),
    };
  }),
  redo: () => set((state) => {
    if (state._redoStack.length === 0) return {};
    const snap = state._redoStack[state._redoStack.length - 1];
    return {
      mappings: snap.mappings,
      offsets: snap.offsets,
      _redoStack: state._redoStack.slice(0, -1),
      _undoStack: [...state._undoStack, { mappings: state.mappings, offsets: state.offsets }].slice(-50),
    };
  }),
  followCamera: true,
  setFollowCamera: (follow) => set({ followCamera: follow }),

  setXmlData: (data) => set({
    geoms: data.geoms,
    bodyNames: data.bodyNames,
    nq: data.nq,
    xmlPath: data.xmlPath,
    xmlBasename: data.xmlBasename ?? null,
    modelHasDemoData: data.hasDemoData ?? false,
    // qpos length is model-dependent — any prior warm-start is invalid.
    liveQpos: null,
    liveQposFrame: null,
    // Model view-transform is per-model: a rotation/scale/offset tuned for one
    // species is meaningless for the next. Reset on every model load so a
    // value set (or persisted) for the rat doesn't silently apply to the fly.
    modelRotationY: 0,
    modelPosition: [0, 0, 0] as [number, number, number],
    modelScale: 1.0,
  }),
  setAcmData: (data) => set({
    acmKeypointNames: data.keypointNames,
    acmBones: data.bones,
    acmPositions: nullsToNaNFloat32(data.positions),
    acmConfidences: data.confidences ? nullsToNaNFloat32(data.confidences) : null,
    acmNumFrames: data.numFrames,
    acmNumKeypoints: data.numKeypoints,
    frameStatuses: new Array(data.numFrames).fill("unlabeled") as FrameStatus[],
    // Clear derived positions — they were computed from the OLD dataset
    adjustedPositions: null,
    alignedPositions: null,
    isAligned: false,
  }),
  // Drop the loaded keypoint clip and everything derived from it (alignment,
  // IK caches, warm-start, per-frame state). Used when switching model presets
  // so a previous species' markers + animation don't linger over the new
  // model. Deliberately does NOT touch mappings/offsets/scaleFactor — the
  // preset's own config has just set those.
  clearAcmData: () => set({
    acmKeypointNames: [],
    acmBones: [],
    acmPositions: null,
    acmConfidences: null,
    acmNumFrames: 0,
    acmNumKeypoints: 0,
    frameStatuses: [],
    labeledFrames: new Set(),
    adjustedPositions: null,
    alignedPositions: null,
    isAligned: false,
    stacQpos: null,
    stacFrameIndices: null,
    stacBodyTransforms: null,
    liveQpos: null,
    liveQposFrame: null,
    perKeypointErrors: [],
    currentFrame: 0,
  }),
  setAlignedPositions: (positions) => set({ alignedPositions: nullsToNaNFloat32(positions), isAligned: true }),
  setCurrentFrame: (frame) => set({ currentFrame: frame }),
  setMode: (mode) => set({ mode }),
  setSelectedKeypoint: (name) => set({ selectedKeypoint: name }),
  setSelectedBody: (name) => set({ selectedBody: name }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  addMapping: (kp, body) => set((state) => {
    const filtered = state.mappings.filter((m) => m.keypointName !== kp);
    return {
      mappings: [...filtered, { keypointName: kp, bodyName: body }],
      _undoStack: [...state._undoStack, { mappings: state.mappings, offsets: state.offsets }].slice(-50),
      _redoStack: [],
      // Any cached multi-frame IK result is now stale; auto-IK only refits
      // the current frame, so per-frame transforms from a previous "Run IK"
      // would otherwise mislead scrubbing.
      stacQpos: null,
      stacFrameIndices: null,
      stacBodyTransforms: null,
    };
  }),
  removeMapping: (kp) => set((state) => ({
    mappings: state.mappings.filter((m) => m.keypointName !== kp),
    _undoStack: [...state._undoStack, { mappings: state.mappings, offsets: state.offsets }].slice(-50),
    _redoStack: [],
    stacQpos: null,
    stacFrameIndices: null,
    stacBodyTransforms: null,
  })),
  updateOffset: (kp, x, y, z) => set((state) => {
    const filtered = state.offsets.filter((o) => o.keypointName !== kp);
    return {
      offsets: [...filtered, { keypointName: kp, x, y, z }],
      stacQpos: null,
      stacFrameIndices: null,
      stacBodyTransforms: null,
    };
  }),
  setOffsetsBulk: (bulk) => set((state) => {
    // Preserve any existing offsets for keypoints not present in `bulk`.
    // Single set + single history snapshot — avoids the 30-render storm
    // that mapping `updateOffset` over the dict would cause.
    const carried = state.offsets.filter((o) => !(o.keypointName in bulk));
    const incoming = Object.entries(bulk).map(([kp, [x, y, z]]) => ({
      keypointName: kp, x, y, z,
    }));
    return {
      offsets: [...carried, ...incoming],
      _undoStack: [...state._undoStack, { mappings: state.mappings, offsets: state.offsets }].slice(-50),
      _redoStack: [],
      stacQpos: null,
      stacFrameIndices: null,
      stacBodyTransforms: null,
    };
  }),
  setMappingsBulk: (pairs) => set((state) => ({
    // Replace the mapping set wholesale from an authoritative source (e.g. the
    // KEYPOINT_MODEL_PAIRS embedded in an imported STAC output). Single set +
    // one history snapshot; stale multi-frame IK is invalidated like addMapping.
    mappings: Object.entries(pairs).map(([kp, body]) => ({ keypointName: kp, bodyName: body })),
    _undoStack: [...state._undoStack, { mappings: state.mappings, offsets: state.offsets }].slice(-50),
    _redoStack: [],
    stacQpos: null,
    stacFrameIndices: null,
    stacBodyTransforms: null,
  })),
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
  // Changing modelScale changes the IK targets (they're divided by it), so the
  // cached warm-start pose is stale. Clear it to force the next auto-IK pass to
  // cold-start and re-seed the root via trunk Procrustes — joints-only warm
  // refinement can't recover the root after a big scale jump.
  setModelScale: (scale) => set({ modelScale: scale, liveQpos: null, liveQposFrame: null }),
  setMocapScaleFactor: (scale) => set({ mocapScaleFactor: scale }),
  setModelOpacity: (opacity) => set({ modelOpacity: opacity }),
  setMarkerSize: (size) => set({ markerSize: size }),
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
  setIkRunning: (running) => set({ ikRunning: running }),
  setIkProgress: (progress) => set({ ikProgress: progress }),
  requestIkCancel: () => set({ ikCancelRequested: true }),
  resetIkCancel: () => set({ ikCancelRequested: false }),
  setStacResults: (qpos, frameIndices, bodyTransforms) => set({
    stacQpos: qpos,
    stacFrameIndices: frameIndices || null,
    stacBodyTransforms: bodyTransforms || null,
    stacRunning: false,
    stacProgress: 1.0,
  }),
  setLiveQpos: (qpos, frame = null) => set({ liveQpos: qpos, liveQposFrame: frame }),
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
    // Model view-transform (rotation/position/scale) is intentionally NOT
    // persisted — it's per-model and reset on every load by setXmlData, so
    // persisting it would just flash a stale value before the reset.
    modelOpacity: state.modelOpacity,
    markerSize: state.markerSize,
    // Preferences
    showGlobalControls: state.showGlobalControls,
    showErrorLines: state.showErrorLines,
    showOffsetMarkers: state.showOffsetMarkers,
    colorByError: state.colorByError,
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
