# 06: Chapbook — vars section, `engine.state.set` and script code

**What to build:** Chapbook's format-forced and state-root writes follow the opaque-assignment rule in `../spec.md`, so properties of values produced by functions or other variables don't warn in Chapbook stories.

**Blocked by:** 03 (Classify every opaque right-hand side)

**Status:** done

- [x] A vars-section entry with an opaque value (`r: fn()`, `p: player`) makes that path opaque; `x: 5` doesn't
- [x] `engine.state.set('x', fn())` is judged by its value argument
- [x] `engine.state` writes in story script files and included scripts mark paths opaque, and the effect reaches `.tw` reads
- [x] Conditional references are unaffected beyond the shared rule (no new warnings)

## Comments

- `engine.state.setDefault` follows the same rule as `set`.
- A self-reference is ignored: `inv: inv || {}` in a vars section and `engine.state.set('inv', engine.state.get('inv') || {})` in script code aren't opaque.
- A vars-section value that doesn't parse never makes its path opaque.
