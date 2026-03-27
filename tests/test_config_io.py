import pytest
import tempfile
from backend.config_io import load_stac_yaml, export_stac_yaml

YAML_PATH = "/home/talmolab/Desktop/SalkResearch/monsees-retarget/configs/stac_rodent_acm.yaml"


def test_load_stac_yaml():
    result = load_stac_yaml(YAML_PATH)
    assert "keypointModelPairs" in result
    assert "keypointInitialOffsets" in result
    assert "scaleFactor" in result
    assert result["keypointModelPairs"]["Snout"] == "skull"
    assert result["keypointModelPairs"]["SpineM"] == "torso"


def test_export_stac_yaml():
    config = load_stac_yaml(YAML_PATH)
    config["keypointInitialOffsets"]["Snout"] = [0.01, 0.02, 0.03]
    with tempfile.NamedTemporaryFile(suffix=".yaml", delete=False) as f:
        export_stac_yaml(config, f.name)
    reloaded = load_stac_yaml(f.name)
    snout = reloaded["keypointInitialOffsets"]["Snout"]
    assert abs(snout[0] - 0.01) < 1e-6
    assert abs(snout[1] - 0.02) < 1e-6
    assert abs(snout[2] - 0.03) < 1e-6
