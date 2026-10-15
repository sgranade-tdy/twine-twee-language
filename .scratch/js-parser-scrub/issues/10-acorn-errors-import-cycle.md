# 10 — Break the `js-parser` ↔ `acorn-errors` import cycle

Type: task
Status: closed
Blocked by: none

If `js-parser` is the first module a test run loads, the error-message
improvement silently stops working: 37 of the 53 "Acorn Error Messages" tests
get Acorn's raw messages (`Unexpected token '}'`, `Unexpected end of input`)
back instead of the improved ones. `npm test` is green only because
`acorn-errors/acorn-errors.test.ts` sorts ahead of every test file that
imports `js-parser`.

Found while reviewing ticket 02. It already happens on HEAD, so no ticket in
this series caused it.

## Reproduce

Passing a spec on the command line loads it first (in addition to the
configured globs), so this runs the whole suite with sc2 first:

```sh
npx mocha --import=tsx server/src/test/passage-text-parsers/sugarcube/sc2/sc2-twinescript.test.ts
# 1190 passing, 37 failing — all in "Acorn Error Messages"
```

Minimal, isolated from `.mocharc.json`:

```sh
npx mocha --no-config --extension ts --import=tsx \
  server/src/test/passage-text-parsers/sugarcube/sc2/sc2-twinescript.test.ts \
  server/src/test/acorn-errors/acorn-errors.test.ts
```

A dummy test file that does nothing but `import "../js-parser";`, loaded
before the acorn-errors tests, reproduces the failure too. Loading the
acorn-errors tests first or on their own passes. So does loading
`js-parser.test.ts` first, because its first import is `acorn-errors`, which
starts the cycle from the other side.

## Cause

There is a circular import:

- `js-parser.ts:7` imports `./acorn-errors`
- `acorn-errors/index.ts` imports `./parse-failure`
- `acorn-errors/parse-failure.ts:3` imports `{ EcmaVersion } from "../js-parser"`

Mechanism, confirmed by temporary instrumentation (since reverted):

- Under mocha + tsx, `parse-failure.ts` is **evaluated twice** in the failing
  order: there are two module instances with the same URL, which is probably
  tsx's CJS/ESM dual loading. `js-parser.ts` is evaluated once.
- The instance the acorn-errors tests end up using is bound to a `js-parser`
  whose evaluation never completed from its point of view. So at call time,
  well after loading, reading `EcmaVersion` throws
  `ReferenceError: Cannot access 'EcmaVersion' before initialization`.
- `tokenize()` (`parse-failure.ts:~85–105`) wraps the tokenizer in a
  `try`/`catch` that keeps "whatever was produced before any lexical fault".
  So it swallows the `ReferenceError` and returns no tokens. Every
  token-based rule then misses, and the result falls back to Acorn's message.

A plain `tsx` script that imports sc2 first does **not** reproduce this. It
needs mocha's loading path. That is why it looks like test flakiness rather
than a bug, but the same cycle is present in the production server bundle.

## Work

1. Move `EcmaVersion` into a leaf module with no imports from this project
   (e.g. `server/src/ecma-version.ts`). Import it from `js-parser.ts` and
   `acorn-errors/parse-failure.ts`, and keep re-exporting it from `js-parser`
   if anything outside the two imports it from there.
2. Check nothing else in `acorn-errors/` imports from `js-parser`, so the
   directory stays a dependency of `js-parser`, never a dependent.
3. Narrow `tokenize()`'s `catch` so it only swallows Acorn `SyntaxError`s
   and rethrows anything else. That way a regression like this fails loudly
   instead of silently degrading messages.
4. **Required:** add a cycle guard, such as `import-x/no-cycle` in the ESLint
   config, or a test that imports `js-parser` before `acorn-errors`. A test
   depends on mocha's load order to mean anything, so the lint rule is the
   more reliable guard.

5. Move `ScopeEcmaVersion` (the numeric version eslint-scope needs, added by
   ticket 15) into the same leaf module, if 15 has landed.

## Not in scope

Changing the `EcmaVersion` value (ticket 04, closed).

## Done when

- `import-x/no-cycle` (or equivalent) is enabled for `server/src` and passes.
  The reproduction commands can't serve as the check (see the 2026-10-13
  comment).
- `tokenize()` rethrows anything that isn't an Acorn `SyntaxError`.
- `npm test` green.
- No import path from `server/src/acorn-errors/` back to `js-parser`.

## Comments

### Re-check (2026-10-13)

Both reproduction commands now **pass** on `improve-var-extraction`: 83 passing
with `--no-config`, and 1260 passing with the full config and sc2 loaded first.
The cause wasn't investigated. The cycle is still there
(`acorn-errors/parse-failure.ts:3` imports `EcmaVersion` from `../js-parser`),
and `tokenize()` still has a bare `catch {}` (line ~102), so the failure could
come back silently with a different load order or tsx version. The work is
unchanged, but the lint rule (item 4) is now the acceptance check instead of
the reproduction.

### Resolution (2026-10-14)

`EcmaVersion` moved to `server/src/ecma-version.ts`; `tokenize()` now rethrows
non-`SyntaxError`s. `import-x/no-cycle` is enabled for `server/src/acorn-errors/**`
and `ecma-version.ts` only: enabling it for all of `server/src` reports 75
pre-existing cycles (chapbook, parser, diagnostics, ...), which are out of scope.
Verified the rule fires when the old import is restored. Item 5 skipped: ticket 15
hasn't landed.

### Scope complete (ticket 20)

`import-x/no-cycle` now covers all non-test code in `server/src`; the narrow scope from this ticket is superseded.
