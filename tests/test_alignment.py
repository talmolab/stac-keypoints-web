"""Tests for alignment.align_acm_to_mujoco — focused on NaN robustness."""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pytest

from backend.alignment import align_acm_to_mujoco

XML_PATH = os.environ.get(
    "STAC_KEYPOINTS_XML",
    str(Path(__file__).resolve().parent.parent / "data" / "rodent_relaxed.xml"),
)

if not Path(XML_PATH).exists():
    pytest.skip(f"MuJoCo XML not found at {XML_PATH}", allow_module_level=True)


# Subset of the rodent KEYPOINT_MODEL_PAIRS — enough for Procrustes (>=3 kps).
KP_MAP = {
    "Snout": "skull",
    "SpineM": "torso",
    "SpineL": "pelvis",
    "ShoulderL": "upper_arm_L",
    "ShoulderR": "upper_arm_R",
}
KP_NAMES = list(KP_MAP.keys())


def _synthetic_positions(n_frames=4, seed=0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # Roughly rodent-scaled (cm because mocap_scale_factor=0.01 puts it in m)
    return rng.normal(0, 5.0, size=(n_frames, len(KP_NAMES), 3))


def test_align_with_no_nan_produces_finite_output():
    positions = _synthetic_positions()
    result = align_acm_to_mujoco(positions, KP_NAMES, XML_PATH, KP_MAP)
    assert "alignedPositions" in result
    assert all(v is not None for v in result["alignedPositions"])


def test_align_with_partial_nan_preserves_nan_per_keypoint():
    """A keypoint missing in one frame should come back as null in that
    frame, but valid in the others — and shouldn't poison the alignment math."""
    positions = _synthetic_positions()
    positions[1, 0] = np.nan  # Snout missing in frame 1
    result = align_acm_to_mujoco(positions, KP_NAMES, XML_PATH, KP_MAP)

    n_frames, n_kp = positions.shape[0], positions.shape[1]
    flat = result["alignedPositions"]
    assert len(flat) == n_frames * n_kp * 3

    # Frame 1, Snout (kp 0) → all three components should be null
    base = (1 * n_kp + 0) * 3
    assert flat[base] is None
    assert flat[base + 1] is None
    assert flat[base + 2] is None

    # Frame 0, Snout → all finite (alignment didn't poison them)
    base0 = (0 * n_kp + 0) * 3
    for k in range(3):
        assert flat[base0 + k] is not None
        assert np.isfinite(flat[base0 + k])

    # Other keypoints in frame 1 are also untouched
    for kp_i in range(1, n_kp):
        base = (1 * n_kp + kp_i) * 3
        for k in range(3):
            assert flat[base + k] is not None


def test_align_with_full_keypoint_missing_drops_it():
    """If a keypoint is NaN in *every* frame, it should be excluded from the
    alignment subset rather than crashing — but still appear as null in the
    output for that keypoint's slot."""
    positions = _synthetic_positions()
    positions[:, 0] = np.nan  # Snout missing throughout
    result = align_acm_to_mujoco(positions, KP_NAMES, XML_PATH, KP_MAP)
    assert "alignedPositions" in result  # didn't error

    n_kp = positions.shape[1]
    flat = result["alignedPositions"]
    # Snout (kp 0) is null in every frame
    for f in range(positions.shape[0]):
        base = (f * n_kp + 0) * 3
        assert flat[base] is None
        assert flat[base + 1] is None
        assert flat[base + 2] is None


def test_align_response_is_strict_json():
    """Browser JSON.parse rejects NaN literals — the response must round-trip
    through stdlib json with allow_nan=False."""
    positions = _synthetic_positions()
    positions[2, 1, 0] = np.nan
    result = align_acm_to_mujoco(positions, KP_NAMES, XML_PATH, KP_MAP)
    json.loads(json.dumps(result, allow_nan=False))


def test_align_too_few_valid_keypoints_returns_error():
    positions = _synthetic_positions()
    # Wipe out all but one keypoint across all frames
    positions[:, 1:] = np.nan
    result = align_acm_to_mujoco(positions, KP_NAMES, XML_PATH, KP_MAP)
    assert "error" in result
