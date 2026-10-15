# 07 — Fallback span and the EOF case

Type: task
Status: closed
Blocked by: 06

Fixes the most common outcome: no rule matches, and the user gets a zero-width
squiggle carrying Acorn's bare text.

## Fallback span

When no rule matches, fall back in this order:

1. **The failing token's own `start`/`end`**, from the parse failure context.
2. `[err.pos, err.raisedAt]`, clamped — reject when the two are equal, and reject
   when the range crosses a newline.
3. Zero-width at `err.pos`.

`[pos, raisedAt]` can't be the primary choice. Measured:

| Input | pos | raisedAt | Result |
| --- | --- | --- | --- |
| `a b c` | 2 | 3 | `b` — correct |
| `try{}` | 0 | 5 | the whole statement — far too wide |
| `x=1;\n\n\n\nreturn` | 8 | 14 | spans blank lines |
| `if(a){` | 6 | 6 | empty |
| `x = 1 @ y` | 6 | 6 | empty |
| `1_` | 1 | 1 | empty |

`pos` isn't reliably a token start either — Acorn's call sites variously pass
`this.pos`, `this.lastTokEnd`, and `node.start`. The failing token's span is
correct by construction instead of by heuristic.

## EOF

When Acorn fails at end of input, the failing token is `eof` and its span is
zero-width at the very end of the text. Underline the **unclosed delimiter**
instead — phase 04's `parserState.context` says exactly which construct is still
open (`if(a){` gives `["{", "("]`). Fall back to the last non-whitespace
character before EOF if no delimiter is open.

This is the single biggest practical win in the effort. A truncated passage is
the common Twine authoring mistake, and today it produces a zero-width squiggle
at the end of the passage with the message "Unexpected token".

Phase 06's hard-wired EOF precedence is what routes these here rather than
letting a nearer rule win on proximity.

## Done when

- No unmatched error produces a zero-width squiggle when a token span is
  available.
- `if(a){`, `foo(`, and `[1,2` all point at the unclosed delimiter.
- The phase 01 table rows for the generic-message sweep all assert meaningful
  spans.
- `npm test` is green.
