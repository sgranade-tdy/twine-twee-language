# 04: SugarCube script code — state-root writes

**What to build:** Opaque assignments made through SugarCube **state roots** in script code (Story JavaScript, `script` passages, script blocks, story script files, included scripts) mark their paths opaque, so a `.tw` read of a property on a value produced in JavaScript doesn't warn.

**Blocked by:** 03 (Classify every opaque right-hand side)

**Status:** done

- [x] `State.variables.x = fn()` and `State.temporary.x = fn()` make `$x` / `_x` opaque
- [x] `variables().x = …`, `SugarCube.State.*` and aliased state roots follow the same rule
- [x] `setVar('$x', fn())` is judged by its value argument; `setVar('$x', 5)` is not opaque
- [x] Property-path writes (`State.variables.a.b = fn()`) make `$a.b` opaque, not `$a`
- [x] Verified across files: a `.js` story script file's opaque write silences the read in a `.tw` passage

## Comments

- A self-reference through any state-root spelling is ignored, as in expression code: `variables().inv = State.variables.inv || {}` and `setVar('$inv', State.getVar('$inv') ?? {})` aren't opaque.
- `setVar` with a property path (`setVar('$a.b', …)`) isn't indexed at all yet, so it can't be opaque either.
