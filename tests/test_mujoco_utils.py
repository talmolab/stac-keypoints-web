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


def _assert_valid_mesh(g: dict) -> None:
    """A mesh geom must carry real, renderable triangle data."""
    assert g["type"] == "mesh"
    verts = g["vertices"]
    faces = g["faces"]
    assert len(verts) > 0 and len(verts) % 3 == 0
    assert len(faces) > 0 and len(faces) % 3 == 0
    n_verts = len(verts) // 3
    assert all(v == v and abs(v) < 1e4 for v in verts)  # finite, sane scale
    # Face indices are mesh-local (0-based) and in range — safe to hand to
    # THREE.BufferGeometry.setIndex without an out-of-bounds read.
    assert all(isinstance(i, int) and 0 <= i < n_verts for i in faces)
    # pos/quat still place the mesh in the body frame like a primitive.
    assert all(c == c and abs(c) < 100 for c in g["position"])
    assert len(g["quaternion"]) == 4


def test_mesh_geom_renders_as_triangles():
    # Mesh geoms now emit the real triangle geometry (a THREE.BufferGeometry on
    # the frontend), not a capsule/ellipsoid fit to the AABB.
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
    _assert_valid_mesh(g)


def test_flat_mesh_renders_as_triangles():
    # A flat mesh (a thin slab) also renders as its real triangles — the old
    # AABB→ellipsoid fallback (to avoid a ballooned capsule radius) is gone now
    # that we draw the actual surface. Its vertices span all three axes with a
    # much thinner extent along the flat one.
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
    _assert_valid_mesh(g)
    sz = sorted(g["size"])  # AABB half-extents kept for reference/bounds
    assert sz[0] < 0.5 * sz[1]  # still flat along its thin axis


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
