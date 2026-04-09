# CLAUDE.md - stac-keypoints-web

## What this is

Interactive 3D web UI for validating STAC (Skeletal Tracking and Alignment with Constraints) retargeting results. Aligns motion capture keypoints to MuJoCo biomechanical models. Supports multiple walkers (rodent, stick bug).

**Repo**: `talmolab/stac-keypoints-web`

## Quick start

```bash
# Requires: Python 3.10+ venv with mujoco, Node.js 18+ (via nvm)
./start.sh              # tmux session: backend :8000 + frontend :5173
./start.sh --no-tmux    # background processes instead
```

Open http://localhost:5173 (or `?noauto` to skip rodent auto-load).

## Environment

```bash
# Python venv (shared with other Salk projects)
source /home/talmolab/Desktop/SalkResearch/mimic-mjx/bin/activate
uv pip install -e ".[dev]"

# Frontend
cd frontend && npm install
```

The backend needs `PYTHONPATH` to include `monsees-retarget` for ACM processing (see `start.sh`).

## Architecture

```
backend/          Python FastAPI
  app.py          API endpoints (load XML, compute FK, run IK, alignment)
  config_io.py    STAC YAML + H5 config I/O (embedded config extraction)
  mujoco_utils.py MuJoCo geometry extraction + FK (body transforms)
  stac_runner.py  STAC optimization wrapper
  alignment.py    Procrustes alignment
  acm_processing.py  ACM .mat FK pipeline

frontend/src/     React + Three.js + TypeScript
  store.ts        Zustand state (persisted to localStorage)
  skeletonEditor.ts  Bone trees per walker (rodent, stick) + segment scaling
  api.ts          Backend API client
  components/
    Viewport3D.tsx    Canvas + camera + grid + lighting
    MuJoCoModel.tsx   Renders model geoms inside transform hierarchy
    ACMSkeleton.tsx   Target keypoint spheres + bone lines
    ErrorLines.tsx    Error visualization (follows model transform)
    FollowCamera.tsx  Auto-zoom + follow centroid
    Toolbar.tsx       Load XML/Config/H5, run IK, export
    PropertiesPanel.tsx  Mode toggle, skeleton editor, model controls
    Timeline.tsx      Frame scrubbing, syncs bodyTransforms with STAC results
    OffsetMarkers.tsx Offset point visualization on model bodies

data/             Bundled sample data
  rodent_relaxed.xml      Default rodent MuJoCo model
  stac_rodent_acm.yaml    Default STAC config (21 keypoints)
  sample_trial/           Demo ACM .mat file
```

## Key concepts

- **Walker**: A MuJoCo XML model (rodent, stick bug). Each has its own bone tree in `skeletonEditor.ts` and keypoint colors in `ACMSkeleton.tsx`.
- **STAC H5 output**: Contains `qpos`, `kp_data`, `offsets`, `kp_names`, and embedded `config` (YAML). The `Load STAC H5` button auto-configures everything from this file.
- **MOCAP_SCALE_FACTOR**: Converts between mocap units and MuJoCo units. Rodent: 0.01 (cm to m). Stick: 1.0 (already in m). Read from embedded H5 config.
- **Model transform**: MuJoCoModel wraps bodies in `position → scale → rotation → position` groups for user adjustment. ErrorLines and OffsetMarkers must account for this transform.
- **Coordinate systems**: MuJoCo is Z-up, Three.js is Y-up. `mjToThree` in `mujocoLoader.ts`: `(x,y,z) -> (x,z,-y)`.

## Rendering pipeline (data flow)

1. Backend: `load-stac-output` reads H5 -> returns qpos, kp_data / mocap_scale_factor, embedded config
2. Frontend Toolbar: auto-loads XML, applies config, sets keypoints + body transforms
3. `ACMSkeleton`: renders `positions * mocapScale` as spheres (adaptive radius from median NN distance)
4. `MuJoCoModel`: renders FK body transforms inside model transform hierarchy
5. `Timeline`: syncs `bodyTransforms` with `stacBodyTransforms[currentFrame]` on frame change
6. `ErrorLines`: draws body+offset -> keypoint lines, applying model transform to body endpoints

## Adding a new walker

1. **Backend**: `load_stac_output_h5` handles any walker via embedded config. No changes needed if the H5 has a `config` dataset. Add XML resolution paths in `_resolve_xml_path` if needed.
2. **`skeletonEditor.ts`**: Add a bone tree array (parent-child pairs in traversal order) and primary segment set. Update `getRetargetTree()` / `getPrimarySegments()` detection logic.
3. **`ACMSkeleton.tsx`**: Add keypoint colors to `KP_COLORS` dict.
4. Everything else (sphere sizing, camera zoom, grid, error lines) is walker-agnostic.

## State persistence

Zustand store persists to `localStorage` key `stac-retarget-ui-state`. Includes: mappings, offsets, segment scales, model transform, preferences, scale factors, frame position. Clear localStorage if state gets corrupted between walker switches.

## Running tests

```bash
pytest                    # from repo root, with venv activated
```

## Common tasks

- **Validate STAC fit**: Load STAC H5 -> scrub timeline -> enable "Show Error Lines"
- **Adjust model visibility**: Model Scale slider + Model Opacity slider in PropertiesPanel
- **Export config**: Click Export -> saves YAML with mappings, offsets, segment scales
- **Compare walkers**: Use `?noauto` URL param, load different H5 files via toolbar

## Conventions

- Use `uv pip` for Python package management
- Frontend changes auto-reload via Vite HMR (dev server) or need `npx vite build` (production)
- Backend auto-reloads via uvicorn `--reload`
- Sphere sizes and grid adapt automatically to walker scale — don't hardcode pixel/meter values
