"""ACM data loading, FK, and retargeting — wraps monsees_retarget.

monsees_retarget is imported lazily so the rest of the backend still
works without it installed. Call sites raise a clear error.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
import numpy as np


def _import_monsees():
    """Import monsees_retarget on demand, optionally from MONSEES_RETARGET path."""
    root = os.environ.get("MONSEES_RETARGET")
    if root and Path(root).exists() and root not in sys.path:
        sys.path.insert(0, root)
    try:
        from monsees_retarget import acm_loader, gap_loader, stac_integration, retarget_proportions
    except ImportError as e:
        raise RuntimeError(
            "monsees_retarget is not importable. Install it, or set the "
            "MONSEES_RETARGET env var to a local checkout. "
            f"Original error: {e}"
        ) from e
    return {
        "acm_forward_kinematics": acm_loader.acm_forward_kinematics,
        "load_motiondata": acm_loader.load_motiondata,
        "discover_gap_trials": gap_loader.discover_gap_trials,
        "load_gap_trial": gap_loader.load_gap_trial,
        "load_stac_config": stac_integration.load_stac_config,
        "map_acm_to_stac_keypoints": stac_integration.map_acm_to_stac_keypoints,
        "RETARGET_TREE": retarget_proportions.RETARGET_TREE,
        "retarget_to_mujoco": retarget_proportions.retarget_to_mujoco,
    }


def get_acm_skeleton_bones() -> list[dict]:
    """Return the STAC keypoint-level skeleton connectivity."""
    m = _import_monsees()
    return [{"parent": p, "child": c} for p, c in m["RETARGET_TREE"]]


def load_acm_trials(
    max_trials: int = 5,
    decimate: int = 2,
    config_path: str | None = None,
) -> dict:
    """Load ACM trials, run FK, map to STAC keypoints. Returns JSON-serializable dict."""
    m = _import_monsees()
    config = m["load_stac_config"](config_path)
    metas = m["discover_gap_trials"](require_motiondata=True)[:max_trials]
    all_positions = []
    kp_names = None
    for meta in metas:
        trial = m["load_gap_trial"](meta)
        positions_mm = m["acm_forward_kinematics"](trial)
        positions_mm = positions_mm[::decimate]
        positions_cm = positions_mm / 10.0
        stac_pos, stac_names = m["map_acm_to_stac_keypoints"](
            positions_cm, trial.joint_names, config
        )
        all_positions.append(stac_pos)
        if kp_names is None:
            kp_names = stac_names
    concatenated = np.concatenate(all_positions, axis=0)
    bones = get_acm_skeleton_bones()
    return {
        "keypointNames": list(kp_names),
        "bones": bones,
        "positions": concatenated.flatten().tolist(),
        "numFrames": int(concatenated.shape[0]),
        "numKeypoints": int(concatenated.shape[1]),
    }


def load_single_matfile(
    mat_path: str,
    config_path: str | None = None,
    decimate: int = 2,
) -> dict:
    """Load a single .mat file directly."""
    m = _import_monsees()
    config = m["load_stac_config"](config_path)
    trial = m["load_motiondata"](mat_path)
    positions_mm = m["acm_forward_kinematics"](trial)
    positions_mm = positions_mm[::decimate]
    positions_cm = positions_mm / 10.0
    stac_pos, stac_names = m["map_acm_to_stac_keypoints"](
        positions_cm, trial.joint_names, config
    )
    bones = get_acm_skeleton_bones()
    return {
        "keypointNames": list(stac_names),
        "bones": bones,
        "positions": stac_pos.flatten().tolist(),
        "numFrames": int(stac_pos.shape[0]),
        "numKeypoints": int(stac_pos.shape[1]),
    }


def apply_retargeting(
    positions_flat: list[float],
    num_frames: int,
    num_keypoints: int,
    kp_names: list[str],
    xml_path: str,
    scale_factor: float = 0.9,
    mocap_scale_factor: float = 0.01,
    spine_blend: float = 0.4,
) -> list[float]:
    """Apply per-segment bone-length retargeting. Returns flat positions list (cm)."""
    m = _import_monsees()
    positions = np.array(positions_flat).reshape(num_frames, num_keypoints, 3)
    retargeted = m["retarget_to_mujoco"](
        positions, kp_names, xml_path,
        scale_factor=scale_factor,
        mocap_scale_factor=mocap_scale_factor,
        spine_blend=spine_blend,
    )
    return retargeted.flatten().tolist()
