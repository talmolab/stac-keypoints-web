import os
import tempfile
import textwrap
from pathlib import Path

import pytest
import yaml
from backend.config_io import (
    dump_stac_ui_sidecar,
    dump_stac_yaml,
    export_stac_yaml,
    load_stac_yaml,
)

YAML_PATH = os.environ.get(
    "STAC_KEYPOINTS_CONFIG",
    str(Path(__file__).resolve().parent.parent / "data" / "stac_rodent_acm.yaml"),
)


@pytest.fixture
def wrapped_yaml():
    if not Path(YAML_PATH).exists():
        pytest.skip(f"STAC YAML not found at {YAML_PATH}")
    return YAML_PATH


def test_load_stac_yaml(wrapped_yaml):
    result = load_stac_yaml(wrapped_yaml)
    assert "keypointModelPairs" in result
    assert "keypointInitialOffsets" in result
    assert "scaleFactor" in result
    assert result["keypointModelPairs"]["Snout"] == "skull"
    assert result["keypointModelPairs"]["SpineM"] == "torso"


def test_export_stac_yaml(wrapped_yaml):
    config = load_stac_yaml(wrapped_yaml)
    config["keypointInitialOffsets"]["Snout"] = [0.01, 0.02, 0.03]
    with tempfile.NamedTemporaryFile(suffix=".yaml", delete=False) as f:
        export_stac_yaml(config, f.name)
    reloaded = load_stac_yaml(f.name)
    snout = reloaded["keypointInitialOffsets"]["Snout"]
    assert abs(snout[0] - 0.01) < 1e-6
    assert abs(snout[1] - 0.02) < 1e-6
    assert abs(snout[2] - 0.03) < 1e-6


def test_load_stac_yaml_flat_format(tmp_path):
    """Stock stac-mjx model configs are flat (no `model:` wrapper)."""
    flat = textwrap.dedent(
        """
        MJCF_PATH: "models/rodent.xml"
        SCALE_FACTOR: 0.9
        MOCAP_SCALE_FACTOR: 0.001
        KP_NAMES:
          - Snout
          - SpineF
        KEYPOINT_MODEL_PAIRS:
          Snout: skull
          SpineF: vertebra_cervical_5
        KEYPOINT_INITIAL_OFFSETS:
          Snout: 0. 0. 0.
          SpineF: -0.015 0. 0.0
        """
    )
    path = tmp_path / "flat.yaml"
    path.write_text(flat)

    result = load_stac_yaml(str(path))
    assert result["keypointModelPairs"]["Snout"] == "skull"
    assert result["keypointModelPairs"]["SpineF"] == "vertebra_cervical_5"
    assert result["kpNames"] == ["Snout", "SpineF"]
    assert result["xmlPath"] == "models/rodent.xml"
    assert result["scaleFactor"] == 0.9
    assert result["mocapScaleFactor"] == 0.001
    spine = result["keypointInitialOffsets"]["SpineF"]
    assert abs(spine[0] - -0.015) < 1e-6


def test_load_includes_raw_template(tmp_path):
    """load_stac_yaml returns the full parsed YAML as _rawTemplate."""
    src = textwrap.dedent(
        """
        MJCF_PATH: "models/rodent.xml"
        N_ITERS: 6
        SITES_TO_REGULARIZE:
          - HandL
          - HandR
        KEYPOINT_MODEL_PAIRS:
          Snout: skull
        """
    )
    path = tmp_path / "with_extras.yaml"
    path.write_text(src)

    result = load_stac_yaml(str(path))
    raw = result["_rawTemplate"]
    assert raw["N_ITERS"] == 6
    assert raw["SITES_TO_REGULARIZE"] == ["HandL", "HandR"]
    assert raw["KEYPOINT_MODEL_PAIRS"]["Snout"] == "skull"


def test_dump_with_flat_template_preserves_other_fields(tmp_path):
    """Template-overlay export keeps non-UI fields (N_ITERS, SITES_TO_REGULARIZE, ...)."""
    src = textwrap.dedent(
        """
        MJCF_PATH: "models/rodent.xml"
        N_ITERS: 6
        N_ITER_Q: 400
        ROOT_OPTIMIZATION_KEYPOINT: SpineL
        SITES_TO_REGULARIZE:
          - HandL
          - HandR
        KEYPOINT_MODEL_PAIRS:
          Snout: skull
          SpineF: vertebra_cervical_5
        KEYPOINT_INITIAL_OFFSETS:
          Snout: 0. 0. 0.
          SpineF: -0.015 0. 0.0
        KP_NAMES: [Snout, SpineF]
        SCALE_FACTOR: 0.9
        MOCAP_SCALE_FACTOR: 0.001
        """
    )
    path = tmp_path / "flat.yaml"
    path.write_text(src)
    loaded = load_stac_yaml(str(path))

    # Simulate a UI edit: reassign Snout to a different body, change scale.
    loaded["keypointModelPairs"]["Snout"] = "head"
    loaded["scaleFactor"] = 1.1

    out_yaml = dump_stac_yaml(loaded)
    out = yaml.safe_load(out_yaml)

    # UI edits applied
    assert out["KEYPOINT_MODEL_PAIRS"]["Snout"] == "head"
    assert out["SCALE_FACTOR"] == 1.1
    # Preserved from template
    assert out["N_ITERS"] == 6
    assert out["N_ITER_Q"] == 400
    assert out["ROOT_OPTIMIZATION_KEYPOINT"] == "SpineL"
    assert out["SITES_TO_REGULARIZE"] == ["HandL", "HandR"]
    # Shape preserved: flat (not wrapped under `model:`)
    assert "model" not in out


def test_dump_with_wrapped_template_preserves_shape(tmp_path):
    """Wrapped UI-format templates round-trip as wrapped."""
    src = textwrap.dedent(
        """
        model:
          MJCF_PATH: models/rodent.xml
          N_ITERS: 6
          KEYPOINT_MODEL_PAIRS:
            Snout: skull
          KEYPOINT_INITIAL_OFFSETS:
            Snout: 0. 0. 0.
          KP_NAMES: [Snout]
          SCALE_FACTOR: 0.9
          MOCAP_SCALE_FACTOR: 0.001
        """
    )
    path = tmp_path / "wrapped.yaml"
    path.write_text(src)
    loaded = load_stac_yaml(str(path))

    out = yaml.safe_load(dump_stac_yaml(loaded))
    assert "model" in out and "MJCF_PATH" in out["model"]
    assert out["model"]["N_ITERS"] == 6


def test_dump_strips_skeleton_editor_from_main_export(tmp_path):
    """`skeleton_editor:` never leaks into the main stac-mjx export."""
    src = textwrap.dedent(
        """
        MJCF_PATH: "models/rodent.xml"
        N_ITERS: 6
        KEYPOINT_MODEL_PAIRS: {Snout: skull}
        KEYPOINT_INITIAL_OFFSETS: {Snout: 0. 0. 0.}
        KP_NAMES: [Snout]
        SCALE_FACTOR: 0.9
        MOCAP_SCALE_FACTOR: 0.001
        skeleton_editor:
          segment_scales:
            'SpineF->SpineM': 1.05
        """
    )
    path = tmp_path / "with_ui.yaml"
    path.write_text(src)
    loaded = load_stac_yaml(str(path))

    out = yaml.safe_load(dump_stac_yaml(loaded))
    assert "skeleton_editor" not in out


def test_dump_without_template_emits_wrapped():
    """No template → UI-internal wrapped format (not a valid stac-mjx config)."""
    config = {
        "keypointModelPairs": {"Snout": "skull"},
        "keypointInitialOffsets": {"Snout": [0.0, 0.0, 0.0]},
        "scaleFactor": 0.9,
        "mocapScaleFactor": 0.01,
        "kpNames": ["Snout"],
        "xmlPath": "models/rodent.xml",
    }
    out = yaml.safe_load(dump_stac_yaml(config))
    assert "model" in out
    assert out["model"]["KEYPOINT_MODEL_PAIRS"]["Snout"] == "skull"


def test_dump_empty_ui_field_does_not_clobber_template(tmp_path):
    """Exporting without loaded mocap must not wipe the template's KP_NAMES.

    Reproduces a bug where loading a config without any keypoint data loaded
    yielded KP_NAMES=[] on export, overwriting the template's populated list.
    """
    src = textwrap.dedent(
        """
        MJCF_PATH: "models/rodent.xml"
        N_ITERS: 6
        KEYPOINT_MODEL_PAIRS:
          Snout: skull
          SpineF: vertebra_cervical_5
        KEYPOINT_INITIAL_OFFSETS:
          Snout: 0. 0. 0.
          SpineF: 0. 0. 0.
        KP_NAMES:
          - Snout
          - SpineF
          - SpineM
        SCALE_FACTOR: 0.9
        MOCAP_SCALE_FACTOR: 0.001
        """
    )
    path = tmp_path / "with_kp_names.yaml"
    path.write_text(src)
    loaded = load_stac_yaml(str(path))

    # Simulate the UI state right after loading config but before loading any
    # mocap data: kpNames/keypointModelPairs still present from the template,
    # but if the user cleared them (or they were never populated in state),
    # we must not clobber what the template already has.
    loaded["kpNames"] = []  # UI hasn't loaded mocap → empty
    out = yaml.safe_load(dump_stac_yaml(loaded))
    assert out["KP_NAMES"] == ["Snout", "SpineF", "SpineM"]


def test_dump_empty_field_when_template_also_empty():
    """If the template has no value either, emit whatever the UI has (incl. empty)."""
    config = {
        "keypointModelPairs": {"Snout": "skull"},
        "keypointInitialOffsets": {},
        "kpNames": [],
        "scaleFactor": 0.9,
        "mocapScaleFactor": 0.01,
        "xmlPath": "models/rodent.xml",
        "_rawTemplate": {
            "MJCF_PATH": "models/rodent.xml",
            "N_ITERS": 6,
        },
    }
    out = yaml.safe_load(dump_stac_yaml(config))
    # UI field overrides are applied when template has nothing to preserve.
    assert out["KEYPOINT_MODEL_PAIRS"] == {"Snout": "skull"}
    assert out["N_ITERS"] == 6


def test_dump_ui_sidecar_none_when_default():
    """Sidecar returns None when there's no UI-only state worth saving."""
    assert dump_stac_ui_sidecar({"segmentScales": {}}) is None
    assert dump_stac_ui_sidecar({"segmentScales": {"SpineF->SpineM": 1.0}}) is None


def test_dump_ui_sidecar_emits_non_default_scales():
    body = dump_stac_ui_sidecar(
        {"segmentScales": {"SpineF->SpineM": 1.05, "HipL->KneeL": 1.0}}
    )
    assert body is not None
    parsed = yaml.safe_load(body)
    # Non-default kept, default dropped.
    assert parsed["skeleton_editor"]["segment_scales"] == {"SpineF->SpineM": 1.05}
