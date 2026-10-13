# Scope resolution comes from eslint-scope, not a hand-rolled analyser

Status: accepted

ADR-0003 makes binder coverage a correctness concern: an identifier is a story
variable exactly when nothing in its snippet binds it, so a missing binder
silently promotes a local to story state. We originally met that with our own
scope analyser in `js-parser.ts` (`Scope`, `bindIdentifier`,
`annotateVariableScopes`, hoisting), about 440 lines that had to track every
binding form JavaScript adds.

We replaced it with `eslint-scope`, which runs directly on the ESTree AST that
Acorn and `acorn-loose` already produce. A spike on 2026-10-13 found that it
matched the behaviour corpus except where it was more correct (default-value
expressions, named-function-expression self-binding). It never threw on
half-typed `acorn-loose` input. Its `Reference.isWrite()` also covers
destructuring, `++`/`--` and `for` heads. Alternatives were weaker:
`@typescript-eslint/scope-manager` expects TS-ESTree fields, and `periscopic`
has no per-reference read/write data and leaked bindings in the spike.

What stays ours is everything Twine-specific: the story-variable rule, the
assignment-context flag, member chains and properties, built-in name lists, and
the story-format seam. Highlighting doesn't use scope analysis.

## Consequences

- **Story-variable rule.** `globalScope.through` alone isn't the set. A story
  variable is a reference that is unresolved *or* resolves to a global-scope or
  module-scope variable, because root-level declarations are story state.
- **`ecmaVersion` must be numeric.** eslint-scope compares it numerically, so
  `"latest"` silently gives ES5 scoping. Acorn keeps `EcmaVersion = "latest"`
  and eslint-scope gets a separate numeric `ScopeEcmaVersion`.
- **Parse with `ranges: true`.** Without ranges, eslint-scope throws on
  default parameters.
- **The root must be a `Program`.** Wrap expression parses in
  `Program` → `ExpressionStatement`.
- **`sourceType: "module"`** when the snippet contains `import`/`export`.
  Script mode asserts on them.
- **`optimistic: true`.** Otherwise a direct `eval()` makes its function
  dynamic, and its locals become story variables that rename would rewrite.
- **Class self-references.** A reference to a class's name inside its own
  body resolves to the inner class-scope binding. Redirect it to the outer
  variable, or rename misses it.
- Adds `eslint-scope`, `esrecurse` and `estraverse` to the server bundle,
  about 33 KB minified.
