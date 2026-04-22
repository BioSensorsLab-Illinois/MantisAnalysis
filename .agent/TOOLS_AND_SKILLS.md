# TOOLS_AND_SKILLS

What tooling exists, what is configured, what is recommended.

## Status legend

- ✅ **shipped** — present, configured, validated.
- 🟡 **shipped, partial** — present and configured, but limited use.
- 🔵 **recommended, not configured** — design + rationale exist; pull
  the trigger when needed.
- 🔴 **blocked / unavailable** — wanted, but something prevents it.

## Inventory

| Tool | Status | Where it's configured | Notes |
|---|---|---|---|
| **git** | ✅ | `.git/`, `.gitignore` | Initialized, remote set; no commits yet (B-0010). |
| **pyproject (PEP 621) + setuptools** | ✅ | `pyproject.toml` | Canonical metadata + deps + tool configs. |
| **pip editable install** | ✅ | `pip install -e .[dev]` | Verified locally. |
| **pytest** | ✅ | `pyproject.toml [tool.pytest.ini_options]` | 39 tests, all green. |
| **pytest-qt** | 🟡 | declared in `[dev]` | No `gui`-marked tests yet — suite is infrastructure-ready (`tests/conftest.py` markers). |
| **ruff (lint + format)** | ✅ | `pyproject.toml [tool.ruff]` | Conservative ruleset (E, F, W, I, B, UP). Run on demand. |
| **mypy** | 🟡 | `pyproject.toml [tool.mypy]` | `ignore_missing_imports = true`; not blocking. Annotations exist throughout but suite is not type-clean. |
| **smoke harness** | ✅ | `scripts/smoke_test.py` | Tier 1 + 2 + 3 implemented; Tier 4 stub. |
| **GitHub Actions CI** | ✅ | `.github/workflows/smoke.yml` | Multi-OS × multi-Python. Tier 3 not in CI yet (B-0009). |
| **pre-commit hooks** | 🔵 | — | Recommended once committing volume picks up; suggested config below. |
| **PyInstaller / freezing** | 🔵 | — | Wait until users want a binary. |
| **Sphinx / readthedocs** | 🔵 | — | Probably overkill for a lab tool; the `.agent/` + `README.md` cover us today. |
| **pip-tools / uv lockfile** | 🔵 | — | Reproducibility upgrade; not yet needed. |

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
    - id: smoke-tier-1
      name: smoke tier 1 (imports)
      entry: python scripts/smoke_test.py --tier 1
      language: system
      pass_filenames: false
      files: ^(mantisanalysis|scripts)/.*\.py$
```

Install with `pre-commit install`. Skipping it on a single commit:
`git commit --no-verify`.

## Skills (repo-local, agent-side)

The `.agent/skills/` folder is INTENTIONALLY EMPTY at the close of
this implementation pass. The Phase 1 plan listed ~13 candidate skill
files; none were materialized because:

- The current `.agent/` doc set (00_START_HERE through CHANGELOG_AGENT)
  already encodes the workflow knowledge in human-readable form.
- A skill file is only useful when the harness can auto-load it on
  trigger keywords. That wiring (Claude Code `.claude/settings.json`
  + a `commands/` shim folder) is not yet present at the repo level.
- Cargo-culting empty skill stubs would clutter the harness with
  "trendy tools" — explicitly forbidden by Phase 2 prompt.

The list of skills to materialize when the harness layer is added:
`session-start`, `smoke-test`, `qt-ui-edit`, `mode-change`,
`analysis-math-change`, `theming-change`, `plotting-change`,
`io-change`, `packaging-binary`, `ci-cd`, `release-workflow`,
`context-handoff`, `review-loop`. See Phase 1 audit § 5.2 for the
full per-skill spec.

## MCP integrations

None configured at the repo level. Recommended set when needed:

| Server | Justification | Status |
|---|---|---|
| `filesystem` (built-in) | default | ✅ already present |
| `github` MCP | PR / issue management without `gh` shell calls | 🔵 if BSL workflow grows |
| `ripgrep-mcp` or built-in `Grep` | fast code search | ✅ built-in |
| heavy IDE-style MCPs | overhead > gain for a solo lab project | ❌ skip |
| data-tool MCPs (Hex, Amplitude, etc.) | irrelevant | ❌ skip |

Adding new MCP servers should be justified per AGENT_RULES rule 12
(no fashionable tools without rationale).

## Editor / IDE config

Not currently shipped. Recommended (drop into `.editorconfig`):

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
```

Add when the team picks a primary editor.
