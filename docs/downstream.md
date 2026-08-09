# Anti-slop downstream setup

GitHub registry items install repository-owned ast-grep rules under
`tools/ast-grep` and the Oxlint restriction config under `tools/oxlint`. The
items add the required CLI packages as development dependencies.

Add scripts with scan roots that exist in the downstream repository:

```json
{
  "scripts": {
    "lint:ast": "ast-grep scan --config tools/ast-grep/sgconfig.yml apps packages projects tools",
    "lint:ast:test": "ast-grep test --config tools/ast-grep/sgconfig.yml --skip-snapshot-tests",
    "lint:types:anti-slop": "oxlint --config tools/oxlint/.oxlintrc.json apps packages projects tools",
    "lint:record-types:strict": "ast-grep scan --config tools/ast-grep/sgconfig.yml --error=no-commented-record-string-unknown apps packages projects tools && oxlint --config tools/oxlint/.oxlintrc.json --deny-warnings apps packages projects tools"
}
```

Put `lint:ast` and `lint:types:anti-slop` in the repository's normal check
command. They report the admitted rules at their rollout severities. After the
repository removes its `Record<string, unknown>` backlog, use
`lint:record-types:strict` to make both forms of that restriction blocking. The
Oxlint config disables every unrelated category.

## Preferences

The `preferences` item installs `tools/ast-grep/sgconfig.preferences.yml` and
its own rule and test directories. Preferences use `hint` severity and encode a
convention rather than a defect, so keep them out of the blocking check:

```json
{
  "scripts": {
    "lint:ast:preferences": "ast-grep scan --config tools/ast-grep/sgconfig.preferences.yml apps packages projects tools"
  }
}
```

Bun may defer `@ast-grep/cli`'s platform-binary postinstall and use its runtime
fallback. Trust it once to remove that per-invocation fallback:

```bash
bun pm trust @ast-grep/cli
```

## Optional OMP stream guard

Install `austinm911/anti-slop/omp-ttsr` only in a repository that uses OMP. It
writes `.omp/rules/no-record-string-unknown.md`. OMP aborts a pending edit or
write when it starts to introduce the banned type, then retries with boundary
guidance.

The TTSR regex is early feedback, not lint enforcement. It fires once per
session by default and can match a comment. Keep the Oxlint command in the
normal check.

## Updating installed rules

An untagged GitHub address follows the registry repository's default branch, but
installed files do not update automatically. Preview the current upstream item:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/no-return-local-alias-function --dry-run
bunx --bun shadcn@latest add austinm911/anti-slop/no-return-local-alias-function --diff tools/ast-grep/rules/no-return-local-alias-function.yml
```

After reviewing local changes, re-run with `--overwrite` only when replacing the
installed copies is intended. Use `#v0.1.0` or another tag to remain pinned to a
release instead of following the default branch.
