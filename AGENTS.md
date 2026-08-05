# Agent guidance

## Rule admission standard

Admit a rule only when all conditions are true:

1. The rule detects a structural and explainable defect, not a style preference.
2. The expected false-positive rate is low.
3. The diagnostic gives one concrete remediation.
4. Tests include invalid examples, valid examples, and legitimate counterexamples.
5. Existing violations start as warnings unless a safe migration removes them.
6. Exceptions are narrow and documented.
7. A fixer is available only when it preserves semantics.
8. The rule documentation explains why ast-grep or Oxlint owns the check.

Use ast-grep for local syntax shapes and codemods. Use Oxlint for checks that need
scope, control-flow, configuration, or fixer logic. Do not duplicate a native
Oxlint rule.

Use Bun for package, test, build, and release commands.

