# ADR-0002: Don't use the loose AST as an error signal

- **Status**: Accepted
- **Date**: 2026-09-04

## Context

`parseJS` already falls back to `acorn-loose` whenever strict parsing fails, so a
repaired AST is available on every error path at no additional cost. `acorn-loose`
marks its repairs — `dummyValue = "✖"` identifiers, zero-width dummy nodes where
`node.end === node.start`, synthetic tokens substituted for unterminated strings.

That looks like a principled "what did the parser expect here?" signal, and a
much better basis for improved messages than regex-sniffing the last non-blank
line of source. The initial design assumed we would use it, and take the small
reordering cost in `parseJS` needed to build the loose AST before improving the
error.

## Decision

Don't. The parse failure context takes source text, the error, captured parser
state, and a token stream. No loose AST. `parseJS` keeps its current ordering.

## Rationale

Measured, `acorn-loose`'s repair markers appear in exactly the cases we already
handle and are absent in exactly the cases we care about.

| Input | Loose repair marker | Notes |
| --- | --- | --- |
| `foo.` | `Identifier@4-4` | Already covered by an existing rule |
| `1 +` | `Identifier@3-3` | Already covered |
| `if ` | `Identifier@3-3` | Already covered |
| `let x = ` | present | Already covered |
| `foo(` | **none** | Yields a complete `CallExpression@0-4`, `arguments: []` |
| `[1,2` | **none** | Yields a complete `ArrayExpression` |
| `{a: }` | **none** | |
| `catch ` | **none** | |

Unclosed delimiters — the case with the worst current diagnostics and the most
common in real Twine passages — are closed *silently*. `acorn-loose`'s `expect()`
skips up to two tokens to resynchronize and leaves no marker at all.

So the loose AST would duplicate the coverage of rules that already exist, add
nothing where coverage is missing, and cost an interface: a `looseNodeAt()` query
with no rule behind it, plus a reordering of `parseJS`. Under
"one adapter means a hypothetical seam", that is a seam with nothing varying
across it.

ADR-0001's parser state supersedes it in any case: `this.context` gives the
open-delimiter stack directly, which is precisely the signal the loose AST
destroys.

## Consequences

The missing-operand rules (`foo.`, `1 +`, `if `) stay pattern-based, but they now
match against a real token stream from the parse failure context rather than a
raw line of text, which is what fixes their multi-line blindness.

`acorn-loose` remains in use for its actual purpose — producing a walkable AST so
that tokenizing and symbol collection still work on broken input. Only its use as
a *diagnostic* signal is rejected.

The parse failure context's interface is left able to accept a loose AST later,
should a rule appear that genuinely needs one. Nothing here forecloses that; it
just declines to build the seam before there is something to put behind it.
