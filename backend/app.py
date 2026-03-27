"""FastAPI backend for STAC Retarget UI."""
from __future__ import annotations

import tempfile

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.mujoco_utils import compute_body_transforms, extract_model_geometry

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
    return geometry


@app.post("/api/body-transforms")
async def body_transforms(qpos: list[float]):
    """Compute body transforms for given qpos."""
    if not _state["xml_path"]:
        return JSONResponse({"error": "No XML loaded"}, status_code=400)
    transforms = compute_body_transforms(_state["xml_path"], qpos)
    return transforms
