# Rule catalog

| Rule                                 | Owner    | Preset      | Severity | Rationale                                                                                                            |
| ------------------------------------ | -------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `no-return-local-alias-function`     | ast-grep | recommended | error    | The complete function body proves that the untyped `const` only forwards its initializer.                            |
| `no-file-local-generic-record-guard` | ast-grep | recommended | warning  | The exact helper name identifies repeated generic boundary parsing. Existing downstream copies still need migration. |

## `no-return-local-alias-function`

Return the initializer directly when an untyped `const` and its return are the
complete function body. The rule does not match a typed local, a mutable local,
a nested block, or a local used by another statement.

## `no-file-local-generic-record-guard`

Do not add another file-local function or function-valued variable named
`isRecord`. Decode external input with Effect Schema or Zod. Generic
infrastructure code must reuse one helper owned by its package.

The rule remains a warning until downstream migrations remove the known
backlog.
