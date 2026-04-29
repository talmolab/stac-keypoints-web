"""Tests for stac_runner — focused on NaN robustness, not IK quality."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import numpy as np
import pytest

from backend.stac_runner import run_quick_stac

XML_PATH = os.environ.get(
    "STAC_KEYPOINTS_XML",
    str(Path(__file__).resolve().parent.parent / "data" / "rodent_relaxed.xml"),
)

if not Path(XML_PATH).exists():
    pytest.skip(f"MuJoCo XML not found at {XML_PATH}", allow_module_level=True)


# A subset that includes 3+ trunk keypoints so the trunk Procrustes fires.
KP_MAP = {
    "Snout": "skull",
    "SpineF": "vertebra_cervical_5",
    "SpineM": "torso",
    "SpineL": "pelvis",
    "ShoulderL": "upper_arm_L",
}
KP_NAMES = list(KP_MAP.keys())


def _flat_positions(n_frames=2, seed=0):
    rng = np.random.default_rng(seed)
    arr = rng.normal(0.0, 5.0, size=(n_frames, len(KP_NAMES), 3))
    return arr.flatten().tolist()


def _run(positions_flat, n_frames, frame_indices, max_iter=5):
    """Cheap call: low max_iter — we test plumbing, not IK convergence."""
    return run_quick_stac(
        kp_positions_flat=positions_flat,
        num_frames=n_frames,
        num_keypoints=len(KP_NAMES),
        kp_names=KP_NAMES,
        xml_path=XML_PATH,
        frame_indices=frame_indices,
        mappings=KP_MAP,
        max_iterations=max_iter,
    )


def test_runs_with_no_nan():
    positions = _flat_positions()
    result = _run(positions, 2, [0, 1])
    assert "qpos" in result
    assert len(result["qpos"]) == 2
    # Every qpos and every error must be finite — no NaN leaks
    for q in result["qpos"]:
        assert all(math.isfinite(v) for v in q)
    for e in result["errors"]:
        assert math.isfinite(e)


def test_nulls_on_wire_become_nan_internally():
    """The frontend sends `null` for missing keypoints. Quick STAC must
    treat them as NaN and still return finite qpos/errors."""
    positions = _flat_positions()
    # Drop one keypoint in frame 0 (Snout, kp 0): set its 3 components to None
    positions[0 * len(KP_NAMES) * 3 + 0 * 3 + 0] = None
    positions[0 * len(KP_NAMES) * 3 + 0 * 3 + 1] = None
    positions[0 * len(KP_NAMES) * 3 + 0 * 3 + 2] = None

    result = _run(positions, 2, [0, 1])
    assert len(result["qpos"]) == 2
    for q in result["qpos"]:
        assert all(math.isfinite(v) for v in q), "NaN target poisoned the IK"
    for e in result["errors"]:
        assert math.isfinite(e)


def test_all_trunk_nan_falls_back_gracefully():
    """If all trunk keypoints are NaN in a frame, the Procrustes path can't
    run. Fall back to the mean-target root and don't crash."""
    positions = np.array(_flat_positions()).reshape(2, len(KP_NAMES), 3)
    # Wipe trunk (Snout, SpineF, SpineM, SpineL) in frame 0
    positions[0, :4] = np.nan
    positions_flat = [
        None if (isinstance(v, float) and math.isnan(v)) else float(v)
        for v in positions.flatten()
    ]
    result = _run(positions_flat, 2, [0, 1])
    assert len(result["qpos"]) == 2
    for q in result["qpos"]:
        assert all(math.isfinite(v) for v in q)


def test_response_is_strict_json():
    """run_quick_stac must produce a response that round-trips through
    stdlib json with allow_nan=False — what the browser will accept."""
    positions = _flat_positions()
    positions[5] = None  # arbitrary missing component
    result = _run(positions, 2, [0, 1])
    json.loads(json.dumps(result, allow_nan=False))
