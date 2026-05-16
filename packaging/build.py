"""Local helper to build the MantisAnalysis standalone executable.

Runs on Windows and macOS. The script:

  1. Creates a throwaway venv under ``build/venv/`` (kept across runs).
  2. Installs the project + PyInstaller into that venv.
  3. Invokes PyInstaller against ``packaging/mantisanalysis.spec``.
  4. Zips the result into ``dist/MantisAnalysis-<os>-<arch>.zip``
     (Windows / Linux) or keeps ``dist/MantisAnalysis.app`` (macOS) and
     produces a ``.tar.gz`` of it.

You can run PyInstaller directly too:
    python -m pip install pyinstaller
    pyinstaller packaging/mantisanalysis.spec --noconfirm --clean
"""

from __future__ import annotations

import argparse
import platform
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SPEC = REPO / "packaging" / "mantisanalysis.spec"
DIST = REPO / "dist"
BUILD = REPO / "build"
VENV = BUILD / "venv"


def _venv_python() -> Path:
    if sys.platform.startswith("win"):
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def _run(cmd: list[str], *, cwd: Path | None = None) -> None:
    print(">>", " ".join(str(c) for c in cmd), flush=True)
    subprocess.check_call(cmd, cwd=cwd and str(cwd))


def _ensure_venv() -> Path:
    py = _venv_python()
    if py.exists():
        return py
    VENV.parent.mkdir(parents=True, exist_ok=True)
    _run([sys.executable, "-m", "venv", str(VENV)])
    _run([str(py), "-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"])
    return py


def _install(py: Path) -> None:
    _run([str(py), "-m", "pip", "install", "--upgrade", "-e", f"{REPO}[build]"])


def _build_frontend() -> None:
    """bundler-migration-v1 Phase 3 — emit `web/dist/` before PyInstaller.

    The spec hard-fails if `web/dist/index.html` is missing, so this step
    must run on every fresh build. Idempotent — if `web/dist/index.html`
    already exists and the source tree is older, the user can re-run with
    `--skip-frontend` to short-circuit.
    """
    npm = shutil.which("npm")
    if npm is None:
        raise SystemExit(
            "npm not found on PATH. Install Node >= 20 + npm before building "
            "the frozen binary — the SPA is now Vite-bundled (post "
            "bundler-migration-v1 Phase 3)."
        )
    _run([npm, "install"], cwd=REPO)
    _run([npm, "run", "build"], cwd=REPO)


def _clean() -> None:
    for target in (DIST, REPO / "build" / "MantisAnalysis"):
        if target.exists():
            print(f"-- removing {target}")
            shutil.rmtree(target, ignore_errors=True)


def _pyinstaller(py: Path) -> None:
    _run([str(py), "-m", "PyInstaller", str(SPEC), "--noconfirm", "--clean"], cwd=REPO)


def _archive() -> Path:
    arch = platform.machine().lower().replace("amd64", "x86_64")
    if sys.platform == "darwin":
        src = DIST / "MantisAnalysis.app"
        if not src.exists():
            raise SystemExit(f"missing {src}; PyInstaller BUNDLE step didn't run")
        out = DIST / f"MantisAnalysis-macos-{arch}.tar.gz"
        out.unlink(missing_ok=True)
        print(f"-- taring {src} → {out}")
        with tarfile.open(out, "w:gz") as tf:
            tf.add(src, arcname=src.name)
        return out

    # Windows / Linux: zip the onedir tree.
    src = DIST / "MantisAnalysis"
    if not src.exists():
        raise SystemExit(f"missing {src}; PyInstaller COLLECT step didn't run")
    os_tag = "windows" if sys.platform.startswith("win") else "linux"
    out = DIST / f"MantisAnalysis-{os_tag}-{arch}.zip"
    out.unlink(missing_ok=True)
    print(f"-- zipping {src} → {out}")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for p in src.rglob("*"):
            zf.write(p, p.relative_to(DIST))
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--no-venv",
        action="store_true",
        help="use the current interpreter instead of creating build/venv",
    )
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="skip pip install step (assumes deps already present)",
    )
    parser.add_argument(
        "--skip-frontend",
        action="store_true",
        help="skip `npm install && npm run build` (web/dist/ must already exist)",
    )
    parser.add_argument("--skip-archive", action="store_true", help="skip zipping / tarring")
    args = parser.parse_args()

    _clean()

    py = Path(sys.executable) if args.no_venv else _ensure_venv()
    if not args.skip_install:
        _install(py)

    if not args.skip_frontend:
        _build_frontend()

    _pyinstaller(py)

    if not args.skip_archive:
        out = _archive()
        size_mb = out.stat().st_size / (1 << 20)
        print(f"\n✔ built {out.name} ({size_mb:.1f} MB)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
