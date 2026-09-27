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
