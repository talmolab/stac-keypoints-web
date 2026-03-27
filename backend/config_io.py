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
        "spineBlend": float(raw.get("acm", {}).get("spine_blend", 0.4)),
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
    with open(output_path, "w") as f:
        yaml.dump(yaml_dict, f, default_flow_style=False, sort_keys=False)


def load_stac_output_h5(h5_path: str) -> dict:
    """Load STAC output H5 and return offsets + qpos for visualization."""
    with h5py.File(h5_path, "r") as f:
        result = {
            "offsets": f["offsets"][:].tolist(),
            "qpos": f["qpos"][:].tolist(),
            "kpNames": [
                n.decode() if isinstance(n, bytes) else str(n)
                for n in f["kp_names"][:]
            ],
        }
        if "marker_sites" in f:
            result["markerSites"] = f["marker_sites"][:].tolist()
    return result
