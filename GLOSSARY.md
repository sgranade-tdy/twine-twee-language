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

## JavaScript symbol extraction

The other half of `server/src/js-parser.ts`: finding the names in a passage's
JavaScript that belong to the _story_, so they can be indexed, cross-referenced
and renamed.

**Story variable**: a name in a passage's JavaScript that holds story state the
author controls. Recognized by being unbound within the snippet the parser was
handed — see ADR-0003 — not by any list of known names. _Avoid_: "global", which
names the heuristic rather than the thing.

**Story property**: a member reached from a story variable, carried with the full
dotted path that reaches it (`prefix` + name). A property whose path can't be
spelled isn't a story property at all.

**Occurrence**: one appearance of a story variable or property at one location.
Every occurrence is indexed; the same name occurring five times is five
occurrences, because rename must rewrite all of them.

**Assignment**: an occurrence that _writes_ the name (`$x = 1`, `$x.y = 1`).
Twine variables are never declared, so this is the only creation signal the
parser has — which is why the story formats can force it on for constructs they
know are writes (`<<set>>`, a setter link, a Chapbook vars section). _Avoid_:
"definition", which implies a declaration site that Twine JavaScript doesn't
have.

**Declaration**: a JavaScript binding form — `var`/`let`/`const`, `function`,
`class`. Unambiguous where an assignment isn't, so a root-level declaration is an
assignment regardless of what the caller asked for.

**Resolvable chain**: a member expression whose every segment has a statically
known name, rooted in an identifier. `$a.b['c']` is resolvable; `$a().b` and
everything after a computed segment in `$a[i].b` are not. Unresolvable segments
are dropped rather than guessed at, because a property indexed under the wrong
prefix renames the wrong thing.

## Diagnostics

**Diagnostic code**: a member of `DiagnosticCodes`, with default message and
severity in `DiagnosticMetadata` (`server/src/diagnostics.ts`). User-facing and
individually disableable — which is why codes stay coarse.
