import pytest
from backend.acm_processing import load_acm_trials, get_acm_skeleton_bones


def test_load_acm_trials():
    result = load_acm_trials(max_trials=1, decimate=4)
    assert "keypointNames" in result
    assert "bones" in result
    assert "positions" in result
    assert "numFrames" in result
    assert "numKeypoints" in result
    assert result["numKeypoints"] == 21
    assert result["numFrames"] > 0
    assert len(result["positions"]) == result["numFrames"] * result["numKeypoints"] * 3


def test_get_acm_skeleton_bones():
    bones = get_acm_skeleton_bones()
    assert len(bones) > 0
    bone_tuples = [(b["parent"], b["child"]) for b in bones]
    assert ("SpineL", "SpineM") in bone_tuples
    assert ("ShoulderL", "ElbowL") in bone_tuples
