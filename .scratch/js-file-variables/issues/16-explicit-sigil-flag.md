# 16: Prefactor: explicit sigil-outside-range flag on occurrences

**What to build:** Each story-variable occurrence in the project index records explicitly whether its sigil sits outside its range. SugarCube rename uses that flag in place of today's range-length-vs-contents heuristic to decide whether to keep or add a `$`/`_`. Renames behave exactly as before. This prepares for `.js` occurrences, whose ranges never include the sigil (spec: Rename).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Every SugarCube and Chapbook occurrence the parsers emit carries the explicit sigil flag
- [ ] SugarCube rename reads the flag and no longer compares range length with document text
- [ ] The existing rename, references and indexer tests pass unchanged, so there's no observable behaviour change
