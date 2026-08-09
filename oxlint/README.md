# Oxlint rules

`anti-slop/no-record-string-unknown` configures Oxlint's native
`typescript/no-restricted-types` rule to report normal and whitespace-formatted
instances. Oxlint 1.77 does not normalize comments inside a restricted type.
`ast-grep/rules/no-commented-record-string-unknown.yml` covers that local syntax
shape without duplicating a native diagnostic.

The rule has no fixer. A safe replacement requires the domain contract and the
parser at the value's I/O boundary.
