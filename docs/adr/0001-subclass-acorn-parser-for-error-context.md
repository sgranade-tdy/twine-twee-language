# ADR-0001: Subclass Acorn's `Parser` to capture error context

- **Status**: Accepted
- **Date**: 2026-09-04

## Context

Acorn's syntax errors carry very little. Every parser error goes through one
choke point (`node_modules/acorn/dist/acorn.js:3807`):

```js
pp$4.raise = function(pos, message) {
  var loc = getLineInfo(this.input, pos);
  message += " (" + loc.line + ":" + loc.column + ")";
  ...
  var err = new SyntaxError(message);
  err.pos = pos; err.loc = loc; err.raisedAt = this.pos;
  throw err
};
```

That is `pos`, `loc`, `raisedAt`, and a string. Three of Acorn's messages —
`Unexpected token`, `Unexpected character '<c>'`, `Unexpected keyword '<k>'` —
account for the great majority of real failures, and none of them say what was
open, what was expected, or what token was actually found.

Meanwhile, at the moment `raise` fires, the parser knows a great deal:
`this.type` and `this.value` (the failing token), `this.start`/`this.end` (its
exact span), `this.lastTokEnd`, and `this.context` (`:576`) — the open-delimiter
stack. Measured, `foo(` raises with `context: ["{", "("]`.

Reconstructing that from outside means re-tokenizing the text and maintaining our
own delimiter stack. The current code does a character-level version of this in
`findUnmatchedDelimiter`, and it is wrong in several ways: its index does not
advance on escape or in-string paths, so positions drift; and it has no concept
of comments, regex literals, or template `${}` interpolation.

## Decision

Subclass `acorn.Parser`, override `raise`, and attach the parser state to the
thrown error as a `parserState` payload. `parseJSStrict` constructs through the
subclass unconditionally, so all three of its call sites benefit.

`acorn.Parser` is public API and `raise` is a plain prototype method, so this is
not a fork or a patch. Espree — ESLint's parser — does the same thing to append
the offending source slice to Acorn's messages.

The subclass **degrades gracefully**: if `this.context` is absent or misshapen, it
attaches no `parserState` and rules fall back to the token stream. The `^8.11.3`
caret range in `server/package.json` stays.

Because graceful degradation is silent by construction, a **canary test** asserts
the measured shape — `foo(` must yield `context: ["{", "("]`. Its failure message
names the cause and the remediation, so an Acorn upgrade produces a red build
that explains itself rather than a mystery.

## Consequences

**Good.** `unclosedDelimiter()` becomes near-trivial and correct by construction,
rather than a re-implementation of Acorn's lexical rules that we would have to
keep in sync forever. The failing token's exact span is available, which is what
makes the fallback span policy possible at all. EOF errors — the most common
Twine authoring mistake, a truncated passage — can point at the construct left
open instead of at the end of the text.

**Bad.** `this.context` and `this.type` are undocumented internals. A minor Acorn
release can reshape them, and the caret range means that can arrive without a
deliberate upgrade. The canary is the mitigation, and it is load-bearing: without
it, this decision silently rots.

**Not obtained.** The expected token remains unrecoverable even from inside the
subclass. `pp$9.expect` is `this.eat(type) || this.unexpected()` (`:816`) — it
drops `type` on the floor before raising. TypeScript-style `"'}' expected"`
messages would require actually forking Acorn, which we are not doing.

## Alternatives considered

- **Re-tokenize with `acorn.tokenizer()` and track our own delimiter stack.**
  Retained as the *fallback* for lexical faults, where parser state is absent.
  Rejected as the primary mechanism: it duplicates lexical logic we would have to
  maintain against Acorn's, for a strictly worse result.
- **Fork or monkey-patch Acorn.** Higher maintenance cost than subclassing, with
  no additional information gained — the expected-token set is destroyed before
  `raise` is reached, so even a fork would have to change `expect` itself.
- **Swap parsers.** `meriyah` gives better messages for some inputs
  (`"Dot property must be an identifier"`, `"Expected '('"`) and `@babel/parser`
  has error recovery with `expected` details, but both would mean changing the
  AST that the rest of `js-parser.ts` walks. Far too large a change for the
  benefit.
