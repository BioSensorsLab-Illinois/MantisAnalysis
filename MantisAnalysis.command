#!/usr/bin/env bash
# MantisAnalysis launcher — macOS double-click entry.
#
# Finder double-click opens Terminal.app and runs this script. It:
#   1. cds to this file's directory (the repo root)
#   2. finds a Python 3.10+ interpreter
#   3. pip-installs the package in editable mode the first time
#   4. runs `python -m mantisanalysis`, which starts the local server
#      on http://127.0.0.1:8765 and opens your default browser.
#
# Close the Terminal window to stop the server (Ctrl-C also works).
#
# First-time setup on a fresh clone: if Finder complains "cannot be
# opened because it is from an unidentified developer" (Gatekeeper),
# right-click → Open, or in Terminal run:
#     chmod +x MantisAnalysis.command

set -u
cd "$(dirname "$0")" || exit 1

PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c "import sys; exit(0 if sys.version_info[:2] >= (3, 10) else 1)" 2>/dev/null; then
      PY="$candidate"
      break
    fi
  fi
done

if [ -z "$PY" ]; then
  echo "Python 3.10+ not found."
  echo "Install from https://www.python.org/downloads/ (or 'brew install python@3.12')."
  read -n 1 -s -r -p "Press any key to close this window…"
  echo
  exit 1
fi

if ! "$PY" -c "import mantisanalysis" 2>/dev/null; then
  echo "MantisAnalysis is not installed in this Python."
  echo "Running: $PY -m pip install -e ."
  echo
  if ! "$PY" -m pip install -e . ; then
    echo
    echo "Install failed. See README.md for manual setup."
    read -n 1 -s -r -p "Press any key to close this window…"
    echo
    exit 1
  fi
fi

echo "Starting MantisAnalysis on http://127.0.0.1:8765/"
echo "Close this window or press Ctrl-C to stop the server."
echo
"$PY" -m mantisanalysis "$@"
RC=$?
if [ $RC -ne 0 ]; then
  echo
  echo "MantisAnalysis exited with code $RC."
  read -n 1 -s -r -p "Press any key to close this window…"
  echo
fi
exit $RC
