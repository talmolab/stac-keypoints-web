import React, { useCallback } from "react";
import { useStore } from "../store";
import * as api from "../api";
import { runIk } from "../ikRunner";
import { validateMappings } from "../validation";

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

/** Trigger a browser download for a YAML document. */
function downloadYaml(body: string, filename: string) {
  const blob = new Blob([body], { type: "application/x-yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Toolbar() {
  const setXmlData = useStore((s) => s.setXmlData);
  const setAcmData = useStore((s) => s.setAcmData);
  const setAlignedPositions = useStore((s) => s.setAlignedPositions);
  const setBodyTransforms = useStore((s) => s.setBodyTransforms);
  const loadConfigAction = useStore((s) => s.loadConfig);
  const ikStatus = useStore((s) => s.ikStatus);
  const setIkStatus = useStore((s) => s.setIkStatus);

  const handleLoadXml = useCallback(async () => {
    const file = await pickFile(".xml");
    if (!file) return;
    const data = await api.uploadXml(file);
    if (data.error) { alert(data.error); return; }
    // Backend stored the upload in a temp file; track that path so subsequent
    // body-transform / align calls reuse the same model.
    setXmlData({
      geoms: data.geoms,
      bodyNames: data.bodyNames,
      nq: data.nq,
      xmlPath: data.xmlPath ?? file.name,
      xmlBasename: file.name,
    });
    const defaultQpos = new Array(data.nq).fill(0);
    defaultQpos[3] = 1.0;
    const transforms = await api.bodyTransforms(defaultQpos);
    setBodyTransforms(transforms);
  }, [setXmlData, setBodyTransforms]);

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
    const state = useStore.getState();
    if (!state.acmPositions || !state.xmlPath || state.mappings.length === 0) {
      setIkStatus("Load XML, ACM data, and set at least some mappings first.");
      return;
    }
    const pairs: Record<string, string> = {};
    for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
    const result = await api.alignToMujoco({
      positions: Array.from(state.acmPositions),
      numFrames: state.acmNumFrames,
      numKeypoints: state.acmNumKeypoints,
      keypointNames: state.acmKeypointNames,
      xmlPath: state.xmlPath,
      keypointModelPairs: pairs,
      scaleFactor: state.scaleFactor,
      mocapScaleFactor: state.mocapScaleFactor,
    });
    if (result.error) { setIkStatus("Align error: " + result.error); return; }
    setAlignedPositions(result.alignedPositions);
    setIkStatus("Alignment complete.");
  }, [setAlignedPositions, setIkStatus]);

  const handleExport = useCallback(async () => {
    const state = useStore.getState();

    const { errors, warnings } = validateMappings({
      mappings: state.mappings,
      bodyNames: state.bodyNames,
      acmKeypointNames: state.acmKeypointNames,
    });
    if (errors.length > 0) {
      setIkStatus(
        `Export blocked: ${errors.length} error(s). First: ${errors[0]}`,
      );
      return;
    }

    const pairs: Record<string, string> = {};
    for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
    const offsetMap: Record<string, [number, number, number]> = {};
    for (const o of state.offsets) offsetMap[o.keypointName] = [o.x, o.y, o.z];
    const config: Record<string, unknown> = {
      keypointModelPairs: pairs,
      keypointInitialOffsets: offsetMap,
      scaleFactor: state.scaleFactor,
      mocapScaleFactor: state.mocapScaleFactor,
      xmlPath: state.xmlPath || "",
      xmlBasename: state.xmlBasename,
      kpNames: state.acmKeypointNames,
      segmentScales: state.segmentScales,
    };
    if (state.rawTemplate) config._rawTemplate = state.rawTemplate;

    let mainBody: string;
    let sidecarBody: string | null;
    try {
      [mainBody, sidecarBody] = await Promise.all([
        api.exportConfig(config),
        api.exportUiSidecar(config),
      ]);
    } catch (e) {
      setIkStatus("Export error: " + (e as Error).message);
      return;
    }
    downloadYaml(mainBody, "stac_retarget_config.yaml");
    if (sidecarBody) {
      downloadYaml(sidecarBody, "stac_retarget_config.ui.yaml");
    }
    const base = sidecarBody
      ? "Config + UI sidecar downloaded."
      : "Config downloaded.";
    setIkStatus(
      warnings.length > 0
        ? `${base} ${warnings.length} warning(s): ${warnings[0]}`
        : base,
    );
  }, [setIkStatus]);

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

  return (
    <>
      <button style={btnStyle} onClick={handleLoadXml}>Load XML</button>
      <button style={btnStyle} onClick={handleLoadKeypoints}>Load KP</button>
      <button style={btnStyle} onClick={handleLoadMat}>Load .mat</button>
      <button style={btnStyle} onClick={handleLoadAcm}>Load ACM</button>
      <button style={btnStyle} onClick={handleLoadConfig}>Load Config</button>
      <button style={btnStyle} onClick={handleAlign}>Align</button>
      <button style={btnStyle} onClick={handleLoadStacOutput}>Load STAC H5</button>
      <button style={{...btnStyle, background: "#2a4a2a", border: "1px solid #4a4"}} onClick={handleRunIk}>Run IK</button>
      <button style={{...btnStyle, background: "#2a3a2a", border: "1px solid #4a4"}} onClick={handleRunIkFrame}>IK Frame</button>
      <button style={{...btnStyle, background: "#2a3a4a", border: "1px solid #4ac"}} onClick={handleRunIkSequence}>IK Sequence</button>
      <button style={btnStyle} onClick={handleExport}>Export</button>
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
