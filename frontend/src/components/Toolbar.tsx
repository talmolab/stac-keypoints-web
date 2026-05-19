import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import * as api from "../api";
import { runIk } from "../ikRunner";
import { runAlignment, formatAlignStatus } from "../alignment";
import { runExport } from "../exportConfig";
import { runQualityReportExport } from "../qualityReport";

/** Open a transient native file picker and resolve with the chosen File. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Multi-file picker — used for XML uploads where mesh assets accompany
 *  the model. Accepts either a folder selection (webkitdirectory) or a
 *  multi-select of explicit files. */
function pickFiles(accept: string, asDirectory: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (asDirectory) {
      // webkitdirectory is non-standard but supported in Chromium + Firefox.
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    } else {
      input.multiple = true;
      input.accept = accept;
    }
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export default function Toolbar() {
  const setXmlData = useStore((s) => s.setXmlData);
  const setAcmData = useStore((s) => s.setAcmData);
  const setBodyTransforms = useStore((s) => s.setBodyTransforms);
  const loadConfigAction = useStore((s) => s.loadConfig);
  const ikStatus = useStore((s) => s.ikStatus);
  const setIkStatus = useStore((s) => s.setIkStatus);

  const finishXmlLoad = useCallback(async (
    data: any, fallbackPath: string, fallbackBasename: string,
  ) => {
    if (data.error) { alert(data.error); return; }
    setXmlData({
      geoms: data.geoms,
      bodyNames: data.bodyNames,
      nq: data.nq,
      xmlPath: data.xmlPath ?? fallbackPath,
      xmlBasename: fallbackBasename,
    });
    const defaultQpos = new Array(data.nq).fill(0);
    defaultQpos[3] = 1.0;
    const transforms = await api.bodyTransforms(defaultQpos);
    setBodyTransforms(transforms);
  }, [setXmlData, setBodyTransforms]);

  const handleLoadXml = useCallback(async () => {
    const file = await pickFile(".xml");
    if (!file) return;
    // Backend stored the upload in a temp file; track that path so subsequent
    // body-transform / align calls reuse the same model.
    const data = await api.uploadXml(file);
    if (data.error && /mesh|asset|folder/i.test(data.error)) {
      // Standalone mode flagged missing meshes — re-prompt for the model dir.
      setIkStatus("XML references mesh files. Pick the model's folder…");
      const files = await pickFiles(".xml", true);
      if (files.length === 0) { setIkStatus("Load cancelled."); return; }
      const data2 = await api.uploadXml(files);
      await finishXmlLoad(data2, file.name, file.name);
      if (data2.preprocessReport) {
        const r = data2.preprocessReport;
        setIkStatus(`Loaded ${file.name} (preprocessed ${r.nReplaced} mesh geom(s) → ${r.nCapsule} capsule, ${r.nSphere} sphere).`);
      }
      return;
    }
    await finishXmlLoad(data, file.name, file.name);
  }, [finishXmlLoad, setIkStatus]);

  const handleLoadXmlFolder = useCallback(async () => {
    const files = await pickFiles(".xml", true);
    if (files.length === 0) return;
    const xmlFile = files.find((f) => f.name.toLowerCase().endsWith(".xml"));
    if (!xmlFile) { setIkStatus("No .xml file in selected folder."); return; }
    setIkStatus("Preprocessing meshful XML…");
    const data = await api.uploadXml(files);
    await finishXmlLoad(data, xmlFile.name, xmlFile.name);
    if (data.preprocessReport) {
      const r = data.preprocessReport;
      setIkStatus(`Loaded ${xmlFile.name} (preprocessed ${r.nReplaced} mesh geom(s) → ${r.nCapsule} capsule, ${r.nSphere} sphere).`);
    }
  }, [finishXmlLoad, setIkStatus]);

  // Path-based load. Needed for models whose XML references external assets
  // by relative path (most non-rat models pull in mesh OBJs from `assets/`),
  // since file uploads land in /tmp where those relative paths don't resolve.
  // If `configPath` is supplied (bundled species), the per-species config
  // (mappings, offsets, mocapScaleFactor) is loaded right after the XML so
  // switching species replaces stale mappings instead of stacking them on
  // top of whatever the previous species left in the store.
  const loadByPath = useCallback(async (path: string, configPath?: string) => {
    if (!path) return;
    const data = await api.loadXml(path);
    if (!data.error) localStorage.setItem("stac.lastXmlPath", path);
    const basename = path.split("/").pop() || path;
    await finishXmlLoad(data, path, basename);
    if (configPath) {
      const cfg = await api.loadConfig(configPath);
      if (!cfg.error) loadConfigAction(cfg);
    }
  }, [finishXmlLoad, loadConfigAction]);

  // Discovered XMLs from the backend's configured search roots — populates
  // the "Load preset" dropdown so users don't have to type absolute paths.
  const [xmlPresets, setXmlPresets] = useState<api.XmlPreset[]>([]);
  useEffect(() => {
    api.listXmls().then(setXmlPresets).catch(() => setXmlPresets([]));
  }, []);

  const handlePresetChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    e.target.value = "";  // reset so re-selecting the same item still fires
    if (!value) return;
    if (value === "__custom__") {
      const last = localStorage.getItem("stac.lastXmlPath") || "";
      const path = prompt("Absolute server-side path to MuJoCo XML:", last);
      if (path) await loadByPath(path);
      return;
    }
    const preset = xmlPresets.find((p) => p.path === value);
    await loadByPath(value, preset?.configPath);
  }, [loadByPath, xmlPresets]);

  const handleLoadMat = useCallback(async () => {
    const file = await pickFile(".mat");
    if (!file) return;
    const data = await api.uploadMatFile(file);
    if (data.error) { alert(data.error); return; }
    setAcmData(data);
  }, [setAcmData]);

  const handleLoadKeypoints = useCallback(async () => {
    const file = await pickFile(".h5,.mat");
    if (!file) return;
    // If a config is already loaded, reuse its kpNames so the keypoints get
    // labeled. Otherwise the backend falls back to kp_0, kp_1, ...
    const kpNames = useStore.getState().acmKeypointNames;
    const data = await api.uploadKeypoints(file, kpNames);
    if (data.error) { alert(data.error); return; }
    setAcmData(data);
  }, [setAcmData]);

  const handleLoadAcm = useCallback(async () => {
    const choice = prompt("Number of ACM trials to auto-load:", "5");
    if (!choice) return;
    const data = await api.loadAcmTrials(parseInt(choice) || 5);
    if (data.error) { alert(data.error); return; }
    setAcmData(data);
  }, [setAcmData]);

  const handleLoadConfig = useCallback(async () => {
    const file = await pickFile(".yaml,.yml");
    if (!file) return;
    const config = await api.uploadConfig(file);
    if (config.error) { alert(config.error); return; }
    loadConfigAction(config);
  }, [loadConfigAction]);

  const handleAlign = useCallback(async () => {
    const outcome = await runAlignment();
    setIkStatus(formatAlignStatus(outcome));
  }, [setIkStatus]);

  const handleExport = useCallback(() => { runExport(); }, []);
  const handleExportAs = useCallback(() => { runExport({ forcePicker: true }); }, []);
  const handleQualityReport = useCallback(() => { runQualityReportExport(); }, []);

  const handleLoadStacOutput = useCallback(async () => {
    const file = await pickFile(".h5");
    if (!file) return;
    setIkStatus("Uploading STAC H5...");
    const data = await api.uploadStacOutput(file);
    if (data.error) { setIkStatus("Load error: " + data.error); return; }

    // Load learned offsets
    const state = useStore.getState();
    for (let i = 0; i < data.kpNames.length; i++) {
      const name = data.kpNames[i];
      const [x, y, z] = data.offsets[i];
      state.updateOffset(name, x, y, z);
    }

    // Replace ACM keypoints with the actual STAC target positions (kp_data)
    // so the reference trajectory aligns with the STAC poses
    if (data.stacTargets) {
      const targets = data.stacTargets;
      setIkStatus(`Syncing ${targets.numFrames} STAC target frames...`);

      const state2 = useStore.getState();
      const bones = state2.acmBones.length > 0 ? state2.acmBones : [];

      // Reset skeleton editor — STAC targets are already in the correct frame
      useStore.getState().resetSegmentScales();

      // setAcmData now clears adjustedPositions & alignedPositions
      setAcmData({
        keypointNames: data.kpNames,
        bones,
        positions: targets.positions,
        numFrames: targets.numFrames,
        numKeypoints: targets.numKeypoints,
      });

      // Set aligned positions (STAC targets are already aligned)
      useStore.getState().setAlignedPositions(targets.positions);
    }

    // Batch compute body transforms for all frames in ONE request
    setIkStatus(`Computing poses for ${data.qpos.length} frames...`);
    const allTransforms = await api.batchBodyTransforms(data.qpos);
    if (!Array.isArray(allTransforms)) {
      setIkStatus("Error computing poses: " + (allTransforms?.error || "unknown"));
      return;
    }
    const frameIndices = Array.from({ length: data.qpos.length }, (_, i) => i);

    // Store results for timeline scrubbing
    useStore.getState().setStacResults(data.qpos, frameIndices, allTransforms);

    // Apply first frame
    if (allTransforms.length > 0) {
      setBodyTransforms(allTransforms[0]);
    }

    // Reset model transform — STAC output is already in the correct frame
    useStore.getState().setModelPosition([0, 0, 0]);
    useStore.getState().setModelRotationY(0);
    useStore.getState().setModelScale(1.0);

    setIkStatus(`Loaded STAC: ${data.qpos.length} frames, ${data.kpNames.length} kps, targets synced`);
  }, [setIkStatus, setBodyTransforms]);

  const runIkOnFrames = useCallback(async (frameIndices: number[], maxIterations = 200) => {
    await runIk(frameIndices, maxIterations);
  }, []);

  const handleRunIk = useCallback(async () => {
    const state = useStore.getState();
    const labeledFrames = Array.from(state.labeledFrames);
    const frames = labeledFrames.length > 0 ? labeledFrames : [state.currentFrame];
    setIkStatus("Running IK on " + frames.length + " labeled frames...");
    await runIkOnFrames(frames);
  }, [runIkOnFrames, setIkStatus]);

  const handleRunIkFrame = useCallback(async () => {
    const state = useStore.getState();
    setIkStatus("Running IK on frame " + state.currentFrame + "...");
    await runIkOnFrames([state.currentFrame]);
  }, [runIkOnFrames, setIkStatus]);

  const handleRunIkSequence = useCallback(async () => {
    const state = useStore.getState();
    if (!state.acmPositions || !state.xmlPath) {
      setIkStatus("Load XML and ACM data first.");
      return;
    }
    const numFrames = state.acmNumFrames;
    if (numFrames === 0) {
      setIkStatus("No frames available.");
      return;
    }
    const allFrames = Array.from({ length: numFrames }, (_, i) => i);
    setIkStatus("Running IK on " + numFrames + " frames...");
    // Use fewer iterations for sequence mode (speed)
    await runIkOnFrames(allFrames, 50);
  }, [runIkOnFrames, setIkStatus]);

  const handleRefitOffsets = useCallback(async () => {
    const state = useStore.getState();
    if (!state.acmPositions || !state.xmlPath) {
      setIkStatus("Load XML and ACM data first.");
      return;
    }
    const labeled = Array.from(state.labeledFrames).sort((a, b) => a - b);
    if (labeled.length === 0) {
      setIkStatus("Label at least one frame first (Label button on the timeline).");
      return;
    }
    if (!state.stacQpos || !state.stacFrameIndices) {
      setIkStatus("Run IK first — Refit Offsets needs solved poses for the labeled frames.");
      return;
    }
    // Align labeled frames with their solved qposes from the last Run IK.
    // If a labeled frame isn't in the last result (user labeled it after
    // the run), surface a clear "re-run IK" hint rather than silently
    // ignoring it.
    const idxMap: Record<number, number> = {};
    state.stacFrameIndices.forEach((f, i) => { idxMap[f] = i; });
    const usableFrames: number[] = [];
    const usableQposes: number[][] = [];
    for (const f of labeled) {
      const i = idxMap[f];
      if (i === undefined) continue;
      usableFrames.push(f);
      usableQposes.push(state.stacQpos[i]);
    }
    if (usableFrames.length === 0) {
      setIkStatus("Labeled frames don't match the last IK result — re-run IK then try again.");
      return;
    }

    const pairs: Record<string, string> = {};
    for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
    if (Object.keys(pairs).length === 0) {
      setIkStatus("Map at least one keypoint first.");
      return;
    }
    const offsetMap: Record<string, [number, number, number]> = {};
    for (const o of state.offsets) offsetMap[o.keypointName] = [o.x, o.y, o.z];
    const positions = state.adjustedPositions ?? state.alignedPositions ?? state.acmPositions;

    setIkStatus(`Refitting offsets on ${usableFrames.length} labeled frame(s)...`);
    const result = await api.refitOffsets({
      positions: Array.from(positions),
      numFrames: state.acmNumFrames,
      numKeypoints: state.acmNumKeypoints,
      keypointNames: state.acmKeypointNames,
      xmlPath: state.xmlPath,
      frameIndices: usableFrames,
      qposesPerFrame: usableQposes,
      mappings: pairs,
      offsets: offsetMap,
      mocapScaleFactor: state.mocapScaleFactor,
    });
    if (result.error) {
      setIkStatus("Refit error: " + result.error);
      return;
    }
    if (!result.offsets || Object.keys(result.offsets).length === 0) {
      setIkStatus("Refit produced no offsets (no usable frames).");
      return;
    }
    state.setOffsetsBulk(result.offsets);
    const errMm = (result.error * 1000).toFixed(1);
    setIkStatus(`Refit: ${Object.keys(result.offsets).length} kp on ${result.frameIndicesUsed.length}f, err ${errMm}mm`);
  }, [setIkStatus]);

  return (
    <>
      <button style={btnStyle} onClick={handleLoadXml}>Load XML</button>
      <button
        style={btnStyle}
        onClick={handleLoadXmlFolder}
        title="Pick a model folder (XML + .obj/.stl meshes). Meshes are baked into capsules client-side."
      >Load XML folder…</button>
      <select
        onChange={handlePresetChange}
        defaultValue=""
        title="Load a discovered XML by path (needed for models with external mesh assets)"
        style={{ ...btnStyle, padding: "4px 6px" }}
      >
        <option value="" disabled>Load preset…</option>
        {xmlPresets.map((p) => (
          <option key={p.path} value={p.path}>{p.name}</option>
        ))}
        <option value="__custom__">Custom path…</option>
      </select>
      <button style={btnStyle} onClick={handleLoadKeypoints}>Load KP</button>
      <button style={btnStyle} onClick={handleLoadMat}>Load .mat</button>
      <button style={btnStyle} onClick={handleLoadAcm}>Load ACM</button>
      <button style={btnStyle} onClick={handleLoadConfig}>Load Config</button>
      <button style={btnStyle} onClick={handleAlign}>Align</button>
      <button style={btnStyle} onClick={handleLoadStacOutput}>Load STAC H5</button>
      <button style={{...btnStyle, background: "#2a4a2a", border: "1px solid #4a4"}} onClick={handleRunIk}>Run IK</button>
      <button style={{...btnStyle, background: "#2a3a2a", border: "1px solid #4a4"}} onClick={handleRunIkFrame}>IK Frame</button>
      <button style={{...btnStyle, background: "#2a3a4a", border: "1px solid #4ac"}} onClick={handleRunIkSequence}>IK Sequence</button>
      <button
        style={{...btnStyle, background: "#3a2a4a", border: "1px solid #84c"}}
        onClick={handleRefitOffsets}
        title="Closed-form marker-offset solve over labeled frames (StacCore.m_opt). Needs a prior Run IK so each labeled frame has a solved pose."
      >
        Refit Offsets
      </button>
      <button style={btnStyle} onClick={handleExport} title="Cmd/Ctrl-S — re-saves to the file you picked first">Export</button>
      <button style={btnStyle} onClick={handleExportAs} title="Cmd/Ctrl-Shift-S — choose a new location">Save As…</button>
      <button style={btnStyle} onClick={handleQualityReport} title="Per-keypoint gap %, confidence histogram, error">Quality Report</button>
      {ikStatus && (
        <span
          style={statusStyle}
          onClick={() => setIkStatus(null)}
          title="Click to dismiss"
        >
          {ikStatus}
        </span>
      )}
    </>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#2a2a4a", border: "1px solid #555", color: "#ccc",
  padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 12,
};

const statusStyle: React.CSSProperties = {
  color: "#8f8", fontSize: 12, marginLeft: 8, cursor: "pointer",
  padding: "4px 8px", background: "#1a2a1a", borderRadius: 4,
  border: "1px solid #3a5a3a",
};
