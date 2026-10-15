# 19: Break the import cycles inside the SugarCube parser

**What to build:** The SugarCube parser, its macros, the sc2 modules (lexer parser, twinescript, t3lt parameters) and its completions, hover, diagnostics and utils modules no longer form import cycles. Today the macros and sc2 modules import from the parser, and the parser imports them back. Move shared types and helpers into leaf modules so dependencies run one way. Behaviour does not change.

**Blocked by:** 17.

**Status:** closed

- [x] `import-x/no-cycle` reports nothing for the SugarCube directory (check with a temporary all-of-`server/src` config if ticket 20 has not landed).
- [x] No SugarCube module imports the registry.
- [x] Typecheck and `npm test` pass.

## Comments

### Scope check (2026-10-14)

Ticket 17 alone does **not** clear these. With every edge to the registry
removed, 20 SugarCube modules still form one cycle. The causes:

- `macros/*` and `macros/types.ts` import `SugarCubeParsingState`,
  `MacroLocationInfo` and helpers from `sugarcube-parser`. `sugarcube-parser`
  imports the macros back through `macros/index`.
- `sc2/t3lt-parameters` and `sc2/sc2-lexer-parser` import from
  `sugarcube-parser`, and `sugarcube-parser` imports `t3lt-parameters`.
- `sugarcube-utils`, `-completions`, `-hover` and `-diagnostics` import from
  `sugarcube-parser` and from the SugarCube `index`. `sugarcube-parser` imports
  the SugarCube `index`.

Fix direction: move the parsing-state and macro-location types and the shared
helpers into leaf modules. Make the SugarCube `index` the only importer of the
feature modules.

### Done

New leaf `sugarcube/parsing-types.ts` holds `MacroLocationInfo`, `SugarCubeParsingState` and `SugarCubeParserAPI` (function-typed). It imports `MacroInfo`/`EnumRecord` with `import type` only, so there is no runtime edge. no-cycle clean for the whole of `server/src` (non-test).

### Follow-up: module moves (2026-10-15)

`sugarcube/parsing-types.ts` is merged into `sugarcube/types.ts`. `EnumRecord` moved there from `sc2/t3lt-parameters.ts`, which removes one type-only cycle. The remaining type-only cycle (`MacroInfo` and `SugarCubeParsingState` refer to each other) is intentionally kept; `eslint.config.mjs` notes that type-only cycles are allowed.
