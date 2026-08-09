# Rule catalog

This catalog covers correctness rules. A convention rule lives in the
preferences tier, documented in
[`preference-catalog.md`](preference-catalog.md).

| Rule                                 | Owner    | Preset      | Severity | Rationale                                                                                                            |
| ------------------------------------ | -------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `no-return-local-alias-function`     | ast-grep | recommended | error    | The complete function body proves that the untyped `const` only forwards its initializer.                            |
| `no-throw-local-alias-function`      | ast-grep | recommended | error    | The complete function body proves that the untyped `const` only forwards its initializer to a throw.                 |
| `no-file-local-generic-record-guard` | ast-grep | recommended | warning  | The exact helper name identifies repeated generic boundary parsing. Existing downstream copies still need migration. |
| `no-commented-record-string-unknown` | ast-grep | recommended | warning  | The local supplement covers comment-formatted instances that native Oxlint does not normalize.                       |
| `no-record-string-unknown`           | Oxlint   | recommended | warning  | The exact utility type erases an object's domain contract and lets unparsed values cross the I/O boundary.           |

## `no-return-local-alias-function`

Return the initializer directly when an untyped `const` and its return are the
complete function body. The rule does not match a typed local, a mutable local,
a nested block, a local used by another statement, or an anonymous function or
class initializer whose inferred name is observable.

## `no-file-local-generic-record-guard`

Do not add another file-local function or function-valued variable named
`isRecord`. Decode external input with Effect Schema or Zod. Generic
infrastructure code must reuse one helper owned by its package.

The rule remains a warning until downstream migrations remove the known
backlog.

## `no-throw-local-alias-function`

Throw the initializer directly when an untyped `const` and its throw are the
complete function body. The rule does not match a typed local, a mutable local,
a nested block, a local used by another statement, or an anonymous function or
class initializer whose inferred name is observable.

The initial scan of this repository found zero matches. The rule is an error
because every admitted shape has a semantics-preserving direct replacement.

## `no-record-string-unknown`

Report every exact `Record<string, unknown>` type. Convert each match to a
strongly typed domain type. Parse external data as early as possible and as
close as possible to the I/O boundary where it originated.

The rule has no fixer. The replacement depends on the source data contract and
the boundary parser. Do not replace the type with an index signature, `object`,
or `any`; those types preserve the same erasure.

Oxlint's native `typescript/no-restricted-types` rule handles normal and
whitespace-formatted expressions. Oxlint 1.77 does not normalize comments inside
a restricted type. The ast-grep supplement matches the local `generic_type`
shape only when it has the same key and value types and contains a comment. The
native and supplemental match sets do not overlap.

The initial external scan found:

| Repository |  Files | Matches |
| ---------- | -----: | ------: |
| Effect     |  1,758 |     111 |
| Drizzle    |    787 |     446 |
| Alchemy    | 15,933 |   1,122 |

The ast-grep supplement found zero comment-formatted matches in the same
repositories. It preserves the exact type ban for formatting variants rather
than adding a separate behavioral policy.

Representative matches include telemetry attributes in Effect, SQL placeholder
values in Drizzle, and test command arguments in Alchemy. These matches show the
same open-object contract even when the code uses the map intentionally. The
rule has no exemptions.

The rule starts as a warning because the scan found an existing backlog and no
semantics-preserving fixer is possible. After migration, both matching engines
become blocking errors.

The optional OMP companion uses a regex limited to TypeScript edit and write
streams. A standalone TypeScript type reference is not a valid ast-grep root
pattern, so `astCondition` cannot cover every annotation context with one
pattern. The default TTSR interrupt aborts the pending tool call and retries
with the rule body. Oxlint and the ast-grep supplement remain authoritative.

## Native Oxlint coverage checked

The following candidates are not implemented because Oxlint 1.77 already owns
them:

- nullish empty-object fallbacks in object spreads:
  `unicorn/no-useless-fallback-in-spread`
- unnecessary optional chains after control-flow narrowing:
  type-aware `typescript/no-unnecessary-condition`
- pass-through `new Promise` construction: `promise/avoid-new`
- `Promise.resolve` in async returns:
  `unicorn/no-useless-promise-resolve-reject`
