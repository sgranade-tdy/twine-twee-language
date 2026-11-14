# 22: Rename story variables into .js files

**What to build:** Renaming a story variable rewrites its `.js` occurrences correctly or refuses with a hard error. Rename correctness is the hard constraint (spec: Rename; user stories 25–33, 35–38).

- **Edits:** each edit replaces only the occurrence's name segment: one segment of a Chapbook dotted key or the whole bare name, and the last segment for properties. Edits never touch the root, quotes or sigil.
- **Sigils:** an omitted sigil is normalized to the original, and a `$`↔`_` change is refused with a message that the two are different stores with different lifetimes.
- **Validation** applies to every story-variable rename, including ones started in `.tw`:
  - refuse a new name that isn't a JS IdentifierName;
  - refuse a reserved word when any edit lands on a Chapbook bare name;
  - refuse a bare-name collision with a root-level declaration or an excluded name, with a message naming the conflict.
- **Shorthand destructuring:** `{ gold }` becomes `{ coins: gold }`, and `{ hp: h }` replaces only the key.
- **Transport:** renames return `documentChanges` when the client supports them, with the synced version for open buffers and `version: null` for closed files. Otherwise they fall back to `changes`.
- **`prepareRename`** in a `.js` file returns the sigil-free name range on an indexed story-variable or property occurrence, including a conditional reference that currently qualifies. It returns `null` everywhere else (declarations, alias bindings, root expressions, other strings), so TypeScript's rename still works.

**Blocked by:** 16, 21

**Status:** ready-for-agent

- [ ] Renaming `$gold` to `$coins` rewrites only `gold` in `State.variables.gold`, `variables().gold`, aliases and bracket keys
- [ ] `getVar('$gold')` becomes `getVar('$coins')`, and typing `coins` without a sigil gives `$coins`
- [ ] A `$`↔`_` change, an invalid IdentifierName, a reserved word on a bare name and a bare-name collision each return an error, not edits
- [ ] Shorthand and renamed destructuring cases produce the specified edits
- [ ] Open buffers get their synced version and closed files get `null`, with `changes` used when `documentChanges` isn't supported
- [ ] `prepareRename` returns the name range on occurrences and `null` on declarations, alias bindings, root expressions and other strings
- [ ] One inline test per rename decision, through the project-index seam
