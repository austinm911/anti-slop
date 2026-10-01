# Lint and format TSRX

[`@tsrx/oxc`](https://oxc.tsrx.dev) provides `oxlint` and `oxfmt` commands that
read `.tsrx` alongside `.js`, `.ts`, `.jsx`, and `.tsx`. Native Oxlint rules and
Oxlint JavaScript plugins both run on `.tsrx`, so this registry's Oxlint
configuration works unchanged. `bun run tsrx:test` checks the behavior on this
page against `@tsrx/oxc` 0.20.0.

## Install

```bash
bunx --bun shadcn@latest add austinm911/anti-slop/tsrx-oxc
bun remove oxlint oxfmt
```

The item adds `@tsrx/oxc@0.20.0` and `tools/oxlint/check-tsrx-oxc.mjs`.

Remove the direct `oxlint` and `oxfmt` dependencies, including the `oxlint` that
the `oxlint`, `recommended`, and `no-record-string-unknown` items declare. A
project that depends on either one keeps that command, and it skips every
`.tsrx` file:

```text
oxlint (oxc-tsrx): this project depends on official oxlint 1.86.0, so the oxlint
command runs it unchanged and will not read b.tsrx.
```

`@tsrx/oxc` bundles Oxlint 1.83.0. When the project has a newer Oxlint
installed, even transitively, it uses that one instead, so a config written for
the newer release still parses.

## Scripts

Run the check before lint and format, and give each command source paths:

```json
{
  "scripts": {
    "lint:oxlint": "node tools/oxlint/check-tsrx-oxc.mjs && oxlint --config tools/oxlint/.oxlintrc.json src",
    "format": "node tools/oxlint/check-tsrx-oxc.mjs && oxfmt src",
    "format:check": "node tools/oxlint/check-tsrx-oxc.mjs && oxfmt --check src"
  }
}
```

The check fails when the project declares `oxlint` or `oxfmt`, when `@tsrx/oxc`
is missing or pinned to a range, when the installed version differs from the
pin, or when `@oxlint/plugins` differs from the bundled Oxlint. It resolves
`catalog:` entries declared in `package.json` and skips the pin comparison for
a catalog it cannot read, such as one in `pnpm-workspace.yaml`.

Use the default or `--format=json` reporter. `--format=unix` errors on a run
that includes `.tsrx`.

## Plugin rules

Write the plugin as a plain ES module exporting `{ meta, rules }`. With no
runtime imports, it runs on whichever Oxlint `@tsrx/oxc` selects. A plugin that
imports `@oxlint/plugins` needs that package pinned to the bundled Oxlint, which
the check enforces.

```js
const keyedMap = {
  meta: {
    type: "problem",
    messages: { missing: "JSX returned from .map() needs a `key` prop." },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // inspect node, then:
        context.report({ node, messageId: "missing" });
      },
    };
  },
};

export default { meta: { name: "house" }, rules: { "keyed-map": keyedMap } };
```

```json
{
  "jsPlugins": ["./plugins/house.js"],
  "rules": { "house/keyed-map": "error" }
}
```

On `.tsrx`, the plugin runs on a TSX copy of the file, and each diagnostic maps
back to the line and column the author wrote.

- **Rules see compiled control flow.** `@if` reaches a rule as an
  `IfStatement`, reported at the `@if`. The TSRX node types, such as
  `JSXIfExpression`, never reach a plugin, so no Oxlint rule can inspect an
  authored control block yet.
- **Each `.tsrx` file is parsed twice**, and `oxlint` says so on stderr.
  `"settings": { "oxcTsrx": { "jsPluginsOnTsrx": false } }` skips the second
  parse. Plugins keep running on other files, and `oxlint` reports `.tsrx`
  files as an error.

`RuleTester` from `@tsrx/oxc/lint/plugins-dev` needs Node.js 22 or newer and
refuses to run under Bun. Under Bun, test a rule by running `oxlint` over
fixture files, as `test/tsrx/tsrx.test.ts` does.

## ast-grep

ast-grep cannot parse `.tsrx`, so ast-grep rules, including this registry's,
skip those files. Write a check that must cover `.tsrx` as an Oxlint plugin.

## Editors and Vite+

The VS Code extension `oxc.oxc-vscode` lints and formats `.tsrx` through
`@tsrx/oxc`. Its README says the extension starts only after you open a
JavaScript, TypeScript, or JSON file once per session.

In a Vite+ project, `node_modules/.bin/oxlint` belongs to Vite+. Run `vp lint`,
which reads lint configuration from `vite.config.ts`, or call
`node_modules/@tsrx/oxc/bin/oxlint` directly.

## Octane

Octane components are `.tsrx`. Its compiler and `octane analyze` already report
render-purity, dependency, and template mistakes. Two React rules contradict
it: `react-hooks/rules-of-hooks`, because Octane keys hooks by call site, and
`react-hooks/exhaustive-deps`, because an omitted dependency array asks the
compiler to infer one.

Octane 0.2.16 and later read inferred member dependencies null-safely, so
`focus !== null && focus.origin` in a hook without a dependency array does not
throw.
