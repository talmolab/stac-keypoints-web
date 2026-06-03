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


def _extract_single_geom(xml: str, body: str = "b1") -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as f:
        f.write(xml)
        path = f.name
    try:
        result = extract_model_geometry(path)
    finally:
        os.unlink(path)
    geoms = [g for g in result["geoms"] if g["bodyName"] == body]
    assert len(geoms) == 1
    return geoms[0]


def test_mesh_geom_renders_as_primitive():
    # Mesh geoms have no triangle-mesh path on the frontend yet, so the
    # extractor exposes them as a primitive fit to the mesh's AABB (a capsule
    # for elongated meshes, an ellipsoid for flat ones).
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
    g = _extract_single_geom(xml)
    assert g["type"] in ("capsule", "ellipsoid", "sphere")
    # All half-extents positive and finite; position finite (not NaN/inf).
    assert all(s > 0 for s in g["size"] if s) and all(s == s and abs(s) < 100 for s in g["size"])
    assert all(c == c and abs(c) < 100 for c in g["position"])


def test_flat_mesh_renders_as_ellipsoid():
    # A flat mesh (a thin slab) must NOT become a capsule — its radius would
    # balloon to the geom's width and read as a fat blob (the fruitfly wing
    # bug). It should be an ellipsoid keeping all three half-extents, so the
    # smallest stays much thinner than the others.
    xml = textwrap.dedent("""
    <mujoco>
      <asset>
        <mesh name="slab" vertex="-1 -0.5 -0.02  1 -0.5 -0.02  1 0.5 -0.02  -1 0.5 -0.02
                                   -1 -0.5 0.02   1 -0.5 0.02   1 0.5 0.02   -1 0.5 0.02"/>
      </asset>
      <worldbody>
        <body name="b1" pos="0 0 0">
          <geom type="mesh" mesh="slab"/>
        </body>
      </worldbody>
    </mujoco>
    """)
    g = _extract_single_geom(xml)
    assert g["type"] == "ellipsoid"
    sz = sorted(g["size"])
    assert sz[0] < 0.5 * sz[1]  # stayed flat, not ballooned into a capsule radius


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
