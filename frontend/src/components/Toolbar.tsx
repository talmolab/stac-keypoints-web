import React, { useCallback } from "react";
import { useStore } from "../store";
import * as api from "../api";

export default function Toolbar() {
  const setXmlData = useStore((s) => s.setXmlData);
  const setAcmData = useStore((s) => s.setAcmData);
  const setAlignedPositions = useStore((s) => s.setAlignedPositions);
  const setBodyTransforms = useStore((s) => s.setBodyTransforms);
  const loadConfigAction = useStore((s) => s.loadConfig);

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
      alert("Load XML, ACM data, and set at least some mappings first.");
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
    if (result.error) { alert(result.error); return; }
    setAlignedPositions(result.alignedPositions);
  }, [setAlignedPositions]);

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
    };
    const path = prompt("Export config to:", "/tmp/stac_retarget_config.yaml");
    if (!path) return;
    const result = await api.exportConfig(config, path);
    if (result.error) alert(result.error);
    else alert("Config exported to " + result.path);
  }, []);

  const handleLoadStacOutput = useCallback(async () => {
    const path = prompt("Enter path to STAC output H5:",
      "/home/talmolab/Desktop/SalkResearch/monsees-retarget/output/monsees_ik_only.h5");
    if (!path) return;
    const data = await api.loadStacOutput(path);
    if (data.error) { alert(data.error); return; }
    const updateOffset = useStore.getState().updateOffset;
    for (let i = 0; i < data.kpNames.length; i++) {
      const name = data.kpNames[i];
      const [x, y, z] = data.offsets[i];
      updateOffset(name, x, y, z);
    }
    alert("Loaded " + data.kpNames.length + " learned offsets from STAC output");
  }, []);

  const runStacOnFrames = useCallback(async (frameIndices: number[]) => {
    const state = useStore.getState();
    if (!state.acmPositions || !state.xmlPath) {
      alert("Load XML and ACM data first."); return;
    }
    const pairs: Record<string, string> = {};
    for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
    const offsetMap: Record<string, [number, number, number]> = {};
    for (const o of state.offsets) offsetMap[o.keypointName] = [o.x, o.y, o.z];

    const positions = state.alignedPositions ?? state.acmPositions;
    const result = await api.runQuickStac({
      positions: Array.from(positions),
      numFrames: state.acmNumFrames,
      numKeypoints: state.acmNumKeypoints,
      keypointNames: state.acmKeypointNames,
      xmlPath: state.xmlPath,
      frameIndices,
      mappings: pairs,
      offsets: offsetMap,
      scaleFactor: state.scaleFactor,
      mocapScaleFactor: state.mocapScaleFactor,
    });
    if (result.error) { alert(result.error); return; }
    state.setStacResults(result.qpos, result.frameIndices, result.bodyTransforms);

    // Update 3D view with body transforms from the first frame
    if (result.bodyTransforms && result.bodyTransforms.length > 0) {
      setBodyTransforms(result.bodyTransforms[0]);
    } else if (result.qpos.length > 0) {
      const transforms = await api.bodyTransforms(result.qpos[0]);
      setBodyTransforms(transforms);
    }

    alert("Quick STAC done on " + result.qpos.length + " frames. Mean error: " +
      (result.errors.reduce((a: number, b: number) => a + b, 0) / result.errors.length * 1000).toFixed(1) + "mm");
  }, [setBodyTransforms]);

  const handleRunStac = useCallback(async () => {
    const state = useStore.getState();
    const labeledFrames = Array.from(state.labeledFrames);
    const frames = labeledFrames.length > 0 ? labeledFrames : [state.currentFrame];
    await runStacOnFrames(frames);
  }, [runStacOnFrames]);

  const handleRunStacFrame = useCallback(async () => {
    const state = useStore.getState();
    await runStacOnFrames([state.currentFrame]);
  }, [runStacOnFrames]);

  return (
    <>
      <button style={btnStyle} onClick={handleLoadXml}>Load XML</button>
      <button style={btnStyle} onClick={handleLoadAcm}>Load ACM</button>
      <button style={btnStyle} onClick={handleLoadConfig}>Load Config</button>
      <button style={btnStyle} onClick={handleAlign}>Align</button>
      <button style={btnStyle} onClick={handleLoadStacOutput}>Load STAC H5</button>
      <button style={{...btnStyle, background: "#2a4a2a", border: "1px solid #4a4"}} onClick={handleRunStac}>Run STAC</button>
      <button style={{...btnStyle, background: "#2a3a2a", border: "1px solid #4a4"}} onClick={handleRunStacFrame}>STAC Frame</button>
      <button style={btnStyle} onClick={handleExport}>Export</button>
    </>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#2a2a4a", border: "1px solid #555", color: "#ccc",
  padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 12,
};
