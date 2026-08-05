# anti-slop

Reusable structural rules for code written by people and coding agents.

The project uses ast-grep for local syntax shapes and Oxlint for rules that need
scope, control-flow, or fixer logic. A rule must pass the admission standard in
`AGENTS.md` before it enters a preset.

