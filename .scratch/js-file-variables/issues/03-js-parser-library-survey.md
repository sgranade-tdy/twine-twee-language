# Survey of JavaScript parsers for whole-file parsing

Type: research
Status: resolved

## Question

Would a parser other than Acorn + acorn-loose + eslint-scope serve whole-file parsing better? Candidates include meriyah, oxc-parser, @babel/parser, swc and esbuild's parser. For each, compare: whole-file parse speed and memory on 100KB–1MB inputs; error recovery on broken mid-edit code; ESTree compatibility, since `js-parser.ts` walks ESTree and eslint-scope needs it (see ADR-0001, ADR-0004); ability to run in the VS Code extension host and the web extension (WASM/native constraints); **added bundle size**; and **maintenance burden**: release cadence, API stability, and how much of `js-parser.ts` and `acorn-errors/` would have to change. The bar is beating the current stack on whole-file cost or robustness without breaking ESTree.

## Answer

The report is `docs/research/js-parser-library-survey.md` on branch `research/js-parser-library-survey`, which is never merged. The re-runnable benchmark harness is in `research-bench/` on the same branch.

- **ESTree parity:** meriyah, oxc and `@babel/parser` with the estree plugin produce the same identifiers and the same eslint-scope results as Acorn on all valid inputs. ts-estree also matches but lacks `start`/`end`, which `js-parser.ts` reads 21 times. swc and tree-sitter aren't ESTree, and esbuild exposes no AST. None of those three is usable.
- **Speed:** warm whole-file parse times on jquery.js and three.core.js were Acorn 8.4/37 ms, meriyah 7.3/23–28 ms, and oxc with experimental raw transfer 4.7/14 ms. oxc's default mode, Babel, swc and ts-estree were all slower than Acorn. Acorn is already fast enough.
- **Recovery is the real problem, and no candidate solves it.** meriyah, swc, espree and ts-estree throw on broken code; oxc returns an empty program; Babel recovered 2 of 16 faults. acorn-loose always returns a tree, but it is junk:
  - one fault in jquery.js raises unbound references (would-be story variables) from 186 to about 786;
  - even *valid* minified lodash produces 869.

  TypeScript's parser recovers well, staying at 187–189, but adds about 1 MB gzipped, needs an unexported ts-estree internal, and crashed on 2 of 8 faults.
- **Size:** today's parsing stack bundles to about 51 KB gzipped. meriyah adds about 32 KB and Babel about 70 KB. oxc needs a native binary per platform or about 0.5 MB of WASM. Babel 8 and oxc need a newer Node than the 20.9 in VS Code 1.90.
- **Maintenance:** `acorn-errors/` (1,284 lines) only works with Acorn. Swapping the parser for whole files only would touch about a dozen lines. The report lists five hybrid options.
