import os
from pathlib import Path

import pytest
from backend.mujoco_utils import extract_model_geometry, compute_body_transforms

XML_PATH = os.environ.get(
    "STAC_KEYPOINTS_XML",
    str(Path(__file__).resolve().parent.parent / "data" / "rodent_relaxed.xml"),
)

if not Path(XML_PATH).exists():
    pytest.skip(f"MuJoCo XML not found at {XML_PATH}", allow_module_level=True)


def test_extract_model_geometry():
    result = extract_model_geometry(XML_PATH)
    assert "bodies" in result
    assert "geoms" in result
    assert len(result["bodies"]) > 0
    assert len(result["geoms"]) > 0
    body_names = [b["name"] for b in result["bodies"]]
    assert "torso" in body_names
    assert "pelvis" in body_names
    assert "skull" in body_names
    geom = result["geoms"][0]
    assert "type" in geom
    assert "bodyId" in geom
    assert "bodyName" in geom
    assert "size" in geom
    assert "position" in geom
    assert "quaternion" in geom
    assert "color" in geom


def test_compute_body_transforms():
    result = extract_model_geometry(XML_PATH)
    nq = result["nq"]
    qpos = [0.0] * nq
    qpos[3] = 1.0
    transforms = compute_body_transforms(XML_PATH, qpos)
    assert len(transforms) > 0
    t = transforms[0]
    assert "bodyId" in t
    assert "position" in t
    assert "quaternion" in t
    assert len(t["position"]) == 3
    assert len(t["quaternion"]) == 4
