# Anti-slop downstream setup

GitHub registry items install repository-owned rules under `tools/ast-grep` and
add `@ast-grep/cli` as a development dependency. The shared config resolves its
rule and test directories relative to `tools/ast-grep/sgconfig.yml`.

Add scripts with scan roots that exist in the downstream repository:

```json
{
  "scripts": {
    "lint:ast": "ast-grep scan --config tools/ast-grep/sgconfig.yml apps packages projects tools",
    "lint:ast:test": "ast-grep test --config tools/ast-grep/sgconfig.yml --skip-snapshot-tests"
  }
}
```

Put `lint:ast` in the repository's normal check command.

Bun may defer `@ast-grep/cli`'s platform-binary postinstall and use its runtime
fallback. Trust it once to remove that per-invocation fallback:

```bash
bun pm trust @ast-grep/cli
```

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
