import React, { useEffect, useRef, useState } from "react";
import Viewport3D from "./components/Viewport3D";
import Timeline from "./components/Timeline";
import MappingTable from "./components/MappingTable";
import PropertiesPanel from "./components/PropertiesPanel";
import Toolbar from "./components/Toolbar";
import { useStore } from "./store";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAutoIk } from "./hooks/useAutoIk";
import * as api from "./api";

export default function App() {
  useKeyboardShortcuts();
  useAutoIk();
  const hasAutoLoaded = useRef(false);
  const [banner, setBanner] = useState<{ kind: "error" | "warn"; text: string } | null>(null);

  useEffect(() => {
    if (hasAutoLoaded.current) return;
    hasAutoLoaded.current = true;

    const autoLoad = async () => {
      const setXmlData = useStore.getState().setXmlData;
      const setBodyTransforms = useStore.getState().setBodyTransforms;
      const loadConfigAction = useStore.getState().loadConfig;
      const setAcmData = useStore.getState().setAcmData;
      const setAlignedPositions = useStore.getState().setAlignedPositions;

      // 0. Reachability check via the dedicated health endpoint.
      try {
        await api.health();
      } catch (err) {
        const msg = (err as Error).message;
        console.error("[AutoLoad] Backend unreachable:", msg);
        setBanner({
          kind: "error",
          text: `Backend unreachable at /api (${msg}). Is uvicorn running on :8000? Check the terminal running start.sh.`,
        });
        return;
      }

      // Fetch defaults (env-overridable, falls back to bundled data/).
      const defaults = await api.getDefaults();
      console.log("[AutoLoad] Defaults:", defaults);

      try {

        // 1. Load XML
        if (!defaults.xmlPath) {
          setBanner({ kind: "warn", text: "No default model. Use 'Load XML' in the toolbar." });
          return;
        }
        console.log("[AutoLoad] Loading XML:", defaults.xmlPath);
        const xmlData = await api.loadXml(defaults.xmlPath);
        if (xmlData.error) {
          console.error("[AutoLoad] XML error:", xmlData.error);
          setBanner({ kind: "error", text: `Failed to load default XML: ${xmlData.error}` });
          return;
        }
        setXmlData({ geoms: xmlData.geoms, bodyNames: xmlData.bodyNames, nq: xmlData.nq, xmlPath: defaults.xmlPath });

        // Get default body transforms
        const defaultQpos = new Array(xmlData.nq).fill(0);
        defaultQpos[3] = 1.0;
        const transforms = await api.bodyTransforms(defaultQpos);
        setBodyTransforms(transforms);

        // 2. Load config (optional)
        if (defaults.configPath) {
          console.log("[AutoLoad] Loading config:", defaults.configPath);
          const config = await api.loadConfig(defaults.configPath);
          if (config.error) {
            console.error("[AutoLoad] Config error:", config.error);
          } else {
            loadConfigAction(config);
          }
        }

        // 3. Load ACM data (requires monsees-retarget; skip if unavailable)
        if (!defaults.monseesRetarget) {
          setBanner({
            kind: "warn",
            text: "MONSEES_RETARGET not set — ACM autoload skipped. Load a .mat file manually, or set the env var and restart the backend.",
          });
          console.log("[AutoLoad] Done (no ACM).");
          return;
        }
        console.log("[AutoLoad] Loading ACM data...");
        const acmData = await api.loadAcmTrials(defaults.acmTrials);
        if (acmData.error) {
          console.error("[AutoLoad] ACM error:", acmData.error);
          return;
        }
        setAcmData(acmData);

        // 4. Auto-run alignment if we have mappings from config
        const state = useStore.getState();
        if (state.mappings.length > 0 && state.acmPositions && state.xmlPath) {
          console.log("[AutoLoad] Running alignment...");
          const pairs: Record<string, string> = {};
          for (const m of state.mappings) pairs[m.keypointName] = m.bodyName;
          const alignResult = await api.alignToMujoco({
            positions: Array.from(state.acmPositions),
            numFrames: state.acmNumFrames,
            numKeypoints: state.acmNumKeypoints,
            keypointNames: state.acmKeypointNames,
            xmlPath: state.xmlPath,
            keypointModelPairs: pairs,
            scaleFactor: state.scaleFactor,
            mocapScaleFactor: state.mocapScaleFactor,
          });
          if (alignResult.error) {
            console.error("[AutoLoad] Alignment error:", alignResult.error);
          } else {
            setAlignedPositions(alignResult.alignedPositions);
            console.log("[AutoLoad] Alignment complete, method:", alignResult.method || "procrustes");
          }
        }

        console.log("[AutoLoad] Done.");
      } catch (err) {
        console.error("[AutoLoad] Exception:", err);
        setBanner({ kind: "error", text: `Autoload failed: ${(err as Error).message}` });
      }
    };

    autoLoad();
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 48, background: "#1a1a2e", display: "flex", alignItems: "center", padding: "0 16px", color: "#fff", gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>STAC Retarget UI</span>
        <Toolbar />
      </div>
      {banner && (
        <div
          onClick={() => setBanner(null)}
          title="Click to dismiss"
          style={{
            padding: "8px 16px",
            background: banner.kind === "error" ? "#4a1a1a" : "#4a3a1a",
            color: banner.kind === "error" ? "#ffb0b0" : "#ffe0a0",
            borderBottom: `1px solid ${banner.kind === "error" ? "#a44" : "#a84"}`,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <strong>{banner.kind === "error" ? "Error: " : "Notice: "}</strong>
          {banner.text}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 3, minWidth: 0 }}>
          <Viewport3D />
        </div>
        <div style={{ width: 240, borderLeft: "1px solid #333", padding: 12, color: "#ccc", background: "#16213e", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <MappingTable />
        </div>
        <div style={{ width: 280, borderLeft: "1px solid #333", padding: 12, color: "#ccc", background: "#16213e", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <PropertiesPanel />
        </div>
      </div>
      <div style={{ height: 64, background: "#1a1a2e", borderTop: "1px solid #333", display: "flex", alignItems: "center", padding: "0 16px", color: "#888", minWidth: 0, overflow: "hidden" }}>
        <Timeline />
      </div>
    </div>
  );
}
