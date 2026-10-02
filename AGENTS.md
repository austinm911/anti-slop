# Agent guidance

Admit a rule only when it meets every condition in `docs/admission-standard.md`,
including its ownership decision between ast-grep and Oxlint. When a candidate
falls short, record why and keep the standard as written.

Write a check as an Oxlint JavaScript plugin when it must cover `.tsrx`, because
ast-grep cannot parse that dialect. `docs/tsrx.md` has the toolchain details.

`@tsrx/oxc` lives in its own package under `test/tsrx/` because its `oxlint` and
`oxfmt` commands would replace the repository's own.

Pin dependencies exactly with `bun add -E`. Bun refuses a release younger than
the configured minimum release age. Pass `--minimum-release-age=0` to take it.
An Oxlint upgrade can turn upstream rules native, which runs their hand-written
`review/examples/*.yml` against the real rule for the first time. Fix the
examples that fail.

Profiles compile to `oxlint/configs/`. Run `bun run build` after changing a
profile, a plugin source, or the vendored plugin. Never edit
`vendor/dmmulroy-anti-slop` by hand. Recopy it from upstream and update its
`UPSTREAM.json`.

Use Bun for package, test, build, and release commands. Make hand-authored
edits with `apply_patch`. Preserve unrelated worktree changes. Run
`bun run check` before each commit.
