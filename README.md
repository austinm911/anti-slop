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

The discovery pipeline clones source revisions into an ignored cache, pins each
resolved commit in the catalog, finds executable ast-grep and Oxlint rules,
records configured Oxlint policy, follows local config re-exports, links tests,
and collects agent-guidance leads without executing foreign code.

Check whether tracked branches moved without changing the pinned catalog or its
evidence checkouts:

```bash
bun run discovery:refresh
```

The refresh output compares each upstream commit with the catalog snapshot.
`updated` means the branch moved, `new` means the source is not in the current
catalog, and `unchanged` means the pinned commit is still current.

```bash
bun run discovery:discover
```

The canonical source list is [`discovery/sources.json`](discovery/sources.json).
Use `--repo owner/name --ref branch` for a one-repository run. Discovery writes
structured candidates to `discovery/candidates.json` and generates
`docs/generated/candidate-catalog.md`. When a source moved, discovery records
both the previous and newly pinned commit in the source table. Candidate links
always use the commit whose files were analyzed.

Agent enrichment is optional. OMP and Pi receive bounded source-and-test packets,
including configured Oxlint policy, and must return structured admission
assessments. A policy assessment recommends whether to adopt an existing native
or third-party rule. It does not treat configuration as a custom implementation.
Agents may classify candidates, but they never promote or install a rule:

```bash
bun run discovery:triage -- --agent omp --model luna --thinking xhigh
bun run discovery:triage -- --agent pi --model openai-codex/gpt-5.6-luna --thinking xhigh
```

Use `--batch-size N` to control candidates per agent call. Every correctness
candidate still needs native Oxlint verification, behavioral counterexamples,
and repository scan evidence before admission.

The normal revisit loop is `discovery:refresh`, `discovery:discover`, then
`discovery:triage`. Review the generated commit transition and candidate diff
before triage, especially when an existing source reports new additions.

## Review discovered candidates

The local review app groups discovery candidates into rules. Sightings of one
rule merge across sources and plugin scopes, so `typescript/no-unused-vars` in
one config and `no-unused-vars` in another are one rule. This repository's
registry rules appear as **Shipped**. Decisions are keyed by rule, append to
`review/events.jsonl`, and survive upstream file moves. A decision is flagged
when the rule changes upstream after it was recorded.

Classify rules with Jev before reviewing. It needs `TYPESAFE_API_KEY` and caches
answers in `review/classification.json`, so a rerun only pays for new or changed
rules:

```bash
bun run review:classify
bun run review
```

Jev answers the domain, category, ecosystem, and whether a rule is tied to its
source repository. Answers below 0.5 confidence stay **Unsorted**.

`bun run review` serves the app through [portless](https://github.com/vercel-labs/portless)
at `https://anti-slop.localhost` and opens it. Portless starts its proxy on
first use. Without portless, run `bun scripts/review/server.ts`, which listens
on `http://localhost:4317` or `PORT`.

- **Rules** filters by status and groups by domain, source, ecosystem, or
  delivery. Keep promising rules, reject weak ones, or defer blocked decisions.
- **Examples** in the inspector show code each rule reports and accepts, with
  the autofix output when a test records one. They come from the Oxlint docs
  page for native rules, cached under `discovery/cache/oxlint-docs`, and from
  upstream RuleTester suites, ast-grep tests, and fixture tests. Upstream
  rarely pairs a broken case with its fix, so every profile rule also has a
  hand-written `review/examples/<rule>.yml` with a break, its fix, and a pass.
  `bun run review:test` lints the native rules' examples with Oxlint. Custom
  rules' examples run once the rule is vendored.
- **Profiles** builds the publishable rule sets in `profiles/*.json`. A profile
  can extend another and enable whole Oxlint `categories`, so `recommended`
  turns on every correctness rule without listing them. The preview shows the generated `.oxlintrc.json`, the
  ast-grep rules, the install commands, and every gap that blocks publishing. A
  profile named after an ecosystem, such as `effect`, lists matching rules.

Native Oxlint rules ship as configuration. Every other rule a profile includes
must be vendored into this repository with its tests before the profile
publishes. Decisions do not promote rules; admission still requires every
condition in [`docs/admission-standard.md`](docs/admission-standard.md).

Keyboard shortcuts: `J`/`K` move, `/` searches, `N` focuses the note, `E`
keeps, `R` rejects, `D` defers, `U` reopens, and `1`–`9` toggle the selected
rule in each profile.

## Develop

```bash
bun install
bun run check
```
