"""Procrustes alignment and coordinate conversion for ACM <-> MuJoCo."""
from __future__ import annotations

import numpy as np
import mujoco


def procrustes_align(
    source: np.ndarray,
    target: np.ndarray,
    allow_scale: bool = True,
) -> dict:
    """Rigid Procrustes alignment of source to target."""
    mu_src = source.mean(axis=0)
    mu_tgt = target.mean(axis=0)
    src_c = source - mu_src
    tgt_c = target - mu_tgt
    H = src_c.T @ tgt_c
    U, S, Vt = np.linalg.svd(H)
    d = np.linalg.det(U @ Vt)
    sign_mat = np.diag([1.0, 1.0, np.sign(d)])
    R = U @ sign_mat @ Vt
    if allow_scale:
        denom = np.sum(src_c ** 2)
        s = np.sum(S) / denom if denom > 1e-12 else 1.0
    else:
        s = 1.0
    t = mu_tgt - s * (R @ mu_src)
    aligned = s * (source @ R.T) + t
    return {"R": R, "t": t, "s": s, "aligned": aligned}


def bbox_align(
    source: np.ndarray,
    target: np.ndarray,
) -> dict:
    """Bounding-box alignment: scale source AABB to match target AABB.

    This is a simple fallback when Procrustes produces unreasonable scales.
    It uniformly scales source so its bounding box diagonal matches target's,
    then translates so the centroids coincide.
    """
    src_min = source.min(axis=0)
    src_max = source.max(axis=0)
    tgt_min = target.min(axis=0)
    tgt_max = target.max(axis=0)

    src_diag = np.linalg.norm(src_max - src_min)
    tgt_diag = np.linalg.norm(tgt_max - tgt_min)

    if src_diag < 1e-12:
        s = 1.0
    else:
        s = tgt_diag / src_diag

    src_center = (src_min + src_max) / 2.0
    tgt_center = (tgt_min + tgt_max) / 2.0

    t = tgt_center - s * src_center

    aligned = s * source + t
    return {
        "R": np.eye(3),
        "t": t,
        "s": s,
        "aligned": aligned,
    }


def get_mujoco_keypoint_positions(
    xml_path: str,
    kp_body_map: dict[str, str],
    scale_factor: float = 1.0,
) -> dict[str, np.ndarray]:
    """Get keypoint positions from MuJoCo default pose."""
    model = mujoco.MjModel.from_xml_path(xml_path)
    data = mujoco.MjData(model)
    mujoco.mj_resetData(model, data)
    mujoco.mj_forward(model, data)
    positions = {}
    for kp_name, body_name in kp_body_map.items():
        body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name)
        if body_id >= 0:
            positions[kp_name] = data.xpos[body_id].copy() * scale_factor
    return positions


def align_acm_to_mujoco(
    acm_positions: np.ndarray,
    kp_names: list[str],
    xml_path: str,
    kp_body_map: dict[str, str],
    scale_factor: float = 0.9,
    mocap_scale_factor: float = 0.01,
) -> dict:
    """Align ACM keypoints (cm) to MuJoCo default pose.

    First tries Procrustes alignment. If the resulting scale is unreasonable
    (>10 or <0.001), falls back to bounding-box alignment.
    """
    mj_positions = get_mujoco_keypoint_positions(xml_path, kp_body_map, scale_factor)
    # Only align keypoints that exist in both sets
    common_kps = [kp for kp in kp_names if kp in mj_positions]
    if len(common_kps) < 3:
        return {"error": "Need at least 3 common keypoints for alignment"}
    kp_indices = [kp_names.index(kp) for kp in common_kps]
    # MuJoCo positions in "ACM-comparable" space (divide out mocap scale)
    mj_array = np.array([mj_positions[kp] / mocap_scale_factor for kp in common_kps])
    mean_acm = acm_positions.mean(axis=0)
    source_subset = mean_acm[kp_indices]

    # Try Procrustes alignment
    result = procrustes_align(source_subset, mj_array, allow_scale=True)
    s = result["s"]

    # Check if scale is reasonable
    use_bbox = False
    if s > 10 or s < 0.001:
        use_bbox = True

    if use_bbox:
        # Fall back to bounding-box alignment
        result = bbox_align(source_subset, mj_array)
        s = result["s"]

    T = acm_positions.shape[0]
    R, t = result["R"], result["t"]
    aligned = np.zeros_like(acm_positions)
    for i in range(T):
        aligned[i] = s * (acm_positions[i] @ R.T) + t

    return {
        "rotation": R.tolist(),
        "translation": t.tolist(),
        "scale": float(s),
        "alignedPositions": aligned.flatten().tolist(),
        "method": "bbox" if use_bbox else "procrustes",
    }
