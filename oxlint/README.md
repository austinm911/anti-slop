# Oxlint rules

`no-record-string-unknown` configures Oxlint's native
`typescript/no-restricted-types` rule, which reports `Record<string, unknown>`
including whitespace-formatted forms. Oxlint 1.86 does not normalize a comment
inside the type, so `ast-grep/rules/no-commented-record-string-unknown.yml`
covers that shape without duplicating the native diagnostic.

The rule has no fixer: a safe replacement needs the domain type and its parser
at the I/O boundary.

`check-tsrx-oxc.mjs` ships with the `tsrx-oxc` item. See
[docs/tsrx.md](../docs/tsrx.md).
