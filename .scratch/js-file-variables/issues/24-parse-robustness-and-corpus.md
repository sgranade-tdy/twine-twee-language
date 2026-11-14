# 24: Whole-file parse robustness and acceptance corpus

**What to build:** Whole `.js` files yield correct occurrences even when they use ES-module syntax, are half-edited or are vendor libraries (spec: Parsing, Testing Decisions; user stories 52, 53, 56).

- **Parse order:** a strict script-mode parse, then a strict module-mode retry, then acorn-loose. The rule is the same for both file kinds and for buffers and disk alike, with no last-good cache. Passage snippets keep today's behaviour.
- **Committed fixtures** go under the server tests, at most 100 KB each and globally ignored by ESLint:
  - `jquery.min.js` and `lodash.min.js`, with their MIT headers intact;
  - `story-sugarcube.js` and `story-chapbook.js`, adapted from the spike's input generators.

**Blocked by:** 21

**Status:** ready-for-agent

- [ ] An inline module with `import`/`export` and a state-root use parses strictly through the module retry and yields its occurrences
- [ ] Vendor fixtures, parsed as both file kinds under both formats, meet four conditions:
  - nothing throws;
  - SugarCube yields zero occurrences;
  - Chapbook yields zero qualifying conditional references when the project defines no variables;
  - every occurrence's range text equals its name segment
- [ ] Story fixtures assert their full expected occurrence lists
- [ ] Broken files are generated in the test by applying the spike's three mutations (half-typed member, truncation at 60%, unterminated string) to `jquery.min.js` and the story fixtures. Each must meet all of these:
  - the loose fallback is taken;
  - nothing throws;
  - offsets stay exact;
  - intact state-root uses are still found;
  - SugarCube yields zero junk
- [ ] No timing assertions
