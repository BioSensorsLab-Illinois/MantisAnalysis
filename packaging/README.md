# Packaging — standalone MantisAnalysis executables

This directory builds **dependency-free** binaries for Windows and macOS end
users. They do **not** need Python installed — double-click the executable,
the local server starts, and the default browser opens to
`http://127.0.0.1:8765/`.

## Contents

| File                    | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `entry.py`              | Frozen-friendly CLI shim invoked by PyInstaller.               |
| `mantisanalysis.spec`   | PyInstaller spec — bundles Python, deps, and the `web/` SPA.   |
| `build.py`              | Convenience script: venv + install + PyInstaller + archive.    |

## Build locally

```bash
# one-shot
python packaging/build.py

# re-use an existing venv, skip the install step
python packaging/build.py --skip-install

# keep raw dist/ tree (no zip)
python packaging/build.py --skip-archive
```

Outputs land in `dist/`:

| Platform | Raw bundle                    | Archive                                     |
| -------- | ----------------------------- | ------------------------------------------- |
| Windows  | `dist/MantisAnalysis/`        | `dist/MantisAnalysis-windows-x86_64.zip`    |
| macOS    | `dist/MantisAnalysis.app`     | `dist/MantisAnalysis-macos-<arch>.tar.gz`   |
| Linux    | `dist/MantisAnalysis/`        | `dist/MantisAnalysis-linux-x86_64.zip`      |

## CI builds

`.github/workflows/release.yml` runs this on every push to `main` and on
tag pushes (`v*`). Artifacts are uploaded on every run; tag pushes also
attach them to a GitHub Release.

## User-facing launch instructions

### Windows

1. Download `MantisAnalysis-windows-x86_64.zip` from the latest
   [Releases](https://github.com/BioSensorsLab-Illinois/MantisAnalysis/releases).
2. Right-click → **Extract All…**
3. Open the extracted folder, double-click `MantisAnalysis.exe`.
4. A console window opens, then your browser shows the UI. Closing the
   console stops the server.

> Windows SmartScreen may show a "Windows protected your PC" prompt the
> first time because the binary isn't codesigned. Click **More info →
> Run anyway**.

### macOS

1. Download `MantisAnalysis-macos-<arch>.tar.gz`.
2. Double-click to extract `MantisAnalysis.app`. Move it to `/Applications`.
3. Right-click `MantisAnalysis.app` → **Open** → **Open** (needed once to
   bypass Gatekeeper since we don't codesign/notarize yet).
4. A Terminal window shows the server log; your browser opens to the UI.

## Troubleshooting the build

- **`ModuleNotFoundError` at runtime** — add the missing module to
  `hiddenimports` in `mantisanalysis.spec` and rebuild.
- **`FileNotFoundError: web/index.html`** — make sure `web/` is present
  in the repo before building; `server.py::_resolve_web_dir` searches
  `sys._MEIPASS`, `<exe_dir>/web`, and the source tree in that order.
- **Huge `.exe`** — scipy + matplotlib + h5py is ~200–350 MB zipped.
  That's the baseline; removing any of them isn't really an option.
