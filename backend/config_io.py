"""STAC YAML config and H5 import/export."""
from __future__ import annotations
import copy
from pathlib import Path
import yaml
import numpy as np
import h5py


# Fields that live at the top level of a stac-mjx model config file
# (e.g. configs/model/rodent.yaml). Used to detect flat vs. wrapped shapes.
_MODEL_FIELD_MARKERS = ("KEYPOINT_MODEL_PAIRS", "KP_NAMES", "MJCF_PATH")

# Fields that the UI owns and will overwrite on export.
_UI_MANAGED_FIELDS = (
    "MJCF_PATH",
    "SCALE_FACTOR",
    "MOCAP_SCALE_FACTOR",
    "KP_NAMES",
    "KEYPOINT_MODEL_PAIRS",
    "KEYPOINT_INITIAL_OFFSETS",
)


def _is_flat(raw: dict) -> bool:
    """True if `raw` looks like a flat stac-mjx model config."""
    return any(k in raw for k in _MODEL_FIELD_MARKERS)


def _extract_model_section(raw: dict) -> dict:
    """Return the dict containing model-level fields from a loaded YAML.

    Handles two shapes:
    - Flat: a stac-mjx shipped model config (rodent.yaml, mouse.yaml, ...),
      where fields like MJCF_PATH sit at the top level because Hydra slots
      the file into the `model` namespace during composition.
    - Wrapped: the UI's own export, where everything is nested under `model:`.
    """
    if _is_flat(raw):
        return raw
    return raw.get("model", {})


def _offsets_to_yaml(offsets: dict) -> dict:
    """Convert [x, y, z] offsets to space-separated strings (stac-mjx format)."""
    return {kp: f"{v[0]} {v[1]} {v[2]}" for kp, v in offsets.items()}


def _ui_managed_fields(config: dict) -> dict:
    """Build the model-level dict of fields the UI owns, in canonical order."""
    return {
        "MJCF_PATH": config.get("xmlPath", ""),
        "SCALE_FACTOR": config.get("scaleFactor", 0.9),
        "MOCAP_SCALE_FACTOR": config.get("mocapScaleFactor", 0.01),
        "KP_NAMES": config.get(
            "kpNames", list(config.get("keypointModelPairs", {}).keys())
        ),
        "KEYPOINT_MODEL_PAIRS": config.get("keypointModelPairs", {}),
        "KEYPOINT_INITIAL_OFFSETS": _offsets_to_yaml(
            config.get("keypointInitialOffsets", {})
        ),
    }


def load_stac_yaml(path: str) -> dict:
    """Load STAC config YAML and return normalized dict for the UI.

    Returns:
        Dict with UI-normalized fields (keypointModelPairs, keypointInitialOffsets,
        scaleFactor, mocapScaleFactor, kpNames, xmlPath) plus `_rawTemplate`:
        the full parsed YAML, for template-overlay export.
    """
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
        "_rawTemplate": raw,
    }


def _overlay_onto_template(template: dict, ui_fields: dict) -> dict:
    """Overlay UI-managed fields onto a template, preserving its shape.

    - Flat template → overlay at top level, preserving key order (UI fields
      replace existing keys in place; new keys appended).
    - Wrapped template → overlay under raw["model"].
    - UI-only sections like `skeleton_editor` are stripped.
    """
    out = copy.deepcopy(template)
    out.pop("skeleton_editor", None)

    target = out if _is_flat(out) else out.setdefault("model", {})

    for field in _UI_MANAGED_FIELDS:
        target[field] = ui_fields[field]
    return out


def dump_stac_yaml(config: dict) -> str:
    """Serialize UI state to STAC-compatible YAML and return it as a string.

    If `config` carries `_rawTemplate` (from a prior `load_stac_yaml`), overlay
    the UI's edits onto it so fields the UI doesn't manage (N_ITERS,
    ROOT_OPTIMIZATION_KEYPOINT, SITES_TO_REGULARIZE, ...) are preserved.

    Without a template, emit a UI-wrapped shape (nested under `model:`). That
    shape is the UI's internal round-trip format and is NOT a drop-in
    stac-mjx config — use template-overlay for that.
    """
    ui_fields = _ui_managed_fields(config)
    template = config.get("_rawTemplate")
    if template:
        yaml_dict = _overlay_onto_template(template, ui_fields)
    else:
        yaml_dict = {"model": dict(ui_fields)}
    return yaml.dump(yaml_dict, default_flow_style=False, sort_keys=False)


def dump_stac_ui_sidecar(config: dict) -> str | None:
    """Serialize UI-only state (skeleton editor) to its own YAML.

    Returns None when there's nothing to save — the caller should skip the
    sidecar download in that case rather than emitting an empty file.
    """
    segment_scales = config.get("segmentScales", {})
    non_default = {
        k: v for k, v in segment_scales.items() if abs(v - 1.0) > 0.001
    }
    if not non_default:
        return None
    return yaml.dump(
        {"skeleton_editor": {"segment_scales": non_default}},
        default_flow_style=False,
        sort_keys=False,
    )


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
