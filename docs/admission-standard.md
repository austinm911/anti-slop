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

## Ownership decision

Use ast-grep when a rule depends only on a local syntax shape or supplies a
codemod. Use Oxlint when a rule needs scope, control-flow, configuration, or a
fixer that must inspect surrounding program state.

## Rollout states

- `candidate`: documented and tested, but absent from presets.
- `warning`: active without blocking existing migrations.
- `error`: active and blocking because every match is actionable.
- `retired`: replaced by a native tool rule or shown to be too noisy.
