# 04: SugarCube script code — state-root writes

**What to build:** Opaque assignments made through SugarCube **state roots** in script code (Story JavaScript, `script` passages, script blocks, story script files, included scripts) mark their paths opaque, so a `.tw` read of a property on a value produced in JavaScript doesn't warn.

**Blocked by:** 03 (Classify every opaque right-hand side)

**Status:** ready-for-agent

- [ ] `State.variables.x = fn()` and `State.temporary.x = fn()` make `$x` / `_x` opaque
- [ ] `variables().x = …`, `SugarCube.State.*` and aliased state roots follow the same rule
- [ ] `setVar('$x', fn())` is judged by its value argument; `setVar('$x', 5)` is not opaque
- [ ] Property-path writes (`State.variables.a.b = fn()`) make `$a.b` opaque, not `$a`
- [ ] Verified across files: a `.js` story script file's opaque write silences the read in a `.tw` passage
