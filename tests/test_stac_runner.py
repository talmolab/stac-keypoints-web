"""Tests for stac_runner — wire contract, NaN robustness, cache behavior.

stac_runner delegates IK to stac_mjx.stac_core.q_opt / m_opt, so this whole
module requires stac-mjx + JAX importable. Backend mode = stac-mjx (per
project policy); standalone / pure-frontend mode uses the WASM Jacobian in
mujocoWasm.ts and never touches this code.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import numpy as np
import pytest


jax = pytest.importorskip("jax")
pytest.importorskip("stac_mjx")
from backend.stac_runner import run_quick_stac, refit_offsets, clear_cache, _CACHE  # noqa: E402

XML_PATH = os.environ.get(
    "STAC_KEYPOINTS_XML",
    str(Path(__file__).resolve().parent.parent / "data" / "rodent_relaxed.xml"),
)

if not Path(XML_PATH).exists():
    pytest.skip(f"MuJoCo XML not found at {XML_PATH}", allow_module_level=True)


KP_MAP = {
    "Snout": "skull",
    "SpineF": "vertebra_cervical_5",
    "SpineM": "torso",
    "SpineL": "pelvis",
    "ShoulderL": "upper_arm_L",
}
KP_NAMES = list(KP_MAP.keys())


@pytest.fixture(autouse=True)
def _reset_cache():
    clear_cache()
    yield
    clear_cache()


def _flat_positions(n_frames=2, seed=0):
    rng = np.random.default_rng(seed)
    arr = rng.normal(0.0, 5.0, size=(n_frames, len(KP_NAMES), 3))
    return arr.flatten().tolist()


def _run(positions_flat, n_frames, frame_indices, max_iter=5, **kw):
    return run_quick_stac(
        kp_positions_flat=positions_flat,
        num_frames=n_frames,
        num_keypoints=len(KP_NAMES),
        kp_names=KP_NAMES,
        xml_path=XML_PATH,
        frame_indices=frame_indices,
        mappings=KP_MAP,
        max_iterations=max_iter,
        **kw,
    )


def test_runs_with_no_nan():
    positions = _flat_positions()
    result = _run(positions, 2, [0, 1])
    assert len(result["qpos"]) == 2
    for q in result["qpos"]:
        assert all(math.isfinite(v) for v in q)
    for e in result["errors"]:
        assert math.isfinite(e)


def test_nulls_on_wire_become_nan_internally():
    """The frontend sends `null` for missing keypoints. The runner must
    treat them as NaN, mask them out of the loss, and still return finite
    qpos/errors."""
    positions = _flat_positions()
    positions[0 * len(KP_NAMES) * 3 + 0 * 3 + 0] = None
    positions[0 * len(KP_NAMES) * 3 + 0 * 3 + 1] = None
    positions[0 * len(KP_NAMES) * 3 + 0 * 3 + 2] = None

    result = _run(positions, 2, [0, 1])
    assert len(result["qpos"]) == 2
    for q in result["qpos"]:
        assert all(math.isfinite(v) for v in q), "NaN target poisoned the IK"
    for e in result["errors"]:
        assert math.isfinite(e)


def test_response_is_strict_json():
    """Response must round-trip through stdlib json with allow_nan=False —
    what the browser will accept."""
    positions = _flat_positions()
    positions[5] = None
    result = _run(positions, 2, [0, 1])
    json.loads(json.dumps(result, allow_nan=False))


def test_warm_start_accepts_initial_qpos():
    positions = _flat_positions(n_frames=1)
    seed = _run(positions, 1, [0], max_iter=5)
    seed_qpos = seed["qpos"][0]

    # Right length: should warm-start and converge cleanly.
    warm = _run(positions, 1, [0], max_iter=1, initial_qpos=seed_qpos)
    assert all(math.isfinite(v) for v in warm["qpos"][0])

    # Wrong length: silent fall-through, no crash.
    bogus = _run(positions, 1, [0], max_iter=1, initial_qpos=[0.0, 0.0, 0.0])
    assert all(math.isfinite(v) for v in bogus["qpos"][0])


def test_offset_change_does_not_recompile():
    """Offset edits at drag-rate must not bust the cache — only mappings
    or max_iter should trigger a rebuild (set_site_pos handles offsets
    in-place)."""
    positions = _flat_positions(n_frames=1)

    _run(positions, 1, [0], offsets={"Snout": [0.01, 0, 0]})
    id_before = id(_CACHE["entry"]["payload"])

    _run(positions, 1, [0], offsets={"Snout": [0.02, 0, 0]})
    id_after = id(_CACHE["entry"]["payload"])

    assert id_after == id_before


def test_refit_offsets_returns_one_offset_per_mapping():
    """m_opt over a couple of labeled frames must return finite offsets,
    one per mapped keypoint, keyed by kp name."""
    positions = _flat_positions(n_frames=3)
    # First run IK to get qposes for the "labeled" frames.
    ik = _run(positions, 3, [0, 2], max_iter=10)

    result = refit_offsets(
        kp_positions_flat=positions,
        num_frames=3,
        num_keypoints=len(KP_NAMES),
        kp_names=KP_NAMES,
        xml_path=XML_PATH,
        frame_indices=[0, 2],
        qposes_per_frame=ik["qpos"],
        mappings=KP_MAP,
        max_iterations=5,
    )
    assert set(result["offsets"].keys()) == set(KP_NAMES)
    for off in result["offsets"].values():
        assert len(off) == 3
        assert all(math.isfinite(v) for v in off)
    assert math.isfinite(result["error"])
    assert result["frameIndicesUsed"] == [0, 2]


def test_refit_offsets_skips_nan_frames():
    """A labeled frame with any NaN mapped keypoint can't go into m_opt
    (no per-row mask in the closed-form solve). It must be dropped from
    frameIndicesUsed without crashing."""
    positions_arr = np.array(_flat_positions(n_frames=2)).reshape(2, len(KP_NAMES), 3)
    # Wipe Snout in frame 1
    positions_arr[1, 0] = np.nan
    positions_flat = [
        None if (isinstance(v, float) and math.isnan(v)) else float(v)
        for v in positions_arr.flatten()
    ]
    ik = _run(positions_flat, 2, [0, 1], max_iter=5)

    result = refit_offsets(
        kp_positions_flat=positions_flat,
        num_frames=2,
        num_keypoints=len(KP_NAMES),
        kp_names=KP_NAMES,
        xml_path=XML_PATH,
        frame_indices=[0, 1],
        qposes_per_frame=ik["qpos"],
        mappings=KP_MAP,
        max_iterations=5,
    )
    assert result["frameIndicesUsed"] == [0]


def test_refit_offsets_rejects_misaligned_qposes():
    """qposes_per_frame length must equal frame_indices length."""
    positions = _flat_positions(n_frames=2)
    with pytest.raises(ValueError, match="align with"):
        refit_offsets(
            kp_positions_flat=positions,
            num_frames=2,
            num_keypoints=len(KP_NAMES),
            kp_names=KP_NAMES,
            xml_path=XML_PATH,
            frame_indices=[0, 1],
            qposes_per_frame=[[0.0] * 7],  # too few
            mappings=KP_MAP,
        )


def test_refit_offsets_shares_cache_with_run_quick_stac():
    """A refit call right after run_quick_stac with the same (xml, mappings,
    max_iter) must hit the same cached payload — no recompile."""
    positions = _flat_positions(n_frames=2)
    ik = _run(positions, 2, [0, 1], max_iter=5)
    id_before = id(_CACHE["entry"]["payload"])

    refit_offsets(
        kp_positions_flat=positions,
        num_frames=2,
        num_keypoints=len(KP_NAMES),
        kp_names=KP_NAMES,
        xml_path=XML_PATH,
        frame_indices=[0, 1],
        qposes_per_frame=ik["qpos"],
        mappings=KP_MAP,
        max_iterations=5,
    )
    assert id(_CACHE["entry"]["payload"]) == id_before


def test_mapping_change_rebuilds_cache():
    positions = _flat_positions(n_frames=1)

    _run(positions, 1, [0])
    id_before = id(_CACHE["entry"]["payload"])

    alt = dict(KP_MAP)
    alt.pop("ShoulderL")
    run_quick_stac(
        kp_positions_flat=positions,
        num_frames=1,
        num_keypoints=len(KP_NAMES),
        kp_names=KP_NAMES,
        xml_path=XML_PATH,
        frame_indices=[0],
        mappings=alt,
        max_iterations=5,
    )
    assert id(_CACHE["entry"]["payload"]) != id_before
