# 01: Go to definition for story properties

**What to build:** Go-to-definition on a story property lists every assignment to its full path, in SugarCube and Chapbook, the same way it does for story variables. Update the README and CHANGELOG. See `../spec.md`.

**Blocked by:** none

**Status:** open

- [ ] SugarCube: on `$player.hp`, definitions are `<<set $player.hp to 1>>`, `<<set $player to {hp: 1}>>`'s `hp`, and `State.variables.player.hp = 2` in a `.js` file
- [ ] Chapbook: on `{player.hp}`, definitions are `player.hp: 1` in a vars section and `engine.state.get('player').hp = 2` in a `.js` file
- [ ] No definition for a property with no direct writes (beneath an opaque path, copied through a shape source, or never set)
- [ ] `getAssignmentLocations`'s doc comment covers properties; no new wrapper
- [ ] README: both format feature lists mention finding, renaming and going to where variables and their properties are set
- [ ] CHANGELOG: Unreleased → Added entry

## Comments
