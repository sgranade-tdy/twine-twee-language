# 06: Chapbook — vars section, `engine.state.set` and script code

**What to build:** Chapbook's format-forced and state-root writes follow the opaque-assignment rule in `../spec.md`, so properties of values produced by functions or other variables don't warn in Chapbook stories.

**Blocked by:** 03 (Classify every opaque right-hand side)

**Status:** ready-for-agent

- [ ] A vars-section entry with an opaque value (`r: fn()`, `p: player`) makes that path opaque; `x: 5` doesn't
- [ ] `engine.state.set('x', fn())` is judged by its value argument
- [ ] `engine.state` writes in story script files and included scripts mark paths opaque, and the effect reaches `.tw` reads
- [ ] Conditional references are unaffected beyond the shared rule (no new warnings)
