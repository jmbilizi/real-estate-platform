# Multi-Model Inference Service (multi-model-inference)

Python service managed by UV (workspace mode — shared root `.venv`, single `uv.lock`). Package code
in `multi_model_inference/`, tests in `tests/`. Nx project name: **`multi-model-inference`**. See
its `README.md` for detail.

## Commands

```bash
pnpm run inference:serve               # nx serve multi-model-inference
pnpm exec nx test multi-model-inference
pnpm run python:check                  # Format (black) + lint (flake8, mypy)
pnpm run python:env                    # One-time env setup (installs UV if missing)
```

## Notes

- Use `uv run <tool>` — never activate the venv manually; never `pip install`.
- Add dependencies with `uv add --project apps/services/multi-model-inference <pkg>`.
- Python 3.11 pinned in `.python-version` (UV auto-downloads it).
- Configs are centralized in `tools/python/` (`.flake8`, `mypy.ini`, etc.) — don't add per-project
  lint configs.
