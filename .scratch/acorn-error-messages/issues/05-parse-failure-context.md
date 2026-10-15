# 05 — The parse failure context

Type: task
Status: closed
Blocked by: 04

The deep module of this effort. Absorbs tokenizing, delimiter tracking, and
parser-state correlation behind a small interface, so that every rule in phase 06
becomes a trivial pure function.

## Work

Add `server/src/acorn-errors/parse-failure.ts`. It takes the source text, the
error, the captured `parserState` (phase 04), and a token stream, and exposes
**queries** — not fields:

- `tokenBefore()` — the token preceding the failure
- `failingToken()` — the token at the failure, with its span
- `unclosedDelimiter()` — the innermost delimiter still open at the failure, from
  `parserState.context`, or from the token-stream fallback
- `isAtEof()`
- `textBefore()` / line access for the pattern-based rules

Add queries **one at a time**, each driven by a rule in phase 06 that actually
needs it. A query with no rule behind it is a hypothetical seam.

Rules must never walk Acorn's token or context structures directly. That is the
whole point: Acorn's internal representations are undocumented and can shift, and
this interface is the one place that has to absorb the shift.

## Token-stream fallback

When `parserState` is absent — purely lexical faults — fall back to tokenizing:

```js
const t = acorn.tokenizer(src, { ecmaVersion: 2020 });
const tokens = []; let err = null;
try {
  for (;;) { const tk = t.getToken(); if (tk.type === acorn.tokTypes.eof) break; tokens.push(tk); }
} catch (e) { err = e; }
```

`getToken()` throws on a lexical fault, but tokens produced before the throw are
retained. Tokenizing is strictly lexical, so `foo( bar` tokenizes cleanly to EOF —
only lexical faults throw.

## Delimiter scanning

The scan stops at `err.pos`. Delimiters after the failure are unreliable: Acorn
stopped parsing there, and the tokenizer may itself go wrong past that point.

## Not in scope

The `acorn-loose` AST. See ADR-0002 — it produces zero repair markers for exactly
the cases we care about (`foo(`, `[1,2`, `{a: }`, `catch `). Leave the interface
able to accept one later; don't build the seam now.

## Testing

The queries get direct tests — they're the deep part, and the only part where
testing past the top-level interface is justified.

## Done when

- Every query has a direct test.
- No rule (phase 06) touches an Acorn token or context object directly.
- `npm test` is green.

## Comments

Implemented as `ParseFailure` in `server/src/acorn-errors/parse-failure.ts`,
with direct tests in `server/src/test/parse-failure.test.ts`. Queries shipped:
`failingToken()`, `tokenBefore()`, `unclosedDelimiter()`, `isAtEof()`,
`textBefore()`, `lineBefore()`. Nothing beyond the five the ticket named.

Measured while building it, and worth knowing in phase 06:

- Acorn's `context` stack tracks `(`, `{`, and templates, but **not** `[`.
  `[1,2` raises with `context: ["{"]` — the base frame only. So the context
  can't be the positional source of truth, and can't veto a bracket.
- Acorn updates its context when it *reads* a token, not when it consumes one.
  `{a: }` fails at the `}` with the brace already popped. That makes the
  context an accurate "is this really still open?" oracle, which the pure
  character/token scan is not.
- So `unclosedDelimiter()` gets positions from the token stream and uses the
  context to corroborate, matching by delimiter label from the innermost
  outward. `f({a: }` correctly reports the `(`, not the already-matched `{`.
- `acorn.Token` carries `value` at runtime but not in `acorn.d.ts`; the cast
  is confined to `toFailureToken`.

### Review follow-ups (fixed here)

- Template frames (`` ` ``, `${`) are on Acorn's context stack but have no
  bracket-token counterpart. Correlating against one vetoed every entry the
  token scan found, so ``foo(`abc`` reported no unclosed delimiter at all.
  Template frames now take no part in the correlation.
- A lexical fault (`foo('abc`) raises from inside the tokenizer, so the parser
  state's token fields describe the *previous* token at the *current*
  position — a zero-width non-`eof` token. `failingToken()` discards that
  rather than reporting a bogus token; the context stack, which is still
  valid, keeps working.
- `tokenBefore()` now uses `parserState.lastTokEnd` when it's available.
  `err.pos` is not reliably a token boundary — `try{}` raises at position 0.

### Open tension for phase 06

ADR-0002's Consequences say the missing-operand rules "now match against a real
token stream from the parse failure context rather than a raw line of text".
This ticket asked for `textBefore()` / line access, and both shipped. Every rule
in phase 06's inventory looks expressible via `tokenBefore()` / `failingToken()`
instead. Phase 06 should prefer the token queries and delete `textBefore()` and
`lineBefore()` if nothing ends up needing them.
