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

**Story variable**: a name that holds story state the author controls. How a
story variable is spelled depends on the code it appears in. In expression code
(macro arguments, vars sections), a name unbound within the snippet is a story
variable; see ADR-0003. In script code (Story JavaScript, `script` passages,
script blocks, story script files, included scripts), a story variable is
reached only through the format's state API (SugarCube `State.variables.x`,
Chapbook `engine.state.get('x')`). The one exception is Chapbook, where a bare
name also counts if the project already defines that variable. _Avoid_:
"global", which names the heuristic rather than the thing.

**Sigil**: the leading character of a SugarCube variable name in twee: `$` for a
story variable kept in story state, `_` for a temporary variable cleared on each
passage. The sigil picks the store, so it's part of the variable's identity, not
its spelling. Script code reaches the same stores through different state roots
and doesn't write the sigil (except inside `getVar`/`setVar` strings).

**Conditional reference**: a bare name in Chapbook script code that refers to a
story variable only when the project sets that variable elsewhere and no
root-level declaration in Story JavaScript binds it. Whether it counts can change
when other files change, without the name itself changing. _Avoid_: "candidate".

**State root**: an expression the story format provides that reaches story state
from script code: SugarCube `State.variables`, `State.temporary`, `variables()`,
`temporary()`, `SugarCube.State.*`, `getVar`/`setVar`, and Chapbook
`engine.state`. A binding that is initialized to a state root and never
reassigned is also a state root. _Avoid_: "accessor", "prefix".

**Host global**: a global the browser or a bundled library provides (`document`,
`location`, `$`), as opposed to JavaScript's own globals (`Math`, `parseInt`).
`js-parser.ts` always excludes JavaScript's globals from story variables. Each
story format decides which host globals to exclude, because the answer depends
on how the format spells story variables. SugarCube's sigils can't collide with
a host global, but Chapbook's bare names can (`location`, `history`).

**Story-format built-in**: a name the story format itself provides (`State`,
`setup`, SugarCube's `either()` and `visited()`). Not a host global. Per ADR-0003
the story-format parser decides which ones aren't story variables; it may hand
some to `js-parser.ts` in the same exclusion set as its host globals.

**Story script file**: a `.js` file matched by the project's `storySourceFiles`
(and not by `ignores`), compiled into the built story as Story JavaScript. Treated
as a `script`-tagged passage that happens to live in its own file. _Avoid_:
"external JS", "local JS".

**Included script**: a `.js` file under the project's `includeSourcePaths` (and
not matched by `ignores`), copied alongside the built story. It runs only if
something loads it at runtime, such as SugarCube's `importScripts()`. _Avoid_:
"external JS", "local JS".

**Story property**: a member reached from a story variable, carried with the full
dotted path that reaches it (`prefix` + name). A property whose path can't be
spelled isn't a story property at all.

**Occurrence**: one appearance of a story variable or property at one location.
Every occurrence is indexed; the same name occurring five times is five
occurrences, because rename must rewrite all of them.

**Callee**: an occurrence of a story property that is the function being called,
by a call or `new` (`push` in `$arr.push(x)`). Callee-ness belongs to the
occurrence, not the name: `$quest.find(x)` and a bare `$quest.find` read are
indexed separately, so diagnostics can treat them differently.

**Built-in JS property**: a story property whose last path segment names
something every JavaScript value of some type already has, so a never-set
warning would be a false positive. Two kinds: **instance properties**
(`length`, `constructor`), exempt in any position; and **method names**
(`push`, `map`, `keys`), exempt only on a callee. Names an author would
naturally choose for their own data (`name`, `description`, `size`) are
deliberately left out, even though built-ins have them. Distinct from a host
global or story-format built-in, which are bare names, not properties.

**Assignment**: an occurrence the parser _counts_ as writing the name (`$x = 1`,
`$x.y = 1`), as evidence that the story variable gets set. Twine variables are
never declared, so this is the only creation signal the parser has. Three things
count: write-shaped syntax inside an **assignment context**, and occurrences a
story format forces to be writes (the Chapbook vars section, SugarCube receivers,
`setVar`, `engine.state.set`). A write the parser doesn't count,
such as `<<print $x = 1>>`, is a read. _Avoid_: "definition", which implies a
declaration site that Twine JavaScript doesn't have.

**Assignment context**: a construct whose purpose is to set state (`<<set>>`,
`<<run>>`, a setter link), so write-shaped syntax inside it (`=`, `++`/`--`,
destructuring and `for` targets) counts as an assignment. Outside one, an
assignment is more often a `==` typo or a side effect buried in a read, so the
parser under-reports. _SugarCube code calls this a setter context._

**Declaration**: a JavaScript binding form: `var`/`let`/`const`, `function` or
`class`. Every story format keeps declarations out of story state, so a
declared name is never a story variable, even at the root of a script.

**Resolvable chain**: a member expression whose every segment has a statically
known name, rooted in an identifier. `$a.b['c']` is resolvable; `$a().b` and
everything after a computed segment in `$a[i].b` are not. Unresolvable segments
are dropped rather than guessed at, because a property indexed under the wrong
prefix renames the wrong thing.

## Diagnostics

**Diagnostic code**: a member of `DiagnosticCodes`, with default message and
severity in `DiagnosticMetadata` (`server/src/diagnostics.ts`). User-facing and
individually disableable — which is why codes stay coarse.

## Workspace files

**Resolved file sets**: the three URI lists the client resolves from the
project's configuration: Twee files, story script files and included scripts
(`ProjectFiles` in code). The server re-resolves them on every workspace index
and after a file is created. A watcher event matters only if its URI is in one
of the sets (or, for a delete, in the index), so ignored files stay out of the
index. _Avoid_: "project files", which suggests every file in the folder.
