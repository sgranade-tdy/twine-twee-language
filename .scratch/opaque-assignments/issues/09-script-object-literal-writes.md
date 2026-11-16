# 09: Object literals written from script code count as property writes

**What to build:** Script code that assigns an object literal to story state records the literal's keys as property writes, so setting up a variable in Story JavaScript no longer makes later reads warn. See "Object literals written from script code" in `../spec.md`. **Highest priority of the follow-ups:** this is a common pattern and gives false warnings today.

**Blocked by:** none

**Status:** done

- [x] SugarCube `.js`: `State.variables.player = {hp: 1}` then `<<print $player.hp>>` doesn't warn (it warns `hp` today)
- [x] Nested: `State.variables.player = {stats: {str: 1}}` then `$player.stats.str` doesn't warn (it warns `stats` and `str` today)
- [x] Chapbook: `engine.state.set('player', {hp: 1})` and `engine.state.setDefault('player', {hp: 1})` then `{player.hp}` don't warn (both warn `hp` today)
- [x] A typo still warns: after `{hp: 1}`, `$player.hpp` / `{player.hpp}` warns
- [x] Spreads in the literal record shape sources (`State.variables.o = {...State.variables.base, a: 1}` checks `$o.*` against `$base` and `a`)
- [x] An opaque value (`{inv: fn()}`) makes only that key's path opaque
- [x] Works in story `.js` files, `<<script>>`/`<<run>>`, and Chapbook `[JavaScript]`
- [x] Find-references and rename on `$player.hp` include the key in the literal

## Comments

- Found while probing the ticket 07 Chapbook gap. Already broken at 47a5d38 (before ticket 07).
- `<<run>>` is TwineScript, not script code: it uses the default extractor plus the legacy `State.variables.x…` → `$x…` rewrite in `sugarcube-utils.ts`, so literal keys, nested keys and opaque-key values already work there (regression test in `js-file-features.test.ts`). No code change for `<<run>>`; `<<script>>` is the real gap (same extractor as `.js`). Gaps found in `<<run>>`, split out to ticket 11: a spread of `State.variables.base` is opaque rather than a `$base` shape source (no noise, lost typo detection), and `State.setVar('$x', …)` isn't recognized (warns on `setVar` and `$x`).
