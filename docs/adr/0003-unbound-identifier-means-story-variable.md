# An identifier unbound within its snippet is a story variable

Status: accepted

Twine story formats give authors variables that live in engine state, but in the
JavaScript embedded in a passage those are just bare identifiers — there is no
declaration, no import, and no type information to distinguish `$player` from a
local loop counter. `js-parser.ts` therefore treats an identifier as a **story
variable** exactly when nothing inside the snippet it was handed binds it: no
enclosing `var`/`let`/`const`, parameter, `function`, `class`, `catch` param or
loop head. Anything bound within the snippet is the author's own scratch space
and is deliberately not indexed.

This is worth recording because a reader will reasonably expect real scope
analysis and find something weaker. The alternatives were worse: a list of known
story-format globals can't see author-defined state at all, and treating every
identifier as a story variable would fill the index with loop counters and
parameters. The cost is that the heuristic is only as good as the set of binders
we implement — a missing binder silently promotes a local to story state — so
binder coverage is a correctness concern, not a nicety.

It also sets the seam: `js-parser.ts` knows only JavaScript. Which names are
_story-format_ built-ins (`State`, `setup`, `_args`) is decided downstream, by
the Chapbook and SugarCube parsers.
