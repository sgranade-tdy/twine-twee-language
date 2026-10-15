# 01 — Baseline tests for Acorn error improvement

Type: task
Status: closed

Capture today's behaviour of `improveAcornErrorMessage` in a table-driven test,
before anything changes. This must land first: without a record of current
behaviour, later phases can't distinguish an improvement from a regression.

## Work

Create `server/src/test/acorn-errors.test.ts`. Table-driven, matching the repo's
existing chai style — an array of `{input, expectedMessage, expectedStart, expectedEnd}`
literals asserted in a loop. No snapshot library; the repo has none, and a
hand-edited table makes every message change a deliberate line in the diff.

Corpus:

- Broken JavaScript harvested from the existing Chapbook and SugarCube test
  fixtures.
- Hand-written typos, one per existing rule.
- A systematic sweep of inputs producing Acorn's three generic messages:
  `a b c`, `{a: }`, `foo(`, `[1,2`, `catch `, `try{}`, `if(a){`, `x = 1 @ y`,
  `1_`.

Record what the code does **today**, bugs included. Where behaviour is known to
be wrong, assert the wrong value and mark it with a comment naming the phase that
will fix it. Two known-wrong areas:

- `findUnmatchedDelimiter` reports drifted positions whenever a string or escape
  precedes the delimiter (its index doesn't advance on `continue` paths).
- Unmatched-delimiter detection short-circuits ahead of every specific rule, so a
  stray `(` masks better messages.

## Done when

- The new test file passes against unmodified `acorn-errors.ts`.
- Every input in the sweep list has a row.
- `npm test` is green.
