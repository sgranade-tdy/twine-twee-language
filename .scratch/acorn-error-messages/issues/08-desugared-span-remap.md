# 08 — Remap both span endpoints when desugaring TwineScript diagnostics

Type: task
Status: closed
Blocked by: 03

Found during code review of ticket 03. `tokenizeTwineScriptExpression`
(`server/src/passage-text-parsers/sugarcube/sc2/sc2-twinescript.ts:307-316`)
remaps a `JSDiagnostic`'s position from desugared-text coordinates back to the
original (sugared) source, but only remaps `start`. `end` is reconstructed as
`start + (sugaredText?.length ?? length)`, where `length` is the width of the
span in *desugared*-text coordinates:

```ts
if (jsTokens.error) {
    const length = jsTokens.error.end - jsTokens.error.start;
    const { sugaredPosition, sugaredText } = getSugaredPositionAndNewText(
        jsTokens.error.start,
        positionMapping,
    );
    jsTokens.error.start = offset + sugaredPosition;
    jsTokens.error.end =
        jsTokens.error.start + (sugaredText?.length ?? length);
}
```

This preserves the pre-ticket-03 behavior exactly (same length-substitution
logic, just renamed fields), so it's not a regression. But it's still wrong
whenever a diagnostic's span crosses a desugaring substitution whose
sugared/desugared length delta at `end` differs from the one resolved at
`start` — e.g. a span covering multiple `$var`/`_var` sigils, or one that
starts before a substitution and ends after it. In those cases the recomputed
`end` doesn't reflect the real sugared-source width and the squiggle can be
mis-sized or land in the wrong place.

## Work

1. Remap `jsTokens.error.end` independently through `getSugaredPositionAndNewText`
   (or equivalent), the same way each semantic token's position is remapped
   individually in the loop below this block, rather than deriving `end` from
   a single length carried over from `start`'s resolution.
2. Add a test to `server/src/test/passage-text-parsers/sugarcube/sc2/sc2-twinescript.test.ts`
   that exercises a diagnostic span crossing (or ending inside/after) a
   sigil substitution, so the sugared/desugared length delta at `end` differs
   from the one at `start`. The existing `"should capture diagnostic errors"`
   test doesn't cover this: its error position falls after the `$var`
   substitution, so `sugaredText` is `undefined` and the interesting branch is
   never exercised.

## Done when

- `jsTokens.error.end` is derived from its own position-mapping lookup, not
  from `start`'s.
- A test exists that would fail against the old length-carried-over logic.
- `npm test` is green.

## Answer

`tokenizeTwineScriptExpression` now maps `jsTokens.error.start` and
`jsTokens.error.end` through `getSugaredPositionAndNewText` independently; the
`start + (sugaredText?.length ?? length)` reconstruction is gone. For an
exclusive end, the helper already does the right thing in every case: an end on
a substitution's `newStart` resolves to that substitution's `originalStart`
(immediately before the sugared token), and an end at or past `newEnd` picks up
the substitution's full sugared width.

Three tests in `sc2-twinescript.test.ts` cover the endpoint cases:

- `$a gt $b to 1` — span over `$a`, whose end sits past the equal-width `$`
  sigil substitution its start lands on. Old logic gave end 134, not 135.
- `$aa gt 1 $bb` (program mode) — span over `$bb`, sitting after the
  length-changing `gt` -> `>` substitution. Old logic gave end 143, not 145.
- `($aa to 1` — span over the unclosed `(`, whose exclusive end falls exactly on
  the start of the `$` sigil substitution.
