import React from "react";
import { useStore } from "../store";
import { errorToColor } from "../errorColor";

// Rodent-specific anatomical regions. Keypoints not present in the current
// dataset are silently skipped, so this list is safe to keep wide. Other
// species would need their own table — region definitions belong in a
// per-species config eventually (M5), but the 3D model itself is the
// year-scale asset, so swapping a Record literal here is cheap by comparison.
const RODENT_REGIONS: { name: string; keypoints: string[] }[] = [
  { name: "Head", keypoints: ["Snout", "EarL", "EarR"] },
  { name: "Back", keypoints: ["SpineF", "SpineM", "SpineL", "TailBase"] },
  {
    name: "Forelimbs",
    keypoints: [
      "ShoulderL", "ElbowL", "WristL", "HandL",
      "ShoulderR", "ElbowR", "WristR", "HandR",
    ],
  },
  {
    name: "Hindlimbs",
    keypoints: [
      "HipL", "KneeL", "AnkleL", "FootL",
      "HipR", "KneeR", "AnkleR", "FootR",
    ],
  },
];

export default function RegionErrorSummary() {
  const errors = useStore((s) => s.perKeypointErrors);
  if (errors.length === 0) return null;

  const errorMap: Record<string, number> = {};
  for (const e of errors) errorMap[e.keypointName] = e.errorMm;

  const rows = RODENT_REGIONS.map((region) => {
    const present = region.keypoints.filter((kp) => kp in errorMap);
    if (present.length === 0) return null;
    const vals = present.map((kp) => errorMap[kp]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const max = Math.max(...vals);
    return {
      name: region.name,
      count: present.length,
      total: region.keypoints.length,
      mean,
      max,
    };
  }).filter(Boolean) as {
    name: string;
    count: number;
    total: number;
    mean: number;
    max: number;
  }[];

  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <h4 style={{ margin: "0 0 4px", fontSize: 12, color: "#aaa" }}>
        Error by region
      </h4>
      <table style={{ width: "100%", fontSize: 11, fontFamily: "monospace", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#888" }}>
            <th style={thStyle}>Region</th>
            <th style={thStyleNum}>n</th>
            <th style={thStyleNum}>mean</th>
            <th style={thStyleNum}>max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={{ ...tdStyle, color: errorToColor(r.mean) }}>{r.name}</td>
              <td style={tdStyleNum}>{r.count}/{r.total}</td>
              <td style={{ ...tdStyleNum, color: errorToColor(r.mean) }}>{r.mean.toFixed(1)}</td>
              <td style={{ ...tdStyleNum, color: errorToColor(r.max) }}>{r.max.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: "left", padding: "2px 4px", fontWeight: 400 };
const thStyleNum: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "1px 4px" };
const tdStyleNum: React.CSSProperties = { ...tdStyle, textAlign: "right" };
