# 06 — Port the rules; add arbitration; delete `findUnmatchedDelimiter`

Type: task
Status: closed
Blocked by: 05

Turns the if-chain in `acorn-errors.ts` into a flat rule list over the parse
failure context, with an explicit arbiter.

## Work

Add `server/src/acorn-errors/rules.ts` and `server/src/acorn-errors/index.ts`.
Each rule is a pure `(ctx) => Improvement | undefined` carrying a kind tag.

Initial rule inventory, one tag each:

| Kind | Recognizes |
| --- | --- |
| `unterminated-string` | Unterminated string or template |
| `unclosed-delimiter` | An opening delimiter with no match |
| `mismatched-delimiter` | A closing delimiter that doesn't match the open one |
| `missing-property` | `foo.` or `foo?.` with nothing after |
| `incomplete-expression` | Trailing operator, `foo +` |
| `missing-property-value` | `foo:` with nothing after |
| `missing-control-parens` | `if` / `for` / `while` / `switch` without `(` |
| `missing-catch-block` | `catch` without `{` |
| `unknown` | Fallback |

The tag is internal. It does **not** become a `DiagnosticCode` — codes are
user-disableable, and a per-error taxonomy would hand users a menu for silencing
individual syntax errors. It exists so a later quick-fix effort has something to
dispatch on, and so the coverage gaps are legible in one place.

Also add the espree-style fallback: append the offending source slice to Acorn's
bare messages, so `Unexpected token` becomes `Unexpected token 'b'`. The failing
token is already in the context. (Espree does exactly this in its own `unexpected`
override.)

## Arbitration

Among matching rules, pick the candidate whose position is closest to, and not
after, `err.pos`. Explicit rule priority is the tiebreak. Acorn's position is the
only ground truth available, so distance to it is an objective arbiter that
doesn't require every future rule author to invent and calibrate a confidence
score against rules they've never read.

**One hard-wired exception:** when the failing token is `eof` and the context
shows an open delimiter, the unclosed-delimiter rule wins outright, bypassing
proximity. At EOF, `err.pos` means only "the text ran out" and carries no signal
about where the problem is, so measuring distance to it is meaningless. Comment
this precedence with the reason.

## Deletions

- `findUnmatchedDelimiter` goes entirely. The delimiter stack now comes from
  parser state or the token stream, which handles comments, regex literals, and
  template `${}` correctly — all things the character-walking scanner got wrong,
  on top of its index-drift bug.
- Report **mismatched** closes (`(]`) instead of the current silent
  `return undefined`.

## Kept as-is

The unterminated-string/template early return, before everything else. It's a
lexical failure, so parser state is genuinely absent, and the existing
`extractUnterminatedString` already handles line continuations. It stays first
and it stays special-cased.

## Message rewording

Existing message text is free to change; update the assertions in
`js-parser.test.ts:1236-1475`. Follow the style rules in phase 02.

## Done when

- `acorn-errors.ts` is gone, replaced by the directory.
- Every rule has a kind tag and a row in the phase 01 table.
- A stray `(` no longer masks a more specific message.
- `npm test` is green.
