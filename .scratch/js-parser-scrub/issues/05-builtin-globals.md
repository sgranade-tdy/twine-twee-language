# 05 — Fix the JavaScript built-in globals list

Type: task
Status: closed
Blocked by: 02

`builtInObjects` (`js-parser.ts:110`) keeps JavaScript's own globals out of the
story index. It has gaps, and issue 07 is about to make those gaps much more
visible: once called identifiers are indexed, every `setTimeout(…)` and
`parseInt(…)` in a script passage becomes a phantom story variable. Land the list
fix first so 07 doesn't regress anything.

Per the spec's seam: this list is **JavaScript only**. Story-format globals
(`State`, `setup`, `_args`, `engine`) stay downstream in the Chapbook and
SugarCube parsers, which already have their own lists.

## Work

1. Fix the typo: `"null,"` has a trailing comma inside the string literal, so it
   never matches (`js-parser.ts:145`).
2. Add the missing constructors and namespaces: `globalThis`, `RegExp`, `NaN`,
   `Infinity`.
3. Add the global *functions*, which the list has never needed until now:
   `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURI`,
   `encodeURIComponent`, `decodeURI`, `decodeURIComponent`, `eval`,
   `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`.
4. Add the browser globals a Twine author actually reaches for: `alert`,
   `prompt`, `confirm`, `localStorage`, `sessionStorage`, `navigator`, `history`,
   `location`.
5. Add `$` and `jQuery`. Twine ships jQuery and SugarCube authors call it in
   `<<script>>` blocks. There's no ambiguity with the `$var` sigil: SugarCube
   desugars `$var` to `Xvar` before this code sees it, so a bare `$` surviving
   into the AST is always jQuery.

## Not in scope

`isBuiltinJSObjectInstanceProperty` and its list of instance *members*. That's a
diagnostics-side filter with a different failure mode, handled in issue 08.

Story-format globals. If SugarCube's `State` is leaking into the index, that's
`sugarcube-utils.ts`'s job.

## Done when

- Corpus rows for `RegExp.test(a)` and `globalThis.z = 1` (defect 8) report no
  story variables.
- `$('#x').hide()`, `setTimeout(fn, 1)` and `parseInt(a)` report nothing, and
  still will after issue 07.
- `npm test` green.

## Comments

Already implemented in commit `923a8c3` ("Improve list of built-in JS
functions and globals."), including the corpus rows for all five "Done when"
checks. Verified: `builtInObjects` now has the fixed `"null"` entry (no
trailing comma), `globalThis`/`RegExp`/`NaN`/`Infinity`, the global functions,
the browser globals, and `$`/`jQuery`. Ran an ad-hoc check confirming
`$('#x').hide()` → `[]`, `setTimeout(fn, 1)` → `["fn"]`, `parseInt(a)` →
`["a"]` (the builtins themselves aren't reported; `fn`/`a` are legitimate
argument references). Full suite: 1227 passing. Closing ticket; no code
changes needed.

### Review of `923a8c3` (2026-10-07)

**Substantive: browser globals swallow real Chapbook story variables.**
Chapbook story variables are bare identifiers, and `builtInObjects` is matched
by name on every unbound identifier and every property root. A Chapbook author
who names a variable `location` or `history` loses all of it: the vars-section
set, `{location}` inserts, `engine.state.set('location', …)`, and any
`location.x` properties. A probe through the Chapbook parser gave no references
at all for `location: 'cave' … {location}`, while `loc: 'cave' … {loc}` indexed
normally. `location` and `history` are common IF variable names. `prompt`,
`confirm`, `alert` and `navigator` carry the same risk with lower odds.
SugarCube is unaffected because `$location` desugars to `Xlocation`. This is
under-reporting, which the spec's governing principle ranks worse than
over-reporting (ticket 13 §2). The ticket asked for these names, so the
implementation follows it. The flaw is in the ticket's design.

Recommendation: split the list. ECMAScript globals stay in `js-parser.ts`, as
ADR-0003 says. Host/browser globals and `$`/`jQuery` aren't JavaScript-the-
language, so they become a per-format list passed through
`StoryFormatParsingState`. SugarCube supplies the full list, since sigils mean
nothing can collide. Chapbook either omits it or filters a name only when the
story never defines it. At minimum, drop `location` and `history`. Add a
Chapbook parser test for a variable named `location`.

**Secondary:**
- Gaps in the ECMAScript list. The `Error` subclasses (`TypeError`,
  `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`,
  `AggregateError`, `SuppressedError`), the typed arrays (`Uint8Array` …
  `Float64Array`, `BigInt64Array`, `BigUint64Array`, `Uint8ClampedArray`,
  `Float16Array`), `WebAssembly`, `escape` and `unescape` are all missing.
  Commonly used host functions are missing too: `requestAnimationFrame`,
  `cancelAnimationFrame`, `fetch`, `structuredClone`, `queueMicrotask`,
  `Audio`, `Image` and `URL`. Once ticket 07 indexes callees,
  `throw new TypeError(…)` will index `TypeError`.
- The comment "These next are actually keywords" is wrong. Only `null` is a
  keyword. `undefined`, `NaN`, `Infinity` and `globalThis` are global
  properties. `null` parses as a `Literal` and never reaches the name check,
  so that entry is dead. It's harmless, but the comment misleads.
- `$` needs a comment pointing at the SugarCube desugar regex
  (`sc2-twinescript.ts`). Its safety depends on that coupling, which isn't
  obvious.
- Tests cover only `RegExp`, `globalThis`, `$`, `setTimeout` and `parseInt`.
  No rows cover `undefined`/`NaN`/`Infinity`, `jQuery(...)` or a browser
  global.
- The closing comment above says the commit included corpus rows for all
  five "Done when" checks. The `$`/`setTimeout`/`parseInt` rows came from
  ticket 02. The commit only rewrote the `RegExp`/`globalThis` rows.

### Review fixes (2026-10-07)

All five findings are fixed (uncommitted at the time of writing).
- `js-parser.ts`'s list is now `ecmaScriptGlobals`, with JavaScript names
  only. It adds the `Error` subclasses, typed arrays and `escape`/`unescape`.
  The dead `null` entry is gone and the comments are corrected.
- Host globals live in `passage-text-parsers/host-globals.ts`:
  `browserGlobals`, `collisionProneBrowserGlobals` and `jQueryGlobals`. Each
  format passes its list as `StoryFormatParsingState.hostGlobals`, and
  `isEveryIdentifierAVariable` takes it as an optional argument.
- SugarCube's `sugarCubeHostGlobals` (in `sc2-twinescript.ts`, beside the
  desugaring that makes `$` safe) is all three lists. Chapbook's is
  `browserGlobals` only (option A, chosen by the user). So `location`,
  `history`, `navigator`, `alert`, `prompt` and `confirm` are Chapbook story
  variables.
- Tests: new corpus rows (with/without host globals, Chapbook vs SugarCube
  sets, `TypeError`, `Uint8Array`, `undefined`/`NaN`/`Infinity`, `jQuery`),
  a Chapbook parser test for a variable named `location`, and a SugarCube
  script-passage test. CONTEXT.md now defines **Host global**.
- Open question: whether Chapbook should warn when a story variable shadows a
  truthy `window` property. Chapbook's `addStateProxy` skips those names, so
  `{location}` works but `[if location …]` and `[JavaScript]` see
  `window.location`.

Resolved by grilling session: ticket 14 (`14-chapbook-shadowed-globals.md`) adds the Chapbook shadowing warning.
