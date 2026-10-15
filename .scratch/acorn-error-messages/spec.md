# Improving Acorn error messages

## Problem

`server/src/acorn-errors.ts` post-processes Acorn's `SyntaxError` into a friendlier
diagnostic. It works, but it is limited by its inputs: it sees only the raw source
text and `err.pos`, and it sniffs the last non-blank line before the error with
regexes. That produces four concrete problems.

1. **Positions are wrong.** `findUnmatchedDelimiter` increments its index at the
   bottom of the loop, but every `continue` path (escape, backslash, in-string
   character, quote-open) skips it. Any string or escape before the delimiter
   shifts the reported position left.
2. **One stray delimiter masks everything.** The delimiter scan runs first and
   short-circuits, so an unclosed `(` anywhere in the text suppresses every
   specific rule. The scan also runs over the whole text, past the error, and
   returns `undefined` on a mismatched close (`(]`) rather than reporting it.
3. **Only one line of context is visible.** Multi-line constructs are invisible to
   every rule.
4. **The most common failure produces the least information.** Acorn has three
   generic messages — `Unexpected token`, `Unexpected character '<c>'`,
   `Unexpected keyword '<k>'` — and they dominate real failures. When no rule
   matches, the diagnostic is a zero-width squiggle carrying Acorn's bare text.

## Goals, in priority order

1. **Precision** — the squiggle covers the right characters.
2. **Actionability** — each error carries a machine-readable kind, so quick fixes
   can be built on it later.
3. **Coverage** — more of Acorn's message catalog is improved.
4. **Phrasing** — plain language in place of parser jargon.

## Non-goals

- Quick fixes / code actions. Deliberately a later effort; this one only lays the
  groundwork by tagging each diagnostic with a kind.
- Related diagnostic information ("the matching `{` is here"). `createDiagnostic`
  (`server/src/diagnostics.ts:357`) cannot carry it, and widening that is its own
  change.
- Splitting `DiagnosticCodes.IncorrectJavaScript` into per-error codes. Codes are
  user-disableable, so a fine-grained taxonomy hands users a menu for silencing
  individual syntax errors one at a time.
- Story-format-specific wording. `acorn-errors/` stays a pure JavaScript module;
  Chapbook and SugarCube knowledge stays on the caller's side of the seam.

## Audience

Twine authors, who are often not JavaScript programmers and whose JavaScript is a
fragment embedded in passage markup. Messages use JavaScript vocabulary — the
module cannot know about story formats — but plain JavaScript vocabulary, not
parser-implementer vocabulary.

## Design

### Module layout

`server/src/acorn-errors.ts` becomes `server/src/acorn-errors/`:

| File | Responsibility |
| --- | --- |
| `parser-state.ts` | `acorn.Parser` subclass that captures raise-time parser state |
| `parse-failure.ts` | The parse failure context: a deep module exposing queries |
| `rules.ts` | Flat list of pure rules over the context |
| `dejargon.ts` | String-to-string rewrite table for Acorn's jargon-heavy messages |
| `index.ts` | Arbitration plus the public interface |

### Parser state

Acorn routes every parser error through one choke point
(`node_modules/acorn/dist/acorn.js:3807`):

```js
pp$4.raise = function(pos, message) {
  ...
  err.pos = pos; err.loc = loc; err.raisedAt = this.pos;
  throw err
};
```

`Parser` is publicly subclassable and `raise` is a plain prototype method, so an
override can read the parser state that the message discards — `this.type`,
`this.value`, `this.start`/`this.end`, `this.lastTokEnd`, and above all
`this.context` (`:576`), the open-delimiter stack. Measured: `foo(` yields
`context: ["{", "("]`.

The expected token is *not* recoverable. `expect()` is
`this.eat(type) || this.unexpected()` (`:816`) — it drops `type` before raising.
So `"'}' expected"`-style messages are off the table without forking Acorn.

See [ADR-0001](../../docs/adr/0001-subclass-acorn-parser-for-error-context.md).

### The parse failure context

`parse-failure.ts` is the deep module. It takes the source text, the error, the
captured parser state, and (as fallback) a token stream, and exposes **queries**
rather than data: `tokenBefore()`, `unclosedDelimiter()`, and so on. Rules ask
questions; they never walk Acorn's token or context structures themselves, so
Acorn's internal representations stay behind one interface.

Queries are added one at a time, each driven by a rule that actually needs it.

Acorn's *loose* parser is not part of the context. See
[ADR-0002](../../docs/adr/0002-no-loose-ast-as-error-signal.md).

Tokenizing is the fallback when parser state is absent, which happens for purely
lexical faults. `acorn.tokenizer()` throws from `getToken()` on a lexical fault
but the tokens produced before the throw are retained, so the context builder
collects what it can and stops at the first failure.

### Rules and arbitration

Each rule is a pure `(ctx) => Improvement | undefined` carrying a kind tag:

`unterminated-string`, `unclosed-delimiter`, `mismatched-delimiter`,
`missing-property`, `incomplete-expression`, `missing-property-value`,
`missing-control-parens`, `missing-catch-block`, `unknown`.

The tag is internal. It does not become a `DiagnosticCode`; it exists so that a
later quick-fix effort has something to dispatch on, and so the rule inventory —
and therefore the coverage gaps — is legible in one place.

**Arbitration** picks the candidate whose reported position is closest to, and not
after, `err.pos`, with explicit rule priority as the tiebreak. Acorn's own
position is the one piece of ground truth available, so distance to it is an
objective arbiter that needs no per-rule confidence calibration.

**One exception, hard-wired:** when the failing token is `eof` and the parser
context shows an open delimiter, the unclosed-delimiter rule wins outright. At
EOF, `err.pos` means only "the text ran out" — it carries no signal about where
the problem is — so proximity to it would measure nothing. This precedence must
be commented as to why.

### Spans

`JSDiagnostic.contents` is a length wearing a disguise: `createDiagnosticFor`
(`server/src/diagnostics.ts:412`) does `createDiagnostic(code, at, at + text.length, ...)`
and discards the string. It becomes a real span.

`improveAcornErrorMessage` takes the document offset as a parameter and returns
document-relative positions. That deletes `js-parser.ts:1119`'s
`tokenized.error.at += offset` and, with it, the entire class of bug where a new
position field is added and someone forgets to rebase it.

When no rule matches, the span falls back through: the failing token's own
`start`/`end` → `[pos, raisedAt]` clamped → zero-width. `[pos, raisedAt]` cannot
be the primary choice; measured, it is frequently zero-width (`if(a){` → `6,6`;
`x = 1 @ y` → `6,6`) and sometimes enormous (`try{}` → `0,5`, the whole
statement). `pos` is not reliably a token start either — call sites pass
`this.pos`, `this.lastTokEnd`, and `node.start`.

The unterminated-string and unterminated-template path keeps its early return.
It is a lexical failure, so parser state is genuinely absent, and the existing
extraction already handles line continuations.

### Message style

- Plain language; state what is wrong and name the offending construct.
- Sentence case, no trailing period.
- Prefer "missing" and "incomplete" over "unexpected".
- Prefer "invalid" over "illegal", and avoid parser vocabulary generally —
  "rvalue", "binding", "unsyntactic" mean nothing to a Twine author.
- Do not append a mandatory "what to do" clause. Many errors have no single
  obvious fix, and forcing one produces filler.

Existing message text is free to change; the assertions in `js-parser.test.ts`
get updated along with it.

### Testing

A new `server/src/test/acorn-errors.test.ts`, table-driven: an array of
`{input, expectedMessage, expectedStart, expectedEnd}` literals asserted in a
loop. No snapshot library — the repo has none, and a hand-edited table makes each
message change a deliberate line in the diff, where an auto-updating snapshot
would launder regressions.

The corpus is: the existing Chapbook and SugarCube broken-JS fixtures, plus
hand-written typos, plus a systematic sweep of inputs that produce each of the
three generic messages — `a b c`, `{a: }`, `foo(`, `[1,2`, `catch `, `try{}`,
`if(a){`, `x = 1 @ y`, `1_`.

Tests exercise the public interface, since arbitration — which rule wins — is
only observable there. The context builder's queries get direct tests of their
own, because they are the deep part.

## Phases

Land in this order. Each is a separate issue under `issues/`.

| # | Phase | Why here |
| --- | --- | --- |
| 01 | Baseline tests | Must be first and absolute: without a record of today's behaviour, including its bugs, improvement is indistinguishable from regression |
| 02 | `dejargon.ts` | Independent, zero risk, immediate user-visible value, and an easy first exercise of the new harness |
| 03 | Span + document offset | Enabling interface change for everything after it |
| 04 | Parser subclass + canary | Supplies the context builder's best input |
| 05 | Parse failure context | The deep module |
| 06 | Rules + arbitration | Ports the rules, deletes `findUnmatchedDelimiter` |
| 07 | Fallback and EOF spans | Depends on the token information from 04 |
