# 07: Shape sources — check copies of story variables against their source

**What to build:** Win back typo detection for the most common opaque cases. A copy of story state (`<<set _p to $player>>`, `clone($player)`, `{...$base, a: 1}`) records a **shape source** (GLOSSARY) instead of marking the target opaque. The never-set check then judges `_p.hpp` against `$player`'s writes. This only affects diagnostics: find-references, go-to-definition and rename are unchanged. See "Shape sources" in `../spec.md`.

**Blocked by:** 03 (Classify every opaque right-hand side), 04 (SugarCube script code — state-root writes), 06 (Chapbook — vars section, `engine.state.set` and script code)

**Status:** ready-for-agent

- [ ] `<<set _p to $player>>` (with `$player` set to `{hp: 10}`): `_p.hp` doesn't warn, `_p.hpp` does
- [ ] Sources may be resolvable chains: `_s to $player.stats` checks `_s.x` as `$player.stats.x`; descendants (`_p.a.b`) map the same way
- [ ] `clone($player)` records a shape source just like plain assignment
- [ ] Spread: `$o to {...$base, ...$extra, a: 1}` checks `$o.*` against `$base`, `$extra` and the explicit `a`
- [ ] Union: a path copied from `$player` in one place and `$enemy` in another accepts a property set on either
- [ ] Opaque wins: if any source is opaque, the path is opaque
- [ ] Chains resolve transitively; a cycle resolves to opaque rather than hanging or warning
- [ ] Non-copy values in those positions (`...fn()`, `$arr[i]`) stay opaque
- [ ] Works in both formats and in script code (e.g. `State.variables.p = State.variables.player`)
- [ ] Find-references and rename on `$player.hp` don't include `_p.hp`
