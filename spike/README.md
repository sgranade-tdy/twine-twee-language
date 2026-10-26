# Whole-file parser spike

This is the throwaway harness for the wayfinder ticket "Spike the current JS parser on whole files". It is never merged.

`run-one.ts` wraps a `.js` file as `:: Story JavaScript [script]` under a StoryData passage for SugarCube 2.37.3 or Chapbook 2.2.0. It then runs it through the real `parse()` → per-format script path (SugarCube `parseAsJavaScript`, Chapbook `parseScript`) → `tokenizeJavaScript` / eslint-scope, and collects callbacks with `MockCallbacks`. `run-all.sh` runs one child process per (format, file) and writes `results.jsonl`.

```sh
npm i jquery lodash three && mkdir -p inputs && node make-inputs.mjs && node make-chapbook-input.mjs
./run-all.sh   # needs ../node_modules and ../server/node_modules (symlinked from the main checkout)
```

## Measurements (ParseLevel.Full; warm = median of 4 re-runs)

| File | Size | Warm / cold ms | Heap Δ MB | Parse error | Story-var occurrences (unique vars) |
| --- | --- | --- | --- | --- | --- |
| story.js (SugarCube style) | 8 KB | 4 / 13 | 4 | – | 187 (8) |
| chapbook-story.js | 8 KB | 5 / 15 | 5 | – | 444 (3) under Chapbook |
| jquery.js | 249 KB | 60–66 / 94 | 29 | – | 10 (2: `module`, `define`) |
| jquery.min.js | 76 KB | 31–36 / 66 | 14 | – | 10 (2) |
| lodash.js | 533 KB | 48–53 / 77–94 | 25 | – | 27 (5: `global`, `self`, `exports`, `module`, `define`) |
| lodash.min.js | 71 KB | 34 / 62 | 15 | – | 27 (5) |
| three.module.js (ESM) | 647 KB | 120 / 160–183 | 44 | `import`/`export` need module | 2461 (526) |
| three.core.js (ESM) | 1423 KB | 252 / 332–340 | 30–34 | same | 4828 (653) |
| broken-midedit.js | 249 KB | 82 / 117 | 53 | yes | 16 (6: adds `foo`, `baz`, and leaked locals `addProp`, `fix`) |
| broken-truncated.js | 149 KB | 52–57 / 84 | 13 | yes | 6 (1) |
| broken-string.js | 249 KB | 77–81 / 105 | 41 | yes | 10 (2) |

The two formats are within noise of each other on every library file. Chapbook at `ParseLevel.PassageNames` (regex-only `engine.state.set` scan) takes 0–10 ms even on 1.4 MB. Max RSS for the whole process (including tsx) peaked at about 500 MB on three.core.js. Large files emit 15k–63k semantic tokens, which a `.js` file has no use for.

## Findings

- **Offsets are always correct.** Every Variable/Property occurrence's range text matched its name: 0 mismatches across about 17k occurrences, all offset by the passage header.
- **Nothing threw.** Strict parse failure → acorn-loose fallback → eslint-scope held up on every input, including truncated and unterminated-string files.
- **The survey's acorn-loose junk flood doesn't reproduce on the real path.** Broken jquery adds 4 names, not about 600. Minified lodash yields 5, not 869. JS and host globals are excluded, and the IIFE/UMD wrapper keeps locals scoped. Real leaks seen: 2 locals (`addProp`, `fix`) and a keyword property (`baz.while`).
- **ESM always fails strict parsing.** `parseJSStrict` hard-codes `sourceType: "script"`, so every module file reports a parse error and goes through acorn-loose. `hasModuleSyntax` only switches eslint-scope.
- **Root-level declarations flood the index.** Under the ADR-0003/0004 rule (global- or module-scope variables are story variables), three.js's top-level `const`/`function`/`class` become 526–653 story variables with 2.5k–4.8k occurrences, many as writes. This, not loose-parse junk, is the real flood. Ticket 01 says those declarations are local for SugarCube/Chapbook Story JavaScript and only become globals in included scripts.
- **UMD boilerplate becomes story variables.** Bare `module`, `define`, `exports`, `global`, `self` are indexed in both formats. Ticket 01 says bare names are never SugarCube story variables.
- **Chapbook gaps (existing script-passage behaviour):**
  - `engine` and `config` aren't excluded, so they're indexed as story variables with 252 property occurrences (`engine.state.get`, …).
  - `engine.state.get('x')` reads are **not** indexed as references to `x`; only `engine.state.set` is. Rename of a Chapbook variable would miss reads in `.js` files and script passages.
- **SugarCube gaps:**
  - `State.variables.x` is correctly mapped to `$x`.
  - Aliases (`const v = State.variables; v.inventory`) are missed, so `$inventory` is never seen.
  - Bare `Config` (a SugarCube built-in) yields property `Config.history`.
