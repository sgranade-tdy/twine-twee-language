# Scrubbing JavaScript variable and property extraction

## Problem

`server/src/js-parser.ts` answers one domain question — _which names in this
JavaScript are story state the author controls, and which occurrences write
them_ — for both Chapbook and SugarCube. Its answers feed the project index,
which feeds go-to-definition, find-references, rename and the `VariableNeverSet`
diagnostic.

Probing it with ~100 inputs turned up ten confirmed defects. They are not
independent; most fall out of two structural causes.

**Cause A: two disagreeing classifiers.** `annotateVariableScopes` walks the AST
and decides reference-vs-declaration properly, via `isReferenceIdentifier`, by
looking at each identifier's parent. `fullAncestorTokenizingCallback` then walks
it again and re-decides with an ad-hoc blacklist (`ancestor?.type !==
"NewExpression" && ancestor?.type !== "CallExpression" && …`). The two disagree.

**Cause B: incomplete scope analysis.** Only `BlockStatement` opens a scope, so
loop heads and `catch` params leak; `ClassDeclaration` doesn't bind at all.

### Confirmed defects

| #   | Input                                         | Today                                                       | Cause                                                                                                                                                                                                                        |
| --- | --------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `foo(bar)`                                    | nothing — `bar` is lost entirely                            | A: the blacklist skips _every_ child of a `CallExpression`, not just the callee. `foo(bar.baz)` _does_ yield `bar` via the member-expression path, so it's inconsistent too. This silently loses `<<set $x to random($y)>>`. |
| 2   | `for (let i = 0; …)`, `for (var j in obj)`    | `i` / `j` reported as written story variables               | B                                                                                                                                                                                                                            |
| 3   | `try {} catch (e) { e.message }`              | `e` reported as a story variable, plus property `e.message` | B                                                                                                                                                                                                                            |
| 4   | `class A {}`                                  | `A` reported as a story variable _read_                     | B                                                                                                                                                                                                                            |
| 5   | `obj.` (loose parse)                          | a property literally named `✖` reaches the index            | A: `✖` is filtered in the identifier branch but not in `captureProperty`                                                                                                                                                     |
| 6   | `obj = {'k': 1}`, `obj = {1: 'x'}`            | key dropped — yet `obj['k'] = 1` yields `obj.k`             | `getStaticPropertyName` accepts string literals only when `computed`                                                                                                                                                         |
| 7   | `a \|\|= 1`, `a ??= 1`, `1_000`, class fields | syntax errors                                               | `EcmaVersion = 2020`; these are ES2021/2022 and run fine in the player                                                                                                                                                       |
| 8   | `RegExp.test(a)`, `globalThis.z = 1`          | `RegExp` / `globalThis` reported as story variables         | missing from `builtInObjects`; that list also contains a `"null,"` typo                                                                                                                                                      |
| 9   | `[a,b] = c`, `({a} = c)`, `a++`               | never an assignment, even with `assignmentIsDefinition`     | only `AssignmentExpression.left === node` is checked                                                                                                                                                                         |
| 10  | `obj = {a}` (shorthand)                       | yields property `obj.a` but not the variable read `a`       | `obj = {a: b}` does yield `b`                                                                                                                                                                                                |

### Two more, found in the callers

`isTwineScriptExpression` (`sugarcube/sc2/sc2-twinescript.ts:192`) calls
`parseJSStrict` then `tokenizeParsedJS` **without** `annotateVariableScopes`, and
hands it the _sugared_ text alongside an AST parsed from the _desugared_ text. So
`_scopeType` is `undefined` everywhere, the `MemberExpression` branch always
bails, and `currentExpression` disagrees with the AST's offsets. Combined with
defect 1, `foo(bareword)` currently passes as valid TwineScript.

Both diagnostics files suppress `VariableNeverSet` for JavaScript built-in
members via `isBuiltinJSObjectInstanceProperty`. That list contains `name`,
`description`, `message`, `source`, `cause`, `size`, `global`, `flags` and
`buffer` — among the most common property names a Twine author will ever choose.
SugarCube's own `builtinSugarCubeProperties` (`sugarcube-variables.ts:86`) repeats
the mistake with `name`, `id`, `tags`, `text`, applied to every root variable.
The result is silent: a typo'd `$player.nmae = "Bob"` beside a correct
`$player.name` read produces no warning at all.

## Governing principle

Rename correctness is the hard constraint. A missed occurrence means rename
rewrites some sites and not others, leaving a silently broken story; a spurious
occurrence is index noise and a disableable warning. So:

- **Over-report references.** When in doubt, index it.
- **Under-report assignments.** A write claim drives `VariableNeverSet` and
  definition lookup; guessing is worse than abstaining.
- **Never guess a prefix.** A property indexed under the wrong path renames the
  wrong thing. Unresolvable chains are truncated — this is the one place
  precision beats recall.

## Design

### One classification, two passes

Highlighting wants every token (literals, operators, keywords, callee names) and
doesn't care about scope. Symbol extraction wants scope-resolved names and
doesn't care about operators. Today they share one `astUnprocessedToken` stream,
which is why half its fields (`scope`, `defined`, `global`) are dead weight for
half its consumers — and why the blacklist exists as a stand-in for real
classification.

Split them into two passes over the same AST, sharing one helper that answers
"what is this identifier": a declaration, a reference, or neither. Defects 1 and
5 disappear as a consequence rather than needing fixes.

### Scope

Per ADR-0003, an identifier is a story variable exactly when nothing in the
snippet binds it. Binder coverage is therefore a correctness concern: every
binding form JavaScript has must open or populate a scope. Defects 2–4 are
missing binders, not a broken definition.

**Update (2026-10-13):** tickets 03 and 13 completed binder coverage by hand.
Ticket 15 then replaces that analyser with `eslint-scope` (ADR-0004), which
runs on the same Acorn AST. A story variable is a reference that is unresolved
or resolves to a global-scope or module-scope variable. Writes come from
`Reference.isWrite()`, gated by the assignment-context flag. Everything
Twine-specific (chains, properties, built-ins, the format seam) stays ours.

### Assignment

Rename the label field `defined` → `assigned`, rename the `assignmentIsDefinition`
flag to `isAssignmentContext` (`isSetterContext` in the SugarCube wrappers), and
apply it uniformly. Today properties ignore the flag (any `a.b = 1` is a write) while
variables require it, and `var x = 1` ignores it in a third direction. After:

- A **declaration** (`var`/`let`/`const`, `function`, `class`) at root level is
  always an assignment — declarations are unambiguous.
- A bare **assignment** is a write only when the caller says so, and this now
  applies to properties as well as variables. Script-passage and `<<script>>`
  call sites pass the flag, since a top-level assignment there genuinely does
  create story state.
- Only the **final segment** of a chain is assigned. `obj.a.b.c = 1` writes
  `obj.a.b.c`; `obj.a` and `obj.a.b` are reads.
- Destructuring targets and `++`/`--`/compound assignment count as writes when
  the flag is on.

### Callees and method properties

`function f(){}` becoming an indexed assignment (above) is only useful if `f()`
is an indexed read — otherwise rename rewrites the declaration and leaves every
call site behind. So a called identifier is a story variable occurrence _and_
keeps its `function` highlighting; the two passes make that non-contradictory.

The same argument applies one level down: `$utils.greet = function(){}` and
`$utils.greet()` must rename together, so resolvable method-call properties are
reported. This reverses a deliberate decision (`js-parser.test.ts:994` asserts
the opposite) and requires built-in _method_ names in the diagnostic filter, or
`$arr.push(x)` becomes a false "never set".

### The seam

`js-parser.ts` knows only JavaScript. Story-format globals (`State`, `setup`,
`_args`) stay downstream in the Chapbook and SugarCube parsers. The JavaScript
built-in list becomes load-bearing in a new way once callees are indexed, so it
needs the global _functions_ too.

## Non-goals

- Type inference. We can't know whether `$x` is an Array, so `$x.length` is
  disambiguated by name lists and always will be.
- Cross-passage analysis. Each snippet is classified on its own.
- Chains rooted in a call (`obj().a`) or continuing past a computed segment
  (`obj[i].name`). No spellable prefix, so nothing to index.
- Splitting `DiagnosticCodes.IncorrectJavaScript`. Unchanged from ADR-0002's
  reasoning: codes are user-disableable.

## Sequencing

Structure first, because defects 1 and 5 vanish with it rather than needing code
that would then be deleted:

01 corpus → 02 split → 03 binders → 04 ECMA → 05 built-ins → 06 rename → 13 binder coverage →
15 eslint-scope → 11 write rules → 12 property assignment → 07 property occurrences → 08 diagnostic filters.

10 (import cycle) and 14 (Chapbook shadowed globals) are independent. 09
(default-value scoping) was closed as superseded by 15.

**Deviation from the grilling session, flagged for review:** the agreed order put
the corpus test last. It's first here instead. The corpus's value is as a
_baseline_ — it can only prove the pass-split is behaviour-preserving if it
exists before the split, and each later issue then edits exactly the rows it
means to change, making every behaviour change visible in a diff. Written last it
can only ratify whatever the code ended up doing. Say the word and I'll move it
back.

## Docs

Already landed, since the terms resolved during the grilling session:

- `GLOSSARY.md` gained a "JavaScript symbol extraction" section defining story
  variable, story property, occurrence, assignment, declaration and resolvable
  chain.
- `docs/adr/0003-unbound-identifier-means-story-variable.md`.
- `docs/adr/0004-eslint-scope-for-scope-resolution.md` (2026-10-13 grilling
  session).
