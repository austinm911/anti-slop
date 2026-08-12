# anti-slop

Reusable correctness rules and conventions for code written by people and
coding agents.

The project uses native Oxlint rules when one already owns a check. It uses
ast-grep for local syntax shapes that Oxlint does not cover. It reserves custom
Oxlint rules for checks that need scope, control flow, configuration, or fixer
logic. A rule must pass the
[`docs/admission-standard.md`](docs/admission-standard.md) admission standard
before it enters a preset.

Rules ship in two tiers:

- A correctness rule reports a defect. It can block a check.
- A preference encodes a convention. It uses `hint` severity. It never enters a
  correctness bundle.

## Correctness rules

- `no-return-local-alias-function` rejects a local that only forwards its
  initializer to the next return.
- `no-throw-local-alias-function` rejects a local that only forwards its
  initializer to the next throw.
- `no-file-local-generic-record-guard` warns about another file-local `isRecord`
  helper instead of a boundary decoder or package-owned utility.
- `no-record-string-unknown` warns on `Record<string, unknown>` and directs the
  author to parse data into a strongly typed domain type at its I/O boundary.
  The item also installs `no-commented-record-string-unknown`, an ast-grep
  supplement that catches comment-formatted instances Oxlint does not
  normalize.

## Preferences

- `no-mixed-jsdoc-line-prefix` reports a JSDoc block that prefixes some lines
  with `*` and not others, because the parser discards the difference.

## Install from the GitHub registry

The shadcn CLI copies the selected item into the consumer repository. It also
installs the item's declared development dependencies. The CLI requires a valid
`components.json` and `tsconfig.json` in the consumer repository. These files
configure the CLI; this registry does not add UI components.

### Individual rules

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/no-return-local-alias-function
bunx --bun shadcn@latest add austinm911/anti-slop/no-throw-local-alias-function
bunx --bun shadcn@latest add austinm911/anti-slop/no-file-local-generic-record-guard
bunx --bun shadcn@latest add austinm911/anti-slop/no-record-string-unknown
bunx --bun shadcn@latest add austinm911/anti-slop/no-mixed-jsdoc-line-prefix
```

### Tool bundles

Install the ast-grep or Oxlint rules as a tool bundle:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/ast-grep
bunx --bun shadcn@latest add austinm911/anti-slop/oxlint
```

`ast-grep` installs the three ast-grep correctness rules. `oxlint` installs the
`no-record-string-unknown` restriction.

### Presets

Install the correctness or preferences preset:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended
bunx --bun shadcn@latest add austinm911/anti-slop/preferences
```

`recommended` installs both correctness tool bundles. `preferences` installs the
preferences rule.

## Wire the checks in the consumer repository

Registry items place ast-grep files under `tools/ast-grep` and the Oxlint
configuration under `tools/oxlint`. Add scripts with source roots that exist in
the consumer repository. Replace the example roots when needed:

```json
{
  "scripts": {
    "lint:ast": "ast-grep scan --config tools/ast-grep/sgconfig.yml apps packages projects tools",
    "lint:ast:test": "ast-grep test --config tools/ast-grep/sgconfig.yml --skip-snapshot-tests",
    "lint:types:anti-slop": "oxlint --config tools/oxlint/.oxlintrc.json apps packages projects tools",
    "lint:ast:preferences": "ast-grep scan --config tools/ast-grep/sgconfig.preferences.yml apps packages projects tools"
  }
}
```

Put `lint:ast` and `lint:types:anti-slop` in the normal check command. Keep
`lint:ast:preferences` out of the blocking check when the repository treats
preferences as optional.

Bun can defer the `@ast-grep/cli` platform binary postinstall. Trust the package
once to avoid that fallback:

```bash
bun pm trust @ast-grep/cli
```

## Resync and pin installed items

Consumers own the installed copies. They may edit those copies. The registry
does not update them automatically. Run the same untagged address to fetch the
latest commit on the registry repository's default branch:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended
```

Preview changes before you replace a local copy:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended --dry-run
bunx --bun shadcn@latest add austinm911/anti-slop/recommended --diff tools/ast-grep/rules/no-return-local-alias-function.yml
```

Use `--overwrite` only when you want the registry version to replace the local
files:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended --overwrite
```

Pin an install to a release tag when you need a fixed version:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended#v0.1.0
```

An untagged address follows the default branch. A tag stays on that release.
Resync with `--overwrite` replaces local edits. Review the diff before the
replacement.

## Optional OMP TTSR guard

OMP users can install an early stream guard separately:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/omp-ttsr
```

The item writes `.omp/rules/no-record-string-unknown.md`. OMP watches edit and
write streams for the banned type. On a match, it aborts the pending tool call,
injects the boundary guidance, and retries from the same point.

TTSR is not the enforcement layer. A TTSR rule fires once per session by
default, and its regex can also see code comments. The Oxlint restriction
remains the syntax-aware source of truth for local checks and CI. See the
[OMP TTSR documentation](https://omp.sh/docs/ttsr).

## Discover rules in other repositories

The discovery pipeline clones pinned source revisions into an ignored cache,
finds executable ast-grep and Oxlint rules, records configured Oxlint policy,
links tests, and collects agent-guidance leads without executing foreign code.

```bash
bun run discovery:discover
```

The canonical source list is [`discovery/sources.json`](discovery/sources.json).
Use `--repo owner/name --ref branch` for a one-repository run. Discovery writes
structured candidates to `discovery/candidates.json` and generates
`docs/generated/candidate-catalog.md`.

Agent enrichment is optional. OMP and Pi receive bounded source-and-test packets
and must return structured admission assessments. They may classify candidates,
but they never promote or install a rule:

```bash
bun run discovery:triage -- --agent omp --model luna --thinking xhigh
bun run discovery:triage -- --agent pi --model openai-codex/gpt-5.6-luna --thinking xhigh
```

Use `--batch-size N` to control candidates per agent call. Every correctness
candidate still needs native Oxlint verification, behavioral counterexamples,
and repository scan evidence before admission.

## Review discovered candidates

The local review app keeps generated discovery facts separate from human
decisions. It reads `discovery/candidates.json`, appends decisions to
`review/events.jsonl`, projects current state to `review/state.json`, and
regenerates `docs/generated/review-summary.md`.

```bash
bun run review
```

Open `http://localhost:4317` if the browser does not open automatically. Start
in **Inbox**: keep promising candidates for deeper evaluation, reject weak
evidence, or defer blocked decisions. The **Kept** queue then offers adopt,
adapt, native-rule, and reject outcomes. Decisions do not modify or promote
rules; admission still requires every condition in
[`docs/admission-standard.md`](docs/admission-standard.md).

Keyboard shortcuts: `J`/`K` navigate, `E` keeps, `R` rejects, and `D` defers.

## Develop

```bash
bun install
bun run check
```
