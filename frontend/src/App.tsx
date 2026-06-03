import React, { useEffect, useRef, useState } from "react";
import Viewport3D from "./components/Viewport3D";
import Timeline from "./components/Timeline";
import MappingTable from "./components/MappingTable";
import PropertiesPanel from "./components/PropertiesPanel";
import Toolbar from "./components/Toolbar";
import HelpOverlay from "./components/HelpOverlay";
import { useStore } from "./store";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAutoIk } from "./hooks/useAutoIk";
import { useAutoAlign } from "./hooks/useAutoAlign";
import { runAlignment } from "./alignment";
import * as api from "./api";

export default function App() {
  useKeyboardShortcuts();
  useAutoIk();
  useAutoAlign();
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

      // 0. Backend-availability probe. When the backend is reachable we
      //    continue with full functionality; when it isn't (GH Pages,
      //    standalone build, dev without start.sh) the api.ts smart router
      //    transparently falls back to localApi (browser-side MuJoCo).
      const hasBackend = await api.isBackendAvailable();
      if (!hasBackend) {
        console.log("[AutoLoad] Backend unreachable — running in standalone mode (in-browser MuJoCo).");
        setBanner({
          kind: "warn",
          text: "Standalone mode (in-browser MuJoCo). Loading a STAC H5 from a server path needs the backend.",
        });
      }

      // Fetch defaults (backend: env-overridable; standalone: bundled rodent paths).
      const defaults = await api.getDefaults();
      console.log("[AutoLoad] Defaults:", defaults);

      try {

        // 1. Load XML — prefer the user's last path-loaded XML (preset
        //    dropdown / Custom path) over the default. The rat-specific
        //    config + ACM autoload below is skipped when we restore a
        //    non-default XML, since that machinery is rat-only and would
        //    overwrite the user's persisted mappings/segment scales.
        const lastUserPath = localStorage.getItem("stac.lastXmlPath");
        let xmlPathToLoad = defaults.xmlPath;
        let restoredFromLast = false;
        if (lastUserPath && lastUserPath !== defaults.xmlPath) {
          console.log("[AutoLoad] Trying last user XML:", lastUserPath);
          const probe = await api.loadXml(lastUserPath);
          if (!probe.error) {
            xmlPathToLoad = lastUserPath;
            restoredFromLast = true;
          } else {
            console.warn("[AutoLoad] Last user XML failed, falling back to default:", probe.error);
          }
        }

        if (!xmlPathToLoad) {
          setBanner({ kind: "warn", text: "No default model. Use 'Load XML' in the toolbar." });
          return;
        }
        console.log("[AutoLoad] Loading XML:", xmlPathToLoad);
        const xmlData = await api.loadXml(xmlPathToLoad);
        if (xmlData.error) {
          console.error("[AutoLoad] XML error:", xmlData.error);
          setBanner({ kind: "error", text: `Failed to load XML: ${xmlData.error}` });
          return;
        }
        const basename = xmlPathToLoad.split("/").pop() || xmlPathToLoad;
        setXmlData({
          geoms: xmlData.geoms,
          bodyNames: xmlData.bodyNames,
          nq: xmlData.nq,
          xmlPath: xmlPathToLoad,
          xmlBasename: basename,
          hasDemoData: api.xmlHasDemoData(xmlPathToLoad),
        });

        // Get default body transforms
        const defaultQpos = new Array(xmlData.nq).fill(0);
        defaultQpos[3] = 1.0;
        const transforms = await api.bodyTransforms(defaultQpos);
        setBodyTransforms(transforms);

        if (restoredFromLast) {
          console.log("[AutoLoad] Restored last user XML; skipping rat-specific config/ACM autoload.");
          return;
        }

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

        // 3. Load ACM data. In backend mode this requires MONSEES_RETARGET;
        //    in standalone mode the bundled acm_keypoints.json is the source.
        if (hasBackend && !defaults.monseesRetarget) {
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
        const outcome = await runAlignment();
        if (!outcome.ok) {
          console.log("[AutoLoad] Skipping align:", outcome.error);
        } else {
          console.log(`[AutoLoad] Aligned (${outcome.method}, scale=${outcome.scale?.toFixed(3)})`);
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
      <div style={{ minHeight: 64, maxHeight: 400, background: "#1a1a2e", borderTop: "1px solid #333", display: "flex", alignItems: "stretch", padding: "0 16px", color: "#888", minWidth: 0, overflow: "hidden", flexShrink: 0 }}>
        <Timeline />
      </div>
      <HelpOverlay />
    </div>
  );
}
