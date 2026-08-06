# Contributing

Anti-slop is a public source registry. Contributions are ordinary pull requests
to this repository; no package publication or registry deployment is required.

## Add or change a rule

1. Follow [`docs/admission-standard.md`](docs/admission-standard.md).
2. Put ast-grep rules in `ast-grep/rules` and tests in
   `ast-grep/rule-tests`.
3. Include invalid examples, valid examples, and legitimate counterexamples.
4. Audit the current Oxlint rule catalog and source before adding overlapping
   behavior.
5. Record ownership, severity, rollout state, and initial scan evidence in
   `docs/rule-catalog.md`.
6. Add or update the rule's individual item and affected bundles in
   `registry.json`.
7. Run `bun run check`.

Registry item names are public API. Do not rename or remove a released item
without a migration path.

## Test a registry change locally

```bash
bunx --bun shadcn@latest registry validate registry.json
bunx --bun shadcn@latest build registry.json --output /tmp/anti-slop-registry
```

A public GitHub install resolves `owner/repo/item[#ref]` from the root
`registry.json`, then reads every declared source file from the same commit.
Release tags provide immutable installs; untagged addresses follow the default
branch when users re-run the command.
