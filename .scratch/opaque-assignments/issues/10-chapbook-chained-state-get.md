# 10: Chained `engine.state.get` in Chapbook script code

**What to build:** Member access off a Chapbook state read counts as the path it reaches: `engine.state.get('player').a.b` is `player.a.b` for reads, writes and shape sources. Today only the key string inside `get('…')` is indexed. See "Chained `engine.state.get` in Chapbook" in `../spec.md`.

**Blocked by:** none

**Status:** open

- [ ] Write: `engine.state.set('player.name', 'a'); engine.state.get('player').hp = 3;` then `{player.hp}` doesn't warn (it warns `hp` today)
- [ ] Read: `engine.state.get('player').hpp`, with only `player.name` set, warns on `hpp` (today it isn't indexed)
- [ ] Shape source: `engine.state.set('s', engine.state.get('player').stats)` with `player.stats.str` set: `{s.str}` doesn't warn and `{s.stt}` does (both silent today)
- [ ] Mixed key and chain: `engine.state.get('player.stats').str` is `player.stats.str`
- [ ] Indexed segments (`get('list')[0]`) and method calls (`get('inv').push(x)`) stop the chain, with no new warnings
- [ ] Find-references, go-to-definition and rename cover the chained property

## Comments

- The ticket 07 spec review found the shape-source gap. Probing turned up the false warning on a chained write, which was already broken at 47a5d38.
