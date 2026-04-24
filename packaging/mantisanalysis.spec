# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for MantisAnalysis — onedir build for Windows + macOS.

Usage:
    pyinstaller packaging/mantisanalysis.spec --noconfirm --clean

The result lives at ``dist/MantisAnalysis/`` (Windows + Linux) or
``dist/MantisAnalysis.app`` (macOS, via the BUNDLE block below).
"""
from __future__ import annotations

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, collect_data_files


# ---------------------------------------------------------------------------
# Paths — spec files run with CWD set by PyInstaller, so resolve from SPECPATH
# ---------------------------------------------------------------------------
HERE = Path(SPECPATH).resolve()          # <repo>/packaging
REPO = HERE.parent                        # <repo>
ENTRY = HERE / "entry.py"
WEB = REPO / "web"

APP_NAME = "MantisAnalysis"
IS_WIN = sys.platform.startswith("win")
IS_MAC = sys.platform == "darwin"


# ---------------------------------------------------------------------------
# Hidden imports — uvicorn and matplotlib load backends via importlib, so
# static analysis misses them. `collect_submodules` is the sledgehammer.
# ---------------------------------------------------------------------------
hiddenimports: list[str] = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("fastapi")
hiddenimports += collect_submodules("starlette")
hiddenimports += collect_submodules("anyio")
hiddenimports += collect_submodules("h11")
hiddenimports += collect_submodules("httptools")
hiddenimports += collect_submodules("websockets")
hiddenimports += collect_submodules("wsproto")
hiddenimports += collect_submodules("pydantic")
hiddenimports += collect_submodules("pydantic_core")
hiddenimports += collect_submodules("multipart")
hiddenimports += collect_submodules("email_validator")
hiddenimports += collect_submodules("matplotlib.backends")
hiddenimports += [
    "matplotlib.backends.backend_agg",
    "encodings.idna",
    "uvicorn.logging",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
]

# Our own package — pulled in because the frozen entry imports lazily.
hiddenimports += collect_submodules("mantisanalysis")


# ---------------------------------------------------------------------------
# Data files — ship the web SPA, plus matplotlib font cache / mpl-data
# ---------------------------------------------------------------------------
datas: list[tuple[str, str]] = []

if WEB.exists():
    datas.append((str(WEB), "web"))

datas += collect_data_files("matplotlib")
datas += collect_data_files("h5py")


# ---------------------------------------------------------------------------
# Analysis → PYZ → EXE → COLLECT
# ---------------------------------------------------------------------------
a = Analysis(
    [str(ENTRY)],
    pathex=[str(REPO)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",          # matplotlib's Tk backend is never used
        "IPython",
        "jupyter",
        "pytest",
        "mypy",
        "ruff",
        "playwright",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,           # server logs + CLI — stay visible on launch
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name=APP_NAME,
)

# ---------------------------------------------------------------------------
# macOS .app bundle — gives Finder a double-clickable icon
# ---------------------------------------------------------------------------
if IS_MAC:
    app = BUNDLE(
        coll,
        name=f"{APP_NAME}.app",
        icon=None,
        bundle_identifier="edu.illinois.biosensors.mantisanalysis",
        info_plist={
            "CFBundleName": APP_NAME,
            "CFBundleDisplayName": APP_NAME,
            "CFBundleVersion": "0.2.0",
            "CFBundleShortVersionString": "0.2.0",
            "NSHighResolutionCapable": True,
            # Force the bundled exe to run in a Terminal window so users
            # see the "server listening on http://127.0.0.1:8765/" line.
            "LSBackgroundOnly": False,
            "LSEnvironment": {"PYTHONUNBUFFERED": "1"},
        },
    )
