"""Generate a NaN-containing .h5 fixture for testing the M4 missing-keypoint
handling in the browser.

Reads the demo file's `marker_sites` (synthetic ground-truth motion in
meters), converts to cm, and overlays a few realistic missingness patterns:

  - Snout: dropped completely (a whole keypoint absent across the run)
  - HandL: gap of ~200 frames in the middle (tracker briefly lost it)
  - WristR: sporadic single-frame dropouts (~5% missing rate)
  - HandR (one component, frame 50): partial NaN on the y axis

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

    # 1) Snout entirely missing
    tracks[:, name_to_idx["Snout"]] = np.nan

    # 2) HandL gap in the middle (frames 400-600)
    tracks[400:600, name_to_idx["HandL"]] = np.nan

    # 3) WristR sporadic dropouts (~5%)
    drop_mask = rng.random(n_frames) < 0.05
    tracks[drop_mask, name_to_idx["WristR"]] = np.nan

    # 4) HandR partial NaN (one component on one frame) to exercise per-axis NaN
    tracks[50, name_to_idx["HandR"], 1] = np.nan

    with h5py.File(out, "w") as f:
        f.create_dataset("tracks", data=tracks)
        f.create_dataset(
            "node_names",
            data=np.array(KP_NAMES, dtype=h5py.string_dtype(encoding="utf-8")),
        )

    n_missing = int(np.isnan(tracks).any(axis=-1).sum())
    print(f"Wrote {out}")
    print(f"  shape: {tracks.shape}  ({n_frames} frames, {n_kp} kps)")
    print(f"  missing keypoint-frames: {n_missing} ({n_missing / (n_frames * n_kp):.1%})")
    print()
    print("Load via the Toolbar's 'Upload keypoints' with kp_names=")
    print(",".join(KP_NAMES))


if __name__ == "__main__":
    main()
