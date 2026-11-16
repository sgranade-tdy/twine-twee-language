# 11: State roots in TwineScript (`<<run>>`, `<<set>>`)

**What to build:** TwineScript recognizes SugarCube state roots the way script code does, so `<<run>>`/`<<set>>` code written in the JavaScript style is checked like `<<script>>` code. Today TwineScript uses the default extractor plus a legacy rewrite of `State.variables.x…`/`State.temporary.x…` property labels to `$x…`/`_x…` (`server/src/passage-text-parsers/sugarcube/sugarcube-utils.ts`), which misses the cases below. Found while scoping ticket 09.

**Blocked by:** none

**Status:** done

- [x] `<<run State.setVar('$x', 5)>>` sets `$x` (today it warns on `$x` and treats `setVar` as a never-set property)
- [x] `<<run State.variables.o = {...State.variables.base, a: 1}>>` records `$base` as a shape source, so `$o.c` warns when `$base` never sets `c` (today the spread's root is `State`, so `$o` is opaque: silent, not noisy)
- [x] Copies through a state root (`<<set _p to State.variables.player>>`) record `$player` as a shape source rather than going opaque
- [x] Decide whether to replace the legacy rewrite with the SugarCube script extractor (`sugarcube-script-symbols.ts`), which also covers `variables()`, `SugarCube.State` and aliases, or to extend the rewrite

## Comments

- Decision (ADR-0006): the legacy rewrite is removed. TwineScript uses `extractTwineScriptSymbols`, which runs the default extractor for sigiled names alongside the SugarCube state-root extractor. Both share one path tracer, so copies through `State.variables`, `variables()`, `getVar` and `SugarCube.State` get sigiled shape sources. `resugarShapeSources` keeps only its resugaring of desugared names.
- Unrelated but seen in the same probe: in `<<run State.variables.r = fn()>>`, the bare `fn` warns as a never-set story variable.
- Resolved here, per ADR-0006: TwineScript keeps only sigiled names (and properties of `settings`/`setup`) and state-rooted occurrences as story variables, so a bare `fn` is no longer indexed.
