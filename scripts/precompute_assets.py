#!/usr/bin/env python
"""Pre-compute static assets for standalone webapp deployment."""
import sys, json, shutil
from pathlib import Path
import numpy as np
import yaml

sys.path.insert(0, str(Path("/home/talmolab/Desktop/SalkResearch/monsees-retarget")))

from monsees_retarget.acm_loader import acm_forward_kinematics
from monsees_retarget.gap_loader import discover_gap_trials, load_gap_trial
from monsees_retarget.stac_integration import load_stac_config, map_acm_to_stac_keypoints
from monsees_retarget.retarget_proportions import RETARGET_TREE

OUT = Path("frontend/public/data")
OUT.mkdir(parents=True, exist_ok=True)

# 1. ACM keypoints
config = load_stac_config()
metas = discover_gap_trials(require_motiondata=True)[:5]
all_pos = []
kp_names = None
for meta in metas:
    trial = load_gap_trial(meta)
    fk = acm_forward_kinematics(trial)[::2]  # decimate to 50Hz
    fk_cm = fk / 10.0  # mm -> cm
    stac_pos, stac_names = map_acm_to_stac_keypoints(fk_cm, trial.joint_names, config)
    all_pos.append(stac_pos)
    if kp_names is None:
        kp_names = stac_names
cat = np.concatenate(all_pos, axis=0)
bones = [{"parent": p, "child": c} for p, c in RETARGET_TREE]

acm_data = {
    "keypointNames": list(kp_names),
    "bones": bones,
    "positions": [round(float(x), 4) for x in cat.flatten()],
    "numFrames": int(cat.shape[0]),
    "numKeypoints": int(cat.shape[1]),
}
(OUT / "acm_keypoints.json").write_text(json.dumps(acm_data))
print(f"ACM: {cat.shape[0]} frames, {cat.shape[1]} kps -> {OUT / 'acm_keypoints.json'}")

# 2. Copy XML
xml_src = Path(config["model"]["MJCF_PATH"])
shutil.copy2(xml_src, OUT / "rodent_relaxed.xml")
print(f"XML: {xml_src} -> {OUT / 'rodent_relaxed.xml'}")

# 3. Config as JSON
offsets_raw = config["model"].get("KEYPOINT_INITIAL_OFFSETS", {})
offsets = {}
for kp, val in offsets_raw.items():
    if isinstance(val, str):
        offsets[kp] = [float(x) for x in val.split()]
    else:
        offsets[kp] = [0.0, 0.0, 0.0]
stac_json = {
    "keypointModelPairs": dict(config["model"]["KEYPOINT_MODEL_PAIRS"]),
    "keypointInitialOffsets": offsets,
    "scaleFactor": float(config["model"]["SCALE_FACTOR"]),
    "mocapScaleFactor": float(config["model"]["MOCAP_SCALE_FACTOR"]),
    "kpNames": list(config["model"]["KP_NAMES"]),
}
(OUT / "stac_config.json").write_text(json.dumps(stac_json, indent=2))
print(f"Config -> {OUT / 'stac_config.json'}")
print("Done!")
