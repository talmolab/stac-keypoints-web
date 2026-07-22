"""Quick STAC runner for subset of frames.

Delegates pose optimization to ``stac_mjx.stac_core.q_opt`` and marker-offset
solves to ``stac_mjx.stac_core.m_opt`` — the same solvers the full stac-mjx
pipeline uses. stac-mjx #134 replaced the old ``StacCore`` class with
module-level functions plus a pre-analyzed ``QOptProblem`` handle (a batched
jaxls SE(3) least-squares solve); this module targets that API. Backend mode
therefore implies stac-mjx (and JAX); standalone / pure-frontend mode uses a
separate WASM Jacobian-transpose loop in ``mujocoWasm.ts`` and never touches
this file.

The compiled MuJoCo model + sites + bounds are cached per process keyed by
``(xml_path, mappings_signature, max_iter)``. Within a cache entry, one
``QOptProblem`` is analyzed per distinct ``(batch_size, keypoint-visibility
mask)`` (a jaxls recompile) — the common all-keypoints-present case reuses a
single problem for a given request size. Marker offsets are passed to ``q_opt``
as solve *data* (``dynamic_site_offsets``), so a live offset drag re-solves
without recompiling.
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
    """Compile model + sites, mjx-load, derive bounds + solve masks.

    Does *not* analyze a jaxls problem — that happens lazily in
    ``_get_q_problem`` keyed by the per-frame keypoint mask, since the mask is
    baked into the analyzed problem and only the visibility pattern varies.
    """
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
        [
            mujoco.mj_name2id(mj_model, mujoco.mjtObj.mjOBJ_SITE, kp)
            for kp in site_kp_order
        ]
    )
    site_idxs = _jp.asarray(site_idxs_np)

    mjx_model, mjx_data = _stac_utils.mjx_load(mj_model)

    # Bounds: free root (qpos[0:3]) unbounded in position, qpos[3:7] quaternion
    # components in [-1, 1]. Non-root joints use jnt_range when limited, else
    # fall back to [-pi, pi]. In SE3 mode (all 7 free-joint DOFs optimized) the
    # root is parameterized on the manifold and these root bounds are inert;
    # the hinge bounds still apply. Simpler than stac_mjx.stac._align_joint_dims
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

    return {
        "mj_model": mj_model,
        "mjx_model_base": mjx_model,
        "mjx_data": mjx_data,
        "site_idxs": site_idxs,
        "lb": lb_j,
        "ub": ub_j,
        "kp_order": site_kp_order,
        "nq": nq,
        "n_kp_coords": len(site_kp_order) * 3,
        # Optimize the full qpos (matches the old qs_to_opt = ones(nq)). All 7
        # free-joint DOFs on → build_q_opt_problem picks SE3 mode for the root.
        "joint_mask": _jp.ones(nq, dtype=_jp.bool_),
        # No joint regularization — the live preview fits pose to keypoints only.
        "joint_reg_weights": _jp.zeros(nq, dtype=_jp.float32),
        # kp_mask -> analyzed QOptProblem (n_frames=1). Filled on demand.
        "q_problems": {},
        "max_iter": int(max_iter),
    }


def _get_q_problem(ctx: dict[str, Any], kp_mask_np: np.ndarray, n_frames: int):
    """Analyze (or reuse) an ``n_frames``-frame jaxls problem for this mask.

    Both the keypoint mask and the frame count are baked into the analyzed
    problem, so a distinct NaN pattern or batch size needs its own analysis
    (a jaxls compile). Offsets are *not* baked (``dynamic_site_offsets``) so
    offset changes never trigger a rebuild. The single-frame case (n_frames=1)
    is just a batch of one, so this serves both the per-frame and batched paths.
    """
    key = (int(n_frames), kp_mask_np.tobytes())
    prob = ctx["q_problems"].get(key)
    if prob is not None:
        return prob
    prob = _stac_core.build_q_opt_problem(
        int(n_frames),
        ctx["mjx_model_base"],
        ctx["mjx_data"],
        ctx["joint_mask"],
        _jp.asarray(kp_mask_np),
        ctx["lb"],
        ctx["ub"],
        ctx["site_idxs"],
        ctx["n_kp_coords"],
        ctx["joint_reg_weights"],
        velocity_smoothness_weight=0.0,
        dynamic_site_offsets=True,
    )
    ctx["q_problems"][key] = prob
    return prob


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
      1. Build the mocap-order → mapping-order remap and a keypoint mask that
         drops NaN rows from the fit.
      2. Look up (or analyze) a 1-frame ``QOptProblem`` for that mask.
      3. Call ``stac_core.q_opt`` (batched jaxls SE(3) solve, n_frames=1),
         passing the current offsets as solve data.
      4. Forward-kinematics for body transforms; mean Euclidean marker error
         over finite keypoints.

    Warm-start: every solved frame starts from ``initial_qpos`` (the previously
    solved pose) when supplied, else the model default. Frames sharing a
    visibility mask are solved together in one batched ``q_opt`` call.

    NOTE (q_opt optimizes the full qpos including the root freejoint —
    ``joint_mask = ones(nq)`` → SE3 root). Because the batched path warm-starts
    every frame from the same ``init_q`` rather than chaining frame-to-frame, it
    does not carry a root pose forward across a discontinuous scrub; if that is
    ever needed, seed each frame's root with a per-frame Procrustes fit (mirroring
    the standalone ``mujocoWasm.jacobianIk`` path) instead of a shared ``init_q``.
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
    # disallows the NaN literal). Restore as NaN so the mask below works.
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
    site_idxs = ctx["site_idxs"]
    kp_order: list[str] = ctx["kp_order"]

    # Offsets are passed to q_opt as solve data (no recompile). The same values
    # are applied to a model copy for the post-solve marker-error FK.
    site_offsets_np = np.array(
        [(offsets or {}).get(kp, [0.0, 0.0, 0.0]) for kp in kp_order], dtype=np.float32
    )
    site_offsets_j = _jp.asarray(site_offsets_np)
    mjx_model_off = _stac_utils.set_site_pos(mjx_model, site_offsets_j, site_idxs)

    kp_idx = {name: i for i, name in enumerate(kp_names)}
    missing = [kp for kp in kp_order if kp not in kp_idx]
    if missing:
        raise ValueError(f"Mapped keypoints not present in kp_names: {missing}")
    remap = np.array([kp_idx[kp] for kp in kp_order], dtype=np.int32)

    targets_m = positions * mocap_scale_factor  # (n_frames, n_kp, 3) → meters

    if initial_qpos is not None and len(initial_qpos) == nq:
        init_q = _jp.asarray(initial_qpos, dtype=_jp.float32)
    else:
        init_q = _jp.asarray(mjx_data.qpos)

    # Per-frame targets + visibility masks, grouped by mask. Each group is
    # solved in a single batched q_opt call — frames are independent
    # (velocity_smoothness_weight=0), so batching only vectorizes the solve, it
    # does not couple frames. The common all-keypoints-present case is one group.
    #
    # NOTE (vs the old per-frame chaining): every frame is warm-started from the
    # same ``init_q`` rather than from the previous frame's solution, so the
    # batched path can't chain a root re-orientation across a discontinuous
    # scrub. For a single frame it is identical to the per-frame path.
    valid_frames = [f for f in frame_indices if f < num_frames]
    frame_meta: dict[int, tuple] = {}
    groups: dict[bytes, list[int]] = {}
    for f in valid_frames:
        targets_mapped = targets_m[f][remap]  # (n_kp, 3)
        finite_mask = ~np.isnan(targets_mapped).any(axis=1)
        kp_mask_np = np.repeat(finite_mask, 3).astype(np.bool_)
        frame_meta[f] = (targets_mapped, finite_mask, kp_mask_np)
        groups.setdefault(kp_mask_np.tobytes(), []).append(f)

    solved_q: dict[int, Any] = {}
    for fs in groups.values():
        n = len(fs)
        kp_mask_np = frame_meta[fs[0]][2]
        problem = _get_q_problem(ctx, kp_mask_np, n)
        q_init = _jp.broadcast_to(init_q[None], (n, nq))
        kp_rows = []
        for f in fs:
            targets_mapped, finite_mask, _ = frame_meta[f]
            clean = np.where(finite_mask[:, None], targets_mapped, 0.0).astype(
                np.float32
            )
            kp_rows.append(clean.reshape(-1))
        kp_data = _jp.asarray(np.stack(kp_rows))  # (n, n_kp*3)
        q_out = _stac_core.q_opt(
            problem,
            q_init,
            kp_data,
            n_solver_max_iters=int(max_iterations),
            initial_step_damping=1.0,
            site_offsets=site_offsets_j,
        )
        for k, f in enumerate(fs):
            solved_q[f] = q_out[k]

    all_qpos: list[list[float]] = []
    all_errors: list[float] = []
    all_body_transforms: list[list[dict]] = []
    emitted_frames: list[int] = []

    for frame_idx in frame_indices:
        if frame_idx not in solved_q:
            continue
        new_q = solved_q[frame_idx]
        targets_mapped, finite_mask, _ = frame_meta[frame_idx]

        # Body transforms + marker positions from FK on the offset-applied model.
        new_mjx_data = mjx_data.replace(qpos=new_q)
        new_mjx_data = _stac_utils.kinematics(mjx_model_off, new_mjx_data)

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
        emitted_frames.append(frame_idx)

    model_center = [0.0, 0.0, 0.0]
    if all_body_transforms:
        positions_arr = np.array([bt["position"] for bt in all_body_transforms[-1]])
        model_center = positions_arr.mean(axis=0).tolist()

    return {
        "qpos": all_qpos,
        "errors": all_errors,
        "frameIndices": emitted_frames,
        "bodyTransforms": all_body_transforms,
        "modelCenter": model_center,
    }


def refit_offsets(
    kp_positions_flat: list[float],
    num_frames: int,
    num_keypoints: int,
    kp_names: list[str],
    xml_path: str,
    frame_indices: list[int],
    qposes_per_frame: list[list[float]],
    mappings: dict[str, str],
    offsets: dict[str, list[float]] | None = None,
    mocap_scale_factor: float = 0.01,
    max_iterations: int = 200,
) -> dict:
    """Closed-form marker-offset solve over the given (labeled) frames.

    Calls ``stac_core.m_opt`` which exactly solves
        min_m  sum_t || y_t - (p_t + R_t m) ||^2
    per keypoint (no SGD iterations, no JIT recompile beyond the first).
    Requires that the caller has already solved IK on these frames and is
    passing the corresponding qposes — m_opt fits offsets given fixed pose.

    Cache key matches ``run_quick_stac`` (xml_path, mappings, max_iter), so
    the same compiled mjx.Model is reused.
    """
    if not mappings:
        return {"offsets": {}, "error": 0.0, "frameIndicesUsed": []}
    if len(qposes_per_frame) != len(frame_indices):
        raise ValueError(
            f"qposes_per_frame ({len(qposes_per_frame)}) must align with "
            f"frame_indices ({len(frame_indices)})"
        )

    _lazy_imports()

    if any(v is None for v in kp_positions_flat):
        flat = np.array(
            [np.nan if v is None else v for v in kp_positions_flat], dtype=float
        )
    else:
        flat = np.asarray(kp_positions_flat, dtype=float)
    positions = flat.reshape(num_frames, num_keypoints, 3)

    ctx = _get(xml_path, mappings, offsets or {}, max_iterations)
    mjx_model = ctx["mjx_model_base"]
    mjx_data = ctx["mjx_data"]
    site_idxs = ctx["site_idxs"]
    kp_order: list[str] = ctx["kp_order"]
    nq = ctx["nq"]

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
    n_kp = len(kp_order)

    # Build the (T, n_kp_xyz) target array. m_opt has no per-keypoint NaN
    # mask, so any frame with a missing mapped keypoint must be skipped
    # rather than poison the closed-form solve.
    valid_idx: list[int] = []
    targets_rows: list[np.ndarray] = []
    qpose_rows: list[np.ndarray] = []
    for i, frame_idx in enumerate(frame_indices):
        if frame_idx >= num_frames or frame_idx < 0:
            continue
        targets_mapped = positions[frame_idx][remap] * mocap_scale_factor
        if np.isnan(targets_mapped).any():
            continue
        q_arr = np.asarray(qposes_per_frame[i], dtype=np.float32)
        if q_arr.shape[0] != nq:
            raise ValueError(
                f"Frame {frame_idx}: qpos length {q_arr.shape[0]} != model nq {nq}"
            )
        valid_idx.append(frame_idx)
        targets_rows.append(targets_mapped.flatten())
        qpose_rows.append(q_arr)

    if len(valid_idx) == 0:
        return {"offsets": {}, "error": 0.0, "frameIndicesUsed": []}

    keypoints = _jp.asarray(np.stack(targets_rows).astype(np.float32))
    q_traj = _jp.asarray(np.stack(qpose_rows).astype(np.float32))

    initial_off_np = np.array(
        [
            offsets.get(kp, [0.0, 0.0, 0.0]) if offsets else [0.0, 0.0, 0.0]
            for kp in kp_order
        ],
        dtype=np.float32,
    )
    initial_off = _jp.asarray(initial_off_np)
    # No per-coord regularization — user is explicitly asking to recompute
    # offsets; we don't want to anchor them to their prior values. The
    # reg_coef multiplier zeros the regularization term entirely.
    is_regularized = _jp.zeros((n_kp, 3), dtype=_jp.float32)

    result = _stac_core.m_opt(
        mjx_model,
        mjx_data,
        keypoints,
        q_traj,
        initial_off,
        is_regularized,
        reg_coef=0.0,
        site_idxs=site_idxs,
    )

    new_offsets_np = np.array(result.params)
    new_offsets = {
        kp: [float(v) for v in new_offsets_np[i]] for i, kp in enumerate(kp_order)
    }
    # Mean per-keypoint error in meters at the solved offsets.
    n_xyz = n_kp * 3
    mean_err = float(np.sqrt(np.array(result.error) / (len(valid_idx) * n_xyz)))

    return {
        "offsets": new_offsets,
        "error": mean_err,
        "frameIndicesUsed": valid_idx,
    }
