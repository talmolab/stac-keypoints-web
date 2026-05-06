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
            # The frontend has no triangle-mesh path (deferred to the WASM SPA
            # migration in M6). Fall back to the mesh's axis-aligned bounding
            # box so body locations are visible — enough fidelity to map
            # keypoints. geom_aabb is [cx, cy, cz, hx, hy, hz] in geom-local
            # frame, so the box's center sits at geom_pos + R(geom_quat) *
            # aabb_center, oriented like the mesh.
            aabb = model.geom_aabb[g]
            center_local = np.array([aabb[0], aabb[1], aabb[2]], dtype=np.float64)
            half = [float(aabb[3]), float(aabb[4]), float(aabb[5])]
            rotated = np.empty(3, dtype=np.float64)
            mujoco.mju_rotVecQuat(rotated, center_local, np.array(quat, dtype=np.float64))
            box_pos = [float(pos[0] + rotated[0]),
                       float(pos[1] + rotated[1]),
                       float(pos[2] + rotated[2])]
            geoms.append({
                "type": "box", "bodyId": body_id, "bodyName": body_name,
                "size": half, "position": box_pos, "quaternion": quat, "color": rgba,
            })
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
