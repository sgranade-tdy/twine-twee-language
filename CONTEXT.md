# Context

Shared vocabulary for this repository. Use these terms as defined; don't drift to
the synonyms listed under _Avoid_.

This file is grown lazily — terms are added when a design decision actually
resolves them, not upfront.

## JavaScript error reporting

Twine passages embed JavaScript, which `server/src/js-parser.ts` parses with
Acorn. When parsing fails, `server/src/acorn-errors/` turns Acorn's
`SyntaxError` into something a Twine author can act on.

**Parse failure context**: the structured picture of a failed parse — source
text, Acorn's error, the parser state captured at `raise`, and a token stream.
Exposes _queries_ (`tokenBefore()`, `unclosedDelimiter()`) rather than raw
structures, so Acorn's internal representations stay behind one interface.
_Avoid_: "error info", "parse result".

**Parser state**: what Acorn's parser knows at the moment it raises — the failing
token, its span, and `this.context`, the open-delimiter stack. Captured by
subclassing `acorn.Parser` and overriding `raise`. See ADR-0001. Distinct from
the parse failure context, which is built _from_ it.

**Rule**: a pure function from a parse failure context to an improved diagnostic,
or `undefined` if it doesn't apply. Rules are nearly data: each recognizes one
shape of mistake and carries a _kind_ tag naming it.

**Arbitration**: choosing among the rules that matched. Picks the candidate whose
position is closest to, and not after, Acorn's reported error position, with rule
priority as the tiebreak. _Avoid_: "priority", "ranking" — those name only the
tiebreak, not the mechanism.

**Kind**: the internal tag a rule attaches to its diagnostic
(`unclosed-delimiter`, `incomplete-expression`, …). Internal on purpose: it is
_not_ a `DiagnosticCode`, because diagnostic codes are user-disableable and a
per-error taxonomy would let users silence individual syntax errors.

**Repair marker**: how `acorn-loose` signals a place it had to patch over — a
`✖` identifier, a zero-width dummy node, a synthetic token. Named here mainly so
ADR-0002's rejection of them as a diagnostic signal is legible.

**Span**: a start and end offset delimiting the text a diagnostic refers to.
Replaces the older `{contents, at}` pair, where `contents` was only ever consumed
for its `.length`.

## Diagnostics

**Diagnostic code**: a member of `DiagnosticCodes`, with default message and
severity in `DiagnosticMetadata` (`server/src/diagnostics.ts`). User-facing and
individually disableable — which is why codes stay coarse.
