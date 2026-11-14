# 29: Go-to-definition for story variables

**What to build:** Go-to-definition on a story-variable read lands on the places that set it, including writes in story script files and included scripts. This is ticket 21's unmet criterion "Go-to-definition on a `.tw` read lands on a `.js` assignment".

- Today it returns nothing for a variable read, even between two `.tw` files, in both SugarCube and Chapbook. The index never treats a variable set as a definition: `getDefinitionBySymbolAt` only matches definitions of the same kind, and neither format's `getDefinitionAt` links a read to its sets.
- A variable can be set in many places, so decide whether the definition is every set location or a single one.
- `server/src/test/indexer.test.ts` has a pending (`it.skip`) test, "should go to a definition in a script file", and `server/src/test/js-file-features.test.ts` has one starting from a `.js` file (ticket 23's definition criterion). Un-skip both once this lands.

**Blocked by:** 21

**Status:** ready-for-agent

- [ ] Go-to-definition on a `.tw` read lands on a `.js` assignment, in both formats
- [ ] Go-to-definition on a `.tw` read lands on a `.tw` set
