"""Extract MuJoCo model geometry for Three.js rendering."""
from __future__ import annotations

import mujoco
import numpy as np

_GEOM_TYPE_NAMES = {
    mujoco.mjtGeom.mjGEOM_PLANE: "plane",
    mujoco.mjtGeom.mjGEOM_SPHERE: "sphere",
    mujoco.mjtGeom.mjGEOM_CAPSULE: "capsule",
    mujoco.mjtGeom.mjGEOM_CYLINDER: "cylinder",
    mujoco.mjtGeom.mjGEOM_ELLIPSOID: "ellipsoid",
    mujoco.mjtGeom.mjGEOM_BOX: "box",
}

# When a mesh's smallest AABB half-extent is below this fraction of the next
# one, it's flat (a wing/fin) and a capsule can't represent it — its radius
# balloons to the geom's width, reading as a fat blob. An ellipsoid uses all
# three half-extents and stays flat. Mirrors scripts/preprocess_meshful_xml.py.
# Only used by the degenerate fallback below (a mesh with no vertex data);
# normal meshes now render as real triangles.
ELLIPSOID_FLAT_RATIO = 0.5


def _mesh_aabb_primitive(model, g, pos, quat, rgba, body_id, body_name) -> dict:
    """Fit a mesh geom's AABB with a capsule/ellipsoid/sphere primitive.

    Fallback for meshes that carry no triangle data (``geom_dataid < 0`` or an
    empty vertex block) — normal meshes emit real triangle geometry instead.
    ``geom_aabb`` is ``[cx, cy, cz, hx, hy, hz]`` in the geom-local frame; the
    centre offset is rotated into the body frame and added to the geom's pos.
    """
    aabb = model.geom_aabb[g]
    center_local = np.array([aabb[0], aabb[1], aabb[2]], dtype=np.float64)
    half_x, half_y, half_z = float(aabb[3]), float(aabb[4]), float(aabb[5])
    extents = [half_x, half_y, half_z]

    quat_arr = np.array(quat, dtype=np.float64)
    rotated = np.empty(3, dtype=np.float64)
    mujoco.mju_rotVecQuat(rotated, center_local, quat_arr)
    prim_pos = [float(pos[0] + rotated[0]),
                float(pos[1] + rotated[1]),
                float(pos[2] + rotated[2])]

    # Flat mesh (smallest half-extent << next) → ellipsoid with all three
    # half-extents. A capsule would balloon its radius to the width.
    e_sorted = sorted(extents)
    if e_sorted[0] < ELLIPSOID_FLAT_RATIO * e_sorted[1]:
        return {
            "type": "ellipsoid", "bodyId": body_id, "bodyName": body_name,
            "size": [max(half_x, 1e-5), max(half_y, 1e-5), max(half_z, 1e-5)],
            "position": prim_pos,
            "quaternion": [float(q) for q in quat],
            "color": rgba,
        }

    # Elongated mesh → capsule along the longest AABB axis. MuJoCo capsules
    # default along their local Z axis, so rotate the geom's quat by an
    # axis-alignment quat that maps Z onto that axis.
    longest = int(np.argmax(extents))
    half_long = extents[longest]
    half_short = max(extents[i] for i in range(3) if i != longest)
    radius = half_short
    half_cyl = max(0.0, half_long - half_short)

    sqrt_half = float(np.sqrt(0.5))
    if longest == 0:    # Z → X via +90° around Y
        align = np.array([sqrt_half, 0.0, sqrt_half, 0.0])
    elif longest == 1:  # Z → Y via -90° around X
        align = np.array([sqrt_half, -sqrt_half, 0.0, 0.0])
    else:               # Z → Z, identity
        align = np.array([1.0, 0.0, 0.0, 0.0])

    combined = np.empty(4, dtype=np.float64)
    mujoco.mju_mulQuat(combined, quat_arr, align)
    return {
        "type": "capsule", "bodyId": body_id, "bodyName": body_name,
        "size": [float(radius), float(half_cyl), 0.0],
        "position": prim_pos,
        "quaternion": [float(combined[0]), float(combined[1]),
                       float(combined[2]), float(combined[3])],
        "color": rgba,
    }


def extract_model_geometry(xml_path: str) -> dict:
    """Parse MuJoCo XML and return geometry + hierarchy as JSON-serializable dict."""
    model = mujoco.MjModel.from_xml_path(xml_path)
    data = mujoco.MjData(model)
    mujoco.mj_resetData(model, data)
    mujoco.mj_forward(model, data)

    bodies = []
    body_names_list = []
    for b in range(model.nbody):
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, b) or f"body_{b}"
        parent_id = int(model.body_parentid[b])
        bodies.append({"bodyId": b, "name": name, "parentId": parent_id})
        body_names_list.append(name)

    geoms = []
    for g in range(model.ngeom):
        geom_type = int(model.geom_type[g])
        if geom_type == mujoco.mjtGeom.mjGEOM_PLANE:
            continue
        body_id = int(model.geom_bodyid[g])
        body_name = body_names_list[body_id] if body_id < len(body_names_list) else ""
        rgba = [float(model.geom_rgba[g, i]) for i in range(4)]
        quat = [float(model.geom_quat[g, i]) for i in range(4)]
        pos = [float(model.geom_pos[g, i]) for i in range(3)]

        if geom_type == mujoco.mjtGeom.mjGEOM_MESH:
            # Emit the real triangle mesh so the frontend renders actual
            # geometry (a THREE.BufferGeometry) instead of a capsule/ellipsoid
            # approximation. mesh_vert is in the geom-local frame (its AABB
            # matches geom_aabb), so the geom's own pos/quat place it just like
            # a primitive; mesh_face indices are mesh-local (0-based). Both are
            # left in the MuJoCo (Z-up) frame — the frontend swizzles to Y-up
            # when it builds the BufferGeometry, matching the primitive path.
            mesh_id = int(model.geom_dataid[g])
            vert_num = int(model.mesh_vertnum[mesh_id]) if mesh_id >= 0 else 0
            if mesh_id >= 0 and vert_num > 0:
                va = int(model.mesh_vertadr[mesh_id])
                fa = int(model.mesh_faceadr[mesh_id])
                fn = int(model.mesh_facenum[mesh_id])
                verts = model.mesh_vert[va:va + vert_num]      # (vert_num, 3)
                faces = model.mesh_face[fa:fa + fn]            # (fn, 3), 0-based
                aabb = model.geom_aabb[g]
                geoms.append({
                    "type": "mesh", "bodyId": body_id, "bodyName": body_name,
                    "size": [float(aabb[3]), float(aabb[4]), float(aabb[5])],
                    "position": pos,
                    "quaternion": quat,
                    "color": rgba,
                    "vertices": verts.reshape(-1).astype(float).tolist(),
                    "faces": faces.reshape(-1).astype(int).tolist(),
                })
                continue
            # Degenerate mesh with no vertex data — fall back to an AABB fit.
            geoms.append(
                _mesh_aabb_primitive(model, g, pos, quat, rgba, body_id, body_name)
            )
            continue

        type_name = _GEOM_TYPE_NAMES.get(geom_type, "unknown")
        size = [float(model.geom_size[g, i]) for i in range(3)]
        geoms.append({
            "type": type_name, "bodyId": body_id, "bodyName": body_name,
            "size": size, "position": pos, "quaternion": quat, "color": rgba,
        })

    return {
        "bodies": bodies, "geoms": geoms,
        "nq": int(model.nq), "nv": int(model.nv),
        "nbody": int(model.nbody), "bodyNames": body_names_list,
    }


def compute_body_transforms(xml_path: str, qpos: list[float]) -> list[dict]:
    """Given qpos, run FK and return world-frame body transforms."""
    model = mujoco.MjModel.from_xml_path(xml_path)
    data = mujoco.MjData(model)
    data.qpos[:] = np.array(qpos, dtype=np.float64)
    mujoco.mj_forward(model, data)
    transforms = []
    for b in range(model.nbody):
        transforms.append({
            "bodyId": b,
            "position": [float(data.xpos[b, i]) for i in range(3)],
            "quaternion": [float(data.xquat[b, i]) for i in range(4)],
        })
    return transforms


def compute_body_transforms_batch(
    xml_path: str, qpos_list: list[list[float]]
) -> list[list[dict]]:
    """Compute body transforms for many qpos in one call (no HTTP overhead)."""
    model = mujoco.MjModel.from_xml_path(xml_path)
    data = mujoco.MjData(model)
    all_transforms = []
    for qpos in qpos_list:
        mujoco.mj_resetData(model, data)
        q = np.array(qpos, dtype=np.float64)
        n = min(len(q), model.nq)
        data.qpos[:n] = q[:n]
        mujoco.mj_forward(model, data)
        frame = []
        for b in range(model.nbody):
            frame.append({
                "bodyId": b,
                "position": [float(data.xpos[b, i]) for i in range(3)],
                "quaternion": [float(data.xquat[b, i]) for i in range(4)],
            })
        all_transforms.append(frame)
    return all_transforms
