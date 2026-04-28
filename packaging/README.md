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

`.github/workflows/release.yml` runs this on every push to `main`, on
tag pushes (`v*`), and on PRs that touch `packaging/` or build config.
The matrix builds **four** binaries per run:

| Job label        | Runner          | GLIBC / SDK base       |
| ---------------- | --------------- | ---------------------- |
| `windows-x86_64` | windows-latest  | Windows Server 2022    |
| `linux-x86_64`   | ubuntu-22.04    | GLIBC 2.35 (wide reach)|
| `macos-arm64`    | macos-14        | macOS 14 SDK           |
| `macos-x86_64`   | macos-13        | macOS 13 SDK           |

Linux uses `ubuntu-22.04` (not `ubuntu-latest`) on purpose: building
on the older LTS gives a binary that runs on Ubuntu 22.04+, Debian 12+,
and RHEL 9+ — `ubuntu-latest` (24.04 = GLIBC 2.39) would cut that
compatibility window.

Artifacts are uploaded on every run with 30-day retention. Tag pushes
additionally publish a GitHub Release with `SHA256SUMS.txt`.

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

### Linux

1. Download `MantisAnalysis-linux-x86_64.zip`.
2. Extract: `unzip MantisAnalysis-linux-x86_64.zip`.
3. Run: `./MantisAnalysis/MantisAnalysis` from a terminal.
4. The terminal shows the server log; your default browser opens to the UI.

> Tested on Ubuntu 22.04+, Debian 12+, RHEL 9+ (anything with
> GLIBC ≥ 2.35). On a barebones server install you may need
> `sudo apt-get install -y libegl1 libgl1 libxkbcommon0 libfontconfig1`
> for matplotlib's font / image paths to work.

### macOS

1. Download `MantisAnalysis-macos-<arch>.tar.gz` (use `arm64` for
   Apple Silicon, `x86_64` for Intel — `uname -m` to check).
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
