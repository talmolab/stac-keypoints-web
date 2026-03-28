"""Quick STAC runner for subset of frames.

Uses Procrustes alignment for root pose, then Jacobian transpose IK to solve
joint angles so the model posture matches the target keypoints.
"""
from __future__ import annotations

import numpy as np
import mujoco
from scipy.spatial.transform import Rotation

from backend.alignment import procrustes_align


# Trunk keypoints used for root IK (Procrustes on these to get root position + quat)
_TRUNK_KEYPOINTS = ["SpineL", "SpineM", "SpineF", "Snout"]


def _rotation_matrix_to_quat(R: np.ndarray) -> np.ndarray:
    """Convert 3x3 rotation matrix to MuJoCo quaternion (w, x, y, z)."""
    rot = Rotation.from_matrix(R)
    q = rot.as_quat()  # scipy returns (x, y, z, w)
    return np.array([q[3], q[0], q[1], q[2]])  # MuJoCo wants (w, x, y, z)


def _jacobian_ik(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    target_positions: np.ndarray,
    kp_names: list[str],
    kp_body_map: dict[str, str],
    offsets: dict[str, list[float]] | None = None,
    max_iter: int = 200,
    step: float = 0.5,
    damping: float = 0.01,
) -> np.ndarray:
    """Jacobian transpose IK to solve joint angles.

    Keeps root position/orientation fixed (set externally via Procrustes)
    and only updates joint DOFs (qpos[7:]).

    Parameters
    ----------
    model : MjModel
    data : MjData with root qpos already set.
    target_positions : (num_keypoints, 3) target world positions in meters.
    kp_names : keypoint names in target_positions order.
    kp_body_map : keypoint name -> MuJoCo body name.
    offsets : keypoint name -> [x, y, z] offset from body origin.
    max_iter : max Jacobian iterations.
    step : gradient step size.
    damping : regularisation for gradient norm.

    Returns
    -------
    qpos copy after IK.
    """
    nv = model.nv

    # Resolve body IDs and active keypoint indices once
    active: list[tuple[int, int, np.ndarray]] = []  # (kp_idx, body_id, offset)
    for kp_name, body_name in kp_body_map.items():
        if kp_name not in kp_names:
            continue
        body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name)
        if body_id < 0:
            continue
        kp_idx = kp_names.index(kp_name)
        off = np.array(offsets[kp_name]) if offsets and kp_name in offsets else np.zeros(3)
        active.append((kp_idx, body_id, off))

    if not active:
        mujoco.mj_forward(model, data)
        return data.qpos.copy()

    best_qpos = data.qpos.copy()
    best_error = float("inf")

    for iteration in range(max_iter):
        mujoco.mj_forward(model, data)

        total_error = 0.0
        grad_nv = np.zeros(nv)

        for kp_idx, body_id, off in active:
            target = target_positions[kp_idx]
            current = data.xpos[body_id] + off
            error = target - current
            total_error += np.linalg.norm(error)

            # Positional Jacobian for this body: shape (3, nv)
            jacp = np.zeros((3, nv))
            mujoco.mj_jacBody(model, data, jacp, None, body_id)

            # Accumulate gradient in velocity space: J^T @ error
            grad_nv += jacp.T @ error

        # Track best solution
        if total_error < best_error:
            best_error = total_error
            best_qpos[:] = data.qpos

        # Convergence check (mean per-keypoint error < 1mm)
        if total_error / len(active) < 0.001:
            break

        # Only update joint DOFs: skip freejoint 6 DOFs in vel space (indices 0:6),
        # which correspond to qpos[0:7] (3 pos + 4 quat).
        # Joint angles qpos[7:] map 1:1 to qvel[6:].
        joint_grad = grad_nv[6:]
        grad_norm = np.linalg.norm(joint_grad)
        if grad_norm > 1e-10:
            data.qpos[7:] += step * joint_grad / (grad_norm + damping)

        # Clamp to joint limits
        for i in range(model.njnt):
            if model.jnt_limited[i]:
                addr = model.jnt_qposadr[i]
                if addr < 7:
                    continue  # skip root
                lo = model.jnt_range[i, 0]
                hi = model.jnt_range[i, 1]
                data.qpos[addr] = np.clip(data.qpos[addr], lo, hi)

    # Use best solution found
    data.qpos[:] = best_qpos
    mujoco.mj_forward(model, data)
    return data.qpos.copy()


def run_quick_stac(
    kp_positions_flat: list[float],
    num_frames: int,
    num_keypoints: int,
    kp_names: list[str],
    xml_path: str,
    frame_indices: list[int],
    offsets: dict[str, list[float]] | None = None,
    mappings: dict[str, str] | None = None,
    scale_factor: float = 0.9,
    mocap_scale_factor: float = 0.01,
) -> dict:
    """Run IK on a subset of frames and return qpos + body transforms.

    For each frame:
    1. Find trunk keypoints in both ACM and MuJoCo spaces
    2. Procrustes align MuJoCo trunk to ACM trunk to get root R, t
    3. Set qpos root position/quaternion accordingly
    4. Run Jacobian transpose IK to solve joint angles
    5. Collect body transforms
    """
    positions = np.array(kp_positions_flat).reshape(num_frames, num_keypoints, 3)

    model = mujoco.MjModel.from_xml_path(xml_path)
    data = mujoco.MjData(model)

    # Get MuJoCo default pose body positions for trunk keypoints
    mujoco.mj_resetData(model, data)
    mujoco.mj_forward(model, data)

    # Determine which trunk keypoints we can use (need both kp_name in kp_names and body in mappings)
    trunk_kps_available = []
    if mappings:
        for tkp in _TRUNK_KEYPOINTS:
            if tkp in kp_names and tkp in mappings:
                body_name = mappings[tkp]
                body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name)
                if body_id >= 0:
                    trunk_kps_available.append(tkp)

    # If we don't have enough trunk keypoints, use any mapped keypoints
    if len(trunk_kps_available) < 3 and mappings:
        trunk_kps_available = [
            kp for kp in kp_names
            if kp in mappings and mujoco.mj_name2id(
                model, mujoco.mjtObj.mjOBJ_BODY, mappings[kp]
            ) >= 0
        ]

    # Get MuJoCo default-pose positions for selected keypoints (in meters, scaled)
    mj_trunk_positions = []
    for kp in trunk_kps_available:
        if mappings and kp in mappings:
            body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, mappings[kp])
            if body_id >= 0:
                pos = data.xpos[body_id].copy() * scale_factor
                if offsets and kp in offsets:
                    pos += np.array(offsets[kp])
                mj_trunk_positions.append(pos)
    mj_trunk_arr = np.array(mj_trunk_positions) if mj_trunk_positions else None

    all_qpos = []
    all_errors = []
    all_body_transforms = []

    prev_qpos = None

    for frame_idx in frame_indices:
        if frame_idx >= num_frames:
            continue

        # Target positions for this frame (cm -> meters)
        target_m = positions[frame_idx] * mocap_scale_factor

        # Reset to default pose or use previous frame for temporal coherence
        if prev_qpos is not None:
            data.qpos[:] = prev_qpos
        else:
            mujoco.mj_resetData(model, data)

        if mj_trunk_arr is not None and len(trunk_kps_available) >= 3:
            # Get ACM trunk keypoint positions for this frame
            acm_trunk_positions = []
            for kp in trunk_kps_available:
                kp_idx = kp_names.index(kp)
                acm_trunk_positions.append(target_m[kp_idx])
            acm_trunk_arr = np.array(acm_trunk_positions)

            # Procrustes: align MuJoCo trunk to ACM trunk
            result = procrustes_align(mj_trunk_arr, acm_trunk_arr, allow_scale=False)
            R = result["R"]
            t = result["t"]

            # Convert rotation to quaternion
            quat = _rotation_matrix_to_quat(R)

            # Set root position and quaternion from Procrustes alignment
            data.qpos[0:3] = t
            data.qpos[3:7] = quat
        else:
            # Fallback: just set root position to mean of target keypoints
            mean_target = target_m.mean(axis=0)
            data.qpos[0] = mean_target[0]
            data.qpos[1] = mean_target[1]
            data.qpos[2] = mean_target[2]
            data.qpos[3] = 1.0  # quaternion w

        # Run Jacobian IK to solve joint angles
        if mappings:
            solved_qpos = _jacobian_ik(
                model, data, target_m, kp_names, mappings,
                offsets=offsets, max_iter=200, step=0.5, damping=0.01,
            )
            data.qpos[:] = solved_qpos
        mujoco.mj_forward(model, data)

        prev_qpos = data.qpos.copy()

        # Compute error: mean distance from model bodies to target keypoints
        if mappings:
            errors = []
            for kp_name, body_name in mappings.items():
                if kp_name not in kp_names:
                    continue
                kp_idx = kp_names.index(kp_name)
                body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name)
                if body_id >= 0:
                    body_pos = data.xpos[body_id]
                    offset = np.zeros(3)
                    if offsets and kp_name in offsets:
                        offset = np.array(offsets[kp_name])
                    dist = np.linalg.norm((body_pos + offset) - target_m[kp_idx])
                    errors.append(dist)
            mean_error = float(np.mean(errors)) if errors else 0.0
        else:
            mean_error = 0.0

        # Collect body transforms for this frame
        frame_transforms = []
        for b in range(model.nbody):
            frame_transforms.append({
                "bodyId": b,
                "position": [float(data.xpos[b, i]) for i in range(3)],
                "quaternion": [float(data.xquat[b, i]) for i in range(4)],
            })

        all_qpos.append(data.qpos[:].tolist())
        all_errors.append(mean_error)
        all_body_transforms.append(frame_transforms)

    # Compute model center from last frame body positions (for frontend positioning)
    model_center = [0.0, 0.0, 0.0]
    if all_body_transforms:
        last_frame = all_body_transforms[-1]
        if last_frame:
            positions_arr = np.array([bt["position"] for bt in last_frame])
            center = positions_arr.mean(axis=0)
            model_center = center.tolist()

    return {
        "qpos": all_qpos,
        "errors": all_errors,
        "frameIndices": frame_indices[:len(all_qpos)],
        "bodyTransforms": all_body_transforms,
        "modelCenter": model_center,
    }
