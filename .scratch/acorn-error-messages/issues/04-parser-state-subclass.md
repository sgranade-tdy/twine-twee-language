# 04 — Capture Acorn parser state via a `Parser` subclass

Type: task
Status: closed
Blocked by: 03

Implements ADR-0001. Supplies the parse failure context (phase 05) with the
information Acorn's message throws away.

## Work

Add `server/src/acorn-errors/parser-state.ts`: a subclass of `acorn.Parser` that
overrides `raise` to attach a `parserState` payload to the thrown `SyntaxError`
before rethrowing. Capture:

- `this.type` and `this.value` — the failing token
- `this.start` / `this.end` — its exact span
- `this.lastTokEnd`
- `this.context` — the open-delimiter stack (`node_modules/acorn/dist/acorn.js:576`)

`parseJSStrict` (`server/src/js-parser.ts:967`) constructs through the subclass
unconditionally, so all three call sites get it —
`js-parser.ts:1000`, `chapbook-parser.ts:629`, `sc2-twinescript.ts:192`. The
override only fires on `raise`, so successful parses are unaffected.

Also declare `raisedAt` on the error type in `improveAcornErrorMessage`'s
signature; Acorn sets it (`:3813`) but the current inline type omits it.

## Graceful degradation

If `this.context` is absent or misshapen, attach no `parserState`. Rules fall
back to the token stream. The `^8.11.3` caret range in `server/package.json`
stays.

## Canary test — load-bearing

Degradation is silent by construction, so a test must make an Acorn upgrade
loud. Assert the measured shapes:

- `foo(` raises with `context: ["{", "("]`
- `a b c` raises with `type.label === "name"`, `value === "b"`, `start..end` `2..3`
- `{a: }` raises with `type.label === "}"`, `start..end` `4..5`

The assertion message must name the cause and the remediation — something like
"Acorn's parser internals changed shape; see `acorn-errors/parser-state.ts` and
ADR-0001" — so a future upgrade produces a red build that explains itself.

## Note

The expected token is not obtainable. `pp$9.expect` is
`this.eat(type) || this.unexpected()` (`:816`) and drops `type` before raising.
Don't spend time trying to recover it.

## Done when

- Errors from all three `parseJSStrict` call sites carry `parserState`.
- The canary passes and fails informatively when the captured shape changes.
- Missing or malformed `this.context` degrades without throwing.
- `npm test` is green.
