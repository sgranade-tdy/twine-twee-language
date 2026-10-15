# 09 — Scope-annotate default-value expressions

Type: task
Status: closed
Blocked by: 03

`annotateVariableScopes` never visits default-value expressions, so the reads
inside them are never scope-annotated. `extractSymbols` only reports identifiers
whose `_scopeType` is `"global"`, and an unannotated identifier's is
`undefined`, so those reads are silently dropped. Per ADR-0003 an unbound name
there is a story variable, and a dropped occurrence breaks rename.

Found while reviewing ticket 02; not one of the spec's ten defects.

| Input | Today | Expected |
| --- | --- | --- |
| `function f(a = b){}` | nothing | `b` |
| `const {a = b} = c` | `a=`, `c` | `a=`, `b`, `c` |
| `const [a = b] = c` | `a=`, `c` | `a=`, `b`, `c` |
| `f = (a = b) => a` | `f` | `f`, `b` |
| `const {[k]: v} = o` | `v=`, `o` | `k`, `v=`, `o` |

Highlighting is unaffected; it doesn't consult scope.

## Cause

- The `FunctionDeclaration`/`FunctionExpression`/`ArrowFunctionExpression`
  cases bind each param via `collectPatternIdentifiers` and then visit only
  `node.body`. The params themselves, including any `AssignmentPattern.right`,
  are never visited.
- The `VariableDeclaration` case binds `decl.id` via `collectPatternIdentifiers`
  and then visits only `decl.init`. Defaults nested in the `id` pattern are
  never visited.

## Work

1. After binding, visit each default-value expression (`AssignmentPattern.right`,
   at any depth in the pattern) in the right scope. For params, that's the
   function scope, so earlier params are visible (`function f(a, b = a)` must
   not report `a`). For declarations, it's the declaration's scope.
2. Visit computed keys in destructuring patterns (`const {[k]: v} = o`) the same
   way; `k` is a read and currently has the same gap.
3. While in here, make the `VariableDeclaration` case pass the
   `VariableDeclarator` in the ancestor chain. It currently goes straight from
   the declaration to `decl.init` (`[...ancestors, decl.init]`), so
   `classifyIdentifier` sees the `VariableDeclaration` as the init's parent.
   That's harmless today but will mislead any parent-type check that issue 11
   adds.

## Related, not in scope

Named function expressions never bind their own name. For example,
`const f = function named(){ let x = named; }` reports `named` as a story
variable. Ticket 03 noted this; it's a binder gap like 03's, not a visiting gap.
Open a separate ticket if it's taken up.

## Done when

- Corpus rows for the five inputs above show the expected reads.
- `function f(a, b = a){}` reports no variables.
- `npm test` green.

## Comments

### Note from ticket 03 review

Catch params had the same gap, a regression from ticket 03. That's been fixed
under 03 (16f6f6b), so it isn't this ticket's job. The fix added a helper,
`visitPatternExpressions(pattern, scope, ancestors)`, inside
`annotateVariableScopes`. It visits a binding pattern's default values and
computed keys without re-visiting the names the pattern binds. Reuse it for
function params (in the function scope) and for `VariableDeclarator.id` (in the
declaration's scope) rather than writing a second walker.

Ticket 13 has landed (1d409c3), and it changes where this work goes:

- **Function params.** `visitFunction` now owns all three function node types.
  Params bind in `paramScope`; the body's declarations bind in a child
  `bodyScope`. Visit param defaults in `paramScope`. Then
  `function f(a, b = a)` resolves `a`, and `function f(a = b){ var b }` reports
  `b`, because body `var`s aren't visible to defaults. That row is tagged
  `// ticket 09` in the corpus; flip it to `["b"]`.
- **Order doesn't matter.** References resolve after the walk, so a default
  sees every param regardless of order. `function f(a = b, b)` treats `b` as
  bound. That code throws at runtime anyway, so leave it.

### Superseded by ticket 15 (2026-10-13)

The hand-rolled scope analyser is being replaced with eslint-scope (ADR-0004),
which visits default values and computed keys and binds named function
expressions to their own names. This ticket's rows and the
`function f(a, b = a){}` check moved to ticket 15's "Done when" list.
