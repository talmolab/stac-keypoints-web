"""ACM data loading, FK, and retargeting — wraps monsees_retarget."""
from __future__ import annotations

import sys
from pathlib import Path
import numpy as np

_MONSEES_ROOT = Path("/home/talmolab/Desktop/SalkResearch/monsees-retarget")
if str(_MONSEES_ROOT) not in sys.path:
    sys.path.insert(0, str(_MONSEES_ROOT))

from monsees_retarget.acm_loader import acm_forward_kinematics, load_motiondata
from monsees_retarget.gap_loader import discover_gap_trials, load_gap_trial
from monsees_retarget.stac_integration import load_stac_config, map_acm_to_stac_keypoints
from monsees_retarget.retarget_proportions import RETARGET_TREE, retarget_to_mujoco


def get_acm_skeleton_bones() -> list[dict]:
    """Return the STAC keypoint-level skeleton connectivity."""
    return [{"parent": p, "child": c} for p, c in RETARGET_TREE]


def load_acm_trials(
    max_trials: int = 5,
    decimate: int = 2,
    config_path: str | None = None,
) -> dict:
    """Load ACM trials, run FK, map to STAC keypoints. Returns JSON-serializable dict."""
    config = load_stac_config(config_path)
    metas = discover_gap_trials(require_motiondata=True)[:max_trials]
    all_positions = []
    kp_names = None
    for meta in metas:
        trial = load_gap_trial(meta)
        positions_mm = acm_forward_kinematics(trial)
        positions_mm = positions_mm[::decimate]
        positions_cm = positions_mm / 10.0
        stac_pos, stac_names = map_acm_to_stac_keypoints(
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
    config = load_stac_config(config_path)
    trial = load_motiondata(mat_path)
    positions_mm = acm_forward_kinematics(trial)
    positions_mm = positions_mm[::decimate]
    positions_cm = positions_mm / 10.0
    stac_pos, stac_names = map_acm_to_stac_keypoints(
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
    positions = np.array(positions_flat).reshape(num_frames, num_keypoints, 3)
    retargeted = retarget_to_mujoco(
        positions, kp_names, xml_path,
        scale_factor=scale_factor,
        mocap_scale_factor=mocap_scale_factor,
        spine_blend=spine_blend,
    )
    return retargeted.flatten().tolist()
