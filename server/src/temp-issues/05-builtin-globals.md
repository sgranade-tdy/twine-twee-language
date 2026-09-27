# 05 — Fix the JavaScript built-in globals list

Type: task
Status: open
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
