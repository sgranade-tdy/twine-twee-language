# Survey: JavaScript parsers for whole-file parsing

- **Ticket**: `.scratch/js-file-variables/issues/03-js-parser-library-survey.md`
- **Date**: 2026-10-26
- **Question**: Would a parser other than Acorn + acorn-loose + eslint-scope
  handle whole local `.js` files better? We need files from a few KB up to 1 MB,
  including minified code, ES modules and files broken mid-edit. The bar is
  beating the current stack on whole-file cost or robustness without breaking
  ESTree.
- **Harness**: `research-bench/` on this branch. Its `README.md` explains how to
  reproduce every number below.

This document reports facts only. It makes no decision.

## Summary

Each speed cell is the median warm parse time on jquery.js (279 KB) and
three.core.js (1.4 MB). The "broken file" column covers 8 mid-edit faults
inserted into jquery.js; see [Error recovery](#error-recovery). Sizes are what
the parser adds to an esbuild-minified bundle, minified and then gzipped.

| Parser | AST | Warm parse, jquery / three.core (ms) | Broken file (8 faults in jquery.js) | Node ext host | Web ext host | Added size | Releases/12 mo; versioning |
|---|---|---|---|---|---|---|---|
| **acorn** (current, strict) | ESTree | 8.4 / 37 | throws on all 8 | ✅ pure JS | ✅ pure JS | baseline | 4; 8.x since 2020 |
| **acorn-loose** (current fallback) | ESTree | 8.8 / 36 | always returns an AST, but unbound references go from 186 to ~786 (locals leak) | ✅ | ✅ | baseline | 0; last release 2025-07 |
| **meriyah** 7.4.1 | ESTree, identical to acorn on all 7 valid inputs | 7.3 / 28 | throws on all 8 (no recovery) | ✅ pure JS | ✅ pure JS | +116 KB / +32 KB | 11; 3 majors in 2024–25 |
| **oxc-parser** 0.155.0, native | ESTree, identical to acorn | 19.5 / 59 by default; **4.7 / 14** with `experimentalRawTransfer` | returns an *empty* `Program` on all 8 | ⚠️ needs a per-platform `.node` (2.0 MB on linux-x64) | ❌ native | +24 KB / +4 KB of JS, plus a 2.0 MB / 0.9 MB binary per platform | 57; 0.x (minor = breaking) |
| **oxc-parser**, WASM | ESTree, identical | 18 / 75 | empty `Program` on all 8 | ⚠️ Node WASI loader broken in 0.155.0 (observed) | ✅ in principle | +504 KB / +85 KB glue, plus 1.4 MB / 0.5 MB `.wasm` | as above |
| **@babel/parser** 8.0.8 (`estree` plugin, `errorRecovery`) | ESTree via plugin; same scope results as acorn | 12 / 52 | throws on all 8 in jquery.js; recovered 2 of 8 in story.js | ⚠️ v8 `engines` needs Node ^22.18 | ✅ pure JS | +282 KB / +70 KB | 14; v8 released 2026-06 |
| **@swc/core** / **@swc/wasm** 1.16.20 | **swc AST, not ESTree** (1-based UTF-8 byte spans) | native 25 / 92; WASM 20 / 71 | throws on all 8 | ⚠️ 10.4 MB `.node` per platform | WASM only, 17.6 MB | +10 MB (native) or +5.2 MB gz (WASM) | 34 |
| **@typescript-eslint/typescript-estree** 8.72.1 | ESTree (TS-ESTree); `range` only, no `start`/`end` | 36 / 171 | throws on all 8 (rejects any parse diagnostic) | ✅ pure JS | ✅ pure JS | +3,813 KB / +1,089 KB (bundles `typescript`) | 47; peer `typescript <6.1` |
| TypeScript parser → ts-estree's internal `Converter` (a hack) | ESTree | ~50–90 including conversion | **structure kept for 6 of 8** (unbound 187–189 vs 186 clean); `Converter` crashed on 2 | ✅ | ✅ | +3.5 MB / +1.0 MB | TS 7 (2026-07) is Go-native |
| **tree-sitter** (web-tree-sitter 0.27 + tree-sitter-javascript 0.25) | **CST, not ESTree** | 24 / 95 | always returns a tree; mixed quality | ✅ WASM | ✅ WASM | +75 KB / +20 KB JS, plus 607 KB / 132 KB `.wasm` | n/a |
| **esbuild** | **No AST API** (a stated non-goal) | n/a | n/a | n/a | n/a | n/a | n/a |
| espree (ESLint's parser, built on Acorn) | ESTree | 10.4 / 44 | throws on all 8 | ✅ | ✅ | +256 KB / +73 KB | 4 |

**Current-stack size for reference**: acorn + acorn-loose + acorn-walk +
eslint-scope (with esrecurse and estraverse) bundles to **189 KB minified /
51 KB gzipped**. Of that, eslint-scope accounts for 32 KB / 9 KB.

## Context and runtime constraints

- **Uses of the current stack.** `server/src/js-parser.ts` has 1,475 lines. It
  imports `acorn`, `acorn-loose`, `acorn-walk` and `eslint-scope`.
  - The parser is called in exactly two functions: `parseJSStrict` (through
    `ParserWithState`) and `parseJS` (strict first, then `acornLoose.parse` on
    a `SyntaxError`).
  - It refers to `acorn.*` types 33 times, across 8 types: `AnyNode`,
    `Expression`, `Identifier`, `MemberExpression`, `Node`, `ObjectExpression`,
    `Pattern` and `Super`. It makes 3 `acornWalk.fullAncestor` passes.
  - It reads `.start`/`.end` 21 times and never reads `.range`.
  - Outside `js-parser.ts`, `chapbook-parser.ts` and `sc2-twinescript.ts` call
    `parseJSStrict`. `chapbook-parser.ts` also imports `acorn`/`acorn-walk`
    directly.
- **`server/src/acorn-errors/` is Acorn-specific throughout (1,284 lines).**
  - `parser-state.ts` subclasses `acorn.Parser` and reads `this.context` and
    `this.type` (ADR-0001).
  - `parse-failure.ts` re-tokenizes with `acorn.tokenizer` and matches on
    Acorn's `token.type.label` strings.
  - `rules.ts` is written against those labels.
  - `dejargon.ts` rewrites Acorn's message strings.
- **Build.** `esbuild.jsx` bundles `client/src/extension.ts` and
  `server/src/server.ts` with `platform: "node"`, `format: "cjs"` and `bundle:
  true`. Only `vscode` is external. Native `.node` files and `.wasm` files
  can't be inlined into that bundle; they would have to ship beside it.
- **No web-extension target today.** The root `package.json` has `main` and no
  `browser` entry, and it declares `"virtualWorkspaces": { "supported": false }`.
  VS Code's guide says that "Extensions that have only a `main` entry point,
  but no `browser` are not web extensions". The web extension host runs in a
  browser WebWorker with "no longer [access] to the Node.js APIs and module
  loading", and the code "must be packaged to a single file"
  ([Web Extensions guide](https://code.visualstudio.com/api/extension-guides/web-extensions)).
  So for a future web target, native addons are out, WASM would need loading
  through `fetch`, and pure JS bundles as-is.
- **Node floor.** `engines.vscode` is `^1.90.0`. VS Code 1.90 shipped
  Electron 29 ([1.90 release notes](https://code.visualstudio.com/updates/v1_90)),
  which carries Node 20.9.0 ([Electron releases feed](https://releases.electronjs.org/releases.json)).
  Some candidates' `engines` fields ask for more:
  - oxc-parser: `^20.19.0 || >=22.12.0`
  - @babel/parser 8: `^22.18.0 || >=24.11.0`
  - meriyah: `>=20.0.0`
  - acorn: `>=0.4.0`
- **Native binaries in a VSIX** need VS Code's
  [platform-specific extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions)
  ("so you can control the exact binaries that are included in a platform
  package"). The alternative is to ship every platform's binary.

## Per-candidate findings

### Acorn + acorn-loose (current baseline)

- **Speed.** Strict Acorn takes 8.4 ms on jquery.js and 37 ms on the 1.4 MB
  three.core.js (warm). Cold first parses take 27 ms and 100 ms.
- **Recovery is the weak point on whole files.** acorn-loose's README says it
  "will, to recover from missing brackets, treat whitespace as significant,
  which has the downside that it might mis-parse a valid but weirdly indented
  file" ([acorn-loose README](https://github.com/acornjs/acorn/blob/master/acorn-loose/README.md)).
  Three measurements bear that out:
  - **Unindented factory bodies.** jQuery's factory body isn't indented. A
    one-line fault in the middle of jquery.js makes acorn-loose close the
    outer factory function at the fault. The result has **156 top-level
    statements** instead of 1, and eslint-scope's `globalScope.through` grows
    from **186 to ~786**. The extra references come from 61 distinct names,
    led by `jQuery` (×354), `undefined`, `window`, `dataPriv`, `document` and
    `isFunction` (`leak-probe.mjs`). Under ADR-0003 these unbound names are
    story-variable candidates. This happens for every fault type tried.
  - **Valid minified code.** On *valid* `lodash.min.js`, acorn-loose
    mis-parses. Unbound references go from 40 to 869, two dummy identifiers
    appear, and some reported ranges don't match the source text. `parseJS`
    only uses loose after strict fails, so this matters only once a minified
    file is broken. On lodash.min.js plus `foo(bar`, acorn-loose gives
    **1,832** unbound references, against 40 clean.
  - **Normally indented code.** On `story.js`, which is indented normally,
    acorn-loose recovers well: unbound references stay at 188–191, against 188
    clean.
- **Maintenance.** acorn had 4 releases in the last 12 months (latest 8.19.0,
  2026-10-05). acorn-loose had none; its last release was 8.5.2 on 2025-07-01.
  One maintainer wrote 32 of 36 commits to `acorn/src` and all 3 to
  `acorn-loose/src` in that time.

### meriyah

- **ESTree.** "Emits an ESTree-compatible abstract syntax tree"
  ([README](https://github.com/meriyah/meriyah/blob/main/README.md)). It was
  measured identical to Acorn for our purposes on all 7 valid inputs:
  - the same Identifier counts
  - the same eslint-scope scope counts
  - the same `through` sets, compared by name and offset
  - `ranges: true` gives the `range` that eslint-scope needs, plus
    `start`/`end`

  acorn-walk walks the tree unchanged.
- **Speed.** It is the fastest pure-JS parser measured: 7.3 ms on jquery.js
  and 23–28 ms on three.core.js, against Acorn's 8.4 ms and 36–39 ms. Repeat
  runs on jquery.min.js gave 4.4–4.6 ms, against 7.5–10 ms for Acorn. Retained
  memory is the same as Acorn's.
- **Recovery.** None. It threw on all 3 broken files and on all 8 faults. Its
  error messages are sometimes more specific than Acorn's, for example
  "Unexpected character after object literal property name".
- **Changes needed.** Only the whole-file parse call. ADR-0001's
  `ParserWithState` and `acorn-errors/` can't run on it, so Acorn would stay
  for snippets and error messages, and acorn-loose would stay for broken files.
- **Size and maintenance.** +116 KB / +32 KB gz. 11 releases in 12 months, and
  majors 5, 6 and 7 between 2024-07 and 2025-11. 15 authors committed to `src`
  in 12 months; the top three made 18, 13 and 12 commits.

### oxc-parser (native and WASM)

- **ESTree.** The README says: "When parsing JS or JSX files, the AST returned is
  fully conformant with the ESTree standard, the same as produced by Acorn …
  Any deviation would be considered a bug"
  ([oxc-parser README](https://github.com/oxc-project/oxc/tree/main/napi/parser),
  shipped in the npm package).
  - Two options are needed. `preserveParens` defaults to `true`, which emits a
    non-standard `ParenthesizedExpression`, so it must be set to `false`.
    `range: true` is needed for eslint-scope.
  - With those options the AST was identical to Acorn's on all 7 valid inputs,
    and offsets are UTF-16 indexes, the same as Acorn's (`offsets.mjs`).
  - `Program` gets a non-standard `hashbang` field.
- **Speed.**
  - Default `parseSync` (native) is **slower** than Acorn warm: 19.5 ms on
    jquery.js and 59 ms on three.core.js. The time goes into building JS
    objects from the native AST.
  - `experimentalRawTransfer: true` is the fastest of everything measured:
    4.7 ms and 13–16 ms, roughly 2–3× faster than Acorn warm. Cold first
    parses are about 25 ms and 51–64 ms, close to Acorn's 27 ms and 95–100 ms.
  - The option is explicitly experimental, and `rawTransferSupported()`
    gates it per platform.
  - Retained AST memory is the same as Acorn's, because the AST ends up as JS
    objects either way.
- **Recovery is worse than acorn-loose for this use.** The oxc_parser docs say
  that "When the parser cannot recover, it will abort and terminate parsing
  early. `program` will be empty and `fatal_error` will be `true`"
  ([docs.rs `ParserReturn`](https://docs.rs/oxc_parser/latest/oxc_parser/struct.ParserReturn.html)).
  Every fault tried was fatal: all 3 broken files and all 8 inserted faults in
  both jquery.js and story.js returned `body: []` and one error. The messages
  name the expected token, for example "Expected `,` or `}` but found `.`".
- **Runtimes.**
  - **Native** needs one `.node` file per platform; the linux-x64-gnu one is
    2.0 MB, and there are 19 optional platform packages. That means
    platform-specific VSIXes or shipping every binary.
  - **WASM**: `NAPI_RS_FORCE_WASI` failed to load in 0.155.0 with both WASI
    packages.
    - `@oxc-parser/binding-wasm32-wasip1` pins `@emnapi/* 2.0.0-alpha.6`,
      while `@napi-rs/wasm-runtime@1.2.6`, the latest, pulls emnapi 1.x. The
      errors were `this.bridge.setLastError is not a function` and `Cannot set
      properties of undefined (setting 'initWorker')`.
    - The self-contained `browser-bundle.js` does work when given a `fetch`
      shim. It parses at 18 ms on jquery.js and 75 ms on three.core.js.
    - Raw transfer wasn't tried on WASM.
- **Maintenance.** 57 releases in 12 months, all `0.x`; npm lists 1
  maintainer. The repository is large and active: in 12 months, 16 authors made
  484 commits to `crates/oxc_parser` and 290 to `napi/parser`. Under 0.x
  semver, any minor release may break the API.
- **Changes needed.** Only the whole-file parse call. The tree is ESTree, so
  the walks and eslint-scope are unchanged. But a broken file yields *nothing*,
  so acorn-loose (or a "keep last good result" policy) is still needed for
  recovery. `acorn-errors/` can't use it.

### @babel/parser (with the `estree` plugin)

- **ESTree.** The `estree` plugin gives an ESTree-shaped AST, and `ranges: true`
  adds `range`. eslint-scope results matched Acorn's on all 7 valid inputs.
- **Recovery.** The docs say that with `errorRecovery` "it will store the parsing
  error and try to continue parsing … Note that even when this option is
  enabled, `@babel/parser` could throw for unrecoverable errors"
  ([Babel parser docs](https://babeljs.io/docs/babel-parser)).
  - In jquery.js, all 8 faults and all 3 broken files threw.
  - In story.js it recovered from the trailing-dot faults (`foo.` and
    `State.variables.`) and threw on the other 5. The 8th fault, a bare
    `func`, is valid JS there; every parser accepted it.
  - The thrown messages carry the expected token, for example `Unexpected token,
    expected ","`.
- **Speed and memory.** It is slower than Acorn (12 ms and 52 ms) and retains
  **about twice the memory**: 13.1 MB against 6.4 MB on jquery.js, and 52 MB
  against 23 MB on three.core.js.
- **Runtime and size.** Babel 8's `engines` field is `^22.18.0 || >=24.11.0`,
  above the extension's Node 20.9 floor; Babel 7 would avoid that. +282 KB /
  +70 KB gz.
- **Maintenance.** 14 releases in 12 months; v8.0 was released 2026-06. In 12
  months, 9 authors committed to `packages/babel-parser`, with 59 of 111
  commits from one person.

### swc (@swc/core native, @swc/wasm)

- **Not ESTree.** Nodes carry `span: {start, end}` with **1-based UTF-8 byte
  offsets**. Measured: for `let é = x;`, `x` has `span.start` 10, where the
  JS string index is 8. Identifiers use `value`, not `name`, and there is no
  `range`. Neither eslint-scope nor acorn-walk can run on it, so every
  traversal in `js-parser.ts` would need rewriting or an adapter.
- **Recovery.** It threw on all 8 faults and all 3 broken files. The WASM
  build's exception message was `undefined`.
- **Speed.** Slower than Acorn in this harness, because the AST is
  deserialized into JS: native 25 ms and 92 ms, WASM 20 ms and 71 ms.
- **Size.** The `.node` file is 10.4 MB per platform, and the `.wasm` file is
  17.6 MB (5.2 MB gzipped).
- **Maintenance.** 34 releases in 12 months; npm lists 1 maintainer. In 12
  months, 18 authors committed to `crates/swc_ecma_parser`, with 69 of 177
  commits from one person.

### esbuild

- **No AST is exposed.** esbuild's FAQ lists "An API for custom AST
  manipulation" among the features it does not plan to include in esbuild's
  core ([esbuild FAQ, "Upcoming roadmap"](https://esbuild.github.io/faq/#upcoming-roadmap)).
  Its author calls this "out of scope for esbuild" and points to swc instead
  ([evanw/esbuild#1297](https://github.com/evanw/esbuild/issues/1297)).
  `esbuild/lib/main.d.ts` 0.28.2 has no parse or AST entry point. esbuild is
  therefore not a candidate. It stays the extension's bundler.

### @typescript-eslint/typescript-estree, and TypeScript's own parser

- **ts-estree as shipped.** It gives an ESTree AST: eslint-scope matched Acorn
  on all 7 valid inputs. But nodes have `range` and **no `start`/`end`**, and
  `js-parser.ts` reads `.start`/`.end` 21 times.
  - It throws on *any* parse diagnostic. `astConverter` runs `if
    (parseDiagnostics.length) throw convertError(parseDiagnostics[0])` before
    converting (`dist/ast-converter.js`, lines 13–16).
  - So it threw on every fault.
  - It is 3–5× slower than Acorn (36 ms and 171 ms) and retains about 3× the
    memory (18 MB and 74 MB).
  - It adds 3.8 MB / 1.1 MB gz, because it bundles `typescript`.
- **TypeScript's parser recovers best.** `ts.createSourceFile` (TS 6.0.3)
  kept jQuery's single top-level statement on all 3 broken files.
- **Converting that tree with ts-estree's unexported `Converter`** (in
  `dist/convert.js`, with `allowInvalidAST: true`, in
  `ts-converter-probe.mjs`) gives ESTree that eslint-scope accepts. On jquery.js
  faults, the unbound-reference count was **187–189, against 186 clean**, for
  `foo.`, `var a = ;`, `State.variables.` and the three broken files.
  acorn-loose gave ~786 on the same inputs.
  - On minified lodash.min.js plus a fault, the count was 41–42, against
    acorn-loose's 870–1,832.
  - The `Converter` **crashed** on `foo(bar` and `if (x {`, with "Cannot set
    properties of null (setting 'typeAnnotation')".
  - An extra `}` splits the file under every parser, TypeScript included:
    156 top-level statements and 786 unbound references.
  - This route relies on an unexported internal, so it would have the same
    "undocumented internals" risk ADR-0001 accepts for Acorn, and more of it.
- **Longevity.** typescript 7.0 (2026-07-08) ships per-platform native binaries
  (`@typescript/typescript-<platform>` dependencies) and exposes only
  `./unstable/*` JS entry points. ts-estree 8.72.1 declares the peer
  `typescript >=4.8.4 <6.1.0`. So the JS-implemented TypeScript parser this
  route relies on is the 6.x line.
- **Maintenance.** ts-estree had 47 releases in 12 months; 26 authors committed
  to `packages/typescript-estree`.

### tree-sitter (WASM), tried as "anything else"

- **Not ESTree.** It produces a concrete syntax tree with `ERROR`/`MISSING`
  nodes, so a rewrite or adapter would be needed for eslint-scope and the
  walks.
- **Speed.** Parsing is about 2–3× slower than Acorn warm: 24 ms on jquery.js
  and 95 ms on three.core.js.
- **Recovery is mixed.** These are the top-level child counts, where a clean
  jquery.js gives 2:
  - **Kept**: `broken-midedit` (2), `if (x {` (2) and an extra `}` (2).
  - **Fragmented**: a truncated file (234 children) and `foo(bar` (340
    children, 254 error nodes).
- **Size.** +75 KB / +20 KB of JS, plus 607 KB / 132 KB gz of `.wasm`.

### espree

espree is Acorn with ESLint's extensions, and was included as a control. Its
output was identical to Acorn's, it was about 20% slower, and it has no
recovery. It has no advantage here.

## Benchmark method

- **Machine.** Node 24.19.0 on x86_64 Linux with 8 cores, mostly idle (load
  0.2).
- **Package versions.**
  - acorn 8.18.0, acorn-loose 8.5.2, acorn-walk 8.3.5, eslint-scope 9.1.2
  - meriyah 7.4.1
  - oxc-parser 0.155.0
  - @babel/parser 8.0.8
  - @swc/core and @swc/wasm 1.16.20
  - @typescript-eslint/typescript-estree 8.72.1, typescript 6.0.3
  - espree 11.2.0
  - web-tree-sitter 0.27.1 with tree-sitter-javascript 0.25.0
- **Inputs** (`make-inputs.mjs`), in KB:

  | File | KB | Notes |
  |---|---:|---|
  | `story.js` | 7.6 | synthetic SugarCube story script |
  | `jquery.min.js` | 85 | minified |
  | `lodash.min.js` | 71 | minified |
  | `jquery.js` | 279 | jquery 3.7.1 |
  | `lodash.js` | 531 | lodash 4.17.21 |
  | `three.module.js` | 647 | ES module, three 0.186.1 |
  | `three.core.js` | 1,424 | ES module |
  | `broken-midedit.js` | 279 | `foo.bar(baz.` inserted at the middle of jquery.js |
  | `broken-string.js` | 279 | an unterminated string inserted at the same point |
  | `broken-truncated.js` | 167 | jquery.js cut at 60% |

  The midpoint of jquery.js falls inside a `jQuery.extend({ … })` object
  literal, so faults there are in property position.
- **Parser options.** Each adapter is called the way `js-parser.ts` calls Acorn:
  `ecmaVersion: "latest"`, ranges on, and `sourceType` set to module when the
  file contains `import`/`export`. Each parser's equivalents are in
  `parsers.mjs`.
- **Speed** (`bench.mjs`). Each (parser, file) pair runs in a fresh child
  process.
  - Module load time and the first (cold) parse are timed.
  - Then come 3 warm-ups, followed by at least 5 and at most 40 timed parses
    within 2 s, of which the median is taken.
  - Repeat runs of acorn, meriyah and oxc with raw transfer varied by about
    ±10%.
  - **Retained memory** is measured after a double `gc()`: the change in
    `heapUsed + external + arrayBuffers` across one parse whose result is kept
    alive.
- **Compatibility** (`compat.mjs`). For each parse: did `acornWalk.fullAncestor`
  complete, did `eslintScope.analyze` (ecmaVersion 2026, `optimistic: true`)
  complete, did every `globalScope.through` reference's `range` slice back to
  its name, and did the through set, compared by name and offset, match
  Acorn's.

### Warm parse time, median ms

| Parser | load | story.js | jquery.min | lodash.min | jquery | lodash | three.module | three.core | broken-midedit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| acorn | 3.8 | 0.4 | 7.5–10 | 6.2 | 8.4 | 8.9 | 18.5 | 36–39 | throws |
| acorn-loose | 4.7 | 0.5 | 5.9 | 5.1 | 8.8 | 8.9 | 16.4 | 35.5 | 9.3 |
| acorn → loose (`parseJS`) | 5.1 | 0.6 | 7.2 | 6.3 | 8.7 | 8.6 | 16.3 | 36.2 | 12.8 |
| espree | 6.4 | 0.7 | 7.3 | 7.4 | 10.4 | 10.1 | 21.3 | 44.2 | throws |
| meriyah | 3.9 | 0.2 | 4.4–4.6 | 4.6 | 7.3 | 7.8 | 9.2 | 23–28 | throws |
| oxc native | 5.0 | 0.8 | 18.3 | 16.0 | 19.5 | 18.3 | 25.7 | 59.1 | 1.4 (empty) |
| oxc native, raw transfer | 7.1 | 0.2 | 3.4 | 3.0 | 4.7 | 5.7 | 6.3 | 13–16 | 1.5 (empty) |
| oxc WASM (browser bundle) | 40.6 | 1.0 | 13.8 | 12.3 | 18.0 | 23.2 | 27.9 | 74.7 | 2.9 (empty) |
| @babel/parser | 7.0 | 0.5 | 9.6 | 6.4 | 12.0 | 14.5 | 17.9 | 52.4 | throws |
| typescript-estree | 48.8 | 1.5 | 32.7 | 28.2 | 35.9 | 37.8 | 71.1 | 170.6 | throws |
| @swc/core | 14.2 | 0.9 | 21.9 | 20.5 | 25.3 | 25.6 | 38.0 | 91.6 | throws |
| @swc/wasm | 31.9 | 1.0 | 18.1 | 17.2 | 20.3 | 20.4 | 31.6 | 70.5 | throws |
| ts.createSourceFile (not ESTree) | 0.9 | 0.5 | 7.2 | 5.9 | 7.1 | 14.5 | 14.0 | 43.1 | 7.5 |
| tree-sitter WASM (not ESTree) | 7.8 | 1.9 | 17.5 | 14.6 | 23.6 | 28.4 | 46.1 | 94.5 | 24.3 |

### Cold (first-call) parse, ms

| Parser | jquery | three.core |
|---|---:|---:|
| acorn | 26.6 | 94–100 |
| meriyah | 25.9 | 62–66 |
| oxc native, raw transfer | 25.3 | 51–64 |
| oxc WASM | 59.2 | 120.3 |
| @babel/parser | 44.4 | 134.9 |
| typescript-estree | 91.9 | 298.7 |

### Retained AST memory, MB

| Parser | jquery.min | jquery | three.module | three.core |
|---|---:|---:|---:|---:|
| acorn / acorn-loose | 5.7 | 6.4 | 11.3 | 23.4 |
| meriyah | 5.3 | 5.9 | 11.6 | 23.4 |
| oxc (any mode) | 4.9–5.5 | 5.4–6.0 | 10.2–11.2 | 23.1–23.5 |
| @babel/parser | 11.5 | 13.1 | 23.4 | 52.0 |
| typescript-estree | 17.0 | 18.0 | 34.0 | 73.8 |

### The rest of the current pipeline, on Acorn's AST

These were measured separately, not end to end; ticket 04 covers end-to-end
runs.

- eslint-scope `analyze` takes 4.4 ms on jquery.js and 16.4 ms on
  three.core.js. It took about the same on every ESTree parser's AST, except
  ts-estree's: 6 ms and 30 ms.
- One `acornWalk.fullAncestor` pass takes 2.1 ms and 9.9 ms, and
  `tokenizeJavaScript` makes 3 such passes.

On three.core.js that adds up as follows:

| Stage | ms |
|---|---:|
| Acorn parse | ~37 |
| eslint-scope | ~16 |
| 3 walk passes | ~30 |
| **Total** | **~83** |

Swapping the parser alone for oxc with raw transfer (~14 ms) would make that
about 60 ms.

### Error recovery

`recovery.mjs` inserts one fault at a statement or property boundary.
`minified-fault.mjs` and `ts-converter-probe.mjs` cover minified inputs and the
TypeScript route. Each cell shows `Identifier count / globalScope.through
count`. T means the parser threw; E means it returned an empty `Program`.

| Parser, file (clean) | `foo.` | `foo(bar` | `if (x {` | `var a = ;` | `"abc;` | extra `}` | `State.variables.` |
|---|---|---|---|---|---|---|---|
| acorn-loose, jquery (9671/186) | 9673/786 | 9674/788 | 9673/786 | 9674/785 | 9673/785 | 9672/786 | 9673/786 |
| acorn-loose, story.js (435/188) | 436/189 | 437/190 | 436/189 | 437/189 | 436/188 | 435/191 | 436/189 |
| acorn, meriyah, espree, swc, ts-estree (both files) | T | T | T | T | T | T | T |
| oxc, all modes (both files) | E | E | E | E | E | E | E |
| @babel/parser, jquery | T | T | T | T | T | T | T |
| @babel/parser, story.js | 436/189 | T | T | T | T | T | 436/189 |
| TS → ts-estree `Converter`, jquery (through only) | 188 | crash | crash | 188 | 187 | 786 | 188 |
| acorn-loose, lodash.min (through only, 869 clean under loose, 40 strict) | 870 | 1832 | — | 870 | — | — | 870 |
| TS → `Converter`, lodash.min | 41 | 42 | — | 41 | — | — | 41 |

The fault `func` (a bare identifier) was also inserted. It is valid JS in
story.js, and in jquery.js it is an error in property position.

## Bundle size

Measured with `bundle-size.mjs`: a minimal entry per package, bundled with
esbuild using `bundle`, `minify`, `cjs` and `platform: "node"`, then gzipped at
level 9.

| Entry | min KB | min+gz KB |
|---|---:|---:|
| **current**: acorn + acorn-loose + acorn-walk + eslint-scope | 189 | 51 |
| acorn + acorn-walk only | 124 | 35 |
| eslint-scope (+ esrecurse + estraverse) | 32 | 9 |
| meriyah | 116 | 32 |
| @babel/parser | 282 | 70 |
| espree | 256 | 73 |
| oxc-parser JS glue (excludes `.node`) | 24 | 4 |
| @swc/core JS glue (excludes `.node`) | 28 | 8 |
| @swc/wasm JS glue (excludes `.wasm`) | 11 | 3 |
| typescript-estree (+ typescript) | 3,813 | 1,089 |
| typescript alone | 3,492 | 1,002 |
| web-tree-sitter JS | 75 | 20 |

Binary artifacts can't be bundled into the JS file:

| Artifact | KB | gz KB |
|---|---:|---:|
| oxc-parser `linux-x64-gnu.node` (one of 19 platforms) | 2,096 | 894 |
| oxc-parser `wasm32-wasip1.wasm` | 1,449 | 477 |
| oxc `browser-bundle.js` (WASM glue with the emnapi runtime) | 504 | 85 |
| @swc/core `linux-x64-gnu.node` | 10,421 | 10,042 |
| @swc/wasm `wasm_bg.wasm` | 17,610 | 5,245 |
| web-tree-sitter `.wasm` + tree-sitter-javascript `.wasm` | 607 | 132 |

## Maintenance

Release data comes from the npm registry (`npm-meta.mjs`), and commit counts
from the GitHub API, `commits?path=…&since=2025-10-26`.

| Package | Latest (date) | Stable releases, last 12 mo | Recent majors | Path, authors / commits in 12 mo |
|---|---|---:|---|---|
| acorn | 8.19.0 (2026-10-05) | 4 | 8.x since 2020-08 | `acorn/src`: 5 / 36 (32 from one maintainer) |
| acorn-loose | 8.5.2 (2025-07-01) | 0 | 8.x since 2020-08 | `acorn-loose/src`: 1 / 3 |
| eslint-scope | 9.1.2 (2026-03-06) | 4 | 8.x 2024-01, 9.x 2025-11 | `eslint/js` `packages/eslint-scope`: 10 / 67 |
| meriyah | 7.4.1 (2026-10-25) | 11 | 5.x 2024-07, 6.x 2024-09, 7.x 2025-11 | `src`: 15 / 69 |
| oxc-parser | 0.155.0 (2026-10-19) | 57 | 0.x; every minor may break | `crates/oxc_parser`: 16 / 484 |
| @babel/parser | 8.0.8 (2026-10-23) | 14 | 8.x 2026-06 | `packages/babel-parser`: 9 / 111 |
| @swc/core | 1.16.20 (2026-10-22) | 34 | 1.x since 2019 | `crates/swc_ecma_parser`: 18 / 177 |
| typescript-estree | 8.72.1 (2026-10-26) | 47 | 8.x since 2024-07 | `packages/typescript-estree`: 26 / 127 |
| typescript | 7.0.2 (2026-07-08) | 3 | 6.x 2026-03, 7.x (Go-native) 2026-07 | — |

## Change-surface estimate, per option

- **Replace Acorn everywhere** with any candidate. `acorn-errors/` (1,284
  lines) would have to be rewritten or dropped, because ADR-0001's subclass,
  the `acorn.tokenizer` re-tokenization and the rules keyed on Acorn token
  labels are all Acorn-specific. `chapbook-parser.ts` and `sc2-twinescript.ts`
  also call `parseJSStrict`.
- **Use an ESTree candidate for whole files only** (meriyah, oxc or Babel).
  - About a dozen lines would change: a second parse call next to
    `parseJSStrict`/`parseJS`, plus the options mapping (`next`/`ranges`;
    `preserveParens: false`/`range`; `plugins: ["estree"]`/`ranges`).
  - The 33 `acorn.*` type annotations would keep working, because the shapes
    are identical, as measured.
  - `acorn-errors/` stays as is. Diagnostics on `.js` files are out of scope,
    per `.scratch/js-file-variables/map.md`.
- **ts-estree.** Because it has no `start`/`end`, the 21 `.start`/`.end` reads
  would need a shim, or a pass adding them.
- **Non-ESTree options** (swc, tree-sitter, raw TypeScript). Every traversal in
  `js-parser.ts` would need rewriting, and eslint-scope would need replacing or
  an adapter that converts the tree to ESTree. That is roughly a rewrite of
  `annotateVariableScopes`, `extractSymbols`, `computeSemanticTokens` and their
  helpers: most of the file's 1,475 lines.

## Hybrid options

These are described, not recommended.

1. **Acorn for snippets, a faster ESTree parser for whole files.** Keep
   `ParserWithState`, `acorn-errors/` and acorn-loose for passages. Parse whole
   files strictly with meriyah (pure JS) or oxc (native, raw transfer), and
   fall back to acorn-loose on failure. Downstream code is unchanged, because
   the ASTs are identical.
   - Parse time on valid files drops from 8.4 to 7.3 ms on jquery.js with
     meriyah, or to 4.7 ms with oxc raw transfer. On three.core.js it drops
     from 37 to 23–28 ms (meriyah) or 13–16 ms (oxc).
   - Recovery stays exactly as good as acorn-loose, because neither candidate
     recovers.
   - Adds +32 KB gz with meriyah. With oxc it adds per-platform binaries and a
     0.x dependency.
2. **Acorn strict, then TypeScript recovery** instead of acorn-loose, for whole
   files only. In this data it is the only route that kept scope structure on
   most broken whole files: 187–189 unbound references, against acorn-loose's
   ~786. Against that:
   - it adds +1 MB gz
   - it relies on an unexported ts-estree internal that crashed on 2 of 8
     faults
   - it ties the extension to TypeScript 6.x's JS API
   - the conversion cost is ~50 ms on jquery.js
3. **No recovery for whole files: keep the last good index.** On a strict-parse
   failure, keep the occurrences from the file's last successful parse instead
   of indexing a loose AST. No parser change is needed, and acorn-loose's
   leaked-locals junk is avoided. oxc's empty-`Program` behaviour fits this
   model naturally.
4. **A cheap pre-scan before parsing** (`prescan.mjs`). A regex for story-API
   uses (`State.variables`, `variables()`, `temporary()`, `engine.state`) plus
   an average-line-length check for minification takes 0.1 ms on jquery.min.js,
   0.7 ms on jquery.js and 4.6 ms on three.core.js. None of the vendor files
   matched the regex. Whether a pre-scan can decide that a file has no story
   variables depends on ticket 05: under ADR-0003's "unbound ⇒ story variable"
   rule, any identifier could qualify. The line-length heuristic needs no
   semantics decision.
5. **oxc native with a pure-JS fallback.** Load the oxc binary where one exists
   and fall back to Acorn or meriyah elsewhere, including any future web build.
   The ASTs are interchangeable, but this means two parse paths to test.

## Conclusion (facts only)

- **Speed.** Two candidates beat the current stack's whole-file parse time and
  keep ESTree:
  - meriyah: about 10–35% faster warm, pure JS, +32 KB gz.
  - oxc-parser with `experimentalRawTransfer`: about 2–3× faster warm, native
    binaries per platform, 0.x versioning.

  On three.core.js, parsing is roughly 45% of the measured
  parse + scope + walk cost. Retained memory is the same for both.
- **Recovery.** No measured ESTree parser recovers better than acorn-loose in
  a usable form:
  - meriyah, swc, espree and ts-estree throw.
  - oxc returns an empty program on every fault tried.
  - Babel's `errorRecovery` recovered 2 of 16 fault cases.
  - acorn-loose always returns a tree. But on unindented or minified whole
    files, its whitespace-driven recovery turned most of a file's locals into
    unbound references.
  - The TypeScript-based route was the only one that preserved structure on
    most broken whole files, at +1 MB gz, through an unexported internal, and
    with crashes on 2 of 8 faults.
- **Non-starters.** swc and tree-sitter don't produce ESTree. esbuild exposes
  no AST.
- **Runtime constraints.** The extension has no web target today. Pure-JS
  options (acorn, meriyah, Babel) have no runtime constraint; oxc and swc need
  per-platform binaries or WASM. Babel 8 and oxc declare minimum Node versions
  above the 20.9 that ships with the oldest supported VS Code (1.90).
- **What ADR-0001 needs.** Its parser-state subclass, and all of
  `acorn-errors/`, work only on Acorn. Any option that keeps those features
  keeps Acorn for passage snippets.
