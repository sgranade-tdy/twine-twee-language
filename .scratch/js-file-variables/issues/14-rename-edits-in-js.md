# Rename edits in .js files

Type: grilling
Status: resolved
Blocked by: 13

## Question

**How a .js file enters the project index** fixed identity offsets and query-time filtering of Chapbook **Conditional references**. **Discovering and keeping .js files fresh** fixed that open buffers are read live, so edits can carry document versions. Given both, what does rename have to do beyond today's script-passage behaviour when an edit lands in a `.js` file?

- **Per state root:** what exact text each rename edit replaces, and is each one safe for a whole file? The roots are `State.variables.foo`, `variables().foo`, `SugarCube.State…`/`window.SugarCube…`, `getVar('$foo')`/`setVar` string literals (where the `$` sigil sits inside the string), aliases, Chapbook `engine.state.get/set/setDefault` string keys (including dotted property keys), and Chapbook conditional references.
- **Conditional references:** if the rename could change whether a conditional reference qualifies (renaming onto a name that a root declaration binds), should it refuse, warn, or proceed?
- **Edit transport:** do edits to `.js` URIs use versioned `documentChanges` for open buffers and unversioned edits for closed files? What happens when a `.js` buffer has a pending debounced parse, so the index is stale relative to the buffer?
- **prepareRename** starting from a `.js` occurrence: the range it returns for each kind of root, and `null` everywhere else, so TypeScript keeps rename.

## Answer

- **Edit text.** Every edit replaces only the occurrence's own name segment, never the root, quotes or sigil. That's `foo` in `State.variables.foo`, `variables().foo`, `SugarCube.State.variables.foo`/`window.SugarCube…`, `v.foo` through an alias, `State.variables['foo']`, and `getVar('$foo')`/`setVar` (the `$` stays). In Chapbook it's one segment of an `engine.state.get/set/setDefault` key (`a` or `b` in `'a.b'`) or the whole bare identifier. Properties replace their last segment, as today. Ranges in `.js` never include the sigil. Each occurrence records explicitly whether its sigil sits outside its range, which replaces the range-length-vs-contents heuristic in `sugarcube-renames.ts`.
- **Sigils.** An omitted sigil is normalized to the original (`bar` from `$foo` gives `$bar`), which a `.js` start needs because its range has no sigil. An explicit `$`↔`_` change is refused with an error explaining that the two are different stores with different lifetimes. A sigil-converting refactor is out of scope (see the map). Silent normalization, text-only edits behind a confirmation, and a mid-rename `showMessageRequest` were rejected. Script roots can't follow without changing roots, and `_→$` would merge unrelated per-passage temporaries.
- **New-name validation.** The rename is refused if the new name, without its sigil, isn't a valid JS IdentifierName. It's also refused for a reserved word when any edit lands on a Chapbook bare name. This applies to every story-variable rename, including ones that start in a `.tw` file.
- **Escaped spellings** (`'\x66oo'`, `\u0066oo`, keys containing escapes) are dropped, not indexed, because their offsets can't be computed safely. No-substitution template literals count as string literals.
- **Destructuring from a state root** (`const { gold, hp: h } = State.variables`) is indexed as reads. This extends **What counts as a story variable in a .js file**. On rename, shorthand `{ gold }` becomes `{ newName: gold }` so the local binding is kept, and `{ hp: h }` replaces only the key.
- **Conditional reference collisions (Chapbook).** The rename is refused, with a message naming the conflict, when any edit lands on a bare name and the new name is bound by a root-level declaration in a story script file or `script` passage, or is excluded (`engine`, `go`, `restart`, a host global). Collisions with an existing story variable stay unchecked, as today.
- **Hard refusals, not confirmations.** The Q3 and Q6 refusals aren't confirm-to-proceed, because there's no correct result to confirm. They surface as errors from the rename request.
- **Transport.** All renames (`.tw` included) return `documentChanges` when the client supports them: `TextDocumentEdit` with the synced version for open buffers and `version: null` for closed files. Otherwise they fall back to `changes`.
- **Stale index.** References, definition, prepareRename and rename first flush every pending debounced `.js` parse synchronously. The version check is the backstop.
- **prepareRename in `.js`** returns the edit range above for any indexed story-variable or property occurrence, including Chapbook conditional references that currently qualify. It returns `null` everywhere else (declarations, alias bindings, root expressions, non-qualifying bare names, other strings), so TypeScript keeps rename there.
- No ADR (cheap to reverse).
