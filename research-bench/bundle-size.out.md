| Entry | min KB | min+gz KB |
|---|---:|---:|
| current: acorn+acorn-loose+acorn-walk+eslint-scope | 189 | 51 |
| acorn+acorn-walk (no loose) | 124 | 35 |
| acorn-loose (alone, shares acorn) | 151 | 41 |
| eslint-scope (+esrecurse+estraverse) | 32 | 9 |
| meriyah | 116 | 32 |
| @babel/parser | 282 | 70 |
| espree (pulls acorn, acorn-jsx, eslint-visitor-keys) | 256 | 73 |
| oxc-parser JS glue (native loader; excludes .node) | 24 | 4 |
| @swc/core JS glue (excludes .node) | 28 | 8 |
| @swc/wasm JS glue (excludes .wasm) | 11 | 3 |
| @typescript-eslint/typescript-estree (+typescript) | 3813 | 1089 |
| typescript (whole compiler; createSourceFile not tree-shakeable) | 3492 | 1002 |

| Artifact | KB | gz KB |
|---|---:|---:|
| oxc-parser linux-x64-gnu .node | 2096 | 894 |
| oxc-parser wasm32-wasip1 .wasm | 1449 | 477 |
| oxc-parser browser-bundle.js (wasm glue incl. emnapi runtime) | 504 | 85 |
| @swc/core linux-x64-gnu .node | 10421 | 10042 |
| @swc/wasm wasm_bg.wasm | 17610 | 5245 |
