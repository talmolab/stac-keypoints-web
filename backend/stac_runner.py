"""Quick STAC runner for subset of frames."""
from __future__ import annotations

import numpy as np
import mujoco


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
    """Run simplified IK on a subset of frames and return qpos.

    For the initial version, returns default pose qpos for each frame.
    Full STAC integration (JAX-based) to be added later.
    """
    positions = np.array(kp_positions_flat).reshape(num_frames, num_keypoints, 3)

    model = mujoco.MjModel.from_xml_path(xml_path)
    data = mujoco.MjData(model)

    all_qpos = []
    all_errors = []

    for frame_idx in frame_indices:
        if frame_idx >= num_frames:
            continue
        # Target positions for this frame (cm -> meters)
        target_m = positions[frame_idx] * mocap_scale_factor

        # Reset to default pose
        mujoco.mj_resetData(model, data)

        # Set root position to mean of target keypoints
        mean_target = target_m.mean(axis=0)
        data.qpos[0] = mean_target[0]  # x
        data.qpos[1] = mean_target[1]  # y
        data.qpos[2] = mean_target[2]  # z
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

        all_qpos.append(data.qpos[:].tolist())
        all_errors.append(mean_error)

    return {
        "qpos": all_qpos,
        "errors": all_errors,
        "frameIndices": frame_indices[:len(all_qpos)],
    }
