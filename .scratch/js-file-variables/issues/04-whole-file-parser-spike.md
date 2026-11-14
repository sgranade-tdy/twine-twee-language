# Spike the current JS parser on whole files

Type: task
Status: resolved

## Question

Run `server/src/js-parser.ts` (`parseJS`/`tokenizeJavaScript` plus eslint-scope) and each format's script-passage path (SugarCube `parseAsJavaScript`, Chapbook `parseScript`) over whole real-world files: a typical story script file, a ~300KB unminified vendor library, a minified library, an ES module, and a file broken mid-edit. Record parse time, memory, number of story-variable occurrences produced (and how many are junk), offset correctness, loose-parse behaviour, and any thrown errors. AFK. The answer is the measurements plus a list of concrete blockers, if any. Write the throwaway harness outside `server/src` and don't merge it. Ticket 03 already benchmarked raw parsers. Reuse `research-bench/` on branch `research/js-parser-library-survey`, including its input generator, and focus on the full `js-parser.ts` and per-format path rather than raw parse time.

## Answer

Harness, raw results and a measurements table are in `spike/README.md` on branch `spike/whole-file-parser`, which is never merged. Each file ran as a `script` passage through the real `parse()` and per-format path, under both formats.

- **Speed and memory are fine for indexing.** Warm/cold timings:
  - jquery.js (249 KB): 60/94 ms
  - lodash.js (533 KB): 50/85 ms
  - three.core.js (1.4 MB): 250/340 ms

  Transient heap peaked at about 53 MB. A 1.4 MB file re-parsed per keystroke would block the single-threaded server for about 250 ms. Large files also produce 15k–63k semantic tokens that a `.js` file doesn't need.
- **Offsets are always correct**: 0 mismatches in about 17k occurrences. **Nothing threw**, including on truncated files and unterminated strings.
- **Loose parse is not the flood ticket 03 predicted.** Broken jquery adds 4 names (2 leaked locals, `foo`, `baz`, plus a `baz.while` keyword property); minified lodash gives 5. JS and host-global exclusion plus IIFE/UMD scoping absorb the rest.
- **Blockers / gaps found:**
  1. **ESM always fails strict parsing.** `parseJSStrict` hard-codes `sourceType: "script"`, so every module reports a parse error and falls back to acorn-loose.
  2. **Root-level declarations are the real flood.** Under the ADR-0003/0004 rule, three.js yields 526–653 story variables with 2.5k–4.8k occurrences.
  3. **UMD boilerplate is indexed in both formats**: bare `module`, `define`, `exports`, `global` and `self`.
  4. **Chapbook (existing script-passage behaviour too):** `engine` and `config` aren't excluded, and `engine.state.get('x')` reads aren't indexed as references to `x`. Rename would miss them.
  5. **SugarCube:** `State.variables.x` → `$x` works, but aliases (`const v = State.variables; v.x`) are missed, and the bare built-in `Config` yields a property.
