# Rule catalog

| Rule                                 | Owner    | Preset      | Severity | Rationale                                                                                                            |
| ------------------------------------ | -------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `no-return-local-alias-function`     | ast-grep | recommended | error    | The complete function body proves that the untyped `const` only forwards its initializer.                            |
| `no-throw-local-alias-function`      | ast-grep | recommended | error    | The complete function body proves that the untyped `const` only forwards its initializer to a throw.                 |
| `no-file-local-generic-record-guard` | ast-grep | recommended | warning  | The exact helper name identifies repeated generic boundary parsing. Existing downstream copies still need migration. |

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
