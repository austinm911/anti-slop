# anti-slop

Reusable correctness rules and conventions for code written by people and
coding agents.

The project uses native Oxlint rules when one already owns a check. It uses
ast-grep for local syntax shapes that Oxlint does not cover. A custom Oxlint
rule is reserved for checks that need scope, control-flow, configuration, or
fixer logic. A rule must pass the admission standard in
[`docs/admission-standard.md`](docs/admission-standard.md) before it enters a
preset.

Rules ship in two tiers. A correctness rule reports a defect and can block a
build. A preference encodes a convention, uses `hint` severity, and never
enters a correctness preset.

The recommended preset contains four ast-grep rules and one Oxlint restriction:

- `no-return-local-alias-function` rejects a local that only forwards its
  initializer to the next return.
- `no-throw-local-alias-function` rejects a local that only forwards its
  initializer to the next throw.
- `no-file-local-generic-record-guard` warns about another file-local
  `isRecord` helper instead of a boundary decoder or package-owned utility.
- `no-commented-record-string-unknown` completes the Oxlint restriction for
  equivalent type expressions that contain a comment.

The Oxlint rule:

- `no-record-string-unknown` warns on `Record<string, unknown>` and directs the
  author to parse data into a strongly typed domain type at its I/O boundary.

The preferences tier contains one ast-grep rule:

- `no-mixed-jsdoc-line-prefix` reports a JSDoc block that prefixes some lines
  with `*` and not others, because the parser discards the difference.

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
austinm911/anti-slop/no-record-string-unknown
austinm911/anti-slop/no-mixed-jsdoc-line-prefix
austinm911/anti-slop/recommended
austinm911/anti-slop/all
austinm911/anti-slop/preferences
austinm911/anti-slop/omp-ttsr
austinm911/anti-slop/agent-guidance
```

Each rule item copies its repository-owned source, test configuration, and setup
guide into the downstream repository. `recommended` installs the normal preset;
`all` installs every admitted correctness rule; `preferences` installs the
convention rules under a separate configuration.

Preview an install:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended --dry-run
```

Registry installs are repository-owned source, not automatically updated.
Re-run the same untagged address to fetch the latest default-branch version.
Use `--dry-run` and `--diff <file>` to review changes, then `--overwrite` only
when replacing the local copies is intended.

## Promote the restriction after migration

The restriction starts as a warning because the initial external scan found
1,679 matches. After a repository removes its backlog, make this rule blocking:

```bash
anti-slop scan --strict
```

Strict mode promotes the native Oxlint restriction and its ast-grep comment
supplement to errors. Other warning-level rules keep their rollout severity.

## Optional OMP TTSR guard

OMP users can install an early stream guard separately:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/omp-ttsr
```

The item writes `.omp/rules/no-record-string-unknown.md`. OMP watches edit and
write streams for the banned type. On a match, it aborts the pending tool call,
injects the boundary guidance, and retries from the same point.

TTSR is not the enforcement layer. A TTSR rule fires once per session by
default, and its regex can also see code comments. The Oxlint restriction and
ast-grep supplement remain the syntax-aware source of truth for local checks and
CI. See the [OMP TTSR documentation](https://omp.sh/docs/ttsr).

## Develop

```bash
bun install
bun run check
```

Scan a repository with either tier:

```bash
bunx anti-slop scan
bunx anti-slop scan --preferences
```

See [`docs/rule-catalog.md`](docs/rule-catalog.md) for rule ownership and rollout
details, and [`docs/preference-catalog.md`](docs/preference-catalog.md) for the
preferences tier.
