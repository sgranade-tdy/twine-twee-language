# 02: Tracer bullet — call results are opaque in `<<set>>`

**What to build:** End-to-end **opaque assignment** (GLOSSARY) for the simplest case. When a counted assignment's value is a call (`<<set _r to javaScriptFunction()>>`), the assigned path is marked opaque, the mark is carried into the project index alongside the write, and the shared never-set check stays silent for every story property beneath any opaque path anywhere in the project. Find-references, definition and rename are unaffected. See `../spec.md`.

**Blocked by:** 01 (Share the never-set check between formats)

**Status:** ready-for-agent

- [ ] `<<set _r to fn()>>` then `<<if _r.isError>>` produces no `variable-never-set` warning
- [ ] Descendants are silenced too: `_r.a.b` doesn't warn
- [ ] Only descendants: a never-set sibling of an opaque property path (`$a.x` when `$a.b` is opaque) still warns
- [ ] Project-wide: an opaque write in one passage/file silences reads in another
- [ ] Known shape still warns: `<<set $x to 5>>` then `$x.foo`
- [ ] A write that isn't a counted assignment (`<<print $x = fn()>>`) doesn't make `$x` opaque
- [ ] Works in Chapbook expression code as well (same shared extraction path)
