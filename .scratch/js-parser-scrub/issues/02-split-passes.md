# 02 — Split highlighting from symbol extraction

Type: task
Status: closed
Blocked by: 01

One AST walk currently serves two unrelated consumers through one
`astUnprocessedToken` stream. Highlighting wants every token and ignores scope;
extraction wants scope-resolved names and ignores operators. The shared record
carries `scope`, `defined` and `global` fields that are meaningless to half its
consumers — and, more damagingly, `fullAncestorTokenizingCallback` re-derives
"is this identifier interesting" with a parent-type blacklist, badly, when
`isReferenceIdentifier` already knows the answer.

Defects 1 and 5 are consequences of that second classifier existing. They should
disappear here, not be fixed later.

## Work

1. Extract one shared helper that classifies an identifier given its ancestors:
   declaration, reference, or neither (property key, label, import binding).
   `isReferenceIdentifier` is most of it already.
2. Split the walk in two: a highlighting pass emitting semantic tokens, and an
   extraction pass emitting `JSVariableLabel` / `JSPropertyLabel`. Both consult
   the helper; neither re-derives classification from parent types.
3. Delete the `ancestor?.type !== "NewExpression" && …` blacklist. Deliberately
   skipping the *callee* is issue 07's business; skipping call *arguments*
   (defect 1) is the bug.
4. Filter `✖` centrally, so it can't reach properties (defect 5).
5. Move `currentExpression` and `unprocessedTokens` out of module scope into
   per-call state.
6. Unexport `annotateVariableScopes` and `tokenizeParsedJS`. Give
   `isTwineScriptExpression` (`sugarcube/sc2/sc2-twinescript.ts:192`) a purpose-
   built predicate instead: it wants "is every identifier here a SugarCube
   variable", and currently gets there by running half an uninitialised pipeline
   with mismatched text and AST.

## Not in scope

Any behaviour change beyond defects 1 and 5 falling out of the restructure. If a
corpus row changes for any other reason, that's a regression — investigate it
rather than updating the expectation.

## Done when

- `js-parser.ts` has no module-level mutable state and no parent-type blacklist.
- `annotateVariableScopes` and `tokenizeParsedJS` are no longer exported.
- The corpus rows for defects 1 and 5 are updated and commented; all other rows
  are untouched. `npm test` green.

## Comments

### Review follow-up

A post-merge review of dcbe8b4 found gaps against this ticket; fixed in a
follow-up commit:

- **`new` arguments were still dropped.** `isExcludedIdentifier` skipped every
  child of a `NewExpression`, which is defect 1's bug for constructors
  (`new Date(bareword)` still passed `isTwineScriptExpression`). Only the
  callee is excluded now; `new Foo(bar)` yields `bar`.
- **Arrow parameters had lost their highlighting.** The shared exclusion added
  `ArrowFunctionExpression` declarations, which the old blacklist never had.
  Removed; arrow params are highlighted again and still never extracted (they
  aren't scope-annotated).
- **A computed callee emitted a bogus token.** `obj[k](x)` produced a
  `function` token with the text `<dynamic>` at `k`'s position, overwriting
  `k`'s variable token. `computeSemanticTokens` now skips it.
- **The identifier filter was triplicated.** The three walks now share
  `isCandidateVariable`; the `✖` literal is the named `REPAIR_MARKER`.

Behaviour changes from the original split that were kept, now pinned by tests:
`obj["m"](x)` no longer yields `obj.m` (consistent with `obj.method(x)`; issue
07 reverses both), and highlighting now marks properties on a locally bound
root (`function f(o){ o.x }` highlights `x`).

Not fixed here, filed as issue 09: default-value expressions in parameters and
destructuring are never scope-annotated, so their reads are lost.

### Note from ticket 01 review

Root cause of the gaps above: ticket 01's corpus tagged only `foo(bar)` and
`a = foo(b)` as defect 1, though `new Foo(bar)`, `obj.method(x)`,
`obj.a.method(x)`, `setTimeout(fn, 1)`, `parseInt(a)`, `Math.max(a,b)`,
`console.log(a)` and `RegExp.test(a)` all lost their argument too. That's why
this ticket's "touch only tagged rows" check was noisy and `new Foo(bar)`
slipped through. Also, the corpus never captured highlighting output
(`passageTokens`), so this split had no compact baseline for the highlighting
half — the arrow-param and `<dynamic>` token regressions were only caught by
review. Nothing to redo here; both rows are correct at HEAD.

### Second review (dcbe8b4 + f917545), fixed in a follow-up commit

- **Item 6 was only partly met.** `isEveryIdentifierAVariable` filtered
  through `isCandidateVariable` → `isExcludedIdentifier`, so it inherited
  extraction's *temporary* callee and shorthand exclusions. That made
  `isTwineScriptExpression("{a}")` true. It would also have flipped
  `either("A","B")` and `visited("X") > 1` to false as soon as issue 07
  removed those exclusions. It now has its own filter: it skips callees and
  function names/params, and checks shorthand values. Pinned in
  `sc2-twinescript.test.ts`.
- **Callee-ness was decided at three sites that disagreed.** One `isCallee`
  helper (call + `new`) now serves `isExcludedIdentifier`, extraction's
  member-chain skip (`lastIsCallee`) and the predicate. Highlighting handles
  `CallExpression` and `NewExpression` in one case. Behaviour changes, pinned
  by tests:
  - `new a.B(x)` no longer yields property `a.B`, matching `a.b(x)`.
  - `new Foo(x)` and `new obj.Foo(x)` now give the callee a `function` token.
    Before, `new Foo(x)` gave `Foo` no token and `new obj.Foo(x)` marked
    `Foo` as a property.
- **`"<dynamic>"` sentinel removed.** `MemberSegment.name` is now
  `string | undefined`, and `MemberChain.dynamic` became
  `isDynamicChain(chain)`.
