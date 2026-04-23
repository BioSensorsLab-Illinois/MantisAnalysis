@echo off
REM MantisAnalysis launcher - Windows double-click entry.
REM
REM Double-click in Explorer to start the local server + open the browser.
REM  1. cds to this .bat's directory (the repo root)
REM  2. finds the py.exe launcher or python.exe
REM  3. pip-installs the package in editable mode the first time
REM  4. runs "python -m mantisanalysis" (serves http://127.0.0.1:8765/)
REM
REM Close the console window or press Ctrl-C to stop the server.

setlocal
pushd "%~dp0"

REM Prefer the Windows py.exe launcher; fall back to python.exe on PATH.
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python 3.10+ not found.
  echo Install from https://www.python.org/downloads/windows/
  pause
  popd
  endlocal
  exit /b 1
)

REM Check for the package. If it's not importable, pip install -e .
%PY% -c "import mantisanalysis" >nul 2>nul
if errorlevel 1 (
  echo MantisAnalysis is not installed in this Python.
  echo Running: %PY% -m pip install -e .
  echo.
  %PY% -m pip install -e .
  if errorlevel 1 (
    echo.
    echo Install failed. See README.md for manual setup.
    pause
    popd
    endlocal
    exit /b 1
  )
)

echo Starting MantisAnalysis on http://127.0.0.1:8765/
echo Close this window or press Ctrl-C to stop the server.
echo.
%PY% -m mantisanalysis %*
set "RC=%ERRORLEVEL%"

popd
endlocal & (
  if not "%RC%"=="0" pause
  exit /b %RC%
)
