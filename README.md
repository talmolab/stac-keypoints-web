# STAC Retarget UI

Interactive web UI for aligning 3D motion capture (ACM) skeleton keypoints to a MuJoCo virtual rodent model. Built for the [Monsees et al. 2022](https://www.nature.com/articles/s41592-022-01634-9) ACM-to-MuJoCo retargeting pipeline.

![screenshot](https://img.shields.io/badge/status-active_development-blue)

## What It Does

- Renders the MuJoCo rodent model (capsules/ellipsoids) alongside ACM skeleton keypoints in a shared 3D scene
- Interactive **keypoint-to-body mapping**: click an ACM keypoint, then click a MuJoCo body to assign correspondence
- **Offset fine-tuning**: drag 3D gizmos to adjust where each keypoint sits on the MuJoCo body
- **Skeleton editor**: adjust ACM segment lengths (especially spine) to match MuJoCo proportions
- **Jacobian IK**: run per-frame inverse kinematics to preview registration quality
- **Error visualization**: toggle color-coded error lines showing mapping quality per keypoint
- **Timeline**: scrub through frames, play/pause animation, label frames (SLEAP-style)
- **Export**: save mappings, offsets, and segment scales as YAML config for the STAC pipeline
- **Persistent state**: all settings survive browser refresh via localStorage

## Quick Start

```bash
./start.sh
```

This launches both the Python backend and React frontend in a tmux session, then opens the UI at **http://localhost:5173**.

If you don't have tmux, run without it:
```bash
./start.sh --no-tmux
```

## Prerequisites

- **Python 3.10+** with a virtualenv containing: `mujoco`, `numpy`, `scipy`, `h5py`, `pyyaml`, `fastapi`, `uvicorn`
- **Node.js 18+** (install via [nvm](https://github.com/nvm-sh/nvm))
- **[monsees-retarget](https://github.com/talmolab/monsees-retarget)** cloned locally (for ACM data loading)
- **ACM dataset**: Monsees et al. 2022 `motiondata.mat` files

### Setup

```bash
# 1. Clone
git clone https://github.com/talmolab/stac-keypoints-web.git
cd stac-keypoints-web

# 2. Install Python backend
source /path/to/your/venv/bin/activate
pip install -e ".[dev]"

# 3. Install frontend
cd frontend && npm install && cd ..

# 4. (Optional) override default paths via env vars
export VENV=/path/to/your/venv/bin/activate           # else uses current Python env
export MONSEES_RETARGET=/path/to/monsees-retarget     # required for ACM autoload
export STAC_KEYPOINTS_XML=/path/to/model.xml          # default: data/rodent_relaxed.xml
export STAC_KEYPOINTS_CONFIG=/path/to/config.yaml     # default: data/stac_rodent_acm.yaml
export STAC_KEYPOINTS_STAC_OUTPUT=/path/to/stac.h5    # default: none
export STAC_KEYPOINTS_ACM_TRIALS=3                    # default: 3

# 5. Run
./start.sh
```

## Manual Start (without start.sh)

Terminal 1 — Backend:
```bash
source /path/to/venv/bin/activate
PYTHONPATH=/path/to/monsees-retarget uvicorn backend.app:app --reload --port 8000
```

Terminal 2 — Frontend:
```bash
cd frontend && npm run dev
```

Open **http://localhost:5173**.

## Workflow

1. **Skeleton Editor** — Adjust ACM spine proportions to match the MuJoCo model (typically shorten spine segments to ~0.6x)
2. **Mapping** (press `1`) — Verify each ACM keypoint is assigned to the correct MuJoCo body
3. **Offsets** (press `2`) — Drag green offset markers to align with ACM keypoints
4. **Validate** — Click "IK Sequence" to run IK on all frames, scrub timeline to evaluate
5. **Export** — Save config for use with the STAC pipeline

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `← →` | Previous / Next frame (`Shift`: ±10) |
| `WASD` | Pan camera |
| `QE` | Orbit camera |
| `RF` | Camera up / down |
| `1` / `2` | Mapping / Offset mode |
| `L` | Label current frame |
| `Esc` | Deselect keypoint |

## Bundled Data

- `data/rodent_relaxed.xml` — MuJoCo rodent model with relaxed scapula joints
- `data/stac_rodent_acm.yaml` — Default STAC config with 21 keypoint-body mappings

## Architecture

```
Browser (React + Three.js)  ↔  Python Backend (FastAPI)
                                  ├── MuJoCo geometry extraction
                                  ├── ACM .mat loading + FK
                                  ├── Procrustes alignment
                                  ├── Jacobian IK solver
                                  └── Config YAML I/O
```

## License

MIT
