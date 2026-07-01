"""Unit tests for CORS-origin resolution (STAC_ALLOW_ORIGINS)."""
import pytest

from backend.app import _allowed_origins


def test_default_is_the_vite_dev_server(monkeypatch):
    monkeypatch.delenv("STAC_ALLOW_ORIGINS", raising=False)
    assert _allowed_origins() == ["http://localhost:5173"]


def test_single_origin_from_env(monkeypatch):
    monkeypatch.setenv("STAC_ALLOW_ORIGINS", "https://user.github.io")
    assert _allowed_origins() == ["https://user.github.io"]


def test_comma_separated_origins_are_split_and_trimmed(monkeypatch):
    monkeypatch.setenv(
        "STAC_ALLOW_ORIGINS",
        " https://user.github.io , http://localhost:5173 ",
    )
    assert _allowed_origins() == [
        "https://user.github.io",
        "http://localhost:5173",
    ]


def test_empty_entries_are_dropped(monkeypatch):
    monkeypatch.setenv("STAC_ALLOW_ORIGINS", "https://a.example,, ,https://b.example")
    assert _allowed_origins() == ["https://a.example", "https://b.example"]


@pytest.mark.parametrize("value", ["", "   ", ",,"])
def test_blank_env_yields_no_origins(monkeypatch, value):
    monkeypatch.setenv("STAC_ALLOW_ORIGINS", value)
    assert _allowed_origins() == []
