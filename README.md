# anti-slop

Reusable structural rules for code written by people and coding agents.

The project uses ast-grep for local syntax shapes and Oxlint for rules that need
scope, control-flow, or fixer logic. A rule must pass the admission standard in
[`docs/admission-standard.md`](docs/admission-standard.md) before it enters a
preset.

The first release contains two ast-grep rules:

- `no-return-local-alias-function` rejects a local that only forwards its
  initializer to the next return.
- `no-file-local-generic-record-guard` warns about another file-local
  `isRecord` helper instead of a boundary decoder or package-owned utility.

The Oxlint lane is intentionally empty. No candidate has met the admission
standard without duplicating a native Oxlint rule or producing excessive noise.

## Install the package from GitHub

```bash
bun add --dev @austinm911/anti-slop@github:austinm911/anti-slop#v0.1.0
```

Scan a repository:

```bash
bunx anti-slop scan apps packages projects tools
```

Test the packaged rules:

```bash
bunx anti-slop test
```

## Install through the GitHub registry

Install the packaged recommended preset:

```bash
bunx shadcn@latest add austinm911/anti-slop/recommended#v0.1.0
```

Use `ast-grep-local` instead when the downstream repository must own and edit
copies of the YAML rules:

```bash
bunx shadcn@latest add austinm911/anti-slop/ast-grep-local#v0.1.0
```

Preview any installation before it writes files:

```bash
bunx shadcn@latest add austinm911/anti-slop/recommended#v0.1.0 --dry-run
```

## Develop

```bash
bun install
bun run check
```

See [`docs/rule-catalog.md`](docs/rule-catalog.md) for rule ownership and rollout
details.
