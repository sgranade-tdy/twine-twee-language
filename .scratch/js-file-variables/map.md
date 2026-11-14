# Story variables in local JavaScript files

Label: wayfinder:map

## Destination

A handoff-ready spec (`.scratch/js-file-variables/spec.md`) for extracting story-variable occurrences from **story script files** and **included scripts** into the project index (SugarCube 2 and Chapbook 2). Occurrences must take part fully in find-references, go-to-definition and rename (including rewriting `.js` files), and writes must count as evidence against `variable-never-set`. Watching for on-disk changes applies the same way to `.tw` files and `tt3.config.json` creation and deletion. This was added for consistency while deciding discovery. The spec settles whether the current JS parsing stack is ready or what replaces it.

## Notes

- Domain: the language server (`server/src/js-parser.ts`, per-format parsers in `server/src/passage-text-parsers/`) and the VS Code client (`client/src/extension.ts`, which already resolves `storySourceFiles` minus `ignores` but filters to `.tw/.twee`). Config schema: `schema/tt3.config.schema.json`.
- Read `GLOSSARY.md` (especially *Story script file*, *Included script*, *Story variable*) and ADR-0001 through ADR-0004 before each session. ADR-0003 (unbound ⇒ story variable) and ADR-0004 (eslint-scope) apply most directly. Flag any conflict with them.
- Governing principle, from `.scratch/js-parser-scrub/spec.md`: rename correctness is the hard constraint. Over-report references, under-report assignments, and never guess a prefix.
- Settled while charting: a story script file is parsed exactly like a `script`-tagged passage, through the same per-format path. `.js` files are parsed with the project's story format from StoryData and re-parsed when it changes; if the format is unknown, nothing is extracted.
- When weighing any library change, count added bundle size and ongoing maintenance, not just capability.
- Skills: `grilling` + `domain-modeling` for grilling tickets; `research` for research tickets.

## Decisions so far

- [How SugarCube and Chapbook execute story and included scripts](issues/01-format-script-execution.md): SugarCube's code is strict-mode and local, reaching story variables only via `State.variables`/`variables()`. Chapbook's bare names are story variables only when the variable already exists. Story script files share one concatenated scope. Included scripts run async at global scope.
- [Claiming .js documents alongside VS Code's JS service](issues/02-lsp-js-document-coexistence.md): references and definition results merge with TypeScript's; rename is first-result-wins, with ours asked first. Results and edits can reach `.js` files without claiming them, but nothing can start from a `.js` file. Registration can be scoped to a dynamic set of files.
- [Survey of JavaScript parsers for whole-file parsing](issues/03-js-parser-library-survey.md): no alternative is clearly better. Acorn is fast enough, and meriyah and oxc are faster but cost size and Node-version headroom. No candidate recovers broken code well. acorn-loose floods unbound names on broken or minified files, and that, not speed, is the real risk.
- [Spike the current JS parser on whole files](issues/04-whole-file-parser-spike.md): the current stack is fast enough, never threw, and kept offsets exact. The loose-parse flood mostly didn't reproduce. The real problems are semantic: root-level declarations and UMD names become story variables, ESM always fails strict parsing, and Chapbook's `engine.state.get` reads go unindexed.
- [Which parser stack parses whole .js files](issues/09-whole-file-parser-stack.md): keep Acorn, acorn-loose and eslint-scope, with no new dependencies and no ADR. Whole files retry strict parsing in module mode when the script-mode parse fails.
- [What counts as a story variable in a .js file](issues/05-story-variable-semantics.md): in script code (`.js` files, `script` passages, JS `<<script>>`, `[JavaScript]`), story variables are reached only through format **state roots** and their single-initializer aliases. Chapbook bare names are references only to variables defined elsewhere and not declared anywhere in the script blob. Declarations are never story variables. ADR-0005 supersedes ADR-0003 for script code.
- [Do writes in included scripts count against variable-never-set](issues/06-included-script-writes.md): yes, always, in both formats. They are ordinary assignments, so they also serve as definition targets. Matching load calls is too fragile, and the index ignores reachability everywhere else.
- [Discovering and keeping .js files fresh](issues/07-discovery-and-freshness.md): the server claims sync, references, definition and rename for exactly the resolved `.js` files, re-registering when that set changes. One client request returns the twee, story script and included script lists, and included scripts follow the build's rules. The server watches `.js` on disk and debounces parses of open buffers. `.tw` watching and config create/delete were added to scope.
- [Handling vendor, minified and oversized .js files](issues/08-vendor-and-oversized-files.md): no special vendor handling; the user's `ignores` is the only way to exclude a file. `.js` files over a fixed 5 MB are skipped, with an output-channel line and a single warning notification per session, because rename would silently miss uses in them.
- [What to extract from a .js file that fails strict parsing](issues/10-broken-file-extraction.md): fall back to acorn-loose, as script passages do. This applies to both kinds of file, to open buffers and disk alike, and adds no extra user signal. ADR-0005 leaves only Chapbook leaked bare names as a junk path, while a stale last-good extraction would corrupt rename.
- [Watching .tw files on disk](issues/11-tw-file-watching.md): `.tw/.twee` joins the file watcher, filtered by the resolved twee set. Creates re-resolve, on-disk changes re-parse fully, and deleting the StoryData file triggers a workspace reindex. The `workspace/did*` notifications are retired, so the watcher is the single path for all file kinds.
- [Noticing tt3.config.json being created or deleted](issues/12-config-create-delete.md): create, change and delete share one debounced handler. It loads the file if it exists, otherwise resets to schema defaults (legacy settings aren't re-migrated), then sends one `RequestReindex`, which rebuilds the `.js` registrations against the result.
- [How a .js file enters the project index](issues/13-index-plumbing.md): a dedicated entry runs the format's script path at offset 0 under a synthetic, unemitted `script` passage. The indexer discards tokens and embedded documents. Chapbook bare names are indexed as **Conditional references** and filtered at query time, so no cross-file re-parse happens. The re-resolve diff drops files, and a `.js` re-parse revalidates open `.tw` documents.
- [Rename edits in .js files](issues/14-rename-edits-in-js.md): edits replace only the name segment, never the root, quotes or sigil. An omitted sigil is normalized, while a `$`↔`_` change, an invalid identifier or a Chapbook bare-name collision is refused outright. Escaped spellings are dropped, and destructuring is indexed with shorthand expanded. Renames use versioned `documentChanges` after flushing pending parses.
- [Acceptance test corpus for .js extraction](issues/15-acceptance-test-corpus.md): commit `jquery.min.js` and `lodash.min.js` (each fixture capped at 100 KB, lint-ignored) plus two small story-script fixtures. Every behaviour gets an inline synthetic case, and broken variants are generated in the test. The 5 MB skip uses an injectable stat, rename gets one case per row of the rename ticket, and there are no timing assertions.

## Not yet specified

_Nothing left in the fog. Every ticket is resolved, so the way is clear: write `.scratch/js-file-variables/spec.md` from Decisions so far._

## Out of scope

- Diagnostics reported *on* `.js` files (syntax errors, `variable-never-set` squiggles in a `.js` editor). VS Code's own JS service covers syntax errors there. Extraction must still survive broken JS.
- Story formats other than SugarCube 2 and Chapbook 2.
- Converting a SugarCube variable between `$` and `_`, which would rewrite roots such as `State.variables` → `State.temporary`. It's a lifetime-changing refactor, not a rename, and `_→$` would merge unrelated temporaries. Rename refuses it (see [Rename edits in .js files](issues/14-rename-edits-in-js.md)).
- Script files other than plain `.js` (`.mjs`, `.ts`, …). Avoiding a choke on huge or vendor `.js` *is* in scope.
