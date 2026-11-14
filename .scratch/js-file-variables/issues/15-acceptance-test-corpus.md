# Acceptance test corpus for .js extraction

Type: grilling
Status: resolved

## Question

Which representative real-world `.js` files (and which synthetic fixtures) should the spec's acceptance criteria name, and what must hold for each? Start from the spike corpus (`spike/` on branch `spike/whole-file-parser`). Cover each decided behaviour:
- state roots, aliases and destructuring in both formats, and Chapbook conditional references;
- UMD and vendor files producing no story variables;
- ESM files that need the module-mode retry;
- broken files falling back to acorn-loose;
- files over the 5 MB limit being skipped;
- the rename refusals and edit shapes from **Rename edits in .js files**.

Decide where the fixtures live (committed to `server/src/test/` or fetched) and how large a committed fixture may be.

## Answer

- **Real-world vendor fixtures.** Commit `jquery.min.js` and `lodash.min.js`, with their MIT headers intact, under `server/src/test/fixtures/js/`. A committed fixture may be at most 100 KB. There are no new devDependencies and no fetched files. three.js is too large, so a synthetic module covers ESM. `npm run lint` lints every file under `./server/src`, so `eslint.config.mjs` needs a global ignore for `server/src/test/fixtures/**`.
- **What must hold for each vendor fixture.** Each one is parsed as both a story script file and an included script, under both SugarCube and Chapbook:
  - nothing throws;
  - SugarCube produces zero story-variable occurrences;
  - Chapbook produces zero **Conditional references** that qualify when the project defines no variables;
  - every occurrence's range text equals its name segment.

  There's no junk-count threshold.
- **Synthetic behaviour fixtures** are inline strings in `js-parser.test.ts` and the per-format parser tests, following the current convention, with one small case per behaviour. The behaviours are:
  - each SugarCube state root, including `window.SugarCube`;
  - `getVar`/`setVar`;
  - single-initializer aliases and the aliases that are dropped;
  - destructuring;
  - `engine.state.get/set/setDefault` with dotted keys and non-literal keys;
  - conditional references with and without a binding root declaration, and per file kind;
  - the excluded `engine`/`go`/`restart`;
  - dropped escaped spellings and no-substitution templates.
- **Typical story scripts.** Two committed fixtures, `story-sugarcube.js` and `story-chapbook.js`, each a few KB and adapted from the spike's generators (`spike/make-inputs.mjs` and `make-chapbook-input.mjs` on `spike/whole-file-parser`). The test asserts the full expected occurrence list for each.
- **ESM.** A synthetic inline module with `import`/`export` and a state-root use. It must parse strictly through the module-mode retry, with no loose fallback, and its occurrences must be found.
- **Broken files** are generated in the test, not committed. The test applies the spike's three mutations (half-typed member mid-file, truncation at 60%, unterminated string) to `jquery.min.js` and to the story fixtures. The result must show:
  - the loose fallback is taken;
  - nothing throws;
  - offsets stay exact;
  - state-root occurrences in the intact part of a story fixture are still found;
  - SugarCube yields zero junk.
- **5 MB skip.** The size gate reads the file size through an injectable stat, so the test fakes 5 MB + 1 byte instead of writing a large file. A file over the limit isn't parsed, indexed or registered, and produces one output-channel line plus a single warning per session. A file just under the limit is indexed.
- **Rename.** Inline cases in `renames.test.ts`, one per row of [Rename edits in .js files](14-rename-edits-in-js.md):
  - the edit range for each root;
  - sigil normalization;
  - the `$`↔`_` refusal;
  - invalid-identifier and reserved-word refusals;
  - Chapbook collisions with a root declaration or an excluded name;
  - shorthand expansion when renaming a destructured name;
  - `documentChanges` versioned for open buffers and `version: null` for closed files;
  - the flush of pending parses before rename;
  - `prepareRename` returning `null` on declarations, aliases and roots.

  The vendor fixtures stay out of rename tests.
- **No timing assertions.** The spike's numbers go into the spec only as non-binding context.
- **Scope.** This corpus covers extraction and rename. The spec writes acceptance criteria for discovery, watching and config create/delete straight from tickets 07, 11 and 12, as behavioural scenarios.
- No ADR and no glossary change.
