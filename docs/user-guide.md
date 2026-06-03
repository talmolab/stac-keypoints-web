# User guide

This is the workflow walkthrough for researchers using the deployed app or a
local checkout. It does not assume any familiarity with the code or with
MuJoCo internals.

## What the app produces

A YAML config that the [stac-mjx](https://github.com/talmolab/stac-mjx) IK
pipeline can consume directly. The config records:

- Which keypoint name maps to which MuJoCo body
- An initial offset (xyz) for each keypoint relative to its body's frame
- Per-segment scale overrides for the model skeleton
- A scale factor for the keypoint cloud
- Optional companion `.ui.yaml` sidecar with non-IK metadata (frame labels,
  preferences) so reopening a session reproduces the visualisation

You map once, export, then run STAC on the GPU box you have (the IK is
expensive — keep it where the GPUs are).

## Loading a model

Use the **Model** dropdown in the toolbar.

- **Bundled species** — rat (with demo data), stick insect, mouse, worm, fly.
  Selected automatically on first launch.
- **Load XML** — single-file MJCF picker. Use this for models that have no
  external mesh assets (all-primitive geoms only).
- **Load XML folder…** — directory picker for models that reference external
  meshes (`.obj` / `.stl`). Select the folder containing the `.xml` and its
  mesh subdirectory; the app compiles the model in-browser to read each
  mesh's compile-time AABB, then rewrites the XML on the fly — replacing
  every mesh geom with a capsule (or sphere for round parts) and stripping
  the `<asset><mesh>` entries. The resulting standalone XML is what gets
  loaded into the live scene. Algorithm parity with
  `scripts/preprocess_meshful_xml.py` (the build-time preprocessor used for
  the bundled mouse / worm / fly). Texture refs (`<texture>` in the XML) are
  **not** stripped — if the upload includes textures, the `.png` files must
  be in the folder too.
- **Custom path…** — point at any MuJoCo `.xml` reachable by the backend
  (only available when the backend is running).

The mouse, worm, and fly models are bundled in a mesh-stripped form: each
mesh geom has been replaced at build time by a capsule (or sphere for round
parts) that matches the mesh's axis-aligned bounding box. This keeps the
download small and renders well enough for keypoint mapping. See
`docs/deploy.md` for the preprocessor details.

## Loading keypoints

The toolbar has three load buttons:

- **Load KP** — `.h5` files in either SLEAP layout (`tracks`, `node_names`)
  or stac-mjx layout (`positions`, `kp_names`). NaNs are preserved as
  "missing" — gaps show up in the heatmap and are skipped during alignment.
- **Load .mat** — Monsees `motiondata.mat` files (MATLAB v7.3 / HDF5).
  Position data is transposed automatically.
- **Load ACM** — only works with the backend running, since it streams full
  Monsees ACM trials through `monsees-retarget`.

Loaded data populates:
- The 3D scene (each keypoint as a coloured dot)
- The timeline scrubber
- The gap heatmap (one row per keypoint, missing frames shown in red)

## Mapping mode (`1`)

1. Click a keypoint in the 3D scene or in the right-hand mapping table.
2. Click a body part on the model. The mapping is recorded immediately.
3. Repeat for every keypoint.

Tips:
- Use **Align** to run Procrustes on the assigned-so-far set; this makes
  the cloud snap to the model frame.
- The **mapping table** has search and inline-edit. Drag a row's bone
  reference to an empty target to move an assignment.
- **Undo** with `Cmd/Ctrl + Z`; redo with `⇧Z` or `Cmd-Y`.

## Offset mode (`2`)

After every keypoint is mapped, switch to offset mode and drag the green
markers on the model to fine-tune where each keypoint attaches. Live IK
preview (when backend is running) shows the effect on the solved pose.

## Quality feedback

- **Color by error** (toolbar checkbox) — keypoints turn green/yellow/red by
  Euclidean distance to the model fit.
- **Region error summary** (left panel) — auto-grouped means by region
  (head, forelimbs, hindlimbs, back, body).
- **Gap heatmap** (timeline) — confidence-tinted, hover for per-keypoint
  details at the cursor frame.
- **Clip boundary ticks** — faint vertical marks on the timeline at every
  `n_frames_per_clip` (read from your YAML config, default 100). Handy for
  spotting clip-edge artifacts when scrubbing long sessions.
- **Error distribution** histogram — overall fit quality at the current frame.

## Validating the fit

If the backend is running:

- **IK Frame** — solves IK at the current frame only (fast, ~0.1s).
- **IK Sequence** — solves over the full clip; scrub to inspect.
- **Run IK** — adds bookkeeping around IK Sequence and reports timing.
- **Refit Offsets** — closed-form marker-offset solve (stac-mjx
  `StacCore.m_opt`) over the frames you've labeled. Workflow: label a few
  representative frames on the timeline, hit **Run IK** so each labeled
  frame has a solved pose, then **Refit Offsets** to recompute the offsets
  in one shot. Auto-IK re-solves the current frame with the new offsets.

All four work in standalone mode too — IK uses a Jacobian-transpose loop
in `mujocoWasm.ts`, and Refit Offsets uses a JS port of the same
closed-form solve (numerically identical to the backend's `m_opt`).

## Saving

- **Cmd/Ctrl + S** — saves to the file you picked the first time
  (Chrome/Edge), no re-prompting. Falls back to a blob download on
  Firefox/Safari.
- **Cmd/Ctrl + ⇧ + S** — Save As…, choose a new location.
- **Quality Report** button — exports a `stac_quality_report.json`
  with per-keypoint gap %, confidence histogram, error stats. Useful for
  downstream QC scripts and for sharing fit summaries with collaborators.

The **`.yaml`** is the canonical artefact for stac-mjx. The **`.ui.yaml`**
sidecar holds non-IK metadata (frame labels, view preferences); load it
back with **Load Config** to resume a session.

## Persistence

Mapping, offsets, segment scales, model transform, and view preferences
auto-save to `localStorage` and survive page refresh. Clear them via the
browser's site-data tools if you want a fresh start.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Model doesn't render | WASM hadn't initialised yet — refresh once. Inspect the browser console for `mj_loadXML` errors. |
| Keypoints don't appear after Load KP | The `.h5` layout is unrecognised — open the file in Python and confirm one of `tracks` / `positions` / `pred` exists. |
| Backend not detected after `./start.sh` | The smart-routing probe times out at 1 s; if your backend is slow to start, give it a moment then refresh. |
| FSA "Save" prompts every time | You're on Firefox/Safari; FSA isn't supported there. Configs download as files instead. |
| "size 1 must be positive" loading custom XML | A mesh geom collapsed to zero volume — see `scripts/preprocess_meshful_xml.py` for the mesh→capsule fallback. |
| "XML references external mesh files" after Load XML | You picked a single `.xml` but it references `.obj` / `.stl` files. Click **Load XML folder…** instead and select the directory containing both. |
