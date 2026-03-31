import React, { useCallback } from "react";
import { useStore } from "../store";
import * as api from "../api";
import { runIk } from "../ikRunner";

export default function Toolbar() {
  const setXmlData = useStore((s) => s.setXmlData);
  const setAcmData = useStore((s) => s.setAcmData);
  const setAlignedPositions = useStore((s) => s.setAlignedPositions);
  const setBodyTransforms = useStore((s) => s.setBodyTransforms);
  const loadConfigAction = useStore((s) => s.loadConfig);
  const ikStatus = useStore((s) => s.ikStatus);
  const setIkStatus = useStore((s) => s.setIkStatus);

  const handleLoadXml = useCallback(async () => {
    const path = prompt("Enter path to MuJoCo XML file:",
      "/home/talmolab/Desktop/SalkResearch/stac-mjx/models/rodent_relaxed.xml");
    if (!path) return;
    const data = await api.loadXml(path);
    if (data.error) { alert(data.error); return; }
    setXmlData({ geoms: data.geoms, bodyNames: data.bodyNames, nq: data.nq, xmlPath: path });
    const defaultQpos = new Array(data.nq).fill(0);
    defaultQpos[3] = 1.0;
    const transforms = await api.bodyTransforms(defaultQpos);
    setBodyTransforms(transforms);
  }, [setXmlData, setBodyTransforms]);

  const handleLoadAcm = useCallback(async () => {
    const choice = prompt("Enter a .mat file path, or number of trials to auto-load:", "5");
    if (!choice) return;
    let data;
    if (choice.endsWith(".mat")) {
      data = await api.loadMatFile(choice);
    } else {
      data = await api.loadAcmTrials(parseInt(choice) || 5);
    }
    if (data.error) { alert(data.error); return; }
    setAcmData(data);
  }, [setAcmData]);

  const handleLoadConfig = useCallback(async () => {
    const path = prompt("Enter path to STAC YAML config:",
      "/home/talmolab/Desktop/SalkResearch/monsees-retarget/configs/stac_rodent_acm.yaml");
    if (!path) return;
    const config = await api.loadConfig(path);
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
    const pairs: Record<string, string> = {};
    for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
    const offsetMap: Record<string, [number, number, number]> = {};
    for (const o of state.offsets) offsetMap[o.keypointName] = [o.x, o.y, o.z];
    const config = {
      keypointModelPairs: pairs,
      keypointInitialOffsets: offsetMap,
      scaleFactor: state.scaleFactor,
      mocapScaleFactor: state.mocapScaleFactor,
      xmlPath: state.xmlPath || "",
      kpNames: state.acmKeypointNames,
      segmentScales: state.segmentScales,
    };
    const path = prompt("Export config to:", "/tmp/stac_retarget_config.yaml");
    if (!path) return;
    const result = await api.exportConfig(config, path);
    if (result.error) setIkStatus("Export error: " + result.error);
    else setIkStatus("Config exported to " + result.path);
  }, [setIkStatus]);

  const handleLoadStacOutput = useCallback(async () => {
    const path = prompt("Enter path to STAC output H5:",
      "/home/talmolab/Desktop/SalkResearch/monsees-retarget/output/monsees_ik_only.h5");
    if (!path) return;
    setIkStatus("Loading STAC H5...");
    const data = await api.loadStacOutput(path);
    if (data.error) { setIkStatus("Load error: " + data.error); return; }

    // Load learned offsets
    const updateOffset = useStore.getState().updateOffset;
    for (let i = 0; i < data.kpNames.length; i++) {
      const name = data.kpNames[i];
      const [x, y, z] = data.offsets[i];
      updateOffset(name, x, y, z);
    }

    // Compute body transforms for all frames (batch via qpos)
    setIkStatus(`Loading poses: ${data.qpos.length} frames...`);
    const allTransforms: any[][] = [];
    const frameIndices: number[] = [];
    // Compute transforms for every frame (batch in chunks for speed)
    const batchSize = 50;
    for (let start = 0; start < data.qpos.length; start += batchSize) {
      const end = Math.min(start + batchSize, data.qpos.length);
      for (let i = start; i < end; i++) {
        const transforms = await api.bodyTransforms(data.qpos[i]);
        if (Array.isArray(transforms)) {
          allTransforms.push(transforms);
          frameIndices.push(i);
        }
      }
      setIkStatus(`Loading poses: ${Math.min(end, data.qpos.length)}/${data.qpos.length}...`);
    }

    // Store results for timeline scrubbing
    useStore.getState().setStacResults(data.qpos, frameIndices, allTransforms);

    // Apply first frame
    if (allTransforms.length > 0) {
      setBodyTransforms(allTransforms[0]);
    }

    setIkStatus(`Loaded STAC: ${data.qpos.length} frames, ${data.kpNames.length} keypoints with offsets`);
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
