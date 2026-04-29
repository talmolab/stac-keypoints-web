"""End-to-end NaN handling: load → align through the FastAPI app, with the
response coming back over the wire as a real HTTP body (so we exercise
Starlette's serializer, not just direct dict returns)."""
from __future__ import annotations

import json
import os
from pathlib import Path

import h5py
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport

from backend.app import app

XML_PATH = os.environ.get(
    "STAC_KEYPOINTS_XML",
    str(Path(__file__).resolve().parent.parent / "data" / "rodent_relaxed.xml"),
)

if not Path(XML_PATH).exists():
    pytest.skip(f"MuJoCo XML not found at {XML_PATH}", allow_module_level=True)


KP_NAMES = ["Snout", "SpineM", "SpineL", "ShoulderL", "ShoulderR"]
KP_MAP = {
    "Snout": "skull",
    "SpineM": "torso",
    "SpineL": "pelvis",
    "ShoulderL": "upper_arm_L",
    "ShoulderR": "upper_arm_R",
}


def _make_h5_with_nan(path: Path, n_frames=4) -> np.ndarray:
    rng = np.random.default_rng(0)
    data = rng.normal(0, 5.0, size=(n_frames, len(KP_NAMES), 3))
    data[1, 0] = np.nan  # Snout missing in frame 1
    data[2, 2, 1] = np.nan  # one component missing in frame 2
    with h5py.File(path, "w") as f:
        f.create_dataset("tracks", data=data)
    return data


@pytest.mark.anyio
async def test_load_keypoints_then_align_with_nan(tmp_path):
    h5_path = tmp_path / "nan.h5"
    _make_h5_with_nan(h5_path)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1) Load the XML so /api/align knows the model
        with open(XML_PATH, "rb") as f:
            resp = await client.post(
                "/api/load-xml", files={"file": ("rodent.xml", f, "text/xml")}
            )
        assert resp.status_code == 200, resp.text
        xml_payload = resp.json()
        xml_path_resolved = xml_payload["xmlPath"]

        # 2) Load keypoints — response must round-trip via strict JSON
        kp_names_str = ",".join(KP_NAMES)
        with open(h5_path, "rb") as f:
            resp = await client.post(
                f"/api/load-keypoints?kp_names={kp_names_str}",
                files={"file": ("nan.h5", f, "application/octet-stream")},
            )
        assert resp.status_code == 200, resp.text
        # The wire format must be browser-parseable: no NaN literals.
        json.loads(resp.text)  # would raise on NaN literal

        kp_payload = resp.json()
        positions = kp_payload["positions"]
        # NaN keypoint became three nulls
        base = (1 * len(KP_NAMES) + 0) * 3
        assert positions[base] is None
        assert positions[base + 1] is None
        assert positions[base + 2] is None

        # 3) Align — feed positions back (with nulls), verify response is strict JSON
        align_body = {
            "positions": positions,
            "numFrames": kp_payload["numFrames"],
            "numKeypoints": kp_payload["numKeypoints"],
            "keypointNames": kp_payload["keypointNames"],
            "xmlPath": xml_path_resolved,
            "keypointModelPairs": KP_MAP,
        }
        resp = await client.post("/api/align", json=align_body)
        assert resp.status_code == 200, resp.text
        # Strict JSON — browser would reject NaN literals
        align_payload = json.loads(resp.text)
        # NaN-input slots come back as null, the rest as numbers
        aligned = align_payload["alignedPositions"]
        assert aligned[base] is None  # frame 1, Snout, x
        assert isinstance(aligned[0], (int, float))  # frame 0, Snout, x — finite


@pytest.fixture
def anyio_backend():
    return "asyncio"
