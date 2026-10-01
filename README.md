# anti-slop

Correctness rules and conventions for code written by people and coding agents,
distributed as a [shadcn](https://ui.shadcn.com/docs/registry) source registry.

Each check uses the cheapest tool that can own it: a native Oxlint rule when one
exists, ast-grep for a local syntax shape, and a custom Oxlint rule when the
check needs scope, control flow, or configuration. Every rule meets the
[admission standard](docs/admission-standard.md) before it enters a preset.

Rules come in two tiers:

- A **correctness** rule reports a defect and can block a check.
- A **preference** encodes a convention at `hint` severity and stays out of
  correctness presets.

## Rules

| Rule                                 | Tier        | Reports                                                                                  |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------- |
| `no-return-local-alias-function`     | correctness | A local that only forwards its initializer to the next `return`                          |
| `no-throw-local-alias-function`      | correctness | A local that only forwards its initializer to the next `throw`                           |
| `no-file-local-generic-record-guard` | correctness | Another file-local `isRecord` helper, instead of a boundary decoder or shared utility    |
| `no-record-string-unknown`           | correctness | `Record<string, unknown>`, which should be parsed into a domain type at its I/O boundary |
| `no-mixed-jsdoc-line-prefix`         | preference  | A JSDoc block that prefixes some lines with `*` and not others                           |

`no-record-string-unknown` is an Oxlint configuration plus an ast-grep rule for
the comment-formatted cases Oxlint misses. The [rule catalog](docs/rule-catalog.md)
and [preference catalog](docs/preference-catalog.md) give each rule's rationale.

## Install

The shadcn CLI copies an item into your repository and installs its declared
dev dependencies. It needs a `components.json` and a `tsconfig.json`, which
configure the CLI only. This registry adds no UI components.

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended
```

| Item          | Installs                                                    |
| ------------- | ----------------------------------------------------------- |
| `recommended` | Every correctness rule (`ast-grep` plus `oxlint`)           |
| `preferences` | Every preference rule                                       |
| `ast-grep`    | The three ast-grep correctness rules                        |
| `oxlint`      | The `no-record-string-unknown` Oxlint configuration         |
| `<rule name>` | One rule from the table above                               |
| `tsrx-oxc`    | Oxlint and Oxfmt for `.tsrx` files (see [TSRX](#tsrx))      |
| `omp-ttsr`    | An optional OMP stream guard (see [OMP](#omp-stream-guard)) |

Items land under `tools/ast-grep` and `tools/oxlint`. Add scripts that scan your
own source roots:

```json
{
  "scripts": {
    "lint:ast": "ast-grep scan --config tools/ast-grep/sgconfig.yml src",
    "lint:ast:test": "ast-grep test --config tools/ast-grep/sgconfig.yml --skip-snapshot-tests",
    "lint:oxlint": "oxlint --config tools/oxlint/.oxlintrc.json src",
    "lint:ast:preferences": "ast-grep scan --config tools/ast-grep/sgconfig.preferences.yml src"
  }
}
```

Run `lint:ast` and `lint:oxlint` in your blocking check. Run
`lint:ast:preferences` separately if preferences are advisory in your
repository.

Bun can defer the `@ast-grep/cli` platform binary. Trust it once:

```bash
bun pm trust @ast-grep/cli
```

## Update installed items

You own the installed copies, and the registry never changes them for you.
Re-run the same address to fetch the latest default branch, previewing first:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/recommended --dry-run
bunx --bun shadcn@latest add austinm911/anti-slop/recommended --diff tools/ast-grep/rules/no-return-local-alias-function.yml
bunx --bun shadcn@latest add austinm911/anti-slop/recommended --overwrite
```

`--overwrite` replaces your local edits. Append a release tag, such as
`recommended#v0.1.0`, to stay on that release.

## TSRX

For `.tsrx` files, such as in Octane apps, install `tsrx-oxc` and remove the
direct Oxlint and Oxfmt dependencies, which would otherwise skip `.tsrx`:

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/tsrx-oxc
bun remove oxlint oxfmt
```

Oxlint rules then run on `.tsrx`. ast-grep rules do not. [docs/tsrx.md](docs/tsrx.md)
covers the version check, scripts, and writing plugin rules for `.tsrx`.

## OMP stream guard

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/omp-ttsr
```

The item writes `.omp/rules/no-record-string-unknown.md`. When an
[OMP](https://omp.sh/docs/ttsr) agent starts writing `Record<string, unknown>`,
OMP aborts the tool call, injects the boundary guidance, and retries. The guard
fires once per session and can match comments, so the Oxlint rule stays the
enforcement in local checks and CI.

## Develop

```bash
bun install
bun run check
```

[docs/maintaining.md](docs/maintaining.md) covers discovering rules in other
repositories and the local review app.
