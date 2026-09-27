# 03 — Complete the scope binders

Type: task
Status: closed
Blocked by: 02

Per ADR-0003, an identifier is a story variable exactly when nothing in the
snippet binds it. That makes binder coverage a correctness concern: a missing
binder silently promotes a local to story state, where it pollutes the index and
draws `VariableNeverSet` warnings on code that is fine.

Three binders are missing. `createScope` is only called for `BlockStatement` and
function bodies.

## Update from ticket 02

Ticket 02's restructure fixed an ancestors off-by-one in
`annotateVariableScopes`'s hand-rolled walk: it built the ancestors chain
ending in the current node's *parent*, but `isReferenceIdentifier` was written
assuming the acorn-walk convention (chain ending in the node *itself*), so it
was reading each identifier's *grandparent* as `parent`. Fixing the convention
means `isReferenceIdentifier`'s existing `CatchClause` case now actually fires:
the catch param itself no longer gets double-counted as a reference (corpus
row for `try{a()}catch(e){e.message}` dropped from `["e", "e"]` to `["e"]`).

That's only half of defect 3, though: `e.message`'s `e` still resolves to the
global scope because nothing binds `e` anywhere — `CatchClause` still has no
`createScope` case. Work item 2 below is unchanged and still required.

The same off-by-one, now fixed, means `isReferenceIdentifier`'s existing
`LabeledStatement`/`BreakStatement`/`ContinueStatement`/`ImportSpecifier` cases
also now evaluate against the true parent instead of the grandparent — worth a
quick corpus check here in case any of those were silently relying on the old
(wrong) behavior, though none appear to have been exercised by existing tests.

## Work

1. **Loop heads** (defect 2). `for (let i = 0; …)`, `for (const x of xs)` and
   `for (var j in obj)` bind in a scope belonging to the statement, not the
   enclosing one. `let`/`const` bind per-iteration in the loop's own scope;
   `var` hoists to the nearest function scope — which `bindIdentifier` already
   handles via `nearestFunctionScope`, so the fix is opening the scope, not
   changing the binding rules.
2. **Catch params** (defect 3). `CatchClause.param` binds in the catch block's
   scope. Note it's a pattern, not just an identifier — `catch ({message})` is
   legal — so route it through `collectPatternIdentifiers`.
3. **Class declarations** (defect 4). `ClassDeclaration.id` binds like a
   function declaration. `ClassExpression` ids bind only inside the class body.

Also check, while in here, that the class *body* doesn't leak: `MethodDefinition`
and `PropertyDefinition` keys are property keys, not references, and the shared
classifier from issue 02 should already say so — add corpus rows either way.

## Not in scope

Whether a root-level `class A {}` counts as an *assignment*. That's issue 06.
This issue only stops `A` from being misreported as a read.

`class A { foo = 1 }` still fails to parse until issue 04 lands; leave that row
recording the parse error.

## Done when

- Corpus rows for defects 2, 3 and 4 show loop variables, catch params and
  class-bound names absent from `variables`.
- A `catch ({message}) { message }` row confirms destructured catch params bind.
- `npm test` green.

## Comments

Implemented in `server/src/js-parser.ts`:

- `annotateVariableScopes` gained `ForStatement`/`ForOfStatement`/`ForInStatement`
  cases that open a per-loop block scope before visiting the head and body, so
  `let`/`const` loop variables bind per-iteration (`var` still hoists via
  `nearestFunctionScope`, unaffected).
- A `CatchClause` case opens a block scope and binds the param via
  `collectPatternIdentifiers` (covers destructured params like
  `catch ({message})`).
- `ClassDeclaration`/`ClassExpression` cases bind `id`: a declaration's name
  binds in the enclosing scope (like a function declaration); an expression's
  name binds only in a scope wrapping its own body.
- `classifyIdentifier` gained `MethodDefinition`/`PropertyDefinition` cases
  (non-computed keys are `"neither"`, matching the existing `Property` case)
  and `ClassDeclaration`/`ClassExpression` cases (`id` is a `"declaration"`).

Corpus rows updated for defects 2, 3 and 4 in
`server/src/test/js-parser.test.ts`; new rows added for `for...of`,
destructured catch params, class method/computed keys, and class-expression
name scoping. `npm test` is green (1212 passing).

## Findings for future sessions

- **`for (var j in obj){j}` never actually leaked.** `bindIdentifier` sends
  `var` through `nearestFunctionScope`, which already climbs past a `block`
  scope to the enclosing function/global scope regardless of whether the loop
  head opens its own scope. So that corpus row's *values* are unchanged by this
  ticket (only `let`/`const` loop heads changed observable output) — opening
  the loop scope was still correct/required, it just wasn't this particular
  row's bug. Don't be surprised the diff there is comment-only.

- **Named function expressions have the same unbound-name gap `class A {}` had
  (defect 4), but for `FunctionExpression`/`ArrowFunctionExpression`.**
  `annotateVariableScopes`'s `FunctionExpression`/`ArrowFunctionExpression`
  case creates `fnScope` and binds params, but never binds `node.id` anywhere
  (unlike the `ClassExpression` case this ticket added, which binds `id` in a
  scope wrapping the body). Confirmed by direct test:
  `const f = function named(){ let x = named; }` reports `named` as an
  unresolved global read. It doesn't surface in the corpus today only because
  the common case, `named()`, is a call and callees are excluded from
  `variables` entirely (`isExcludedIdentifier`'s `CallExpression` check) — the
  bug only shows when the name is referenced without calling it. This isn't in
  the original ten confirmed defects and no ticket currently owns it; flag it
  if it's noticed again rather than assuming it's already covered.

- **The shorthand-property collision I worried about isn't real.** Acorn gives
  a shorthand `Property` (`{a}` in both object literals and destructuring
  patterns) distinct `key` and `value` nodes even though they render
  identically — confirmed with a quick acorn probe (`pat.key === pat.value` is
  `false`). So `classifyIdentifier`'s `parent.key === node` check correctly
  tells them apart; no special-casing was needed for
  `catch ({message}) { message }` or similar shorthand patterns.
