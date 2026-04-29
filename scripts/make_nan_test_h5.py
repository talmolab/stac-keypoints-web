"""Generate a NaN-containing .h5 fixture for testing the M4 missing-keypoint
and confidence handling in the browser.

Reads the demo file's `marker_sites` (synthetic ground-truth motion in
meters), converts to cm, and overlays a few realistic missingness patterns:

  - Snout: dropped completely (a whole keypoint absent across the run)
  - HandL: gap of ~200 frames in the middle (tracker briefly lost it)
  - WristR: sporadic single-frame dropouts (~5% missing rate)
  - HandR (one component, frame 50): partial NaN on the y axis

Also writes a SLEAP-style `point_scores` dataset of shape (frames, keypoints)
with realistic confidence patterns:
  - Baseline ~0.95 for tracked keypoints (with light noise)
  - NaN where positions are NaN (Snout always; HandL during the gap)
  - Tracker-bleed: low conf (~0.3-0.5) for HandL in the 50 frames before
    and after its gap (the tracker gets uncertain at gap edges)
  - WristR: low conf (~0.4) on the sporadic-drop frames *and* general
    scatter so non-dropout frames vary too — exercises the gradient

Run from the repo root:
    python scripts/make_nan_test_h5.py
Writes to data/demo_with_nan.h5.
"""
from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np


KP_NAMES = [
    "AnkleL", "AnkleR", "EarL", "EarR", "ElbowL", "ElbowR",
    "FootL", "FootR", "HandL", "HandR", "HipL", "HipR",
    "KneeL", "KneeR", "ShoulderL", "ShoulderR", "Snout",
    "SpineF", "SpineL", "SpineM", "TailBase", "WristL", "WristR",
]


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    src = repo / "data" / "demo_ik_only.h5"
    out = repo / "data" / "demo_with_nan.h5"

    if not src.exists():
        raise SystemExit(
            f"Source demo file not present at {src}. Pull or generate it first."
        )

    with h5py.File(src, "r") as f:
        marker_sites_m = np.array(f["marker_sites"])  # (frames, 23, 3), meters

    # cm — matches the default mocap_scale_factor=0.01 the UI assumes.
    tracks = (marker_sites_m * 100.0).astype(np.float32)
    n_frames, n_kp, _ = tracks.shape
    assert n_kp == len(KP_NAMES), f"keypoint count mismatch: {n_kp} vs {len(KP_NAMES)}"

    name_to_idx = {n: i for i, n in enumerate(KP_NAMES)}
    rng = np.random.default_rng(0)

    # Baseline confidence: high with mild jitter, like a clean tracker run.
    scores = (0.95 + 0.04 * rng.standard_normal((n_frames, n_kp))).astype(np.float32)
    scores = np.clip(scores, 0.0, 1.0)

    # 1) Snout entirely missing
    tracks[:, name_to_idx["Snout"]] = np.nan
    scores[:, name_to_idx["Snout"]] = np.nan

    # 2) HandL gap in the middle (frames 400-600)
    handl = name_to_idx["HandL"]
    tracks[400:600, handl] = np.nan
    scores[400:600, handl] = np.nan
    # Tracker-bleed: confidence drops near the gap edges
    edge_lo = np.linspace(0.9, 0.3, 50, dtype=np.float32)  # 350→400
    edge_hi = np.linspace(0.3, 0.9, 50, dtype=np.float32)  # 600→650
    scores[350:400, handl] = edge_lo + 0.05 * rng.standard_normal(50).astype(np.float32)
    scores[600:650, handl] = edge_hi + 0.05 * rng.standard_normal(50).astype(np.float32)
    scores[:, handl] = np.where(np.isnan(scores[:, handl]), scores[:, handl],
                                 np.clip(scores[:, handl], 0.0, 1.0))

    # 3) WristR sporadic dropouts (~5%)
    wristr = name_to_idx["WristR"]
    drop_mask = rng.random(n_frames) < 0.05
    tracks[drop_mask, wristr] = np.nan
    scores[drop_mask, wristr] = np.nan
    # General scatter on WristR — tracker is generally less reliable.
    not_dropped = ~drop_mask
    scores[not_dropped, wristr] = np.clip(
        0.7 + 0.2 * rng.standard_normal(int(not_dropped.sum())).astype(np.float32),
        0.0, 1.0,
    )

    # 4) HandR partial NaN (one component on one frame) to exercise per-axis NaN
    tracks[50, name_to_idx["HandR"], 1] = np.nan

    with h5py.File(out, "w") as f:
        f.create_dataset("tracks", data=tracks)
        f.create_dataset("point_scores", data=scores)
        f.create_dataset(
            "node_names",
            data=np.array(KP_NAMES, dtype=h5py.string_dtype(encoding="utf-8")),
        )

    n_missing = int(np.isnan(tracks).any(axis=-1).sum())
    valid_scores = scores[~np.isnan(scores)]
    print(f"Wrote {out}")
    print(f"  shape: {tracks.shape}  ({n_frames} frames, {n_kp} kps)")
    print(f"  missing keypoint-frames: {n_missing} ({n_missing / (n_frames * n_kp):.1%})")
    print(f"  confidence: mean={valid_scores.mean():.3f}  "
          f"min={valid_scores.min():.3f}  max={valid_scores.max():.3f}")
    print()
    print("Load via the Toolbar's 'Upload keypoints' with kp_names=")
    print(",".join(KP_NAMES))


if __name__ == "__main__":
    main()
