import os
import tempfile
import textwrap
from pathlib import Path

import pytest
from backend.config_io import load_stac_yaml, export_stac_yaml

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
