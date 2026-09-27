# 06 — Make assignment mean one thing

Type: task
Status: open
Blocked by: 03

`defined` currently means three different things depending on what's being
written:

| Construct | Honours `assignmentIsDefinition`? |
| --- | --- |
| `a = 1` | yes |
| `a.b = 1` | **no** — always a write |
| `var a = 1` | **no** — always a write |
| `[a,b] = c`, `({a} = c)`, `a++` | **never** a write, flag or not (defect 9) |

And the name is wrong: Twine variables are never declared, so `defined` promises
a declaration site that doesn't exist. `CONTEXT.md` now calls this **assignment**
(an occurrence that writes) as distinct from **declaration** (a JavaScript
binding form).

## Work

1. Rename the label field `defined` → `assigned` on `JSVariableLabel` and
   `JSPropertyLabel`, updating the doc comments. Consumers:
   `chapbook-parser.ts:118-144`, `sugarcube-utils.ts:19`, and the hand-patching
   loop in `findAndParseEngineStateSets` (`chapbook-parser.ts:938-944`).
2. **Declarations are always assignments.** `var`/`let`/`const`, `function` and
   `class` at root level are writes regardless of the flag — a declaration is
   unambiguous in a way a bare assignment isn't. This means `function f(){}` and
   `class A {}` start being reported at all, which is the point: a Chapbook
   script passage declaring `function greet(){}` declares something renameable.
3. **Properties honour the flag**, like variables. This changes Chapbook and
   SugarCube script passages, so pass `assignmentIsDefinition: true` at those
   call sites — `chapbook-parser.ts:1554` (`parseScript`),
   `sugarcube-parser.ts:159` (`parseAsJavaScript`) and
   `sugarcube-parser.ts:1455` (script-tagged passages). A top-level assignment in
   a script block genuinely does create story state. Bonus: this also makes bare
   `a = 1` in a script passage a write, which it isn't today.
4. **Only the final chain segment is assigned.** `obj.a.b.c = 1` writes
   `obj.a.b.c`; `obj.a` and `obj.a.b` are reads. The Chapbook vars section — the
   one place the whole chain really is created — passes `isSet` and overrides
   this anyway.
5. **Widen what counts as a write** when the flag is on (defect 9): destructuring
   assignment targets (`[a,b] = c`, `({a} = c)`), compound assignment
   (`+=`, `||=`, …), `++`/`--`, and `for (a of b)` / `for (a in b)` heads where
   `a` is an unbound identifier.

## Not in scope

`isSet`, the override channel both `createVariableAndPropertyReferences`
implementations already have. It stays: the Chapbook vars section and SugarCube's
`data-setter` know things the JavaScript can't express.

Method-valued properties (`$utils.greet = function(){}`) — the *write* side works
here; the matching *read* at `$utils.greet()` is issue 07.

## Done when

- No `defined` field remains in `js-parser.ts` or its consumers.
- Corpus rows for defect 9 show writes under `assignmentIsDefinition`.
- `obj.a.b.c = 1` marks only the last segment.
- A script-passage row shows `a = 1` and `a.b = 1` both as writes.
- `npm test` green.

## Note from ticket 03

Work item 2's class half is already done as a side effect of ticket 03's
`ClassDeclaration` binding fix: `isExcludedIdentifier` only excludes
`"declaration"`-role identifiers whose ancestor is
`FunctionDeclaration`/`FunctionExpression`/`ArrowFunctionExpression` — it has
no `ClassDeclaration`/`ClassExpression` case, so a root-level `class A {}`
already reports `A=` unconditionally today (see the corpus row in
`js-parser.test.ts`), regardless of `assignmentIsDefinition`. Only the
*function* half of item 2 remains: `function f(){}` is still fully excluded
from `variables` by that same clause, and needs it removed/adjusted here.
Function *params* being excluded by the same clause is harmless either way —
they're already filtered by scope (`_scopeType !== "global"`) whenever the
function isn't called at the top level with no enclosing scope, so removing
the exclusion for params shouldn't change behavior, but verify against the
corpus rather than assuming.
