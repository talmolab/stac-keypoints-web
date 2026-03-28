"""Quick STAC runner for subset of frames."""
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
    """Run simplified IK on a subset of frames and return qpos + body transforms.

    For each frame:
    1. Find trunk keypoints in both ACM and MuJoCo spaces
    2. Procrustes align MuJoCo trunk to ACM trunk to get root R, t
    3. Set qpos root position/quaternion accordingly
    4. Run mj_forward to get body transforms
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

    for frame_idx in frame_indices:
        if frame_idx >= num_frames:
            continue

        # Target positions for this frame (cm -> meters)
        target_m = positions[frame_idx] * mocap_scale_factor

        # Reset to default pose
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

            # Set root position and quaternion
            data.qpos[0:3] = t
            data.qpos[3:7] = quat
        else:
            # Fallback: just set root position to mean of target keypoints
            mean_target = target_m.mean(axis=0)
            data.qpos[0] = mean_target[0]
            data.qpos[1] = mean_target[1]
            data.qpos[2] = mean_target[2]
            data.qpos[3] = 1.0  # quaternion w

        mujoco.mj_forward(model, data)

        # Compute error: mean distance from model bodies to target keypoints
        if mappings:
            errors = []
            for kp_name, body_name in mappings.items():
                if kp_name not in kp_names:
                    continue
                kp_idx = kp_names.index(kp_name)
                body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name)
                if body_id >= 0:
                    body_pos = data.xpos[body_id] * scale_factor
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

    return {
        "qpos": all_qpos,
        "errors": all_errors,
        "frameIndices": frame_indices[:len(all_qpos)],
        "bodyTransforms": all_body_transforms,
    }
