# 04 — Parse at the latest ECMA version

Type: task
Status: open
Blocked by: 02

`EcmaVersion = 2020` (`js-parser.ts:20`). Twine stories run in whatever browser
the player opens them in, so ES2021+ syntax works fine in the story and fails
here — producing a red squiggle on correct code, which is the worst diagnostic
outcome we have.

Confirmed failures: `a ||= 1`, `a &&= 1`, `a ??= 1` (ES2021 logical assignment),
`1_000` (ES2021 numeric separators), `class A { foo = 1 }` (ES2022 class fields).
The class-field failure is especially bad — it reports "Opening `{` is missing a
matching `}`", pointing at the wrong thing entirely.

## Work

1. Set `EcmaVersion` to `"latest"`.
2. Re-run the corpus. The `||=` / `??=` / `1_000` / class-field rows should stop
   erroring; capture whatever variables and properties they now yield.
3. Check the `acorn-errors/` rules still behave. They match on Acorn's message
   text, and a newer Acorn parses further before raising, so some inputs will now
   fail differently or not at all. `server/src/test/acorn-errors/` should catch
   it; if a rule's trigger input no longer errors, find one that does rather than
   deleting the rule.
4. Leave `sourceType: "script"`. `import` / `export` in a passage is an error
   worth reporting, not a parser setting to relax.

## Not in scope

Handling the *new* syntax's semantics. `a ||= 1` should be treated as a write
under `assignmentIsDefinition` — that's issue 06, which explicitly covers
compound assignment.

## Done when

- The four ES2021/2022 corpus rows parse cleanly.
- `npm test` green, including `server/src/test/acorn-errors/`.

## Note from ticket 03

The `class A { foo = 1 }` corpus row's `variables` already changed from `["A"]`
to `["A="]` as a side effect of ticket 03's `ClassDeclaration` binding fix —
unrelated to this ticket's parse-error work, and `error` is unchanged
(`"Opening '{' is missing a matching '}'"`). Don't attribute that diff to the
`EcmaVersion` change when you touch this row.

Also: once `class A { foo = 1 }` actually parses (this ticket's job), be aware
`extractSymbols` has no `PropertyDefinition`-specific handling for capturing a
class field as a property write — only `MemberExpression`/`ObjectExpression`
paths feed `captureProperty` today. So re-running the corpus will likely show
`foo` recorded as neither a variable nor a property (correctly `"neither"` per
ticket 03's classifier fix, but also simply never captured as an occurrence
anywhere) — that's expected, not a new bug to chase, unless a later ticket
decides class fields should be indexed as story properties.
