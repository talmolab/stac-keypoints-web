"""Loaders for STAC-format 3D keypoint tracks.

Unlike `acm_processing.load_single_matfile`, these readers do not depend
on `monsees_retarget`. They accept the data formats that `stac-mjx`
itself consumes — already-resolved 3D keypoint positions per frame, as
produced by tracking tools (SLEAP, DeepLabCut) or stored in stac-mjx's
own test fixtures.

Supported inputs:
    .h5   — dataset ``tracks`` of shape (frames, [animals,] keypoints, 3)
            or ``positions`` of shape (frames, keypoints, 3).
    .mat  — ``pred`` of shape (frames, 3, keypoints), as in
            ``stac-mjx/tests/data/test_rodent_mocap_1000_frames.mat``.
"""
from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np


def load_keypoints(path: str, kp_names: list[str] | None = None) -> dict:
    """Load 3D keypoint tracks from a file on disk.

    Returns the same dict shape as ``acm_processing.load_single_matfile``
    so the frontend's ``setAcmData`` can consume either.
    """
    p = Path(path)
    ext = p.suffix.lower()
    embedded_names: list[str] | None = None
    confidences: np.ndarray | None = None
    if ext == ".h5":
        positions, embedded_names, confidences = _load_h5(p)
    elif ext == ".mat":
        positions = _load_mat(p)
    else:
        raise ValueError(
            f"Unsupported file type '{ext}'. Use .h5 or .mat."
        )

    if positions.ndim != 3 or positions.shape[-1] != 3:
        raise ValueError(
            f"Expected positions with shape (frames, keypoints, 3), "
            f"got {positions.shape}."
        )

    n_frames, n_kp, _ = positions.shape
    # Resolution order: caller-supplied > embedded in file > generic kp_N.
    # Embedded names lift the "must Load Config first" footgun in the UI
    # — Procrustes alignment matches kp names against the mapping keys, and
    # generic labels never match anything in the mapping.
    names = list(kp_names) if kp_names else []
    if len(names) != n_kp:
        if embedded_names is not None and len(embedded_names) == n_kp:
            names = embedded_names
        else:
            names = [f"kp_{i}" for i in range(n_kp)]

    # Tracking exports (SLEAP, DLC) use NaN for missing keypoints. JSON spec
    # disallows NaN literals — the browser's JSON.parse will reject them — so
    # convert to None (→ null on the wire) and reverse on the JS side.
    positions_list = _flat_with_nulls(positions)

    out: dict = {
        "keypointNames": names,
        "bones": [],  # no keypoint-level connectivity available from raw tracks
        "positions": positions_list,
        "numFrames": int(n_frames),
        "numKeypoints": int(n_kp),
    }
    if confidences is not None and confidences.shape == (n_frames, n_kp):
        out["confidences"] = _flat_with_nulls(confidences)
    return out


def _flat_with_nulls(arr: np.ndarray) -> list:
    flat = arr.flatten()
    if np.isnan(flat).any():
        return [None if v != v else float(v) for v in flat]
    return flat.tolist()


def _load_h5(path: Path) -> tuple[np.ndarray, list[str] | None, np.ndarray | None]:
    """Return (tracks (frames, keypoints, 3), names or None, confidences or None).

    Embedded names are read from `node_names` (SLEAP convention) or
    `kp_names` (stac-mjx convention), whichever is present.

    Confidences are read from `point_scores` (SLEAP convention) when present.
    SLEAP shape is (frames, animals, keypoints) — same first-animal slicing
    as for `tracks`. stac-mjx-style files without scores return None.
    """
    with h5py.File(path, "r") as f:
        if "tracks" in f:
            arr = np.array(f["tracks"])
            # SLEAP-style (frames, animals, keypoints, 3): take first animal.
            if arr.ndim == 4:
                arr = arr[:, 0, :, :]
        elif "positions" in f:
            arr = np.array(f["positions"])
        else:
            raise ValueError(
                f"H5 file has no 'tracks' or 'positions' dataset. "
                f"Keys found: {list(f.keys())}"
            )

        names: list[str] | None = None
        for key in ("node_names", "kp_names"):
            if key in f:
                raw = f[key][:]
                names = [n.decode() if isinstance(n, bytes) else str(n) for n in raw]
                break

        scores: np.ndarray | None = None
        if "point_scores" in f:
            scores = np.array(f["point_scores"])
            # SLEAP-style (frames, animals, keypoints): take first animal.
            if scores.ndim == 3:
                scores = scores[:, 0, :]
        return arr, names, scores


def _load_mat(path: Path) -> np.ndarray:
    """Return tracks as (frames, keypoints, 3) from a MATLAB file."""
    from scipy.io import loadmat

    data = loadmat(str(path), squeeze_me=True)
    if "pred" in data:
        pred = np.asarray(data["pred"])
        # stac-mjx format: (frames, 3, keypoints) → (frames, keypoints, 3)
        if pred.ndim == 3 and pred.shape[1] == 3:
            return np.transpose(pred, (0, 2, 1))
        return pred
    if "positions" in data:
        return np.asarray(data["positions"])
    keys = [k for k in data.keys() if not k.startswith("__")]
    raise ValueError(
        f"MAT file has no 'pred' or 'positions' field. Keys found: {keys}"
    )
