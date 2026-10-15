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

### Note from ticket 01 review

The `class A { foo = 1 }` corpus row was tagged only `// defect 7` in ticket 01,
but its `["A"]` read was also defect 4. That's why this ticket changed an
untagged-for-4 row. Already handled; recorded so the tag gap isn't mistaken for
scope creep.

### Review of 643a04d (2026-10-07)

Verified by running inputs through `tokenizeJavaScript` at 643a04d and at HEAD.

**Regression to fix:**

- **Catch-param defaults and computed keys are now dropped.** The new
  `CatchClause` case binds the param and then visits only `node.body`. It never
  walks the param pattern, so `b` in `catch({a = b})` and `k` in
  `catch({[k]: v})` get no `_scopeType` and are silently dropped. Before this
  commit, the generic walk reported them as reads: `try{}catch({a = b}){ a }`
  gave `["a","b","a"]` and now gives `[]`. That's a lost occurrence, which
  breaks rename. It's the same gap ticket 09 fixes for function params and
  declarations, so it's been handed to 09 (see the note there).

**Binders this ticket's audit missed.** ADR-0003 says every binding form
counts. No ticket owns these yet; they need a new one:

- **`StaticBlock`.** `class A { static { let z = 1; z } }` gives
  `["A=","z=","z"]`, a spurious story-variable *write*. A static block is a
  function-like scope, so `var` inside it shouldn't hoist out either. This
  didn't show until ticket 04 made class bodies like this parse.
- **`SwitchStatement`.** The case block is one block scope, but nothing opens
  it. At the top level, `switch (k) { case 1: let y = 2; y }` gives
  `["k","y=","y"]`. This predates the ticket, but switches are common in Story
  JavaScript.
- **No hoisting.** Bindings are added in visit order, so an inner scope that
  refers to a name *before* its `function`/`let`/`const`/`class` declaration
  resolves it as global. For example,
  `(function(){ document.addEventListener('x', handler); function handler(){} })()`
  reports `handler` as a story variable. This is the usual pattern in SugarCube
  Story JavaScript IIFEs. It predates the ticket, but it's the same correctness
  concern. Fix: before visiting each function/block body, pre-bind its
  `function` declarations and its `var`s (into the function scope), and its
  `let`/`const`/`class` declarations (into the block scope).
- **Named function expressions.** Already noted above, and still unowned.

**Minor:** `ClassDeclaration`/`ClassExpression` bind with kind `"function"`.
That works because only `"var"` is special-cased, but `bindIdentifier`'s kind
union should get a `"class"` member so a hoisting change doesn't sweep classes
in with functions.

### Review follow-up (16f6f6b)

- Fixed the catch-param regression. A new `visitPatternExpressions` walks the
  param's defaults and computed keys inside the catch scope. There are corpus
  rows for `catch({a = b})`, `catch({[k]: v})` and `catch([a, b = a])`.
- Class names now bind with a `"class"` kind.
- `bindDeclaredName` replaces three copies of the bind-and-mark code, and the
  two class cases are merged.
- The `classifyIdentifier` doc comment now lists class names, and the corpus row
  wording says "assignment", not "definition".
- The missing binders (static blocks, `switch`, hoisting, named function
  expressions, `arguments`) moved to ticket 13.
