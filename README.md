# anti-slop

Correctness rules and conventions for code written by people and coding agents,
distributed as Oxlint profiles on npm and as a
[shadcn](https://ui.shadcn.com/docs/registry) source registry of single rules.

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

## Install a profile

A profile is one Oxlint config that combines native Oxlint rules, upstream
plugin rules, and this repository's rules. Profiles ship in the npm package:

```bash
bun add -D -E oxlint @austinm911/anti-slop
```

Extend a profile from `.oxlintrc.json`. Oxlint resolves `extends` from a file
path, not a package name, so the entry names the installed folder. Rules you
list after it override the profile:

```json
{
  "extends": ["./node_modules/@austinm911/anti-slop/oxlint/configs/recommended.json"],
  "rules": {
    "rayhanadev/require-jsdoc-comments": "off"
  }
}
```

| Profile       | Contains                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `recommended` | Oxlint correctness, nkzw's stricter native picks, this repository's rules, and portable TypeScript rules from dmmulroy and oxray |
| `effect`      | `recommended` plus dmmulroy's Effect rules                                                                                       |
| `react`       | `recommended` plus nkzw's React, accessibility, and React Compiler picks                                                         |
| `result`      | `recommended` plus oxray's better-result rules                                                                                   |
| `zod`         | `recommended` plus oxray's Zod 4 rules                                                                                           |
| `preferences` | Hint-level conventions to keep out of blocking checks                                                                            |

A profile keeps the options its upstream source sets. For example,
`no-warning-comments` reports only `@nocommit`, as nkzw configures it. The
package bundles dmmulroy's plugin and depends on `@rayhanadev/ox`, so upgrading
the package upgrades every rule.

The ast-grep rules run from the package as well:

```json
{
  "scripts": {
    "lint": "oxlint .",
    "lint:ast": "ast-grep scan --config node_modules/@austinm911/anti-slop/ast-grep/sgconfig.yml src"
  }
}
```

Install `@ast-grep/cli` for `lint:ast`. Bun can defer its platform binary, so
trust it once with `bun pm trust @ast-grep/cli`.

## Copy single rules

To own a rule's files instead, the shadcn CLI copies a registry item into your
repository and installs its declared dev dependencies. It needs a
`components.json` and a `tsconfig.json`, which configure the CLI only.

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/no-return-local-alias-function
```

| Item          | Installs                                                    |
| ------------- | ----------------------------------------------------------- |
| `<rule name>` | One rule from the table above                               |
| `ast-grep`    | The three ast-grep correctness rules                        |
| `oxlint`      | The `no-record-string-unknown` Oxlint configuration         |
| `tsrx-oxc`    | Oxlint and Oxfmt for `.tsrx` files (see [TSRX](#tsrx))      |
| `omp-ttsr`    | An optional OMP stream guard (see [OMP](#omp-stream-guard)) |

Items land under `tools/ast-grep` and `tools/oxlint`. The registry never changes
your copies. Re-run the address to fetch the latest default branch, adding
`--dry-run` or `--diff <file>` to preview and `--overwrite` to replace local
edits. Append a release tag, such as `#v0.1.0`, to stay on that release.

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
