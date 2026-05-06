import os
import tempfile
import textwrap
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


def test_mesh_geom_renders_as_aabb_box():
    # Mesh geoms have no triangle-mesh path on the frontend yet, so the
    # extractor should expose them as a box matching the mesh's AABB.
    xml = textwrap.dedent("""
    <mujoco>
      <asset>
        <mesh name="m1" vertex="0 0 0  1 0 0  0 2 0  0 0 3"/>
      </asset>
      <worldbody>
        <body name="b1" pos="0 0 0">
          <geom type="mesh" mesh="m1"/>
        </body>
      </worldbody>
    </mujoco>
    """)
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as f:
        f.write(xml)
        path = f.name
    try:
        result = extract_model_geometry(path)
    finally:
        os.unlink(path)
    geoms = [g for g in result["geoms"] if g["bodyName"] == "b1"]
    assert len(geoms) == 1
    g = geoms[0]
    assert g["type"] == "box"
    # Verts span x:[0,1], y:[0,2], z:[0,3]. MuJoCo's compiler recenters the
    # mesh on its inertial frame, so the box's exact pose moves; what we
    # verify is that each half-extent ends up in the right ballpark for the
    # corresponding axis (the ordering of axes survives recentering).
    sx, sy, sz = g["size"]
    assert 0.3 < sx < 0.7  # ≈ 0.5
    assert 0.7 < sy < 1.3  # ≈ 1.0
    assert 1.3 < sz < 1.9  # ≈ 1.5
    # Position should be finite, not NaN/inf.
    for c in g["position"]:
        assert c == c and abs(c) < 100  # finite


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
