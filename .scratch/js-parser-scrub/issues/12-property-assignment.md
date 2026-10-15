# 12 — Properties honour `isAssignmentContext`

Type: task
Status: closed
Blocked by: 11

Split from the original ticket 06. Today a property write ignores
`isAssignmentContext`: any `a.b = 1` is a write, while `a = 1` is a write only
when the caller passes the flag. After this ticket, properties follow the same
rule as variables. This changes the story-format call sites, so most of the work
is auditing them.

## Work

1. **Properties honour the flag.** `isMemberExpressionAssignment`
   (`js-parser.ts`, ~line 862) currently checks
   `AssignmentExpression.left === node` and nothing else. Fold it into ticket
   15's write-position helper so it's conditional on `isAssignmentContext`, the
   same as identifier writes.

    **Object-literal keys follow the flag too** (decided 2026-10-13). For a bare
    assignment (`obj = {a: 1}`, `obj.x = {a: 1}`), pass `isAssignmentContext`
    through to `captureObjectExpressionProperties` instead of hard-coding a
    write. The `VariableDeclarator` call site stays a write regardless, because
    `var obj = {a: 1}` is a declaration. Find the call sites by name.
    `extractSymbols` currently calls it from three places, plus its own
    recursion.

2. **Only the final chain segment is written.** `obj.a.b.c = 1` writes
   `obj.a.b.c`. `obj.a` and `obj.a.b` are reads, and so is the root variable
   `obj`. Today every segment of the chain is marked as written. The Chapbook
   vars section and `engine.state.set` are the places where the whole chain
   really is created, and they force every segment to be a write through `isSet`
   or hand-patching. That stays.

3. **Member targets are writes when the flag is on.** This extends ticket 11's
   identifier targets to member expressions, with the final segment written:
   `[o.x] = c`, `({k: o.x} = c)`, `[o.x = 1] = c`, `[...o.x] = c`, `o.x++`,
   `for (o.x of y)`. A computed segment truncates as usual: `[o[i].x] = c`
   writes nothing past `o`.

4. **Call sites.** Pass the flag (`isSetterContext` in the SugarCube wrappers)
   where a top-level assignment really does set
   state. Everywhere else, deliberately leave it off. Assignments in
   expression-only contexts are usually a typo for `==` or a side effect buried
   in a read, and under the "under-report assignments" principle they shouldn't
   suppress `VariableNeverSet`. So those sites **lose** the property writes they
   get today, and that's intentional.

    Line numbers as of `923a8c3`. They have drifted (for example,
    `parseAsJavaScript` is now at ~150), so find each site by function name:

    | Call site                                                                                                                                                                                                                                                          | Flag                   | Notes                                                                                        |
    | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------- |
    | SugarCube `parseAsJavaScript` (`sugarcube-parser.ts:159`)                                                                                                                                                                                                          | **add**                | Covers both Story JavaScript (`isScript`, line 1575) and `<<script>>` (line 811)             |
    | SugarCube `<<run>>` (`macros/scripting.ts:9`)                                                                                                                                                                                                                      | **add**                | Its own description says it's functionally identical to `<<set>>`                            |
    | Chapbook `parseScript` (`chapbook-parser.ts:1554`)                                                                                                                                                                                                                 | **add**                | `[JavaScript]` modifier and script passages                                                  |
    | SugarCube `<<set>>` (`macros/variables.ts:20`)                                                                                                                                                                                                                     | already on             |                                                                                              |
    | SugarCube link setters (`sc2/sc2-lexer-parser.ts:135`)                                                                                                                                                                                                             | already on             |                                                                                              |
    | SugarCube `data-setter` (`sugarcube-parser.ts:1291`)                                                                                                                                                                                                               | already on             |                                                                                              |
    | SugarCube receivers (`sugarcube-parser.ts:533`), `<<for>>` (`macros/control.ts:154`)                                                                                                                                                                               | hand-patched           | Unchanged                                                                                    |
    | Chapbook vars section (`chapbook-parser.ts:2228`), `engine.state.set` (`:931`)                                                                                                                                                                                     | `isSet` / hand-patched | Unchanged                                                                                    |
    | SugarCube script-tagged passages (`sugarcube-parser.ts:1455`)                                                                                                                                                                                                      | n/a                    | Tokenized for highlighting only; it doesn't capture references, so the flag would do nothing |
    | Everything else: SugarCube backtick and bareword macro args, `<<print>>`/`<<=>>`, `<<if>>`, the default for `parseArgsAsTwineScriptExpression`, `sc-eval:`/`@` attributes; Chapbook inserts, insert properties, modifiers, conditions, the vars-section value side | off                    | Intended loss of property writes                                                             |

    Adding the flag at the script sites also makes a bare `a = 1` a write there.
    That includes SugarCube Story JavaScript, where a bare `a` is a window global
    rather than `State.variables.a`. That's intended: per ADR-0003, an unbound
    name is a story variable.

## Not in scope

`isSet`, the override channel that both `createVariableAndPropertyReferences`
implementations already have. It stays: the Chapbook vars section and
SugarCube's `data-setter` know things the JavaScript can't express.

Method-valued properties (`$utils.greet = function(){}`): the _write_ side works
here. The matching _read_ at `$utils.greet()` is ticket 07.

## Done when

- `obj.a.b.c = 1` with the flag marks only `obj.a.b.c` as written. Without the
  flag, nothing is written.
- `obj = {a: 1}` writes `obj.a` only with the flag. `var obj = {a: 1}` writes
  it either way.
- There are corpus rows for each member target in item 3, with and without the
  flag.
- Chapbook and SugarCube parser tests show `a = 1` and `a.b = 1` as writes in a
  script passage. For SugarCube, that means Story JavaScript.
- A SugarCube `<<run $a.b = 1>>` test shows a property write.
- Two tests pin the intended loss: a SugarCube one (e.g. `<<print $a.b = 1>>`)
  and a Chapbook one (an insert) each show a property _read_, not a write.
- `npm test` green.

## Comments

### Note from ticket 01 review

The corpus rows this ticket should change are now tagged `// ticket 12: …` in
`js-parser.test.ts` (ticket 01 had left them untagged). Two kinds:

- **Member-expression writes** (work items 1–2): `a.b = 1`, `a.b += 1`,
  `setup.x = 1`, `obj.a.b.c = 1`, `State.variables.foo = 1`, and `obj.x` in
  `obj.x = {a: 1}`. `State.variables.foo = 1` matters most, since
  `sugarcube-utils.ts` remaps `State.variables.*` labels.
- **Object-literal keys of a bare assignment** (`obj = {a: {b: 1}}`,
  `obj = {a}`, `obj = {a: b}`, `obj = {get a(){…}}`, the keys in
  `obj.x = {a: 1}`). **This ticket's Work doesn't cover them.** The spec says a
  bare assignment is a write only with the flag, "and this now applies to
  properties", but `captureObjectExpressionProperties` passes `defined = true`
  unconditionally, and item 1 only touches `isMemberExpressionDefinition`.
  Either thread `isAssignmentContext` into the `AssignmentExpression` branch
  that calls `captureObjectExpressionProperties` (the `VariableDeclarator`
  branch stays a write — `var obj = {a: 1}` is a declaration), or decide
  explicitly that literal keys stay writes and drop the tag.

### Note from ticket 15 (2026-10-13)

eslint-scope only tracks identifiers, so member targets in item 3 (`o.x++`,
`[o.x] = c`, `for (o.x of y)`) still need our own parent-shape check. Put it
in ticket 15's "is this node in a write position?" helper rather than a second
classifier, so identifier and member writes can't disagree. Two disagreeing
classifiers were the spec's Cause A.

### Update from ticket 15 review (2026-10-14)

Ticket 15's helper is `isWriteReference(ref, isAssignmentContext)`, and it takes
an eslint-scope `Reference`. A member expression has no `Reference`, so it
can't be reused as is. Don't change its return value. Add a sibling that works
from AST shape, e.g. `isWriteTarget(node, ancestors, isAssignmentContext)`, that
covers the same positions as `ref.isWrite()` (assignment LHS including compound,
`++`/`--` operand, destructuring targets, defaults, rest, `for` heads). Put both
next to each other and add a parity corpus: for each identifier form in ticket
11's list, assert the shape helper and `isWriteReference` agree. Skip the
`ref.init` clause for members; a member can't be declared.
`annotateVariableScopes` also needs `isAssignmentContext` threaded to
`extractSymbols` for the property rules.

### Note from ticket 11 (2026-10-14)

Ticket 11's identifier-target corpus rows (defaults, rest, `--`, `for…in`, destructured `for…of` heads, each with and without the flag) are in `js-parser.test.ts` under the "Writes in an assignment context" section. The parity corpus can reuse them. Member-expression forms (`[o.x] = c`, `o.x++`, `for (o.x of y)`) are not covered yet.

### Done (2026-10-14)

Implemented in `7d42e98` and `a55a570`.

- `isWriteTarget(node, ancestors, isAssignmentContext)` sits next to `isWriteReference` in `js-parser.ts`. `isMemberExpressionAssignment` is gone.
- acorn-walk's `fullAncestor` skips the `Property` (and `RestElement`) between an `ObjectPattern` and its value. A member's parent is therefore the `ObjectPattern` itself, and the check has to find which property holds the node. Computed keys in a pattern also have the `ObjectPattern` as parent, so don't just return true there. Ticket 11's identifier path doesn't hit this because eslint-scope does the classifying.
- The parity corpus is the "Write parity between identifiers and members" describe in `js-parser.test.ts`. It is table-driven through `tokenizeJavaScript`, so it needs no new exports. It found the `({...o.x} = c)` bug on its first run. Add a template there when a new write position appears.
- `extractSymbols` takes `isAssignmentContext`. `captureObjectExpressionProperties` takes an explicit `assigned` argument. The `VariableDeclarator` call passes `true`, and the others pass the flag.
- The old `chain.root._scopeType === "global"` check on the write flag is gone. It's redundant, because a non-global root already bails out earlier in the `MemberExpression` case.
- Existing tests whose expectations changed: Story JavaScript, `<<script>>` and `[JavaScript]` now count a bare `a = 1` as a write. `State.temporary.var.prop = 1` now writes only `_var.prop`, and `_var` is a read. Several old `tokenizeJavaScript` tests that checked property writes now pass the flag.
