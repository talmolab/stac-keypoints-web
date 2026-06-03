"""Convert a MuJoCo XML with `<mesh file="...">` refs into a single-file XML
with mesh geoms replaced by capsules (or spheres for round meshes), using
each mesh's AABB as computed by MuJoCo at compile time.

Why: @mujoco/mujoco's wasm runtime calls `mj_loadXML`, which rejects missing
asset files. Bundling the asset directories alongside the XML would balloon
the SPA payload by tens of MB. The capsule fallback already used by the
backend's mujoco_utils.extract_model_geometry reads well enough for the
keypoint-mapping workflow; baking it into the XML at build time means the
browser doesn't need any mesh data at all.

Algorithm mirrors backend/mujoco_utils.py:extract_model_geometry's mesh
branch — same axis-alignment quat math, same radius/cylinder split. We
fall back to sphere when the cylinder portion would be a tiny fraction of
the radius (otherwise MuJoCo's compiler rejects sub-µm capsule lengths,
and visually a sphere reads correctly anyway).
"""
from __future__ import annotations

from collections import defaultdict, deque
from pathlib import Path
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

# A capsule's cylinder portion needs to be at least this fraction of the
# radius for the conversion to read as elongated; below that, a sphere of
# radius=half_short is cleaner and avoids MuJoCo's positivity validation.
CAPSULE_MIN_CYL_RATIO = 0.3
CAPSULE_MIN_CYL_ABS = 1e-5

# When the smallest AABB half-extent is below this fraction of the next one,
# the mesh is flat (a wing/fin) and a capsule can't represent it — its radius
# would balloon to the geom's *width*, reading as a fat blob over the model.
# An ellipsoid uses all three half-extents and stays flat. (The fly's wings
# already carry thin collision *ellipsoids*; this makes the visual geom match.)
ELLIPSOID_FLAT_RATIO = 0.5


def _is_mesh_geom(geom: ET.Element) -> bool:
    """A geom is mesh-typed if it explicitly says so, or if it has a `mesh`
    attribute (which forces the type even when inherited via `<default>`)."""
    return geom.get("type") == "mesh" or "mesh" in geom.attrib


def _collect_mesh_geoms(model: "mujoco.MjModel") -> dict[str, deque[tuple]]:
    """Walk compiled mesh geoms in document order, queueing (aabb, pos, quat)
    by parent-body name. The XML walker pops from these queues in matching
    document order — this keeps multiple mesh geoms on the same body lined up.

    Critically, we use the COMPILED ``geom_pos``/``geom_quat`` rather than the
    XML element's own ``pos``/``quat`` attributes: a mesh geom's compiled frame
    bakes in the mesh asset's reference frame and any class-inherited transform,
    so it differs from the raw attributes (often wildly). The raw attributes
    placed the replacement primitive in the wrong spot — capsules hid it as a
    blob, ellipsoids made it obvious. This matches the backend extractor, which
    reads the compiled values."""
    queues: dict[str, deque[tuple]] = defaultdict(deque)
    for g in range(model.ngeom):
        if int(model.geom_type[g]) != int(mujoco.mjtGeom.mjGEOM_MESH):
            continue
        body_id = int(model.geom_bodyid[g])
        body_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, body_id)
        queues[body_name].append((
            np.array(model.geom_aabb[g]),
            np.array(model.geom_pos[g]),
            np.array(model.geom_quat[g]),
        ))
    return queues


def _mesh_to_capsule_attrs(aabb: np.ndarray, pos0: np.ndarray, quat0: np.ndarray) -> dict[str, str]:
    """Compute geom-element attrs (type, size, pos, quat) for the AABB."""
    cx, cy, cz = float(aabb[0]), float(aabb[1]), float(aabb[2])
    hx, hy, hz = float(aabb[3]), float(aabb[4]), float(aabb[5])
    extents = [hx, hy, hz]
    longest = int(np.argmax(extents))
    half_long = extents[longest]
    half_short = max(extents[i] for i in range(3) if i != longest)
    cyl = half_long - half_short

    rotated = np.empty(3, dtype=np.float64)
    mujoco.mju_rotVecQuat(rotated, np.array([cx, cy, cz]), quat0)
    new_pos = pos0 + rotated

    attrs: dict[str, str] = {"pos": " ".join(f"{v:.6g}" for v in new_pos)}

    # Flat mesh → ellipsoid. Must precede the sphere/capsule split: a capsule
    # would balloon its radius to the width, and a sphere would discard the
    # flatness. The ellipsoid's axes are the geom-local frame, so it keeps the
    # geom's own quat (no Z-to-longest alignment needed).
    e_sorted = sorted(extents)
    if e_sorted[0] < ELLIPSOID_FLAT_RATIO * e_sorted[1]:
        attrs["type"] = "ellipsoid"
        attrs["size"] = " ".join(f"{max(h, 1e-5):.6g}" for h in extents)
        attrs["quat"] = " ".join(f"{v:.6g}" for v in quat0)
        return attrs

    if (half_short < 1e-9
        or cyl < CAPSULE_MIN_CYL_RATIO * half_short
        or cyl < CAPSULE_MIN_CYL_ABS):
        attrs["type"] = "sphere"
        attrs["size"] = f"{max(half_short, 1e-5):.6g}"
        return attrs

    sqrt_half = float(np.sqrt(0.5))
    align = [
        np.array([sqrt_half, 0.0, sqrt_half, 0.0]),  # Z → X
        np.array([sqrt_half, -sqrt_half, 0.0, 0.0]),  # Z → Y
        np.array([1.0, 0.0, 0.0, 0.0]),  # Z → Z
    ][longest]
    combined = np.empty(4, dtype=np.float64)
    mujoco.mju_mulQuat(combined, quat0, align)
    attrs["type"] = "capsule"
    attrs["size"] = f"{half_short:.6g} {cyl:.6g}"
    attrs["quat"] = " ".join(f"{v:.6g}" for v in combined)
    return attrs


def preprocess(xml_path: Path, out_path: Path) -> dict:
    """Read xml_path, write out_path with mesh geoms replaced. Returns
    a {n_replaced, n_sphere, n_capsule, out_bytes} report."""
    model = mujoco.MjModel.from_xml_path(str(xml_path))
    queues = _collect_mesh_geoms(model)

    tree = ET.parse(xml_path)
    root = tree.getroot()
    n_replaced = n_sphere = n_ellipsoid = 0

    def walk_body(body_el: ET.Element, body_name: str) -> None:
        nonlocal n_replaced, n_sphere, n_ellipsoid
        for geom in list(body_el.findall("geom")):
            if not _is_mesh_geom(geom):
                continue
            queue = queues.get(body_name)
            if not queue:
                continue
            # Compiled pos/quat (not the XML attributes — see _collect_mesh_geoms).
            aabb, pos0, quat0 = queue.popleft()
            new_attrs = _mesh_to_capsule_attrs(aabb, pos0, quat0)
            # Strip mesh-only attrs and any class= that supplied type="mesh".
            # pos/quat are overwritten from new_attrs with the compiled frame.
            for attr in ("mesh", "fitscale", "type", "class", "pos", "quat"):
                geom.attrib.pop(attr, None)
            for k, v in new_attrs.items():
                geom.set(k, v)
            n_replaced += 1
            if new_attrs["type"] == "sphere":
                n_sphere += 1
            elif new_attrs["type"] == "ellipsoid":
                n_ellipsoid += 1
        for child in body_el.findall("body"):
            walk_body(child, child.get("name") or "")

    worldbody = root.find("worldbody")
    if worldbody is not None:
        for body in worldbody.findall("body"):
            walk_body(body, body.get("name") or "")

    for asset in list(root.findall("asset")):
        for mesh in list(asset.findall("mesh")):
            asset.remove(mesh)
        if len(list(asset)) == 0:
            root.remove(asset)

    for comp in root.findall("compiler"):
        comp.attrib.pop("meshdir", None)

    ET.indent(tree, space="  ")
    tree.write(out_path, encoding="utf-8", xml_declaration=False)

    # Validate by recompiling — output XML must load standalone.
    mujoco.MjModel.from_xml_path(str(out_path))
    return {
        "n_replaced": n_replaced,
        "n_sphere": n_sphere,
        "n_ellipsoid": n_ellipsoid,
        "n_capsule": n_replaced - n_sphere - n_ellipsoid,
        "out_bytes": out_path.stat().st_size,
    }
