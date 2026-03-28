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
        if int(model.geom_group[g]) >= 3:
            continue
        type_name = _GEOM_TYPE_NAMES.get(geom_type, "unknown")
        body_id = int(model.geom_bodyid[g])
        body_name = body_names_list[body_id] if body_id < len(body_names_list) else ""
        size = [float(model.geom_size[g, i]) for i in range(3)]
        pos = [float(model.geom_pos[g, i]) for i in range(3)]
        quat = [float(model.geom_quat[g, i]) for i in range(4)]
        rgba = [float(model.geom_rgba[g, i]) for i in range(4)]
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
    mujoco.mj_resetData(model, data)
    # Handle qpos length mismatch: pad with defaults or truncate
    q = np.array(qpos, dtype=np.float64)
    n = min(len(q), model.nq)
    data.qpos[:n] = q[:n]
    mujoco.mj_forward(model, data)
    transforms = []
    for b in range(model.nbody):
        transforms.append({
            "bodyId": b,
            "position": [float(data.xpos[b, i]) for i in range(3)],
            "quaternion": [float(data.xquat[b, i]) for i in range(4)],
        })
    return transforms
