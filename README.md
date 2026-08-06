# anti-slop

Reusable structural rules for code written by people and coding agents.

The project uses ast-grep for local syntax shapes and Oxlint for rules that need
scope, control-flow, or fixer logic. A rule must pass the admission standard in
[`docs/admission-standard.md`](docs/admission-standard.md) before it enters a
preset.

The recommended preset contains three ast-grep rules:

- `no-return-local-alias-function` rejects a local that only forwards its
  initializer to the next return.
- `no-throw-local-alias-function` rejects a local that only forwards its
  initializer to the next throw.
- `no-file-local-generic-record-guard` warns about another file-local
  `isRecord` helper instead of a boundary decoder or package-owned utility.

The Oxlint lane is intentionally empty. No candidate has met the admission
standard without duplicating a native Oxlint rule or producing excessive noise.

## Install from the GitHub registry

Install one rule directly from the public GitHub source registry:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/no-return-local-alias-function
```

The shadcn CLI requires a valid `components.json` and `tsconfig.json` in the
consumer repository. `components.json` is project configuration for the CLI;
using this registry does not require adopting shadcn UI components.

The untagged address follows the latest commit on the repository's default
branch. Pin a release when reproducibility matters:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/no-return-local-alias-function#v0.1.0
```

Other installable items:

```text
austinm911/anti-slop/no-throw-local-alias-function
austinm911/anti-slop/no-file-local-generic-record-guard
austinm911/anti-slop/recommended
austinm911/anti-slop/all
austinm911/anti-slop/agent-guidance
```

Each rule item copies its YAML rule, tests, shared ast-grep configuration, and
setup guide into the downstream repository. `recommended` installs the normal
preset; `all` installs every admitted rule.

Preview an install:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended --dry-run
```

Registry installs are repository-owned source, not automatically updated.
Re-run the same untagged address to fetch the latest default-branch version.
Use `--dry-run` and `--diff <file>` to review changes, then `--overwrite` only
when replacing the local copies is intended.

## Develop

```bash
bun install
bun run check
```

See [`docs/rule-catalog.md`](docs/rule-catalog.md) for rule ownership and rollout
details.
