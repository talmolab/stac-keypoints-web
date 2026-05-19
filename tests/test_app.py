import os
from pathlib import Path

import pytest
from httpx import AsyncClient, ASGITransport
from backend.app import app


@pytest.mark.anyio
async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


XML_PATH = os.environ.get(
    "STAC_KEYPOINTS_XML",
    str(Path(__file__).resolve().parent.parent / "data" / "rodent_relaxed.xml"),
)

_REQUEST_BODY = {
    "positions": [0.0] * 5 * 3,
    "numFrames": 1,
    "numKeypoints": 5,
    "keypointNames": ["Snout", "SpineF", "SpineM", "SpineL", "ShoulderL"],
    "xmlPath": XML_PATH,
    "frameIndices": [0],
    "mappings": {
        "Snout": "skull",
        "SpineF": "vertebra_cervical_5",
        "SpineM": "torso",
        "SpineL": "pelvis",
        "ShoulderL": "upper_arm_L",
    },
    "maxIterations": 5,
}


@pytest.mark.anyio
@pytest.mark.skipif(not Path(XML_PATH).exists(), reason="MuJoCo XML not bundled")
async def test_run_quick_stac_endpoint_returns_expected_shape():
    pytest.importorskip("jax")
    pytest.importorskip("stac_mjx")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/run-quick-stac", json=_REQUEST_BODY)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "qpos" in body and len(body["qpos"]) == 1
    assert "errors" in body and len(body["errors"]) == 1
    assert "bodyTransforms" in body
    assert "modelCenter" in body
