# Preference catalog

A preference rule encodes a convention. It does not detect a defect. No
preference rule enters the `recommended` or `all` presets, and every preference
rule uses `hint` severity.

Run them with `ast-grep scan --config ast-grep/sgconfig.preferences.yml`.

| Rule                         | Owner    | Preset      | Severity | Convention                                                         |
| ---------------------------- | -------- | ----------- | -------- | ------------------------------------------------------------------ |
| `no-mixed-jsdoc-line-prefix` | ast-grep | preferences | hint     | One JSDoc block uses one line prefix. Both prefix forms are valid. |

## `no-mixed-jsdoc-line-prefix`

Give every content line in a JSDoc block the same prefix. Prefix all of them
with `*`, or none of them. Both forms are valid, and this rule does not choose
between them.

```ts
/**
 * Time to live in seconds.
 * Default is 'never'.
 */

/**
  Time to live in seconds.
  Default is 'never'.
 */
```

### Cost of the mixture

The JSDoc parser removes at most one leading `*` from each line. A mixed block
therefore loses content.

A `* item` line in an unprefixed block reads as a prefix, not as a list item,
so the parser discards the bullet:

```ts
/**
  Modes:
  * fast
  * slow
 */
```

TypeScript reports the description as `"Modes:\n fast\n slow"`. The list is
gone. The same block written with `-` keeps both items, and a prefixed block
written with `* * fast` also keeps both items.

A line that lost its `*` inside a prefixed block keeps its raw indentation and
breaks the rendered code block. `drizzle-orm/src/table.ts:124` shows this
shape: an `@example` fence lost the prefix, so the fenced lines carry a tab
indent that the rest of the block does not.

Write markdown lists with `-`. A `-` item survives both forms.

### Ownership

ast-grep owns this rule because the defect is a local text shape inside one
comment node.

Oxlint 1.86 does not own it. The `jsdoc` plugin reports nothing on a mixed
block under `--jsdoc-plugin -D all`. `eslint-plugin-jsdoc` owns the adjacent
`require-asterisk-prefix` rule, but that rule picks one form and this rule does
not.

oxfmt does not reindent or reprefix comment interiors. Prettier reindents a
comment line only when the line starts with `*`, so it repairs neither form.

### Exceptions

The rule does not match a single-line block, a block comment that is not
JSDoc, a line comment, a blank separator line, or a mid-line `*` used for
emphasis or multiplication.

No fixer is supplied. A fixer must choose one of the two forms, and that choice
belongs to the repository.

### Initial scan

A scan of six TypeScript repositories covered 39,568 files and found 119
matches.

| Repository          | Files  | Matches |
| ------------------- | ------ | ------- |
| `effect`            | 1,749  | 0       |
| `drizzle-orm`       | 1,739  | 1       |
| `alchemy`           | 24,475 | 114     |
| `sapphire/packages` | 1,096  | 1       |
| `octane`            | 8,882  | 2       |
| `mono`              | 1,627  | 1       |

110 of the 114 `alchemy` matches are in one generated OpenAPI client. Outside
that tree the density is 9 matches in 15,093 files. Every inspected match is a
true positive. Two representative matches:

- `drizzle-orm/src/table.ts:124`: an `@example` fence inside a prefixed block
  lost its `*` prefix.
- `octane/packages/hook-form/src/types/form.ts:385`: the same shape in a
  vendored copy of `react-hook-form`.

The low hand-authored density is why this rule is a preference and not a
correctness rule. A match reports a rendering defect in one comment, not a
defect in the program.
