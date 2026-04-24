"""Claude-powered auto-fix: read failing CI logs, patch files, save.

Invoked from .github/workflows/auto-fix.yml when ``ANTHROPIC_API_KEY`` is
set. Uses a tight tool-use loop (Read / Edit / Write) against Anthropic's
API with prompt caching. Writes at most ~20 edits before stopping.

Design notes:
  * Deliberately conservative — if Claude can't confidently localise the
    bug, it returns without edits and the workflow falls through to the
    "open an issue" branch.
  * No Bash tool exposed. Auto-fix runs inside a privileged GH Actions
    context; restricting the model to file edits keeps the blast radius
    small.
  * Prompt caches the "system + project layout" prefix so repeated runs
    across many failures stay cheap.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import anthropic

MODEL = "claude-sonnet-4-6"
MAX_ITER = 20
REPO = Path(__file__).resolve().parents[2]


# --- Tool schemas (file-only; no shell) --------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "name": "read_file",
        "description": "Read a UTF-8 text file from the repository. Returns the full file contents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Repo-relative path."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "list_dir",
        "description": "List entries in a directory (non-recursive).",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "edit_file",
        "description": (
            "Apply a targeted replacement in a file. `old` must occur EXACTLY once; "
            "include surrounding context to disambiguate."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old": {"type": "string"},
                "new": {"type": "string"},
            },
            "required": ["path", "old", "new"],
        },
    },
    {
        "name": "write_file",
        "description": "Overwrite a file (or create it if missing) with the given contents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "finish",
        "description": (
            "Call when you've applied all necessary fixes, or when you decide no "
            "confident fix is possible. Provide a one-paragraph summary."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "fixed": {"type": "boolean"},
            },
            "required": ["summary", "fixed"],
        },
    },
]


# --- Tool implementations ----------------------------------------------------

def _safe_path(rel: str) -> Path:
    p = (REPO / rel).resolve()
    if REPO not in p.parents and p != REPO:
        raise ValueError(f"path escapes repo root: {rel}")
    return p


def tool_read_file(path: str) -> str:
    p = _safe_path(path)
    if not p.exists():
        return f"ERROR: {path} does not exist"
    if p.is_dir():
        return f"ERROR: {path} is a directory"
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        return f"ERROR reading {path}: {exc}"


def tool_list_dir(path: str) -> str:
    p = _safe_path(path)
    if not p.is_dir():
        return f"ERROR: {path} is not a directory"
    entries = sorted(
        (f"{child.name}{'/' if child.is_dir() else ''}" for child in p.iterdir()),
    )
    return "\n".join(entries) or "(empty)"


def tool_edit_file(path: str, old: str, new: str) -> str:
    p = _safe_path(path)
    if not p.exists():
        return f"ERROR: {path} does not exist"
    src = p.read_text(encoding="utf-8")
    count = src.count(old)
    if count == 0:
        return f"ERROR: `old` string not found in {path}"
    if count > 1:
        return f"ERROR: `old` string occurs {count} times in {path}; make it unique"
    p.write_text(src.replace(old, new, 1), encoding="utf-8")
    return f"OK: replaced 1 occurrence in {path}"


def tool_write_file(path: str, content: str) -> str:
    p = _safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return f"OK: wrote {path} ({len(content)} bytes)"


def dispatch(name: str, args: dict[str, Any]) -> str:
    try:
        if name == "read_file":
            return tool_read_file(args["path"])
        if name == "list_dir":
            return tool_list_dir(args["path"])
        if name == "edit_file":
            return tool_edit_file(args["path"], args["old"], args["new"])
        if name == "write_file":
            return tool_write_file(args["path"], args["content"])
        return f"ERROR: unknown tool {name}"
    except Exception as exc:
        return f"ERROR: {exc}"


# --- System prompt -----------------------------------------------------------

SYSTEM = """\
You are an automated CI repair bot for the MantisAnalysis project (a FastAPI
+ React SPA for scientific image analysis). A GitHub Actions workflow has
failed. Your job: read the failure log, find the minimal set of files to
edit, and apply fixes.

GROUND RULES
1. Edit only what's needed to make CI pass. Do NOT refactor, reformat broadly,
   or restructure code.
2. Prefer small, surgical edits over rewrites.
3. Never introduce a new dependency unless the failure clearly demands it.
4. Never touch `.github/workflows/*` unless the failure is obviously inside
   the workflow YAML itself.
5. Never delete tests to silence failures; fix the underlying cause.
6. If the failure root cause is unclear or outside your reach (infrastructure,
   network, secrets), call `finish` with `fixed=false` and a short explanation.

PROCESS
- Start by reading the failure log, then the relevant source files.
- Use `list_dir` to orient yourself if needed.
- Apply edits with `edit_file` (preferred) or `write_file`.
- Call `finish` when done — do not keep exploring indefinitely.

Project layout (read-only hint):
- `mantisanalysis/` — Python package (FastAPI server + NumPy analysis)
- `tests/unit/` — fast unit tests
- `tests/headless/` — matplotlib Agg tests
- `web/` — static React SPA (JSX compiled in-browser; no build step)
- `packaging/` — PyInstaller spec + build scripts
- `.github/workflows/` — CI definitions
- `pyproject.toml` — deps, tool config
"""


def build_first_message(log_tail: str, workflow: str, branch: str, commit: str) -> str:
    return f"""\
Workflow **{workflow}** failed on branch `{branch}` at commit `{commit}`.

Here is the tail of the failure log:

<failure_log>
{log_tail}
</failure_log>

Investigate, fix, and call `finish` when done. If you cannot confidently fix
it, call `finish` with `fixed=false` and explain why.
"""


# --- Main loop ---------------------------------------------------------------

def run(log_path: Path, workflow: str, branch: str, commit: str) -> int:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY not set; skipping Claude fix.")
        return 0

    log_tail = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else "(no log available)"
    client = anthropic.Anthropic(api_key=api_key)

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": build_first_message(log_tail, workflow, branch, commit)},
    ]

    for step in range(MAX_ITER):
        resp = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            tools=TOOLS,
            messages=messages,
        )

        messages.append({"role": "assistant", "content": resp.content})

        if resp.stop_reason == "end_turn":
            print(f"[claude] end_turn at step {step}; stopping without finish()")
            break

        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            break

        tool_results: list[dict[str, Any]] = []
        finished = False
        for block in tool_uses:
            name = block.name
            args = block.input or {}
            if name == "finish":
                summary = args.get("summary", "")
                fixed = bool(args.get("fixed"))
                print(f"[claude] finish(fixed={fixed}): {summary}")
                finished = True
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": "acknowledged",
                })
            else:
                result = dispatch(name, args)
                preview = result if len(result) < 2000 else result[:2000] + "\n…[truncated]"
                print(f"[claude] {name}({json.dumps(args)[:200]}) → {len(result)} chars")
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": preview,
                })

        messages.append({"role": "user", "content": tool_results})
        if finished:
            break

    else:
        print(f"[claude] hit MAX_ITER={MAX_ITER}; stopping")

    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", required=True)
    ap.add_argument("--workflow", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--commit", required=True)
    args = ap.parse_args()
    return run(Path(args.log), args.workflow, args.branch, args.commit)


if __name__ == "__main__":
    sys.exit(main())
