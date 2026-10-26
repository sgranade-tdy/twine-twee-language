# research-bench

A throwaway harness for `docs/research/js-parser-library-survey.md`. It isn't
part of the extension and is never merged.

```sh
npm install                 # some install scripts are blocked by allowScripts; that's fine
node make-inputs.mjs        # copies jquery/lodash/three from node_modules into inputs/ and builds broken variants
node compat.mjs  > compat.out.jsonl     # ESTree / acorn-walk / eslint-scope compatibility on every input
node recovery.mjs > recovery.out.jsonl  # mid-edit fault matrix
node bench.mjs   > bench.out.jsonl      # speed + memory, one child process per (parser, file)
node bundle-size.mjs                    # esbuild-minified + gzipped added size
node npm-meta.mjs                       # release cadence from the npm registry
node ts-converter-probe.mjs             # TypeScript-recovered tree converted to ESTree
node minified-fault.mjs                 # faults in minified files: acorn-loose vs the TypeScript route
node leak-probe.mjs                     # why acorn-loose leaks locals on broken jquery.js
node treesitter.mjs                     # tree-sitter (WASM): times and error nodes
node prescan.mjs walk-cost.mjs offsets.mjs
```

`parsers.mjs` holds the adapter for each parser. The oxc WASM adapter loads
`@oxc-parser/binding-wasm32-wasip1/browser-bundle.js` with a `fetch` shim
because the Node WASI loader in oxc-parser 0.155.0 fails. The survey explains
why.
