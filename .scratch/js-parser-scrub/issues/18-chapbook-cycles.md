# 18: Break the import cycles inside the Chapbook parser

**What to build:** The Chapbook parser, its inserts, its modifiers, and its completions, hover, definitions and diagnostics modules no longer form import cycles. Today the insert and modifier modules import from the parser, and the parser imports them back, usually through shared types. Move shared types and helpers into leaf modules so dependencies run one way. Behaviour does not change.

**Blocked by:** 17.

**Status:** closed

- [x] `import-x/no-cycle` reports nothing for the Chapbook directory (check with a temporary all-of-`server/src` config if ticket 20 has not landed).
- [x] No Chapbook module imports the registry.
- [x] Typecheck and `npm test` pass.

## Comments

### Scope check (2026-10-14)

Ticket 17 alone does **not** clear these. With every edge to the registry
removed, 33 Chapbook modules still form one cycle. The causes:

- `modifiers/*` and `inserts/types.ts` import `ChapbookParsingState` (and
  related helpers) from `chapbook-parser`. `chapbook-parser` imports the
  modifiers and inserts back through their `index` modules.
- `chapbook-completions`, `-hover`, `-definitions`, `-diagnostics` import from
  `chapbook-parser` and from the Chapbook `index`. `chapbook-parser` imports
  the Chapbook `index`.

Fix direction: move `ChapbookParsingState` and the helpers the modifiers and
inserts use into a leaf module. Make the Chapbook `index` the only importer of
the feature modules.

### Done

New leaf `chapbook/parsing-types.ts` holds `ModifierKind`, `ChapbookParsingState`, `ChapbookParserAPI` (now function-typed, not `typeof` the feature modules), `InsertInfo`/`ModifierInfo` and token types. `inserts/types.ts` and `modifiers/types.ts` re-export. Chapbook `index` is the only importer of feature modules. no-cycle clean for the Chapbook directory.

### Follow-up: module moves (2026-10-15)

`chapbook/parsing-types.ts` is merged into `chapbook/types.ts`. The `inserts/types.ts` and `modifiers/types.ts` re-export shims are deleted, along with the `export *` from the `inserts` and `modifiers` barrels; importers use `chapbook/types.ts` directly.
