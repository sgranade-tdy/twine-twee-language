# 11 — Declarations and identifier targets are writes

Type: task
Status: closed
Blocked by: 06, 15

Split from the original ticket 06. Everything here lives in
`server/src/js-parser.ts`, and its tests are corpus rows in `js-parser.test.ts`.

## Work

1. **Declarations are always assignments.** A `var`/`let`/`const`, `function`
   or `class` whose name is bound in the snippet's **top-level scope** (that is,
   the identifier ends up with `_scopeType === "global"`) is a write, whatever
   `isAssignmentContext` says. A declaration is unambiguous in a way a bare
   assignment isn't. Declarations that bind in an inner scope (`let` inside a
   block, a function nested in a function) are bound names, not story variables,
   per ADR-0003, and stay unreported.

    Status of each form, after ticket 15:
    - `var`/`let`/`const` and `class`: done. Ticket 15's glue marks global- and
      module-scope `Variable`/`ClassName` defs as assignments (`_isAssignment`).
    - `function`: ticket 15 marks `FunctionName` defs the same way, but
      `isExcludedIdentifier` drops the name, so this is the only remaining
      work. Its
      `role === "declaration" && parent is FunctionDeclaration/FunctionExpression`
      clause hides it. Narrow that clause so a `FunctionDeclaration`'s `id` gets
      through. The clause also excludes function _params_. Those are already
      filtered by scope (they bind in the function's scope), so dropping the
      exclusion for them shouldn't change anything, but check that against the
      corpus rather than assuming.

    On its own this makes rename _worse_ for functions (a write with no indexed
    call sites). Ticket 07 fixes that by indexing callees.

2. **Identifier targets are writes when the flag is on (defect 9).** With
   `isAssignmentContext`, an unbound identifier is a write when it is:
    - a destructuring assignment target: `[a, b] = c`, `({a} = c)`,
      `({k: a} = c)`, nested patterns;
    - a target with a default: `[a = 1] = c`, `({a = 1} = c)`. `a` is a write,
      and identifiers _inside_ the default (`b` in `[a = b] = c`) are reads;
    - a rest target: `[...a] = c`, `({...a} = c)`;
    - the operand of `++`/`--` (prefix or postfix);
    - the head of `for (a of b)` / `for (a in b)`, including destructured heads
      (`for ([a, b] of c)`).

    Without the flag, all of these stay reads, the same as a bare `a = 1`.

    Compound assignment (`+=`, `||=`, `??=`, …) already counts. It's an
    `AssignmentExpression`, and the corpus shows `a += 1` as `a=` under the flag.
    Keep those rows as they are.

    Member-expression targets (`[o.x] = c`, `o.x++`, `for (o.x of y)`) are
    **ticket 12**. They depend on properties honouring the flag.

## Done when

- `function f(){}` at top level yields `f=` regardless of the flag. A nested
  `function g(){}` inside `f` yields nothing.
- The defect 9 corpus rows (`a++`, `[a,b] = c`, `({a} = c)`) show writes under
  `isAssignmentContext` and reads without it.
- There are new corpus rows for defaults, rest, `--`, and `for…of` / `for…in`
  heads, each with and without the flag.
- `npm test` green.

## Comments

### Note from ticket 02 second review

The function-declaration clause this ticket narrows now lives in its own
helper, `isFunctionOwnBinding(role, parent)`. Two callers use it:
`isExcludedIdentifier` (highlighting and extraction) and
`isEveryIdentifierAVariable` (SugarCube's `isTwineScriptExpression`). If you
narrow it there, a `FunctionDeclaration`'s `id` also becomes something that
predicate requires to be `$`/`_`-prefixed. To change extraction only, narrow
the call in `isExcludedIdentifier` instead. Either way, check
`sc2-twinescript.test.ts`.

### Update from ticket 15 (2026-10-13)

Scope now comes from eslint-scope (ADR-0004), and the work changes as follows.

- **Item 1:** "bound in the top-level scope" now means "resolves to a variable in
  eslint-scope's global or module scope". Ignore the `_scopeType === "global"`
  wording above. The `isExcludedIdentifier`/`isFunctionOwnBinding` narrowing
  still applies.
- **Item 2:** use ticket 15's write-position helper, `ref.isWrite()` gated by
  `isAssignmentContext`. Ticket 15 already flips `a++`, `[a,b] = c`, `({a} = c)`
  and `for (a of b)`. What's left is the remaining corpus rows: defaults, rest,
  `--`, `for…in` and destructured heads, each with and without the flag.

### Update from ticket 15 review (2026-10-14)

- Corpus rows already added or flipped by ticket 15: `a++`, `[a,b] = c`,
  `({a} = c)` with the flag (now writes), `for (a of b)` with the flag, and the
  ticket 09 default-value rows. Add only what's missing: defaults as targets,
  rest, `--`, `for…in`, destructured heads, and the _without the flag_ variants.
- `isWriteReference` already returns true for a declaration initializer
  whatever the flag says (`ref.init`). Item 1's `var`/`let`/`const`/`class`
  behaviour is therefore doubly covered; don't gate it on the flag.
- Pre-existing SugarCube test change: `<<for>>` post expression `_v++` is now a
  `VariableSet` (macros.test.ts). Expect similar flips elsewhere when adding rows.

### Note from ticket 12 (2026-10-14)

Member targets (`[o.x] = c`, `o.x++`, `for (o.x of y)`, `({...o.x} = c)`) are now covered, using the flag. `isWriteTarget` is the AST-shape sibling of `isWriteReference`. The "Write parity between identifiers and members" corpus in `js-parser.test.ts` runs each of your identifier forms against a member form. If you add an identifier write position here, add a template to that table.
