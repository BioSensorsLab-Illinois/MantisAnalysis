@echo off
REM Windows launcher for MantisAnalysis. Pauses on error so the
REM traceback stays visible when double-clicking from Explorer.
setlocal
cd /d "%~dp0"
echo Launching MantisAnalysis...
python -m mantisanalysis %*
if errorlevel 1 (
    echo.
    echo *** MantisAnalysis exited with error code %errorlevel% ***
    echo Press any key to close.
    pause ^>nul
)
