# 02: Tracer bullet — call results are opaque in `<<set>>`

**What to build:** End-to-end **opaque assignment** (GLOSSARY) for the simplest case. When a counted assignment's value is a call (`<<set _r to javaScriptFunction()>>`), the assigned path is marked opaque, the mark is carried into the project index alongside the write, and the shared never-set check stays silent for every story property beneath any opaque path anywhere in the project. Find-references, definition and rename are unaffected. See `../spec.md`.

**Blocked by:** 01 (Share the never-set check between formats)

**Status:** done

- [x] `<<set _r to fn()>>` then `<<if _r.isError>>` produces no `variable-never-set` warning
- [x] Descendants are silenced too: `_r.a.b` doesn't warn
- [x] Only descendants: a never-set sibling of an opaque property path (`$a.x` when `$a.b` is opaque) still warns
- [x] Project-wide: an opaque write in one passage/file silences reads in another
- [x] Known shape still warns: `<<set $x to 5>>` then `$x.foo`
- [x] A write that isn't a counted assignment (`<<print $x = fn()>>`) doesn't make `$x` opaque
- [ ] Works in Chapbook expression code as well (same shared extraction path) — partial: the index and check carry the flag, but no Chapbook code produces an opaque write until ticket 06 (see Comments)

## Comments

- Chapbook has no counted assignment that goes through the shared extraction yet (its writes are forced `engine.state.set`/vars-section writes, ticket 06). Here Chapbook forwards the `opaque` flag to the index and uses the shared check, covered by a Chapbook diagnostics test; ticket 06 supplies the opaque writes.
- Opaque values are only calls (incl. optional calls) for now. `=`, `||=`, `&&=`, `??=` and declarator initializers are judged by their value; compound arithmetic assignments never are. Ticket 03 extends `isOpaqueValue` in `js-parser.ts`.
