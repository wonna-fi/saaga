# Changelog

Saaga is in alpha. This file records the changes that require action when
upgrading; everything else is in the git history.

## 1.0.0-alpha.7 (2026-09-02)

### Per-step model keys

The `modelLow`, `modelMedium` and `modelHigh` config fields and the
`--model-low` / `--model-medium` / `--model-high` flags were removed. Move
them under `backends.<name>.models:` as `low` / `medium` / `high`; a config
still using the old fields fails with a `ConfigError` naming the
replacement. Use `--model <key>=<model>` on the command line. See
[Model keys](./README.md#model-keys).

The `init`, `update` and `verify-quick-updates` flow files gained a `model:`
key on every agent step, which changes their flow hash. A run of one of
those flows that was interrupted under an earlier version can no longer be
resumed, and `--resume` / `--continue` will say
`flow '<name>' has changed since run '<id>' started; start a new run instead`.
Start a fresh run. Interrupted `quick-update` runs are unaffected. The
models each command uses are otherwise unchanged.
