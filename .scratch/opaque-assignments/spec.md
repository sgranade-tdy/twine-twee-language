# Silencing never-set warnings on values of unknown shape

## Problem Statement

`variable-never-set` warns on a story property unless some counted assignment
writes that exact dotted path. The only way a value contributes property writes
is an object literal (`$o to {a: 1}` writes `$o.a`). There is no value or
return-type inference. So any property read on a value the parser can't see
into is a false positive:

```
<<set _r to javaScriptFunction()>>
<<if _r.isError>>   ← warns today
```

This predates `.js` tracking (`setup.fn` in Story JavaScript has always done
it). Indexing story script files and included scripts just makes it more
common.

### Noise catalogue

All but one share a root cause: a story variable takes its value from an
expression whose shape is invisible to the parser.

1. **Call results**: `fn()`, `setup.make()`, `$arr.find(…)`, `JSON.parse(…)`,
   `clone($q)`, `Object.assign(…)`.
2. **Aliases**: `<<set _p to $player>>` then `_p.hp`; `_a to $arr[0]`;
   `$x to setup.items.sword`.
3. **Iteration**: `<<for _item range $list>>` then `_item.name`.
4. **Constructed objects**: `new setup.Player()` (fields set via `this.hp`);
   `new Date()` then `$d.getFullYear()`.
5. **Spread**: `{...$base, a: 1}`.
6. **Format-supplied values**: SugarCube receivers (`<<listbox>>`, `<<cycle>>`),
   `setVar('x', fn())`, Chapbook `engine.state.set('x', fn())`.
7. _Out of scope, different cause:_ indirect writes the parser doesn't count,
   such as `const p = State.variables.player; p.hp = 10` or `$inv[_k] = 1`
   followed by `$inv.sword`.

## Solution

Introduce the **opaque assignment** (see GLOSSARY). An assignment whose value
could be an object of unknown shape marks the assigned path **opaque**.
`variable-never-set` stays silent for every story property beneath an opaque
path.

Goals: minimal code to maintain, no bundle growth, and no surprises for authors.
A missed typo surprises authors less than a warning they can't fix.

## Implementation Decisions

- **Scope**: all code the parsers extract from: `<<set>>` and other
  assignment contexts, setter links, script passages, Story JavaScript, story
  script files, included scripts, and Chapbook vars sections. Both formats.
- **Opaque right-hand sides**: identifiers, member access (including computed
  element access), calls, `new`, `this`, `await`, `yield`. Also
  `c ? x : y`, `a || b`, `a ?? b` when _any_ branch is opaque.
- **Self-reference is ignored**: a branch that is the assigned path itself
  contributes nothing, so the common `$inv to $inv || {}` is judged by `{}` and
  is _not_ opaque.
- **Spread in an object literal** makes the literal's parent path opaque. The
  literal's explicit keys are still recorded as property writes. Spreads of
  story variables later become shape sources (see below).
- **Known shape (not opaque)**: literals of every kind, template strings,
  arithmetic, comparisons, unary `typeof`/`!`/`-`, and string concatenation.
  `$x to 5` then `$x.foo` still warns.
- **Destructuring** from an opaque source makes each target opaque
  (`[_a, _b] to fn()`).
- **`for…range`**: the value variable is opaque and the key/index variable is
  not.
- **Format-forced writes**: `setVar`/`engine.state.set` are judged by their
  value argument. Every SugarCube receiver is opaque. We don't model each
  macro's value type.
- **Only counted assignments** mark a path opaque. `<<print $x = fn()>>` is a
  read and doesn't.
- **Flow-insensitive, project-wide**: an opaque assignment anywhere makes the
  path opaque everywhere, regardless of order or reachability. This matches how
  the index already treats writes.
- **Opaque wins**: if `$player` gets both `{hp: 10}` and `loadSave()`,
  `$player.*` is silenced, `$player.hpp` included.
- **Descendants only**: an opaque `$a.b` silences `$a.b.c.d`. It doesn't
  silence `$a.b` itself, `$a`, or siblings like `$a.x`.
- **Diagnostics only**: opacity changes only `variable-never-set`.
  References, definition and rename are unaffected.
- **No new diagnostic code** (no `property-never-set` split) and no hover or
  other "why is this silent" feedback.

### Shape sources (recovering precision)

Some opaque values are copies of story state whose shape we already know.
Rather than marking them opaque, they record a **shape source** (GLOSSARY).

- **What records one**: plain assignment from a story variable or a statically
  resolvable chain rooted in one (`_p to $player`, `_s to $player.stats`),
  `clone(<that>)`, and each spread of one in an object literal
  (`{...$base, ...$extra, a: 1}`; `a` is still an explicit write).
  Anything else in those positions (`...fn()`, `$arr[i]`) stays opaque.
- **Union**: a path may have several shape sources. A property beneath it is
  set if any source (or the path's own writes) sets it. If any source is
  opaque, the path is opaque ("opaque wins").
- **Branches**: a conditional or logical value (`c ? $a : $b`, `$a || {}`)
  unites its branches' shape sources, with opaque winning as usual.
- **Built-ins**: a copy of a story format's built-in (`setup.items.sword`) is
  opaque, since the format sets its properties where the index can't see.
- **Chains** resolve transitively (`_q` ← `_p` ← `$player`). Cycles resolve to
  opaque.
- **Descendants**: `_p.a.b` is checked as `$player.a.b`.
- **Diagnostics only**: find-references, go-to-definition and rename don't
  follow shape sources. After renaming `$player.hp`, a now-unbacked `_p.hp`
  starts warning, which surfaces the stale read.

### Object literals written from script code

An object literal assigned to story state in script code
(`State.variables.player = {hp: 1}`, `engine.state.set('player', {hp: 1})`,
`engine.state.setDefault(…)`) records its keys as property writes, just as
`<<set $player to {hp: 1}>>` does. Without this, Story JavaScript that sets up
a variable makes every later read of its properties warn.

- **Nested keys**: `{stats: {str: 1}}` writes `stats` and `stats.str`.
- **Spreads** inside the literal record shape sources, as above.
- **Opaque values**: a key whose value is opaque (`{inv: fn()}`) makes only
  that key's path opaque.
- **Every script context**: story `.js` files, `<<script>>`/`<<run>>`, and
  Chapbook `[JavaScript]`.

### Chained `engine.state.get` in Chapbook

Member access off a Chapbook state read counts as the path it reaches:
`engine.state.get('player').a.b` is `player.a.b`. That applies to reads, to
writes (`engine.state.get('player').hp = 3` sets `player.hp`), and to shape
sources (`set('s', engine.state.get('player').stats)` copies `player.stats`).
Indexed segments (`get('list')[0]`) and method calls stop the chain, as they do
elsewhere.

## Rejected Alternatives

- **Full type system or the TypeScript checker**: large bundle growth and a lot
  of code to maintain, for a lint warning.
- **Consuming JSDoc types**: authors rarely write JSDoc, it needs a type
  evaluator, and it only covers call results (catalogue item 1).
- **Do nothing**: authors keep seeing warnings they can only silence by
  disabling the diagnostic, which undermines trust in it.
- **Separate `property-never-set` code**: diagnostic codes are kept coarse on
  purpose, and an off switch doesn't fix the false positives.
- **No ADR**: the decision is local to extraction and the check, so it's
  cheap to reverse.

## Testing Decisions

Add focused cases to the existing parser and diagnostics test files. Cover:

- each catalogue item 1–6;
- the known-shape counterexample (`$x to 5` then `$x.foo` still warns);
- the "opaque wins" mixed-write case;
- descendants-only behavior;
- a `<<print>>` write that must not mark the path opaque;
- the self-reference default (`$inv to $inv || {}` stays checked);
- shape sources: a single source, a union of sources, a chain, a cycle, an opaque source, spread, and a typo through a copy (`_p.hpp`) that must warn.

## Out of Scope

- Catalogue item 7 (indirect writes the parser doesn't count), apart from the
  two direct forms above: object literals written from script code and chained
  `engine.state.get` writes.
- `Object.assign`: its result is opaque, and the mutating form
  (`Object.assign($o, {k: 1})`) is an uncounted write (item 7), not an opaque
  one.
- Any inference beyond literals and shape sources.

## Further Notes

- **Function return shapes** (rejected for now): giving `_r` in
  `_r to setup.fn()` the keys of every `return` literal in `setup.fn` would
  address the motivating example directly. But it needs call-to-definition
  linking across files, plus handling for methods, arrows and `window.`
  globals, and an opaque fallback. That's too much code to maintain for now.
- **Navigating shape sources** (rejected): find-references could follow shape
  sources cheaply by reusing the resolver. But it would then disagree with
  rename, which can't follow them: with several sources there's no correct
  rewrite. Authors use find-references to preview renames, so the
  disagreement would surprise them. "Related" would also need a one-hop rule,
  so that `$player.hp` doesn't reach `$enemy.hp` through `_p`.
  Go-to-definition doesn't work on properties at all today. Revisit if
  property definitions are ever added.
  Property definitions are planned in `../property-definitions/spec.md`,
  which also leaves shape sources unfollowed.

### Future directions for fuller un-opaquing (exploration only)

Whatever engine is chosen, real shape knowledge needs:

- **one program** made of every Twee expression, translated to JS with
  position mapping, plus all script code (each passage its own function body,
  sharing story state);
- story state **typed as the union of its writes**, solved until it stops
  changing;
- **models of the format APIs**;
- a **leniency policy**: unknown values are silent, a property counts if any
  member of a union has it, and engine errors are never shown directly;
- **incremental re-analysis**.

Some values stay unknowable with any engine: `JSON.parse` results, scripts
loaded at runtime, DOM-derived data, save migrations and dynamic keys.

Two candidates are worth recording:

- **Our own analysis.** Grow the shape-source graph (ticket 07) into a
  flow-insensitive, unification-based shape inference: object literals are
  allocation sites, and edges follow assignments, arguments→parameters,
  returns→call results, `this` in constructors, and array elements (which
  solves `for…range`). No new dependencies and no bundle growth; it fits the
  current Acorn/eslint-scope stack. Roughly 1.5–3k lines plus tests (a rough
  estimate). It never gets JSDoc, generics or library types. This is the
  natural next step after ticket 07.
- **VS Code's TypeScript server.** A TS server plugin injects the virtual
  program into VS Code's built-in tsserver, the "hybrid mode" pattern that
  Vue and Svelte tooling use. The language server queries types through a
  relay in the client. No bundle growth. JSDoc, return shapes, constructor
  fields and array element types come for free, and existing
  `@types/twine-sugarcube` typings model SugarCube's API. Types would also
  let rename and references follow copies correctly, which removes the
  find-references/rename disagreement noted above. Costs: VS Code-only (not
  other LSP clients), coupled to the tsserver protocol, and a larger
  architectural change. Risk to verify first: TS 7's native server may not
  support tsserver-style JavaScript plugins.

- **Volar (further research).** Volar is a framework for building LSP servers
  (`@volar/language-server`, started from an ordinary `vscode-languageclient`
  client), so adopting it keeps the LSP approach and replaces what sits inside
  the server. It maps between source files and virtual code, and runs existing
  language services on that virtual code. Adopting it would mean:
  - a Twee language plugin that turns each `.tw` file into virtual JS with
    mappings flagged per feature, which is how the leniency policy would be
    applied;
  - rehosting our Twine features (passage links, macro and insert
    diagnostics) as Volar service plugins;
  - choosing a TS mode. _Full LSP_ runs TS in our server: it works in any
    editor but bundles TS. _Hybrid_, which Vue's tooling uses, runs TS
    features in VS Code's tsserver: no bundle growth, but VS Code-only, with
    the same TS 7 plugin risk as the tsserver option;
  - TS replacing the JS symbol, reference and rename stack (including the
    custom `.js` rename work), while the index keeps Twine-only symbols.

  Effectively the tsserver option plus a server rewrite. The rewrite buys
  mapping infrastructure and editor portability. Open question: story state
  is project-wide but Volar builds virtual code per file, so we need to check
  how a shared virtual declaration file for the derived story-state type
  would work.

Rejected as candidates: bundling TypeScript on its own (the 5.x package is
~24 MB unpacked against a ~4 MB server bundle today, and TS 7 is a native
binary), and Tern.js (unmaintained since 2023).
