# Which parser stack parses whole .js files

Type: grilling
Status: resolved
Blocked by: 04

## Question

Keep Acorn, acorn-loose and eslint-scope for whole `.js` files? Or adopt one of the hybrids in `docs/research/js-parser-library-survey.md` (branch `research/js-parser-library-survey`), such as meriyah for whole files only? Weigh measured speed against added bundle size, the Node-version floor and maintenance; see ticket 03. Use the spike's numbers for the *real* `js-parser.ts` path, not just raw parse time. If the answer changes the stack, does it need an ADR alongside ADR-0001 and ADR-0004? The spike (ticket 04) found Acorn fast enough and offsets exact. The one parser-level gap is that `parseJSStrict` hard-codes `sourceType: "script"`, so ES modules always fail strict parsing.

## Answer

**Keep Acorn, acorn-loose and eslint-scope for whole `.js` files.** No new dependencies and no ADR.

- **No faster parser.** Raw parse time is a small share of the full extraction path: 8.4 of 60 ms on jquery.js and 37 of 250 ms on three.core.js. meriyah would save 2–10% of total time for +32 KB gzipped plus a second parser to track. oxc would cost native binaries or WASM, a higher Node floor and a 0.x API. Neither recovers broken code better.
- **No TypeScript-based recovery.** It costs about 1 MB gzipped and relies on an unexported ts-estree internal that crashed on 2 of 8 faults. The spike showed acorn-loose's real-path junk is small. What to extract from a broken file remains ticket 10's call.
- **ES modules: retry strict parsing in module mode.** For whole files only, if the script-mode strict parse fails, retry with `sourceType: "module"` and extract from that clean tree. Passage snippets keep today's behaviour. Module syntax can't actually run in Story JavaScript, `importScripts()` or the Cookbook recipe, but diagnostics on `.js` files are out of scope, so this only affects extraction quality. Whether module-scope declarations count as story variables is ticket 05's call.
- **No ADR:** this keeps the status quo and is cheap to reverse.
