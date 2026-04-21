import React from "react";
import { useStore } from "../store";

function errorColor(mm: number): string {
  if (mm < 5) return "#00ff44";
  if (mm < 10) return "#88ff00";
  if (mm < 20) return "#ffaa00";
  if (mm < 40) return "#ff4400";
  return "#ff0000";
}

export default function ErrorDistribution() {
  const errors = useStore((s) => s.perKeypointErrors);
  const setSelectedKp = useStore((s) => s.setSelectedKeypoint);

  if (errors.length === 0) return null;

  const sorted = [...errors].sort((a, b) => b.errorMm - a.errorMm);
  const maxError = Math.max(...sorted.map((e) => e.errorMm), 1);

  const mean = sorted.reduce((s, e) => s + e.errorMm, 0) / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)].errorMm;

  const barHeight = 14;
  const labelWidth = 70;
  const valueWidth = 42;
  const chartWidth = 280 - labelWidth - valueWidth - 16;
  const svgHeight = sorted.length * (barHeight + 2) + 4;

  return (
    <div>
      <h3 style={{ margin: "0 0 4px", fontSize: 14, color: "#aaa" }}>Error Distribution</h3>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
        Mean: <span style={{ color: errorColor(mean) }}>{mean.toFixed(1)}mm</span>
        {" | "}
        Median: <span style={{ color: errorColor(median) }}>{median.toFixed(1)}mm</span>
        {" | "}
        Max: <span style={{ color: errorColor(maxError) }}>{maxError.toFixed(1)}mm</span>
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto", overflowX: "hidden" }}>
        <svg
          width="100%"
          height={svgHeight}
          viewBox={`0 0 ${labelWidth + chartWidth + valueWidth} ${svgHeight}`}
          style={{ display: "block" }}
        >
          {sorted.map((entry, i) => {
            const y = i * (barHeight + 2) + 2;
            const barW = Math.max(1, (entry.errorMm / maxError) * chartWidth);
            const color = errorColor(entry.errorMm);
            return (
              <g
                key={entry.keypointName}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedKp(entry.keypointName)}
              >
                <text
                  x={labelWidth - 4}
                  y={y + barHeight / 2 + 1}
                  textAnchor="end"
                  fill="#999"
                  fontSize={10}
                  fontFamily="monospace"
                  dominantBaseline="middle"
                >
                  {entry.keypointName.length > 10
                    ? entry.keypointName.slice(0, 9) + "\u2026"
                    : entry.keypointName}
                </text>
                <rect
                  x={labelWidth}
                  y={y}
                  width={barW}
                  height={barHeight}
                  fill={color}
                  opacity={0.8}
                  rx={2}
                />
                <text
                  x={labelWidth + chartWidth + 4}
                  y={y + barHeight / 2 + 1}
                  fill={color}
                  fontSize={10}
                  fontFamily="monospace"
                  dominantBaseline="middle"
                >
                  {entry.errorMm.toFixed(1)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
