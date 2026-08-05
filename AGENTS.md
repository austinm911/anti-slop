# Agent guidance

## Rule admission standard

Follow `docs/admission-standard.md`. Do not weaken the standard to admit a
candidate rule.

Use ast-grep for local syntax shapes and codemods. Use Oxlint for checks that need
scope, control-flow, configuration, or fixer logic. Do not duplicate a native
Oxlint rule.

Use Bun for package, test, build, and release commands.

Use `apply_patch` for hand-authored file changes. Preserve unrelated worktree
changes. Run `bun run check` before each commit.
