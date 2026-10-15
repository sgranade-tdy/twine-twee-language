# 16: Break the diagnostics ↔ project-index import cycle

**What to build:** `diagnostics` and `project-index` no longer import each other. The types they share (for example `Label` and `TwineDiagnostic`) live in a leaf module that imports nothing from this project. Behaviour does not change.

**Blocked by:** None (can start immediately).

**Status:** closed

- [x] Neither module imports the other, directly or through a third module.
- [x] Imports outside these two modules still compile, or are updated to the new location.
- [x] `import-x/no-cycle` reports nothing for either module (check with a temporary all-of-`server/src` config if ticket 20 has not landed).
- [x] Typecheck and `npm test` pass.

## Comments

Done in 28cf2c1: `Label` and `TwineDiagnostic` moved to `server/src/core-types.ts` (re-exported from the old modules). `import-x/no-cycle` clean on all three files; typecheck and tests pass.

### Follow-up: module moves (2026-10-15)

`core-types.ts` is gone. `Label` and `TwineDiagnostic` now live in the existing leaf `server/src/types.ts`, and the re-exports from `project-index.ts` and `diagnostics.ts` are removed; importers use `types.ts` directly.
