"""Tests for keypoints_io — synthetic fixtures + a live check against
stac-mjx test data when present."""
from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest
from scipy.io import savemat

from backend.keypoints_io import load_keypoints


def _rand_tracks(n_frames=10, n_kp=4, seed=0):
    rng = np.random.default_rng(seed)
    return rng.standard_normal((n_frames, n_kp, 3)).astype(np.float64)


# ---------------------------------------------------------------------------
# H5 inputs
# ---------------------------------------------------------------------------


def test_load_h5_tracks_with_animal_dim(tmp_path):
    """SLEAP-style shape (frames, animals, keypoints, 3)."""
    data = _rand_tracks(n_frames=5, n_kp=3)
    four_d = data[:, None, :, :]  # add animal axis
    path = tmp_path / "sleap.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("tracks", data=four_d)

    result = load_keypoints(str(path), kp_names=["a", "b", "c"])
    assert result["numFrames"] == 5
    assert result["numKeypoints"] == 3
    assert result["keypointNames"] == ["a", "b", "c"]
    # positions round-trips through flatten()
    assert np.allclose(np.array(result["positions"]).reshape(5, 3, 3), data)


def test_load_h5_tracks_without_animal_dim(tmp_path):
    """stac-mjx-style shape (frames, keypoints, 3)."""
    data = _rand_tracks(n_frames=7, n_kp=5)
    path = tmp_path / "plain.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("tracks", data=data)

    result = load_keypoints(str(path))
    assert result["numFrames"] == 7
    assert result["numKeypoints"] == 5
    # Fallback names when user provides none
    assert result["keypointNames"] == ["kp_0", "kp_1", "kp_2", "kp_3", "kp_4"]


def test_load_h5_positions_dataset(tmp_path):
    """Alternative dataset name 'positions' is also accepted."""
    data = _rand_tracks(n_frames=3, n_kp=2)
    path = tmp_path / "positions.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("positions", data=data)

    result = load_keypoints(str(path))
    assert result["numFrames"] == 3
    assert result["numKeypoints"] == 2


def test_load_h5_missing_dataset_raises(tmp_path):
    path = tmp_path / "bad.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("not_tracks", data=np.zeros((2, 2, 3)))

    with pytest.raises(ValueError, match="no 'tracks' or 'positions'"):
        load_keypoints(str(path))


# ---------------------------------------------------------------------------
# MAT inputs
# ---------------------------------------------------------------------------


def test_load_mat_pred_field(tmp_path):
    """stac-mjx rodent fixture stores tracks as 'pred' with shape (N, 3, K)."""
    tracks = _rand_tracks(n_frames=8, n_kp=4)
    pred = np.transpose(tracks, (0, 2, 1))  # (frames, 3, keypoints)
    path = tmp_path / "rat.mat"
    savemat(str(path), {"pred": pred})

    result = load_keypoints(str(path), kp_names=["a", "b", "c", "d"])
    assert result["numFrames"] == 8
    assert result["numKeypoints"] == 4
    # Round-trip should match the original (frames, keypoints, 3) layout
    assert np.allclose(np.array(result["positions"]).reshape(8, 4, 3), tracks)


def test_load_mat_missing_fields_raises(tmp_path):
    path = tmp_path / "bad.mat"
    savemat(str(path), {"something_else": np.zeros((2, 3, 2))})
    with pytest.raises(ValueError, match="no 'pred' or 'positions'"):
        load_keypoints(str(path))


# ---------------------------------------------------------------------------
# Extension + shape guards
# ---------------------------------------------------------------------------


def test_unsupported_extension_raises(tmp_path):
    path = tmp_path / "foo.csv"
    path.write_text("a,b,c\n")
    with pytest.raises(ValueError, match="Unsupported file type"):
        load_keypoints(str(path))


def test_wrong_shape_raises(tmp_path):
    path = tmp_path / "bad_shape.h5"
    with h5py.File(path, "w") as f:
        # Shape (frames, keypoints, 2) — not 3D space
        f.create_dataset("tracks", data=np.zeros((4, 3, 2)))
    with pytest.raises(ValueError, match="shape \\(frames, keypoints, 3\\)"):
        load_keypoints(str(path))


def test_load_h5_uses_embedded_node_names(tmp_path):
    """When the file embeds names (SLEAP `node_names` or stac-mjx `kp_names`),
    use them rather than falling back to generic kp_N labels — otherwise
    Procrustes alignment can't match against the mapping keys."""
    data = _rand_tracks(n_frames=2, n_kp=3)
    path = tmp_path / "named.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("tracks", data=data)
        f.create_dataset(
            "node_names",
            data=np.array(["Snout", "SpineM", "SpineL"],
                          dtype=h5py.string_dtype(encoding="utf-8")),
        )
    result = load_keypoints(str(path))
    assert result["keypointNames"] == ["Snout", "SpineM", "SpineL"]


def test_load_h5_caller_names_override_embedded(tmp_path):
    """If the caller passes kp_names with the right count, use them."""
    data = _rand_tracks(n_frames=2, n_kp=3)
    path = tmp_path / "named.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("tracks", data=data)
        f.create_dataset(
            "node_names",
            data=np.array(["a", "b", "c"],
                          dtype=h5py.string_dtype(encoding="utf-8")),
        )
    result = load_keypoints(str(path), kp_names=["x", "y", "z"])
    assert result["keypointNames"] == ["x", "y", "z"]


def test_load_h5_kp_names_dataset_also_works(tmp_path):
    """stac-mjx writes `kp_names` rather than `node_names`."""
    data = _rand_tracks(n_frames=2, n_kp=2)
    path = tmp_path / "stacmjx.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("tracks", data=data)
        f.create_dataset(
            "kp_names",
            data=np.array(["Snout", "SpineL"],
                          dtype=h5py.string_dtype(encoding="utf-8")),
        )
    result = load_keypoints(str(path))
    assert result["keypointNames"] == ["Snout", "SpineL"]


def test_load_h5_with_nan_serializes_as_null(tmp_path):
    """SLEAP/DLC put NaN at missing keypoints. The wire must use null,
    not the JSON-illegal `NaN` literal that browsers reject."""
    import json as _json
    data = _rand_tracks(n_frames=4, n_kp=3)
    data[1, 0] = np.nan  # whole keypoint missing in frame 1
    data[2, 2, 1] = np.nan  # single component missing
    path = tmp_path / "with_nan.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("tracks", data=data)

    result = load_keypoints(str(path), kp_names=["a", "b", "c"])
    flat = result["positions"]
    # 4 frames * 3 keypoints * 3 = 36 values
    assert len(flat) == 36
    # NaN positions are now None
    assert flat[1 * 3 * 3 + 0 * 3 + 0] is None  # frame 1, kp 0, x
    assert flat[1 * 3 * 3 + 0 * 3 + 1] is None
    assert flat[1 * 3 * 3 + 0 * 3 + 2] is None
    assert flat[2 * 3 * 3 + 2 * 3 + 1] is None  # frame 2, kp 2, y
    # Non-NaN values survive intact
    assert flat[0] == data[0, 0, 0]
    # Round-trips through stdlib json (browser-compatible)
    _json.loads(_json.dumps(result, allow_nan=False))


def test_kp_names_count_mismatch_falls_back(tmp_path):
    """User-supplied names ignored when count doesn't match."""
    data = _rand_tracks(n_frames=2, n_kp=3)
    path = tmp_path / "ok.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("tracks", data=data)

    result = load_keypoints(str(path), kp_names=["a", "b"])  # 2 names, 3 kps
    assert result["keypointNames"] == ["kp_0", "kp_1", "kp_2"]


# ---------------------------------------------------------------------------
# Live check against stac-mjx test data when present
# ---------------------------------------------------------------------------


_STAC_DATA = Path(__file__).resolve().parents[2] / "stac-mjx" / "tests" / "data"


@pytest.mark.skipif(
    not (_STAC_DATA / "test_rodent_mocap_1000_frames.mat").exists(),
    reason="stac-mjx test fixture not present in this checkout",
)
def test_live_rodent_fixture():
    path = _STAC_DATA / "test_rodent_mocap_1000_frames.mat"
    result = load_keypoints(str(path))
    assert result["numFrames"] == 1000
    assert result["numKeypoints"] == 23


@pytest.mark.skipif(
    not (_STAC_DATA / "test_mouse_mocap_3600_frames.h5").exists(),
    reason="stac-mjx test fixture not present in this checkout",
)
def test_live_mouse_fixture():
    path = _STAC_DATA / "test_mouse_mocap_3600_frames.h5"
    result = load_keypoints(str(path))
    assert result["numFrames"] == 3600
    assert result["numKeypoints"] == 34
