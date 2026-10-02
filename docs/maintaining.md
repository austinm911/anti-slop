# Maintaining the registry

New rules come from other repositories. Discovery finds candidate rules
upstream, the review app is where you decide on them, and profiles collect the
rules a published preset will ship.

## Discover

[`discovery/sources.json`](../discovery/sources.json) lists the source
repositories. Discovery clones each one into the ignored `discovery/cache`,
pins the analyzed commit, and records executable ast-grep and Oxlint rules,
configured Oxlint policy, linked tests, and agent-guidance leads. It never runs
upstream code.

```bash
bun run discovery:refresh   # report which sources moved: updated, new, or unchanged
bun run discovery:discover  # re-analyze and write discovery/candidates.json
bun run discovery:triage -- --agent omp --model luna --thinking xhigh
```

`discovery:discover` also writes `docs/generated/candidate-catalog.md`. Pass
`--repo owner/name --ref branch` to analyze one source. When a source moved,
the catalog records both the previous and the new commit. Review that diff
before triage.

Triage is optional. It sends OMP or Pi (`--agent pi --model
openai-codex/gpt-5.6-luna`) bounded source-and-test packets in batches of
`--batch-size N` and records a structured admission assessment for each. Agents
classify candidates. Admission still needs native Oxlint verification,
counterexamples, and repository scan evidence.

## Review

```bash
bun run review:classify  # needs TYPESAFE_API_KEY
bun run review
```

`review:classify` asks Jev for each rule's domain, category, ecosystem, and
whether it depends on its source repository. It caches answers in
`review/classification.json`, so a rerun pays only for new or changed rules.
Answers below 0.5 confidence stay **Unsorted**.

`bun run review` serves the app at `https://anti-slop.localhost` through
[portless](https://github.com/vercel-labs/portless). Without portless,
`bun scripts/review/server.ts` listens on `PORT` or `http://localhost:4317`.

The app groups candidates into rules. Sightings merge across sources and plugin
scopes, so `typescript/no-unused-vars` and `no-unused-vars` are one rule. This
repository's own rules appear as **Shipped**. Decisions append to
`review/events.jsonl`, keyed by rule, and the app flags a decision when the
rule changes upstream afterwards. A decision does not admit a rule.

Keys: `J`/`K` move, `/` search, `N` note, `E` keep, `R` reject, `D` defer, `U`
reopen, `1`–`9` toggle the rule in each profile.

## Examples

The inspector shows code each rule reports and accepts. Native rules take
examples from their Oxlint docs page, cached under `discovery/cache/oxlint-docs`.
Other rules take them from upstream RuleTester suites, ast-grep tests, and
fixture tests.

Upstream rarely pairs broken code with its fix, so every profile rule also has
a hand-written `review/examples/<rule>.yml`: a break, its fix, and a pass.
`bun run review:test` lints the native rules' examples with Oxlint. A native
rule that cannot fire on a single file with default options sets
`verify: false` and a `reason`. Custom rules' examples run once the rule is
vendored.

An Oxlint upgrade can turn an upstream rule native, which puts its examples
under test for the first time. Fix the examples that fail.

## Profiles

`profiles/*.json` define the presets to publish. A profile can `extend` another
and enable whole Oxlint `categories`. `recommended`, for example, turns on every
correctness rule without listing them. A rule's value is a severity, which takes
the options upstream configures when every source agrees, or an Oxlint
`["warn", { ... }]` tuple that sets them.

`bun run build` writes each profile to `oxlint/configs/<profile>.json` and each
plugin to `dist/plugins/`, then lints a sample file with every config so a rule
that fails to load stops the build. `bun run check` fails when a committed
config is stale. The Profiles tab previews the same output, the rule count from
each source, and the gaps that keep a rule out of the config.

Native rules ship as configuration. Plugin rules ship through the sources in
`scripts/review/plugins.ts`: `@rayhanadev/ox` as a dependency, and
dmmulroy/anti-slop vendored under `vendor/dmmulroy-anti-slop` at the commit in
its `UPSTREAM.json`. Another upstream plugin must be added there, or vendored,
before its rules can ship. A source without a license, such as
typeonce-dev/ai-automation, cannot be redistributed, so its rules stay gaps.
