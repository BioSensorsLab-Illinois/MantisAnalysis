"""Shared fixtures for the MantisAnalysis test suite."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


@pytest.fixture(scope="session", autouse=True)
def _matplotlib_agg():
    """Force Agg backend before any pyplot import in headless tests."""
    import matplotlib
    matplotlib.use("Agg")
    yield


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _on_path() -> None:
    root = Path(__file__).resolve().parent.parent
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))


_on_path()
