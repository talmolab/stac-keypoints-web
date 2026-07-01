import React, { useEffect, useState } from "react";
import { getApiBase, setApiBase, probeBackend, type BackendStatus } from "../api";

// Live connection indicator. "unreachable" is the important state: it means a
// backend URL is configured but /api/health didn't answer, so the app is
// silently running the in-browser WASM solver — this surfaces that instead of
// letting the user assume they're hitting their server.
const INDICATOR: Record<BackendStatus | "probing", { color: string; label: (base: string) => string }> = {
  probing:     { color: "#888", label: () => "Checking connection…" },
  connected:   { color: "#4a4", label: (b) => `Connected: ${b || "same origin"}` },
  standalone:  { color: "#888", label: () => "Standalone (in-browser, no server)" },
  unreachable: { color: "#c84", label: (b) => `Standalone — couldn't reach ${b}` },
};

export default function BackendControls() {
  const base = getApiBase();
  const [url, setUrl] = useState(base);
  const [status, setStatus] = useState<BackendStatus | "probing">("probing");

  useEffect(() => {
    let live = true;
    probeBackend()
      .then((s) => { if (live) setStatus(s); })
      .catch(() => { if (live) setStatus("standalone"); });
    return () => { live = false; };
  }, []);

  const normalized = url.trim().replace(/\/+$/, "");
  const dirty = normalized !== base;
  const meta = INDICATOR[status];

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 11 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
        <span style={{ color: "#aaa" }}>{meta.label(base)}</span>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          type="text"
          value={url}
          placeholder="http://host:8000 (blank = same origin)"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && dirty) setApiBase(url); }}
          style={{
            flex: 1, minWidth: 0, background: "#1a1a2e", border: "1px solid #444",
            color: "#ccc", padding: "3px 6px", borderRadius: 3, fontSize: 11,
          }}
        />
        <button
          onClick={() => setApiBase(url)}
          disabled={!dirty}
          title="Save the backend URL and reload to connect"
          style={{ ...btnStyle, opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }}
        >
          Connect
        </button>
      </div>
      <div style={{ fontSize: 10, color: "#666", marginTop: 4, lineHeight: 1.4 }}>
        Reloads to apply. The server must allow this page's origin (set
        {" "}<code style={{ color: "#888" }}>STAC_ALLOW_ORIGINS</code> on the backend).
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#2a2a4a", border: "1px solid #444", color: "#ccc",
  padding: "3px 10px", borderRadius: 3, fontSize: 11, flexShrink: 0,
};
