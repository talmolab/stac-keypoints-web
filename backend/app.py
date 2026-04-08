"""FastAPI backend for STAC Retarget UI."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

# Repo root = parent of `backend/`. Bundled defaults live in <repo>/data/.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_BUNDLED_DATA = _REPO_ROOT / "data"

from backend.mujoco_utils import compute_body_transforms, extract_model_geometry
from backend.acm_processing import load_acm_trials, load_single_matfile, apply_retargeting
from backend.alignment import align_acm_to_mujoco
from backend.config_io import load_stac_yaml, dump_stac_yaml, load_stac_output_h5
from backend.frame_selector import suggest_frames
from backend.stac_runner import run_quick_stac

app = FastAPI(title="STAC Retarget UI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_state = {"xml_path": None}


@app.get("/api/health")
def health():
    return {"status": "ok"}


def _resolve_default(env_var: str, bundled: Path) -> str | None:
    """Pick env override if set, else bundled path if it exists, else None."""
    override = os.environ.get(env_var)
    if override:
        return override
    return str(bundled) if bundled.exists() else None


@app.get("/api/defaults")
def defaults():
    """Default file paths the frontend should auto-load on startup.

    Each value is overridable via env var. Falls back to files bundled in
    the repo's `data/` directory if present, otherwise null.
    """
    return {
        "xmlPath": _resolve_default(
            "STAC_KEYPOINTS_XML", _BUNDLED_DATA / "rodent_relaxed.xml"
        ),
        "configPath": _resolve_default(
            "STAC_KEYPOINTS_CONFIG", _BUNDLED_DATA / "stac_rodent_acm.yaml"
        ),
        "stacOutputPath": os.environ.get("STAC_KEYPOINTS_STAC_OUTPUT"),
        "acmTrials": int(os.environ.get("STAC_KEYPOINTS_ACM_TRIALS", "3")),
        "monseesRetarget": os.environ.get("MONSEES_RETARGET"),
    }


@app.post("/api/load-xml")
async def load_xml(file: UploadFile = File(None), path: str = Query(None)):
    """Load MuJoCo XML either by file upload or local path."""
    if path:
        xml_path = path
    elif file:
        tmp = tempfile.NamedTemporaryFile(suffix=".xml", delete=False)
        content = await file.read()
        tmp.write(content)
        tmp.close()
        xml_path = tmp.name
    else:
        return JSONResponse({"error": "Provide file or path"}, status_code=400)
    try:
        geometry = extract_model_geometry(xml_path)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    _state["xml_path"] = xml_path
    # Echo the resolved server-side path so the frontend can pass it back
    # to endpoints that need it (e.g. /api/align).
    geometry["xmlPath"] = xml_path
    return geometry


@app.post("/api/body-transforms")
async def body_transforms(qpos: list[float]):
    """Compute body transforms for given qpos."""
    if not _state["xml_path"]:
        return JSONResponse({"error": "No XML loaded"}, status_code=400)
    transforms = compute_body_transforms(_state["xml_path"], qpos)
    return transforms


@app.post("/api/batch-body-transforms")
async def batch_body_transforms(data: dict):
    """Compute body transforms for multiple qpos in one call."""
    if not _state["xml_path"]:
        return JSONResponse({"error": "No XML loaded"}, status_code=400)
    from backend.mujoco_utils import compute_body_transforms_batch
    qpos_list = data["qpos"]  # list of lists
    transforms = compute_body_transforms_batch(_state["xml_path"], qpos_list)
    return transforms


@app.post("/api/load-acm")
async def load_acm(max_trials: int = Query(5), decimate: int = Query(2)):
    """Load ACM gap-crossing trials, run FK, return STAC keypoints."""
    try:
        result = load_acm_trials(max_trials=max_trials, decimate=decimate)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return result


@app.post("/api/load-matfile")
async def load_matfile(file: UploadFile = File(None), path: str = Query(None)):
    """Load a single .mat file."""
    if path:
        mat_path = path
    elif file:
        tmp = tempfile.NamedTemporaryFile(suffix=".mat", delete=False)
        content = await file.read()
        tmp.write(content)
        tmp.close()
        mat_path = tmp.name
    else:
        return JSONResponse({"error": "Provide file or path"}, status_code=400)
    try:
        result = load_single_matfile(mat_path)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return result


@app.post("/api/align")
async def align_endpoint(data: dict):
    """Align ACM keypoints to MuJoCo pose via Procrustes."""
    positions = np.array(data["positions"]).reshape(
        data["numFrames"], data["numKeypoints"], 3
    )
    result = align_acm_to_mujoco(
        positions,
        data["keypointNames"],
        data["xmlPath"],
        data["keypointModelPairs"],
        scale_factor=data.get("scaleFactor", 0.9),
        mocap_scale_factor=data.get("mocapScaleFactor", 0.01),
    )
    return result


@app.post("/api/load-config")
async def load_config(file: UploadFile = File(None), path: str = Query(None)):
    """Load STAC YAML config from a server-side path or an uploaded file."""
    tmp_path: str | None = None
    if path:
        cfg_path = path
    elif file:
        tmp = tempfile.NamedTemporaryFile(suffix=".yaml", delete=False)
        tmp.write(await file.read())
        tmp.close()
        cfg_path = tmp_path = tmp.name
    else:
        return JSONResponse({"error": "Provide file or path"}, status_code=400)
    try:
        return load_stac_yaml(cfg_path)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    finally:
        if tmp_path:
            os.unlink(tmp_path)


@app.post("/api/export-config")
async def export_config(data: dict):
    """Serialize the UI state as STAC YAML and return the document body.

    The browser is expected to save this as a file via a download link.
    The backend never writes to its own filesystem.
    """
    try:
        body = dump_stac_yaml(data["config"])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return PlainTextResponse(body, media_type="application/x-yaml")


@app.post("/api/load-stac-output")
async def load_stac_output(file: UploadFile = File(None), path: str = Query(None)):
    """Load STAC output H5 from a server-side path or an uploaded file."""
    tmp_path: str | None = None
    if path:
        h5_path = path
    elif file:
        tmp = tempfile.NamedTemporaryFile(suffix=".h5", delete=False)
        # Stream in chunks — STAC H5s can be hundreds of MB.
        while chunk := await file.read(1 << 20):
            tmp.write(chunk)
        tmp.close()
        h5_path = tmp_path = tmp.name
    else:
        return JSONResponse({"error": "Provide file or path"}, status_code=400)
    try:
        return load_stac_output_h5(h5_path)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    finally:
        if tmp_path:
            os.unlink(tmp_path)


@app.post("/api/suggest-frames")
async def suggest_frames_endpoint(data: dict):
    """Suggest diverse frames for labeling."""
    frames = suggest_frames(
        data["positions"], data["numFrames"], data["numKeypoints"],
        n_suggestions=data.get("nSuggestions", 8),
    )
    return {"frames": frames}


@app.post("/api/run-quick-stac")
async def run_quick_stac_endpoint(data: dict):
    """Run Quick STAC on labeled frames."""
    frame_indices = data.get("frameIndices", list(range(min(4, data.get("numFrames", 0)))))
    try:
        result = run_quick_stac(
            kp_positions_flat=data["positions"],
            num_frames=data["numFrames"],
            num_keypoints=data["numKeypoints"],
            kp_names=data["keypointNames"],
            xml_path=data["xmlPath"],
            frame_indices=frame_indices,
            offsets=data.get("offsets"),
            mappings=data.get("mappings"),
            scale_factor=data.get("scaleFactor", 0.9),
            mocap_scale_factor=data.get("mocapScaleFactor", 0.01),
            max_iterations=data.get("maxIterations", 200),
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return result
