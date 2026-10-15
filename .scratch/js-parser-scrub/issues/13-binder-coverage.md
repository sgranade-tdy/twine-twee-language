# 13 — Complete binder coverage, including hoisting

Type: task
Status: closed
Blocked by: 03

Per ADR-0003, every binding form JavaScript has must open or populate a scope;
a missing binder silently promotes a local to story state. Ticket 03's review
found binders that ticket's audit didn't list. Decided in a grilling session on
2026-10-07.

| Input | Today | Expected |
| --- | --- | --- |
| `(function(){ on('x', handler); function handler(){} })()` | `handler` | nothing |
| `(function(){ const cb = () => count; let count = 0; })()` | `count` | nothing |
| `class A { static { let z = 1; z } }` | `A=`, `z=`, `z` | `A=` |
| `switch (k) { case 1: let y = 2; y }` | `k`, `y=`, `y` | `k` |
| `const f = function named(){ let x = named; }` | `f=`, `named` | `f=` |
| `function f(){ return arguments[0] }` | `arguments` | nothing |

## Work

1. **Hoisting by deferred resolution.** Every declaration is visible
   throughout its scope: `var`/`function` the way JS hoists them, and
   `let`/`const`/`class` too, because a closure can legally refer to a later
   `let`. Code that reads a `let` before its declaration throws at runtime, so
   treating the name as bound loses nothing. Implement it in
   `annotateVariableScopes` by *recording* each reference identifier with its
   scope during the walk instead of calling `findBindingScope` immediately.
   Once the walk finishes, every scope's bindings are complete, so resolve the
   recorded references and set `_scopeType` then. Assignment marking
   (`_isDefinition`) doesn't depend on resolution and stays where it is. Don't
   write a pre-pass declaration collector; it would duplicate the binding rules.

   Top-level behaviour doesn't change: top-level names are global, and
   therefore story variables, whether bound or not. `x; let x = 1` stays
   `x`, `x=`.

2. **Functions declared inside blocks bind to the block only** (strict
   semantics). Sloppy-mode browsers (Annex B) also make
   `if (x) { function g(){} } g()` work by exposing `g` to the enclosing
   function. We deliberately don't model that: it's rare, and reporting `g` is
   over-reporting a reference, which the spec's governing principle prefers.

3. **`arguments`.** Bind it implicitly in every non-arrow function's scope.
   Arrows see their enclosing function's. At the top level it stays an unbound
   name, and so a story variable. Filtering it there, if needed, is the story
   format's job (ADR-0003's seam). Don't add it to the built-in list.

4. **Class static blocks** (`StaticBlock`) open a `function`-type scope, so
   `var` inside one stays inside, as JS specifies.

5. **`switch`.** One `block` scope covers all the `case` bodies. The
   discriminant is visited in the outer scope.

6. **Named function expressions.** Bind `id` in a scope of its own between
   the outer scope and the function's scope, mirroring the `ClassExpression`
   case, so a param or local of the same name shadows it.

7. **Parameters don't see body `var`s.** `function f(a = b){ var b }`: in JS a
   default can't see body `var`s, but with deferred resolution `var b` hoists
   to the same function scope that holds the params. Give the body its own
   function-type scope (or make `nearestFunctionScope` stop at a dedicated
   function-body scope) so `var`s land there, and the params scope is its
   parent. Ticket 09 depends on this when it visits defaults.

## Not in scope

- `with (obj) { y }`. `y` might be `obj.y`; there's no way to know. It stays a
  story variable (over-report references).
- Visiting param/declaration defaults at all. That's ticket 09.

## Done when

Corpus rows in `js-parser.test.ts`, each with its expected result:

- the IIFE forward-reference rows in the table above, both call
  (`(function(){ init(); function init(){} })()`; it yields nothing today only
  because callees are excluded, which ticket 07 removes) and non-call;
- a closure over a later `let`;
- `function f(){ if (x) { function g(){} } return g }` → `x`, `g`;
- `arguments` in a function (nothing), in an arrow inside a function (nothing),
  and at the top level (`arguments`);
- static block `let` and `var` (neither leaks);
- top-level `switch` with `let`;
- a named function expression referring to itself (nothing), and shadowed by a
  param (`function named(named){ return named }`, nothing);
- `with (obj) { y }` → `obj`, `y`;
- `function f(a = b){ var b }`. This is only observable once ticket 09 visits
  defaults; if 09 hasn't landed, record what it does today and tag the row for
  09;
- `x; let x = 1` → `x`, `x=` (unchanged).

`npm test` green.

## Comments

Implemented in 1d409c3:

- `annotateVariableScopes` pushes each reference onto a list with its scope
  and resolves the whole list after the walk.
- A new `visitFunction` handles all three function node types:
  - a named function expression's own name scope;
  - a params scope, which holds the params and `arguments` (not for arrows);
  - a function-type body scope, so `var` hoists there, not into the params
    scope.
- New `StaticBlock` and `SwitchStatement` cases.

Seven of the new corpus rows fail without the change. The other seven pin
behaviour that already held and must stay:
- the call-form IIFE row;
- the Annex B row;
- the param-shadowing row;
- `with`;
- the top-level row;
- `function f(a = b){ var b }`, which is tagged for ticket 09 because defaults
  aren't visited yet.

`npm test`: 1251 passing.
