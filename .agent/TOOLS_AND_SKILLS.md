# TOOLS_AND_SKILLS

What tooling exists, what's configured, what's recommended. For
workflow-level knowledge, see [`skills/`](skills/). For reviewer
roles, see [`agents/`](agents/).

## Status legend

- ✅ **shipped** — present, configured, validated.
- 🟡 **shipped, partial** — present and configured, but limited use.
- 🔵 **recommended, not configured** — design + rationale exist;
  install on trigger.
- 🔴 **blocked / unavailable** — wanted, but something prevents it.
- ❌ **rejected** — considered, explicitly not adopted.

## Backend / analysis tooling

| Tool | Status | Where | Notes |
|---|---|---|---|
| **pyproject (PEP 621) + setuptools** | ✅ | `pyproject.toml` | Single metadata + deps source. |
| **pip editable install** | ✅ | `pip install -e .[dev]` | Dev install verified. |
| **FastAPI + uvicorn** | ✅ | `pyproject.toml dependencies`, `mantisanalysis/server.py`, `app.py` | Post [D-0009](DECISIONS.md). |
| **Pydantic 2.5+** | ✅ | `pyproject.toml dependencies` | Request/response schemas in `server.py`. |
| **NumPy + SciPy** | ✅ | `pyproject.toml dependencies` | Analysis-math core. |
| **matplotlib (Agg backend)** | ✅ | `pyproject.toml dependencies`, `tests/conftest.py` | Figure builders; headless in tests. |
| **h5py, Pillow, tifffile** | ✅ | `pyproject.toml dependencies` | I/O. |
| **pytest** | ✅ | `pyproject.toml [tool.pytest.ini_options]` | 40+ tests green. |
| **httpx** | ✅ | `pyproject.toml [dev]` | FastAPI TestClient dep. |
| **ruff (lint + format)** | ✅ | `pyproject.toml [tool.ruff]` | Conservative ruleset (E, F, W, I, B, UP). |
| **mypy** | 🟡 | `pyproject.toml [tool.mypy]` | `ignore_missing_imports = true`; progressive. |
| **smoke harness** | ✅ | `scripts/smoke_test.py` | Tier 0–3 implemented; Tier 4 = pointer to Playwright gate. |
| **Agent-doc consistency checker** | ✅ | `scripts/check_agent_docs.py` | Tier 0. Detects stale Qt refs + dead command paths. |
| **GitHub Actions CI** | ✅ | `.github/workflows/smoke.yml` | Multi-OS × multi-Python. Tier 0 + 4 not yet wired. |
| **pre-commit hooks** | 🔵 | — | Recommended when commit volume rises. Suggested config below. |
| **pip-tools / uv lockfile** | 🔵 | — | Reproducibility upgrade; not yet needed. |
| **PyInstaller / freezing** | 🔵 | — | Wait until users want a binary. |
| **Sphinx / readthedocs** | ❌ | — | Overkill for a lab tool; `.agent/` + `README.md` cover us. |

## Frontend tooling

| Tool | Status | Where | Notes |
|---|---|---|---|
| **React 18** | ✅ | `web/index.html` (CDN), `web/src/*.jsx` | Core UI. |
| **Babel standalone** | ✅ | `web/index.html` (CDN) | JSX transpiled in-browser. |
| **dom-to-image-more** | 🟡 | CDN in `web/index.html` | Used for export path; known CORS issues being migrated away in `analysis-page-overhaul-v1` Phase 5. |
| **Vite or esbuild (bundler)** | 🔵 | — | `B-0014`. Attractive after `web/src/analysis/` subtree lands. Would unlock npm deps + lockfile + Storybook. |
| **Storybook + Chromatic** | 🔵 | — | Gated on bundler decision. Component-level docs + interaction tests + a11y + visual regression if adopted. |
| **React DevTools** | 🟡 | Browser extension (manual install) | Used for performance review. |

## Testing tooling

| Tool | Status | Where | Notes |
|---|---|---|---|
| **pytest-qt** | ❌ | Removed | Qt layer deleted in D-0009. |
| **pytest (unit + headless)** | ✅ | `tests/unit/`, `tests/headless/` | 40+ tests. |
| **fastapi.testclient** | ✅ | Used in `scripts/smoke_test.py` Tier 3 + `tests/unit/test_isp_modes.py` | In-process ASGI. |
| **Playwright (chromium)** | 🟡 | `[project.optional-dependencies].web-smoke`, `tests/web/conftest.py + test_web_boot.py` | Opt-in. `pytest -m web_smoke`. |
| **pytest-playwright** | 🟡 | `[web-smoke]` | Native Playwright integration. |
| **axe-core (via axe-playwright-python)** | 🔵 | — | Accessibility automation. Install only when an initiative explicitly needs it. |
| **Visual regression (Playwright toHaveScreenshot)** | 🔵 | — | No baseline today. First initiative to adopt it sets the policy. |
| **Lighthouse CI** | 🔵 | — | Possible for performance budgets; overkill today. |

## Agent harness (Claude Code)

| Tool | Status | Where | Notes |
|---|---|---|---|
| **.agent/ (single source of truth)** | ✅ | `.agent/`, `.claude → .agent` symlink | See [`README.md`](README.md). |
| **Custom subagents** | ✅ | `.agent/agents/*.md` | 10 specialist reviewer briefs. |
| **Reusable skills** | ✅ | `.agent/skills/*/SKILL.md` | 17 workflow skills. |
| **CLAUDE.md (root)** | ✅ | `/CLAUDE.md` | Short entry file + compaction protocol. |
| **settings.local.json permissions** | ✅ | `.agent/settings.local.json` + `.agent/settings.local.README.md` | Allowlist for routine safe commands. |
| **launch.json (Preview MCP config)** | ✅ | `.agent/launch.json` | `python -m mantisanalysis --port 8773 --no-browser`. |
| **Claude Preview MCP** | 🟡 | External (user-side) | `mcp__Claude_Preview__*` tools; needed for browser verification. |
| **Hooks (PreToolUse / PostToolUse / Stop)** | 🔵 | — | Proposals in `.agent/settings.local.README.md`. Not installed — would affect every tool call. |
| **AGENTS.md (root)** | ✅ | `/AGENTS.md` | Standard discoverable pointer to `.agent/`. |
| **Manifest (machine-readable)** | ✅ | `.agent/manifest.yaml` | Module + command + gate summary. |

## Recommended: pre-commit suggested config

```yaml
# .pre-commit-config.yaml
repos:
- repo: https://github.com/astral-sh/ruff-pre-commit
  rev: v0.5.7
  hooks:
    - id: ruff           # lint
    - id: ruff-format    # format
- repo: local
  hooks:
    - id: check-agent-docs
      name: agent docs consistency (Tier 0)
      entry: python scripts/check_agent_docs.py
      language: system
      pass_filenames: false
      files: ^(\.agent/|CLAUDE\.md|AGENTS\.md)
    - id: smoke-tier-1
      name: smoke tier 1 (imports)
      entry: python scripts/smoke_test.py --tier 1
      language: system
      pass_filenames: false
      files: ^(mantisanalysis|scripts)/.*\.py$
```

Install with `pre-commit install`. Skipping on a single commit:
`git commit --no-verify` — but only with user consent per
`AGENT_RULES.md`.

## Skills catalogue (always up-to-date roster)

See [`skills/README.md`](skills/README.md) for the full roster.

- **Session lifecycle**: `session-start`, `execplan-large-feature`,
  `context-handoff`.
- **Change-class workflows**: `react-browser-ui-change`,
  `fastapi-api-change`, `h5-io-data-pipeline-change`,
  `visualization-canvas-image-pipeline`.
- **Verification**: `quality-gates`, `playwright-e2e-verification`,
  `visual-regression`, `accessibility-check`,
  `performance-profiling`, `independent-review-loop`.
- **Infra**: `docs-sync`, `safe-git-and-worktrees`,
  `dependency-change`, `emergency-recovery`.

## Specialist reviewer agents

See [`agents/README.md`](agents/README.md) for the full roster.

`planner-architect`, `react-ui-ux-reviewer`,
`frontend-react-engineer`, `fastapi-backend-reviewer`,
`playwright-verifier`, `accessibility-reviewer`,
`performance-reviewer`, `test-coverage-reviewer`, `risk-skeptic`,
`docs-handoff-curator`.

## MCP integrations

| Server | Status | Justification |
|---|---|---|
| `mcp__Claude_Preview__*` | 🟡 | Browser verification (screenshot, console, network, click, fill, resize). Required for UI work per `AGENT_RULES.md` rule 14. |
| `filesystem` (built-in) | ✅ | Default. Read / Edit / Write / Glob / Grep. |
| `ripgrep` (built-in Grep) | ✅ | Code / doc search. |
| `github` MCP | 🔵 | If PR / issue volume rises. Use `gh` CLI meanwhile. |
| Data-tool MCPs (Hex, Amplitude, etc.) | ❌ | Irrelevant to a scientific desktop tool. |
| Heavy IDE MCPs | ❌ | Overhead > gain for a solo lab project. |

New MCPs justified per `AGENT_RULES.md` rule 12 (no fashionable
tools without rationale).

## Editor / IDE config

Not currently shipped. Suggested `.editorconfig`:

```ini
root = true

[*.py]
indent_style = space
indent_size = 4
trim_trailing_whitespace = true
insert_final_newline = true
end_of_line = lf
charset = utf-8

[*.{md,yaml,yml,json,toml}]
indent_style = space
indent_size = 2

[*.jsx]
indent_style = space
indent_size = 2
```

Add when the team picks a primary editor.
