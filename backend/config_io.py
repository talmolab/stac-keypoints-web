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

    kp_data contains the actual target keypoints STAC was fitting to (scaled by
    MOCAP_SCALE_FACTOR). We reshape and convert back to the original coordinate
    frame (÷ MOCAP_SCALE_FACTOR) so the web UI can display them aligned with the
    STAC poses.

    If the H5 contains an embedded 'config' dataset (YAML string), we parse it
    to extract MOCAP_SCALE_FACTOR, MJCF_PATH, KEYPOINT_MODEL_PAIRS, etc. and
    return them so the frontend can auto-configure.
    """
    h5_path = h5_path.strip()
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

        # Try to read embedded config for scale factor and model metadata
        mocap_scale_factor = 0.01  # default (rodent)
        embedded_config = None
        if "config" in f:
            try:
                raw_config = f["config"][()]
                if hasattr(raw_config, 'decode'):
                    raw_config = raw_config.decode()
                elif not isinstance(raw_config, str):
                    raw_config = str(raw_config)
                parsed = yaml.safe_load(raw_config)
                model_cfg = parsed.get("model", {})
                mocap_scale_factor = float(model_cfg.get("MOCAP_SCALE_FACTOR", 0.01))

                # Resolve XML path: try original, then same dir as H5, then
                # common local locations
                xml_path = model_cfg.get("MJCF_PATH", "")
                resolved_xml = _resolve_xml_path(xml_path, h5_path)

                offsets_raw = model_cfg.get("KEYPOINT_INITIAL_OFFSETS", {})
                offsets_parsed = {}
                for kp, val in offsets_raw.items():
                    if isinstance(val, str):
                        offsets_parsed[kp] = [float(x) for x in val.split()]
                    elif isinstance(val, (list, tuple)):
                        offsets_parsed[kp] = [float(x) for x in val]
                    else:
                        offsets_parsed[kp] = [0.0, 0.0, 0.0]

                embedded_config = {
                    "xmlPath": resolved_xml,
                    "keypointModelPairs": dict(model_cfg.get("KEYPOINT_MODEL_PAIRS", {})),
                    "keypointInitialOffsets": offsets_parsed,
                    "scaleFactor": float(model_cfg.get("SCALE_FACTOR", 0.9)),
                    "mocapScaleFactor": mocap_scale_factor,
                    "kpNames": list(model_cfg.get("KP_NAMES", kp_names)),
                }
            except Exception:
                pass  # Fall back to defaults

        if embedded_config:
            result["embeddedConfig"] = embedded_config

        # Load kp_data: the actual targets STAC optimized against
        if "kp_data" in f:
            kp_data = f["kp_data"][:]  # (N, n_kp*3) scaled by mocap_scale_factor
            n_kp = len(kp_names)
            n_frames = kp_data.shape[0]
            # Reshape to (N, n_kp, 3) and undo MOCAP_SCALE_FACTOR
            kp_3d = kp_data.reshape(n_frames, n_kp, 3)
            if mocap_scale_factor != 0 and mocap_scale_factor != 1.0:
                kp_3d = kp_3d / mocap_scale_factor
            result["stacTargets"] = {
                "positions": kp_3d.flatten().tolist(),
                "numFrames": int(n_frames),
                "numKeypoints": int(n_kp),
            }
    return result


def _resolve_xml_path(original_path: str, h5_path: str) -> str:
    """Try to find the XML file, checking several locations."""
    if not original_path:
        return ""
    p = Path(original_path)
    fname = p.name
    try:
        # 1. Original path as-is
        if p.is_file():
            return str(p)
    except (PermissionError, OSError):
        pass
    # 2. Same directory as the H5 file
    h5_dir = Path(h5_path).parent
    local = h5_dir / fname
    if local.is_file():
        return str(local)
    # 3. Common local search paths
    search_dirs = [
        Path("/home/talmolab/Desktop/SalkResearch"),
    ]
    for base in search_dirs:
        try:
            for match in base.rglob(fname):
                if match.is_file():
                    return str(match)
        except (PermissionError, OSError):
            continue
    # 4. Give up, return original
    return original_path
