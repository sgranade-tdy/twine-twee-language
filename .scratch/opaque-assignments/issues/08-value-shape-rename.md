# 08: Rename `Opaque` to `ValueShape` and simplify reference collation

**What to build:** A refactor with no change in behavior. Since ticket 07, `Opaque` and `opaqueFlag` carry shape sources as well as the opaque flag, so their names are misleading (`const knownShape: Opaque = {}`). Rename them, and remove the hand-built grouping key in `collateReferences` that repeats every flag field.

**Blocked by:** none

**Status:** open

- [ ] `Opaque` → `ValueShape` and `opaqueFlag` → `shapeFlags` (in `server/src/project-index.ts`), with all uses and doc comments updated to the GLOSSARY wording (opaque assignment and shape source are separate ideas)
- [ ] `collateReferences` (`server/src/indexer.ts`) builds the flags once (`{...calleeFlag(s), ...sigilFlag(s), ...shorthandFlag(s), ...shapeFlags(s)}`), keys on `kind`, `contents` and `JSON.stringify(flags)`, and reuses that object for the `References` entry. No new shared helper, since no other site uses all four flags.
- [ ] `shapeFlags` sorts and dedupes `shapeSources`, so equal shapes found in different orders group into one `References` entry
- [ ] The existing suite passes unchanged, apart from tests that name the renamed symbols

## Comments

- Came out of the ticket 07 code review (Mysterious Name and Data Clumps smells).
