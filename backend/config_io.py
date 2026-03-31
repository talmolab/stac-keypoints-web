"""STAC YAML config and H5 import/export."""
from __future__ import annotations
from pathlib import Path
import yaml
import numpy as np
import h5py


def load_stac_yaml(path: str) -> dict:
    """Load STAC config YAML and return normalized dict for the UI."""
    with open(path) as f:
        raw = yaml.safe_load(f)
    model = raw.get("model", {})
    offsets_raw = model.get("KEYPOINT_INITIAL_OFFSETS", {})
    offsets = {}
    for kp, val in offsets_raw.items():
        if isinstance(val, str):
            offsets[kp] = [float(x) for x in val.split()]
        elif isinstance(val, (list, tuple)):
            offsets[kp] = [float(x) for x in val]
        else:
            offsets[kp] = [0.0, 0.0, 0.0]
    return {
        "keypointModelPairs": dict(model.get("KEYPOINT_MODEL_PAIRS", {})),
        "keypointInitialOffsets": offsets,
        "scaleFactor": float(model.get("SCALE_FACTOR", 0.9)),
        "mocapScaleFactor": float(model.get("MOCAP_SCALE_FACTOR", 0.01)),
        "kpNames": list(model.get("KP_NAMES", [])),
        "xmlPath": model.get("MJCF_PATH", ""),
    }


def export_stac_yaml(config: dict, output_path: str) -> None:
    """Export UI state back to STAC-compatible YAML."""
    offsets_str = {}
    for kp, vals in config.get("keypointInitialOffsets", {}).items():
        offsets_str[kp] = f"{vals[0]} {vals[1]} {vals[2]}"
    yaml_dict = {
        "model": {
            "MJCF_PATH": config.get("xmlPath", ""),
            "SCALE_FACTOR": config.get("scaleFactor", 0.9),
            "MOCAP_SCALE_FACTOR": config.get("mocapScaleFactor", 0.01),
            "KP_NAMES": config.get("kpNames", list(config.get("keypointModelPairs", {}).keys())),
            "KEYPOINT_MODEL_PAIRS": config.get("keypointModelPairs", {}),
            "KEYPOINT_INITIAL_OFFSETS": offsets_str,
        },
    }
    # Include segment scales if any are non-default
    segment_scales = config.get("segmentScales", {})
    if segment_scales:
        non_default = {k: v for k, v in segment_scales.items() if abs(v - 1.0) > 0.001}
        if non_default:
            yaml_dict["skeleton_editor"] = {"segment_scales": non_default}
    with open(output_path, "w") as f:
        yaml.dump(yaml_dict, f, default_flow_style=False, sort_keys=False)


def load_stac_output_h5(h5_path: str) -> dict:
    """Load STAC output H5 and return offsets + qpos + kp_data for visualization.

    kp_data contains the actual target keypoints STAC was fitting to (in meters,
    flattened as N x 63). We reshape and convert back to cm (÷ MOCAP_SCALE_FACTOR)
    so the web UI can display them aligned with the STAC poses.
    """
    with h5py.File(h5_path, "r") as f:
        kp_names = [
            n.decode() if isinstance(n, bytes) else str(n)
            for n in f["kp_names"][:]
        ]
        result = {
            "offsets": f["offsets"][:].tolist(),
            "qpos": f["qpos"][:].tolist(),
            "kpNames": kp_names,
        }
        if "marker_sites" in f:
            result["markerSites"] = f["marker_sites"][:].tolist()
        # Load kp_data: the actual targets STAC optimized against (meters, flat)
        if "kp_data" in f:
            kp_data = f["kp_data"][:]  # (N, n_kp*3) in meters
            n_kp = len(kp_names)
            n_frames = kp_data.shape[0]
            # Reshape to (N, n_kp, 3) and convert meters → cm (÷ 0.01)
            kp_3d = kp_data.reshape(n_frames, n_kp, 3) / 0.01  # meters → cm
            result["stacTargets"] = {
                "positions": kp_3d.flatten().tolist(),
                "numFrames": int(n_frames),
                "numKeypoints": int(n_kp),
            }
    return result
