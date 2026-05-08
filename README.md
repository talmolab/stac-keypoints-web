# STAC Retarget UI

Interactive web UI for aligning 3D motion-capture keypoints to MuJoCo body
models. The exported YAML feeds the [stac-mjx](https://github.com/talmolab/stac-mjx)
inverse-kinematics pipeline.

The app supports five species out of the box (rat, fly, mouse, worm, stick
insect) and runs in two modes:

- **Standalone (default)** — static SPA, all computation in the browser via
  the MuJoCo WebAssembly module. Hosted on GitHub Pages, no install required.
- **With local backend** — start the FastAPI backend and the SPA picks it up
  automatically (per-call probe). Adds the heavier features that need
  Python: ACM `.mat` loading via `monsees-retarget`, Procrustes alignment
  on full-resolution data, and the Jacobian-IK preview.

## Quick start (browser-only)

Visit the deployed site or build locally:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Pick a species from the model dropdown, load
your keypoints (`.h5` / `.mat`), map keypoints to bodies, export YAML.

See **[docs/user-guide.md](docs/user-guide.md)** for the full workflow.

## Quick start (with backend)

```bash
./start.sh
```

Spawns the backend and frontend in a tmux session. Requires Python 3.12+
with the project installed (`pip install -e ".[dev]"`) and Node 22+. See
**[docs/deploy.md](docs/deploy.md)** for env-var configuration.

## Features

### Mapping
- Click-to-assign: pick a keypoint, then a body part
- Drag 3D gizmos to fine-tune marker offsets
- Per-segment skeleton editor (e.g. shorten spine to match model proportions)
- Procrustes auto-alignment of keypoint cloud to model frame

### Quality feedback
- Color-by-error mode: per-keypoint Euclidean distance to the model fit
- Region error summary (forelimbs, hindlimbs, head, back) with auto L/R grouping
- Confidence-tinted keypoints; gap heatmap on the timeline
- **Quality Report** export: per-keypoint gap %, confidence histogram,
  per-keypoint error — JSON output suitable for downstream QC scripts

### Workflow
- Timeline scrubber, frame labelling (SLEAP-style)
- Undo/redo over mappings + offsets
- Save / Save As… via the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
  on Chrome/Edge (re-saves to the same file without re-prompting); blob
  download fallback on Firefox/Safari
- Persistent state via `localStorage`

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `← →` | Prev / next frame (`Shift`: ±10) |
| `Home` / `End` | Jump to first / last frame |
| `1` / `2` | Mapping / Offset mode |
| `Cmd/Ctrl + S` | Save / re-save YAML |
| `Cmd/Ctrl + ⇧ + S` | Save As… |
| `Cmd/Ctrl + Z` / `⇧Z` | Undo / redo |
| `L` | Label current frame |
| `?` / `H` | Toggle help overlay |
| `WASD` `QE` `RF` | Camera pan / orbit / vertical |

## Documentation

- **[User guide](docs/user-guide.md)** — loading data, mapping, exporting
- **[Developer guide](docs/developer-guide.md)** — architecture, SPA dual mode,
  parity tests, contributing
- **[Deploy guide](docs/deploy.md)** — GitHub Pages deploy, asset bundling,
  mesh preprocessor
- **[Known issues](docs/known-issues.md)** — limitations and future directions

## License

MIT
