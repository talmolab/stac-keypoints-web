"""STAC YAML config and H5 import/export."""
from __future__ import annotations
from pathlib import Path
import yaml
import numpy as np
import h5py


# Fields that live at the top level of a stac-mjx model config file
# (e.g. configs/model/rodent.yaml). Used to detect flat vs. wrapped shapes.
_MODEL_FIELD_MARKERS = ("KEYPOINT_MODEL_PAIRS", "KP_NAMES", "MJCF_PATH")


def _extract_model_section(raw: dict) -> dict:
    """Return the dict containing model-level fields from a loaded YAML.

    Handles two shapes:
    - Flat: a stac-mjx shipped model config (rodent.yaml, mouse.yaml, ...),
      where fields like MJCF_PATH sit at the top level because Hydra slots
      the file into the `model` namespace during composition.
    - Wrapped: the UI's own export, where everything is nested under `model:`.
    """
    if any(k in raw for k in _MODEL_FIELD_MARKERS):
        return raw
    return raw.get("model", {})


def load_stac_yaml(path: str) -> dict:
    """Load STAC config YAML and return normalized dict for the UI."""
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    model = _extract_model_section(raw)
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


def dump_stac_yaml(config: dict) -> str:
    """Serialize UI state to STAC-compatible YAML and return it as a string."""
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
    return yaml.dump(yaml_dict, default_flow_style=False, sort_keys=False)


def export_stac_yaml(config: dict, output_path: str) -> None:
    """Export UI state to a STAC-compatible YAML file on disk."""
    with open(output_path, "w") as f:
        f.write(dump_stac_yaml(config))


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
