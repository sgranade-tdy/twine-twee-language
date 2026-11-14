# Story variables in local JavaScript files

Label: ready-for-agent

## Problem Statement

A Twine author who writes their story in Twee keeps much of the story's logic in local `.js` files. **Story script files** are matched by `storySourceFiles` and concatenated into the Story JavaScript. **Included scripts** sit under `includeSourcePaths` and are copied beside the built story. The extension never looks inside either kind of file. These are the consequences:

- Find-references and go-to-definition for a **Story variable** miss every use in a `.js` file.
- Renaming a story variable leaves its `.js` uses untouched, which silently breaks the story at runtime.
- A variable that's only ever set in a `.js` file gets a false `variable-never-set` warning in the `.tw` files that read it.
- Nothing can start from a `.js` file. The author can't find references to, or rename, `State.variables.gold` from inside the script that sets it.

The server also learns about `.tw` file changes and `tt3.config.json` lifecycle events inconsistently:

- external `.tw` edits, such as a git checkout, aren't re-read;
- deleting the StoryData file leaves a stale story format;
- creating or deleting `tt3.config.json` goes unnoticed.

Meanwhile the existing script-passage extraction is wrong in ways that whole files make obvious:

- it treats every unbound or root-level-declared name as a story variable, which floods the index from vendor libraries and UMD boilerplate;
- it misses SugarCube aliases of `State.variables`;
- it misses Chapbook `engine.state.get` reads, so rename misses them too.

## Solution

The language server indexes story-variable **Occurrences** in story script files and included scripts, for SugarCube 2 and Chapbook 2, using the project's story format from StoryData. Those occurrences take part fully in find-references, go-to-definition and rename, and rename rewrites `.js` files. Writes in `.js` files count as evidence against `variable-never-set`.

In all script code (`.js` files, `script` passages, SugarCube JS `<<script>>` and Chapbook `[JavaScript]` blocks), a story variable is reached only through a format **State root** or a single-initializer alias of one. Chapbook bare names are the one exception: they become **Conditional references**, which qualify only when the variable is defined elsewhere in the project and isn't declared in the shared script scope. **Declarations** are never story variables (ADR-0005).

The server claims only text sync, references, definition and rename, and only for the exact set of resolved `.js` files. VS Code's own JS service keeps everything else, including rename anywhere that isn't a story-variable occurrence. One file watcher keeps `.tw`, `.js` and `tt3.config.json` fresh, whether the change happened in the editor or on disk.

## User Stories

### Finding and navigating story variables in `.js` files

1. As a SugarCube author, I want find-references on `$gold` in a `.tw` file to list `State.variables.gold` in my story script file, so that I see every place the variable is used.
2. As a SugarCube author, I want `variables().gold`, `State.temporary.x` and `temporary().x` recognized, so that every spelling the format provides is found.
3. As a SugarCube author, I want `SugarCube.State.variables.gold` and `window.SugarCube.State.variables.gold` recognized in included scripts, so that code loaded with `importScripts()` is covered.
4. As a SugarCube author, I want `State.getVar('$gold')` and `State.setVar('$gold', 1)` with string literals recognized, so that the string-based API is covered.
5. As a SugarCube author, I want `const v = State.variables; v.gold` recognized when `v` is never reassigned, so that the common alias idiom is covered.
6. As a SugarCube author, I want an alias that's reassigned, or defined in another file, to be ignored rather than guessed at, so that rename never rewrites something that isn't a story variable.
7. As a SugarCube author, I want `const { gold, hp: h } = State.variables` indexed as reads of `$gold` and `$hp`, so that destructuring is covered.
8. As a SugarCube author, I want `State.variables['gold']` and no-substitution template keys recognized, so that bracket access is covered.
9. As an author, I want escaped spellings such as `'\x66oo'` to be skipped, so that rename never computes a wrong offset.
10. As a Chapbook author, I want `engine.state.get('gold')` indexed as a read, so that rename and find-references see reads in scripts.
11. As a Chapbook author, I want `engine.state.set('gold', …)` and `setDefault` indexed as assignments, so that they count as definitions.
12. As a Chapbook author, I want a dotted key such as `engine.state.get('a.b')` indexed as the property `a.b`, so that properties work in scripts too.
13. As a Chapbook author, I want a bare `gold` in a script indexed as a reference to `gold` when the project defines `gold` elsewhere, so that the window-mirrored use is found.
14. As a Chapbook author, I want a bare name that a root-level declaration in any story script file or `script` passage binds to be excluded, so that my own locals in the shared Story JavaScript scope aren't mistaken for story variables.
15. As a Chapbook author, I want `engine`, `go`, `restart` and host globals excluded, while `config` counts as a story variable, so that built-ins aren't indexed.
16. As an author, I want declarations never to be indexed as story variables, so that vendor libraries and my own helpers don't flood the index.
17. As an author, I want UMD boilerplate (`module`, `define`, `exports`, `global`, `self`) to produce no story variables, so that bundled libraries stay quiet.
18. As an author, I want go-to-definition on a `.tw` read to land on an assignment in a `.js` file, so that I can find where a value is set.
19. As an author, I want find-references and go-to-definition to work when I start from a story-variable occurrence inside a `.js` file, so that I can navigate from scripts.
20. As an author, I want our results merged with VS Code's JS results in `.js` files, so that I don't lose TypeScript's own references.

### `variable-never-set`

21. As an author, I want a write in a story script file to suppress `variable-never-set`, so that variables initialised in Story JavaScript aren't flagged.
22. As an author, I want a write in an included script to count the same way, in both formats, so that a variable set only in an included script isn't flagged.
23. As a Chapbook author, I want conditional references never to raise `variable-never-set`, so that bare names don't create warnings.
24. As an author, I want open `.tw` documents revalidated after a `.js` file is re-parsed, so that warnings appear and clear without my touching the `.tw` file.

### Renaming

25. As an author, I want renaming `$gold` to rewrite only the `gold` segment of each `.js` occurrence and never the root, quotes or sigil, so that the surrounding code stays intact.
26. As a SugarCube author, I want `getVar('$gold')` renamed to `getVar('$coins')`, keeping the `$`, so that string-based calls stay correct.
27. As a SugarCube author, I want typing `coins` without a sigil to give `$coins`, so that renaming from a `.js` file, where the range has no sigil, just works.
28. As a SugarCube author, I want a `$`↔`_` change refused with an error explaining that the two are different stores with different lifetimes, so that I don't silently merge or split state.
29. As an author, I want a new name that isn't a valid JS IdentifierName refused, so that rename never produces broken JavaScript.
30. As a Chapbook author, I want a reserved word refused when any edit would land on a bare name, so that rename never produces broken JavaScript.
31. As a Chapbook author, I want a rename refused, with a message naming the conflict, when an edit lands on a bare name and the new name is bound by a root-level declaration or is excluded, so that the reference doesn't silently stop being a reference.
32. As an author, I want renaming a shorthand-destructured `{ gold }` to become `{ coins: gold }`, so that my local binding keeps working.
33. As an author, I want `{ hp: h }` to rename only the key, so that the local binding is left alone.
34. As an author, I want rename to flush any pending `.js` parses first, so that edits are computed against the current buffer.
35. As an author, I want rename edits to carry document versions for open buffers and `null` for closed files, so that VS Code rejects a stale rename instead of corrupting text.
36. As an author, I want `prepareRename` in a `.js` file to return `null` on declarations, alias bindings, root expressions and other strings, so that TypeScript's rename still works there.
37. As an author, I want `prepareRename` to return the sigil-free name range on a story-variable occurrence in a `.js` file, so that the rename box shows the right text.
38. As an author, I want these refusals to be hard errors, not confirmations, so that I'm never asked to approve a wrong result.

### Discovery and freshness

39. As an author, I want story script files and included scripts discovered with the same rules the build uses, including `ignores`, so that the index sees exactly what the build ships.
40. As an author, I want a directory entry in `includeSourcePaths` to cover every `.js` file beneath it, so that included scripts are found.
41. As an author, I want a `.js` file matched by both settings treated as a story script file and indexed once, so that occurrences aren't duplicated.
42. As an author, I want the server to claim only my resolved `.js` files, so that vendor files I've excluded and unrelated JS are left to VS Code.
43. As an author, I want edits to an open `.js` buffer to be re-parsed after a short pause, so that typing in a large script stays responsive.
44. As an author, I want a `.js` or `.tw` file changed on disk while it's closed (for example by git) to be re-indexed, so that the index matches the disk.
45. As an author, I want creating, deleting or renaming a `.js` or `.tw` file, in the editor or outside it, to update the index and the claimed file set, so that file operations just work.
46. As an author, I want deleting the file that holds StoryData to trigger a workspace reindex, so that the story format is rediscovered or cleared.
47. As an author, I want `.js` extraction to stop when the story format is unknown, and to re-run when the format changes, so that the wrong format's rules are never applied.
48. As an author, I want creating `tt3.config.json` (including when the "disable diagnostic" quick action writes it first) to take effect immediately, so that new settings apply without a reload.
49. As an author, I want deleting `tt3.config.json` to reset to schema defaults and reindex, so that the editor never follows settings that no longer exist.
50. As an author, I want an invalid `tt3.config.json` to keep the last good config and show the existing error, so that a typo doesn't wipe my setup.
51. As an author, I want a burst of config events, such as an atomic save, to cause one reload, so that the server doesn't thrash.

### Robustness

52. As an author, I want a `.js` file I'm halfway through editing to still yield its story-variable occurrences, so that rename doesn't silently skip it.
53. As an author, I want ES-module syntax in a `.js` file to parse cleanly, so that `import`/`export` don't degrade extraction.
54. As an author, I want a `.js` file over 5 MB skipped, with a line in the output channel and one warning per session, so that the server stays responsive and I know rename can't see inside that file.
55. As an author, I want that warning to tell me that adding the file to `ignores` silences it, so that I can act on it.
56. As an author, I want minified and vendor libraries indexed like any other file but to contribute nothing, so that I don't have to configure anything.
57. As an author, I want no diagnostics reported on my `.js` files, so that VS Code's JS service stays the single source of JS errors.

## Implementation Decisions

### Semantics (ADR-0005; GLOSSARY: State root, Conditional reference, Story variable, Declaration)

- One rule set governs all script code: story script files, included scripts, `script` passages, SugarCube JS `<<script>>` and Chapbook `[JavaScript]`. ADR-0003 still governs expression code. Fixing today's script-passage semantics is part of this work.
- **SugarCube state roots:**
  - `State.variables`, `State.temporary`, `variables()` and `temporary()`;
  - `SugarCube.State.*`, with or without a leading `window.`;
  - `State.getVar`/`setVar` with a string or no-substitution template literal, where the sigil sits inside the string.

  No bare identifier is ever a story variable, including `$x`. The bare built-in `Config` isn't one either.
- **Aliases:** a `var`/`let`/`const` whose initializer is exactly a state root and which is never reassigned. Any other alias, or one defined in another file, is dropped.
- **Destructuring from a state root** is indexed as reads, one per key.
- **Chapbook:** `engine.state.get` is a read, and `set`/`setDefault` are assignments. A dotted literal key is a property, and a non-literal key is dropped. Every unbound bare name in script code is indexed as a **Conditional reference**, never an assignment. Root-level declarations are recorded per URI as their own kind. `engine`, `go` and `restart` are excluded, and `config` is a story variable.
- **Escaped spellings** are not indexed.
- **Writes in included scripts** are ordinary assignments in both formats. They count against `variable-never-set` and serve as definition targets, with no reachability gating.

### Parsing

- Keep Acorn, acorn-loose and eslint-scope. Add no new dependencies.
- **Whole files only:** if the script-mode strict parse fails, retry strict in module mode. If that also fails, fall back to acorn-loose, exactly as script passages do. The rule is the same for both file kinds, and for open buffers and disk alike. There's no extra user signal and no last-good cache. Passage snippets keep today's behaviour.
- A `.js` file is parsed with the project's story format from StoryData. An unknown format extracts nothing, and a format change re-parses every `.js` file.

### Index plumbing

- A **dedicated indexer entry for script files** sits beside the existing `updateProjectIndex`. It takes the document, its file kind (story script file or included script) and the index.
  - It skips the StoryData scan and `::` splitting, and emits no passages.
  - It calls the format's script path directly at offset 0 of the real document, under a synthetic, unemitted `script` passage, so offsets map one-to-one.
  - Only the full parse level does anything.
  - It uses no-op callbacks for embedded documents, semantic tokens, folding ranges, decorations and parse errors. Tokenizing still runs because references come from it.
  - Format parsers are not changed for this.
- **Conditional references are filtered at query time.** References, definition, rename and `variable-never-set` filter them against two sets: the variables the project defines, and the root-level declarations from story script files and `script` passages. No file is re-parsed because another file changed.
- **Whose declarations count:** only story script files and `script` passages feed the root-declaration set and are filtered by it, since they share one concatenated scope. Included scripts are filtered only by their own scope and the project-defined test.
- **Workspace indexing order:** all `.tw` files, then all `.js` files, then validation.
- **Revalidation:** every `.js` re-parse revalidates the open `.tw` documents. `.js` documents are never validated.
- **Removal:** a re-resolve diffs the new file sets against the old ones. A URI that left both sets is removed from the index. A URI whose kind changed is re-parsed. A watcher delete removes the URI directly.

### Rename

- Each edit replaces only the occurrence's name segment. In Chapbook that's one segment of a dotted key, or the whole bare name. Properties replace their last segment. `.js` ranges never include the sigil.
- Each occurrence records explicitly whether its sigil sits outside its range. This replaces the range-length-vs-contents heuristic in SugarCube renames.
- **Sigils:** an omitted sigil is normalized to the original, and an explicit `$`↔`_` change is refused.
- **Validation** applies to every story-variable rename, including ones started in `.tw`:
  - refuse a new name that isn't a valid JS IdentifierName;
  - refuse a reserved word when any edit lands on a Chapbook bare name;
  - refuse a Chapbook bare-name collision with a root-level declaration or an excluded name, with a message naming the conflict.

  Collisions with existing story variables stay unchecked, as today. All refusals are errors from the rename request.
- **Shorthand destructuring:** `{ gold }` becomes `{ newName: gold }`, and `{ hp: h }` replaces only the key.
- **Transport:** all renames return `documentChanges` when the client supports them. Open buffers get the synced version, and closed files get `version: null`. Otherwise renames fall back to `changes`.
- **Freshness:** references, definition, `prepareRename` and rename first flush every pending debounced `.js` parse synchronously.
- **`prepareRename`** in `.js` returns the edit range for indexed story-variable or property occurrences, including conditional references that currently qualify, and `null` everywhere else.

### Discovery, registration and watching

- **File-set resolution (new client module):** one pure helper, shared by the build and the index, maps the config and a workspace provider to three lists: `tweeFiles`, `storyScriptFiles` and `includedScripts`.
  - Included scripts follow the build's rules: a directory entry becomes `<dir>/**/*`, a file entry stays as written, `ignores` is subtracted, and only `.js` files are kept.
  - A file in both sets is a story script file only.
- **Discovery request:** the existing find-twee-files request becomes a single request returning those three lists.
- **Dynamic registration:** the server registers text sync, references, definition and rename (with `prepareRename`) through `client/registerCapability`. The document selector lists each resolved `.js` file by exact path, with glob metacharacters escaped. The server unregisters and registers again whenever the set changes. No other feature is registered for `.js`.
- **Workspace file tracker (new server module, extracted from server startup code).** It owns:
  - the watcher event handling for `**/*.{tw,twee}` and `**/*.js`;
  - the debounced re-resolve and set diff;
  - the open-buffer `.js` re-parse debounce (about 300 ms after the last edit; `.tw` stays undebounced);
  - the size gate;
  - registration updates;
  - the StoryData-delete reindex.

  Its collaborators are injected: clock and timers, stat, the registration call and the **indexing queue** (a separate server module that runs indexing work one task at a time). Each is added when a feature first needs it. Relevance is decided by membership in the resolved sets. The unanchored `.tw` URI test is retired from event handling.
- **Watcher events:**
  - **Create** re-resolves the sets.
  - **Change to a file that isn't open** re-reads and re-indexes it at full level, and validates `.tw` files.
  - **Change to an open file** is ignored, because sync owns it.
  - **Delete** removes the file from the index and revalidates. If the file held StoryData, the whole workspace is reindexed.
  - **Rename** arrives as a delete plus a create.
- **Retirements:** the client's `workspace/didCreateFiles`, `didDeleteFiles` and `didRenameFiles` notifications, and the client's included-source-file filter, are removed.
- **Size gate:** a `.js` file over 5 MB (by on-disk size) isn't parsed, indexed or registered. The limit is fixed, with no setting. Each skipped file gets an output-channel line, and there's one warning notification per session. The warning says the file wasn't scanned, that rename and find-references won't see uses in it, and that adding it to `ignores` silences the warning.
- **Vendor files:** there are no default ignores and no minification heuristic. The user's `ignores` is the only way to exclude a file.

### Config lifecycle (new client handler)

- The config watcher subscribes to create, change and delete, and all three feed one handler debounced at about 300 ms. When the handler fires, it checks the file's current state on disk:
  - **File exists:** load it. An invalid file keeps the last good config and shows the existing error.
  - **File missing:** reset to schema defaults. Legacy settings are not migrated again, and the file isn't recreated.
  - Either way, send one reindex request. The reindex re-resolves the file sets and re-registers the `.js` selector against the result.
- The config location and multi-root behaviour are unchanged.

### Schema and dependencies

- There are no config schema changes and no new runtime dependencies.

## Testing Decisions

- **What makes a good test:** it drives the feature through a public seam and asserts what an author would observe: occurrences, references, definitions, rename edits and refusals, diagnostics, registrations and notifications. It never asserts internal data structures or call order. Each behaviour is covered once, at the highest seam that can express it.
- **Seam 1: project index (existing, primary).** Index `.js` documents through the new script-file indexer entry into a real index, together with `.tw` documents where needed. Then assert through the existing references, definition, `prepareRename`/`generateRenames` and validator functions. This seam covers:
  - vendor and story fixtures;
  - broken files;
  - ESM;
  - conditional-reference filtering across files;
  - writes in included scripts against `variable-never-set`;
  - every rename case.

  Prior art: the indexer, references, renames and validator test files, which use a real index and the passage builders.
- **Seam 2: per-format parsers (existing).** Run the script path with mock callbacks for the fine-grained cases:
  - each state root, including `window.SugarCube`;
  - `getVar`/`setVar`;
  - single-initializer aliases and the aliases that are dropped;
  - destructuring;
  - Chapbook `get/set/setDefault` with dotted and non-literal keys;
  - conditional references and root-declaration recording;
  - the excluded names;
  - dropped escapes and no-substitution templates.

  Prior art: the existing SugarCube and Chapbook parser tests and the JS parser tests. Synthetic inputs stay inline as strings, following the current convention.
- **Seam 3: file-set resolution (new).** Use a fake workspace provider to test directory versus file entries, `ignores`, `.js` filtering, overlap precedence and parity with what the build copies. Prior art: the client build tests.
- **Seam 4: workspace file tracker (new).** With fake timers, stat, registration and indexing queue, test:
  - create, change and delete for `.tw` and `.js`, open versus closed;
  - debounce coalescing;
  - selector rebuild and escaping;
  - re-resolve diffs (left both sets, kind changed);
  - the StoryData-delete reindex;
  - the 5 MB gate: a faked size of 5 MB + 1 is skipped with one output line and one warning per session, while a file just under the limit is indexed.
- **Seam 5: config reload handler (new).** With a fake file reader and timers, test that create behaves like change, that delete resets to defaults, that an invalid file keeps the last good config, and that a burst sends exactly one reindex. Prior art: the client config tests.
- **Acceptance corpus.**
  - **Committed fixtures** live in a fixtures directory under the server tests, at most 100 KB each and excluded from lint by a global ignore in the ESLint config:
    - `jquery.min.js` and `lodash.min.js`, with their MIT headers intact;
    - `story-sugarcube.js` and `story-chapbook.js`, each a few KB and adapted from the spike's input generators.
  - **Vendor fixtures**, parsed as both file kinds under both formats, must hold that:
    - nothing throws;
    - SugarCube yields zero story-variable occurrences;
    - Chapbook yields zero conditional references that qualify when the project defines no variables;
    - every occurrence's range text equals its name segment.

    There's no junk-count threshold.
  - **Story fixtures** assert their full expected occurrence lists.
  - **ESM:** a synthetic inline module with `import`/`export` and a state-root use must parse strictly through the module-mode retry and yield its occurrences.
  - **Broken files** are generated in the test, not committed. The test applies the spike's three mutations (half-typed member mid-file, truncation at 60%, unterminated string) to `jquery.min.js` and the story fixtures. The results must show that:
    - the loose fallback is taken;
    - nothing throws;
    - offsets stay exact;
    - state-root occurrences in the intact part are still found;
    - SugarCube yields zero junk.
  - **Rename:** one inline case per rename decision above. The vendor fixtures stay out of rename tests.
  - **No timing assertions.**

## Out of Scope

- Diagnostics reported on `.js` files, such as syntax errors or `variable-never-set` squiggles in a `.js` editor. VS Code's JS service covers those, though extraction must still survive broken JS.
- Hover, completions, semantic tokens or any other feature in `.js` files.
- Story formats other than SugarCube 2 and Chapbook 2.
- Converting a SugarCube variable between `$` and `_`. Rename refuses this.
- Script files other than plain `.js` (`.mjs`, `.ts`, …).
- Cross-file SugarCube aliases.
- Checking collisions between a renamed name and an existing story variable. This stays unchecked, as today.
- A configurable size limit, built-in vendor ignores or minification detection.
- Matching `importScripts()` or load calls to decide whether an included script runs.
- A faster or different JS parser.

## Further Notes

- The map with every decision is `.scratch/js-file-variables/map.md`, and each decision's detail lives in its ticket under `issues/`. Read `GLOSSARY.md` (Story script file, Included script, Story variable, State root, Conditional reference, Declaration) and ADR-0001 through ADR-0005 before starting. ADR-0005 supersedes ADR-0003 for script code and strikes ADR-0004's root-declaration consequence.
- The governing principle is that rename correctness is the hard constraint: over-report references, under-report assignments, and never guess a prefix.
- **Non-binding performance context from the spike** (`spike/README.md` on branch `spike/whole-file-parser`):
  - warm parse times: jquery.js (249 KB) about 60 ms, lodash.js (533 KB) about 50 ms, three.core.js (1.4 MB) about 250 ms;
  - transient heap about 53 MB;
  - offsets exact across about 17k occurrences;
  - nothing threw.
- Research write-ups live on never-merged branches: `research/format-script-execution`, `research/lsp-js-document-coexistence` and `research/js-parser-library-survey`.
- Changing script-passage semantics will change existing expectations in the SugarCube and Chapbook parser tests that encode the old "unbound ⇒ story variable" rule. Update them to ADR-0005 rather than keeping them.
