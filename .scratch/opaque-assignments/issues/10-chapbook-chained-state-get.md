# 10: Chained `engine.state.get` in Chapbook script code

**What to build:** Member access off a Chapbook state read counts as the path it reaches: `engine.state.get('player').a.b` is `player.a.b` for reads, writes and shape sources. Today only the key string inside `get('…')` is indexed. See "Chained `engine.state.get` in Chapbook" in `../spec.md`.

**Blocked by:** none

**Status:** done

- [x] Write: `engine.state.set('player.name', 'a'); engine.state.get('player').hp = 3;` then `{player.hp}` doesn't warn (it warns `hp` today)
- [x] Read: `engine.state.get('player').hpp`, with only `player.name` set, warns on `hpp` (today it isn't indexed)
- [x] Shape source: `engine.state.set('s', engine.state.get('player').stats)` with `player.stats.str` set: `{s.str}` doesn't warn and `{s.stt}` does (both silent today)
- [x] Mixed key and chain: `engine.state.get('player.stats').str` is `player.stats.str`
- [x] Indexed segments (`get('list')[0]`) and method calls (`get('inv').push(x)`) stop the chain, with no new warnings
- [ ] ~~Find-references, go-to-definition and rename cover the chained property~~ References and rename done; go-to-definition is out of scope (see comments)

## Comments

- The ticket 07 spec review found the shape-source gap. Probing turned up the false warning on a chained write, which was already broken at 47a5d38.
- Done. Go-to-definition doesn't support properties in either format (spec: "Go-to-definition doesn't work on properties at all today"), so only find-references and rename are tested for the chained property. A method call off a chain (`get('inv').push(x)`) records the callee as a property, the same as SugarCube's `$inv.push()`. The check already skips built-in methods.
