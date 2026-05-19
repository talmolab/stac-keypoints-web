"""Quick STAC runner for subset of frames.

Delegates per-frame pose optimization to ``stac_mjx.stac_core.StacCore.q_opt``
— the same projected-gradient solver the full stac-mjx pipeline uses. Backend
mode therefore implies stac-mjx (and JAX); standalone / pure-frontend mode
uses a separate WASM Jacobian-transpose loop in ``mujocoWasm.ts`` and never
touches this file.

The compiled MuJoCo model + sites + ``StacCore`` are cached per process keyed
by ``(xml_path, mappings_signature, max_iter)``. Offsets change every drag
tick and are applied via in-place ``site_pos`` updates — no JIT recompile.
"""
from __future__ import annotations

import threading
from typing import Any

import numpy as np
import mujoco

# stac-mjx + JAX are heavy imports — defer them so the module loads on
# stac-mjx-less dev / CI setups (test collection, /api/health, etc.).
# Production backend installs `stac-keypoints-web` which pulls stac-mjx as
# a hard dep, so any IK call there resolves these at first use.
_jax = None
_jp = None
_stac_core = None
_stac_utils = None


def _lazy_imports():
    global _jax, _jp, _stac_core, _stac_utils
    if _jax is not None:
        return
    import jax as _j
    from jax import numpy as _jpm
    from stac_mjx import stac_core as _sc, utils as _su
    _jax, _jp, _stac_core, _stac_utils = _j, _jpm, _sc, _su


# Single-entry cache. Most sessions stick to one (model, mappings, max_iter)
# triple; swapping is cheap if users compare two. A larger LRU would just
# hold JAX state for nothing.
_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {}


def _cache_key(xml_path: str, mappings: dict[str, str], max_iter: int) -> tuple:
    return (xml_path, tuple(sorted(mappings.items())), int(max_iter))


def _build(
    xml_path: str,
    mappings: dict[str, str],
    offsets: dict[str, list[float]],
    max_iter: int,
) -> dict[str, Any]:
    """Compile model + sites, mjx-load, build StacCore + bounds."""
    _lazy_imports()
    spec = mujoco.MjSpec.from_file(xml_path)
    site_kp_order: list[str] = []
    for kp, body_name in mappings.items():
        body = spec.body(body_name)
        if body is None:
            continue
        pos = list(offsets.get(kp, [0.0, 0.0, 0.0]))
        body.add_site(
            name=kp,
            size=[0.001, 0.001, 0.001],
            pos=pos,
            rgba=[1, 0, 0, 0.5],
            group=3,
        )
        site_kp_order.append(kp)

    mj_model = spec.compile()
    site_idxs_np = np.array(
        [mujoco.mj_name2id(mj_model, mujoco.mjtObj.mjOBJ_SITE, kp) for kp in site_kp_order]
    )
    site_idxs = _jp.asarray(site_idxs_np)

    mjx_model, mjx_data = _stac_utils.mjx_load(mj_model)

    # Bounds: free root (qpos[0:3]) unbounded in position, qpos[3:7] quaternion
    # components in [-1, 1]. Non-root joints use jnt_range when limited, else
    # fall back to [-pi, pi]. Simpler than stac_mjx.stac._align_joint_dims
    # which carries per-part masks the live preview doesn't need.
    nq = mj_model.nq
    lb = np.full(nq, -np.pi, dtype=np.float32)
    ub = np.full(nq, np.pi, dtype=np.float32)
    if mj_model.njnt > 0 and mj_model.jnt_type[0] == mujoco.mjtJoint.mjJNT_FREE:
        lb[0:3] = -np.inf
        ub[0:3] = np.inf
        lb[3:7] = -1.0
        ub[3:7] = 1.0
        next_q = 7
    else:
        next_q = 0
    for j in range(1, mj_model.njnt):
        addr = mj_model.jnt_qposadr[j]
        if addr < next_q:
            continue
        if mj_model.jnt_limited[j]:
            lo, hi = mj_model.jnt_range[j]
            lb[addr] = lo
            ub[addr] = hi
    lb_j = _jp.asarray(lb)
    ub_j = _jp.asarray(ub)

    core = _stac_core.StacCore(tol=1e-5, n_iter_q=int(max_iter))

    return {
        "mj_model": mj_model,
        "mjx_model_base": mjx_model,
        "mjx_data": mjx_data,
        "core": core,
        "site_idxs": site_idxs,
        "lb": lb_j,
        "ub": ub_j,
        "kp_order": site_kp_order,
        "nq": nq,
    }


def _get(
    xml_path: str,
    mappings: dict[str, str],
    offsets: dict[str, list[float]],
    max_iter: int,
) -> dict[str, Any]:
    key = _cache_key(xml_path, mappings, max_iter)
    with _CACHE_LOCK:
        cached = _CACHE.get("entry")
        if cached and cached["key"] == key:
            return cached["payload"]
        payload = _build(xml_path, mappings, offsets, max_iter)
        _CACHE["entry"] = {"key": key, "payload": payload}
        return payload


def clear_cache() -> None:
    """For tests: drop the cached compiled model."""
    with _CACHE_LOCK:
        _CACHE.pop("entry", None)


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
    max_iterations: int = 200,
    initial_qpos: list[float] | None = None,
) -> dict:
    """Run IK on a subset of frames and return qpos + body transforms.

    For each frame:
      1. Apply current offsets in-place on the cached mjx.Model
         (``set_site_pos`` — no recompile).
      2. Build the mocap-order → mapping-order remap and a kps_to_opt mask
         that zeros NaN rows out of the loss.
      3. Call ``StacCore.q_opt`` (projected gradient over ``q_loss``).
      4. Forward-kinematics for body transforms; mean Euclidean marker error
         over finite keypoints.

    Warm-start: caller passes ``initial_qpos`` (the previously solved pose).
    Single-frame auto-IK then converges in 1-5 iters; multi-frame batches
    chain via ``prev_q`` so frame N seeds frame N+1.
    """
    if not mappings:
        # No sites → no loss → q_opt returns initial; faster to bail. The
        # frontend wouldn't construct an empty mapping request anyway.
        return {
            "qpos": [],
            "errors": [],
            "frameIndices": [],
            "bodyTransforms": [],
            "modelCenter": [0.0, 0.0, 0.0],
        }

    _lazy_imports()

    # The frontend uses `null` on the wire for missing keypoints (JSON
    # disallows the NaN literal). Restore as NaN so the kps_to_opt mask
    # downstream works.
    if any(v is None for v in kp_positions_flat):
        flat = np.array(
            [np.nan if v is None else v for v in kp_positions_flat], dtype=float
        )
    else:
        flat = np.asarray(kp_positions_flat, dtype=float)
    positions = flat.reshape(num_frames, num_keypoints, 3)

    ctx = _get(xml_path, mappings, offsets or {}, max_iterations)
    nq = ctx["nq"]
    mj_model = ctx["mj_model"]
    mjx_model = ctx["mjx_model_base"]
    mjx_data = ctx["mjx_data"]
    core = ctx["core"]
    site_idxs = ctx["site_idxs"]
    lb, ub = ctx["lb"], ctx["ub"]
    kp_order: list[str] = ctx["kp_order"]

    if offsets:
        site_pos_np = np.array(
            [offsets.get(kp, [0.0, 0.0, 0.0]) for kp in kp_order], dtype=np.float32
        )
        mjx_model = _stac_utils.set_site_pos(
            mjx_model, _jp.asarray(site_pos_np), site_idxs
        )

    kp_idx = {name: i for i, name in enumerate(kp_names)}
    missing = [kp for kp in kp_order if kp not in kp_idx]
    if missing:
        raise ValueError(f"Mapped keypoints not present in kp_names: {missing}")
    remap = np.array([kp_idx[kp] for kp in kp_order], dtype=np.int32)

    targets_m = positions * mocap_scale_factor  # (n_frames, n_kp, 3) → meters
    qs_to_opt = _jp.ones(nq, dtype=_jp.bool_)

    if initial_qpos is not None and len(initial_qpos) == nq:
        prev_q = _jp.asarray(initial_qpos, dtype=_jp.float32)
    else:
        prev_q = _jp.asarray(mjx_data.qpos)

    all_qpos: list[list[float]] = []
    all_errors: list[float] = []
    all_body_transforms: list[list[dict]] = []

    for frame_idx in frame_indices:
        if frame_idx >= num_frames:
            continue

        targets_mapped = targets_m[frame_idx][remap]
        finite_mask = ~np.isnan(targets_mapped).any(axis=1)
        targets_clean = np.where(
            finite_mask[:, None], targets_mapped, 0.0
        ).astype(np.float32)
        ref_flat = _jp.asarray(targets_clean.flatten())
        kps_to_opt = _jp.asarray(np.repeat(finite_mask, 3).astype(np.bool_))

        new_mjx_data, result = core.q_opt(
            mjx_model,
            mjx_data,
            ref_flat,
            qs_to_opt,
            kps_to_opt,
            prev_q,
            lb,
            ub,
            site_idxs,
        )
        new_q = prev_q if result is None else result.params

        new_mjx_data = new_mjx_data.replace(qpos=new_q)
        new_mjx_data = _stac_utils.kinematics(mjx_model, new_mjx_data)

        marker_pos = np.array(_stac_utils.get_site_xpos(new_mjx_data, site_idxs))
        diffs = marker_pos - np.array(targets_mapped)
        per_kp_err = np.linalg.norm(diffs, axis=1)
        per_kp_err = np.where(finite_mask, per_kp_err, np.nan)
        with np.errstate(invalid="ignore"):
            mean_err = float(np.nanmean(per_kp_err)) if finite_mask.any() else 0.0

        xpos_np = np.array(new_mjx_data.xpos)
        xquat_np = np.array(new_mjx_data.xquat)
        frame_transforms = [
            {
                "bodyId": b,
                "position": [float(v) for v in xpos_np[b]],
                "quaternion": [float(v) for v in xquat_np[b]],
            }
            for b in range(mj_model.nbody)
        ]

        all_qpos.append([float(v) for v in np.array(new_q)])
        all_errors.append(mean_err)
        all_body_transforms.append(frame_transforms)

        prev_q = new_q

    model_center = [0.0, 0.0, 0.0]
    if all_body_transforms:
        positions_arr = np.array([bt["position"] for bt in all_body_transforms[-1]])
        model_center = positions_arr.mean(axis=0).tolist()

    return {
        "qpos": all_qpos,
        "errors": all_errors,
        "frameIndices": frame_indices[: len(all_qpos)],
        "bodyTransforms": all_body_transforms,
        "modelCenter": model_center,
    }
