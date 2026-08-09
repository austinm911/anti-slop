# Rule admission standard

Admit a rule only when all conditions are true.

1. The rule detects a structural and explainable defect. It does not enforce a
   personal style preference.
2. The expected false-positive rate is low enough that users can act on every
   diagnostic.
3. The diagnostic gives one concrete remediation.
4. Tests include invalid examples, valid examples, and legitimate
   counterexamples.
5. Existing violations start as warnings unless a safe migration removes them.
6. Exceptions are narrow and documented.
7. A fixer is available only when it preserves semantics.
8. The rule documentation explains why ast-grep or Oxlint owns the check.
9. The rule does not duplicate a native Oxlint rule.
10. A repository scan records the initial match count and representative
    matches before the rule enters `recommended`.

## Preferences

A preference rule encodes a convention. It does not detect a defect, so it
cannot meet condition 1 and it never enters a correctness preset.

Keep preference rules in `ast-grep/preferences` with tests in
`ast-grep/preference-tests`. Run them with `anti-slop scan --preferences`.

Admit a preference rule only when all conditions are true.

1. The convention has a stated cost that the rule removes. Record the cost.
2. Both forms of the convention stay valid. The rule reports the mixture, the
   drift, or the ambiguous case, not the form a maintainer chose.
3. Conditions 2, 3, 4, 6, 7, and 9 of the correctness standard still apply.
4. The severity is `hint`. A preference never blocks a build.
5. The documentation names the formatter setting or native tool rule that
   would own the check instead, if one exists.

Reject a preference rule that only restates a formatter's job.

## Ownership decision

Use ast-grep when a rule depends only on a local syntax shape or supplies a
codemod. Use Oxlint when a rule needs scope, control-flow, configuration, or a
fixer that must inspect surrounding program state.

## Rollout states

- `candidate`: documented and tested, but absent from presets.
- `warning`: active without blocking existing migrations.
- `error`: active and blocking because every match is actionable.
- `retired`: replaced by a native tool rule or shown to be too noisy.
