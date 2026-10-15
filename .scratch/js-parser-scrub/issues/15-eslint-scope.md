# 15 — Replace the scope layer with eslint-scope

Type: task
Status: closed
Blocked by: none

Decided in a grilling session on 2026-10-13. See ADR-0004 for the reasons and
the pitfalls. A spike ran the full `js-parser.test.ts` suite with eslint-scope
handling scope (155 passing, 1 failing, where the failure is the ticket 09 row
and eslint-scope's answer is the correct one) and fed it about 30 half-typed
`acorn-loose` inputs without a throw.

## Work

1. **Add the dependency.** Add `eslint-scope` (9.x) to `server/package.json`
   dependencies, plus the type packages if needed. Import it through the CJS
   `exports.require` build that esbuild bundles. Acorn's `Program` needs a cast
   (`as unknown as ESTree.Program`).
2. **Parse options.** Add `ranges: true` to the strict and loose acorn parse
   calls used for extraction.
3. **Run eslint-scope.** Call `analyze` with:
   - `ecmaVersion: ScopeEcmaVersion`, a new numeric constant (e.g. `2026`)
     defined next to `EcmaVersion`, with a comment explaining why `"latest"`
     can't be used;
   - `sourceType: "module"` when the body contains `Import*`/`Export*` nodes,
     otherwise `"script"`;
   - `optimistic: true`;
   - the default `fallback: "iteration"`.

   Wrap a `parseExpressionAt` result in `Program` → `ExpressionStatement`
   first.
4. **Annotate identifiers from the analysis.** Keep the current mechanism, setting
   `_scopeType` and `_isAssignment` on `ScopedIdentifier`, so downstream code is
   unchanged.
   - A reference is a story variable when it is unresolved, or resolves to a
     variable in the global or module scope.
   - Mark declarations by walking `variable.defs` of type `Variable`,
     `FunctionName` and `ClassName` in the global/module scope. Skip a class's
     inner self-binding.
   - Redirect a reference that resolves to a class's inner self-binding to the
     outer variable (`class A { static s = A }` must report `A`).
5. **Writes.** A reference is a write when `ref.isWrite()` is true and
   `isAssignmentContext` is on. Put this behind one helper that answers "is this
   node in a write position?" Ticket 12 reuses it for member-expression
   targets, so the two rules can't disagree.
6. **Delete** `Scope`, `createScope`, `nearestFunctionScope`, `bindIdentifier`,
   `bindDeclaredName`, `findBindingScope`, `collectPatternIdentifiers` (unless
   something else still uses it), and `annotateVariableScopes` with
   `visitFunction`/`visitPatternExpressions`. Keep `classifyIdentifier`,
   `parentOf` and `IdentifierRole`. Highlighting and
   `isEveryIdentifierAVariable` don't use scope analysis.

## Done when

- Every corpus row in `js-parser.test.ts` passes unchanged, or changes on
  purpose and visibly in the diff. Expected changes:
  - The ticket 09 rows (taken over from 09, now closed):

    | Input | Expected |
    | --- | --- |
    | `function f(a = b){}` | `b` |
    | `function f(a = b){ var b }` | `b` |
    | `const {a = b} = c` | `a=`, `b`, `c` |
    | `const [a = b] = c` | `a=`, `b`, `c` |
    | `f = (a = b) => a` | `f`, `b` |
    | `const {[k]: v} = o` | `k`, `v=`, `o` |
    | `function f(a, b = a){}` | nothing |

  - A named function expression binds its own name:
    `const f = function named(){ let x = named; }` doesn't report `named`.
  - With `isAssignmentContext`: `a++`, `[a,b] = c`, `({a} = c)` and
    `for (a of b)` are writes. That's defect 9 for identifiers. Ticket 11
    adds the rest of the rows.
- `class A { static s = A }` reports `A`.
- `function f(){ var v; eval('x'); return v }` doesn't report `v`.
- None of the half-typed inputs below throws, and each gives the same output as
  before: `obj.`, `foo(`, `let = `, `for (let i of`, `class {`, `$x.y.`,
  `{ a: }`, `function (`, `obj?.`, `` `${a ``, `new `, `if (`, `x = {a:`,
  `try{}catch(`, `import x from`.
- No noticeable slowdown per keystroke on a large passage.
- `npm test` green.

## Not in scope

- Properties and member-expression writes (ticket 12). eslint-scope doesn't
  model properties.
- Moving `EcmaVersion`/`ScopeEcmaVersion` to a leaf module (ticket 10).
- Replacing node mutation with a `WeakMap` side table. That can be a separate
  refactor.

## Comments

### Outcome (2026-10-14)

Done in commits e2259d4 and 1fe0bc3. Differences from the plan:

- The write rule is `isWriteReference(ref, isAssignmentContext)` in
  `js-parser.ts`. It takes an eslint-scope `Reference`, not a node, and returns
  `ref.init === true || (isAssignmentContext && ref.isWrite())`. A declaration's
  initializer is always a write. See tickets 11 and 12 for what that means for
  them.
- The "one helper" goal became two siblings: ticket 12 added
  `isWriteTarget(node, ancestors, isAssignmentContext)` for member targets.
  The "Write parity between identifiers and members" corpus in
  `js-parser.test.ts` guards against the two disagreeing (accepted 2026-10-14).
- `ranges: true` goes on the parse calls only. `analyze` rejects it as an option
  in its types.
- `@types/eslint-scope` isn't needed (the package ships types); only
  `@types/estree` was added.
- Changed on purpose: the defect 9 rows (`a++`, `[a,b] = c`, `({a} = c)`) now
  show writes under the flag, and the SugarCube `<<for>>` test now expects
  `_v++` to be a `VariableSet`.
- A class *expression*'s own name inside its body isn't redirected (there's no
  outer variable); only `ClassDeclaration` inner bindings are.
- Not done: no per-keystroke timing measurement on a large passage.
- Checked on 2026-10-14: the half-typed inputs give the same variables and
  properties at e2259d4 as at its parent. The half-typed rows in
  `js-parser.test.ts` pin today's output, which has since changed on purpose
  for `foo(` (callees, ticket 07) and `x = {a:` (property writes, ticket 12).
