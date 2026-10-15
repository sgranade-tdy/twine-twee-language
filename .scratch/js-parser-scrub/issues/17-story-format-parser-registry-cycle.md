# 17: Separate the story format parser types from the parser registry

**What to build:** The passage-text-parsers entry module today holds two things: the registry that picks a Chapbook or SugarCube parser, and the types and helper every parser shares (`StoryFormatParser`, `StoryFormatParsingState`, `capturePreSemanticTokenFor`). It also needs `ParsingState` from the main parser. Move the shared types and helper, and `ParsingState`, into leaf modules. Only the registry imports the Chapbook and SugarCube parsers. Everything else imports the shared types and never the registry. Behaviour does not change.

This removes the cycles through `js-parser`, `parser`, `validator` and the registry entry. Cycles inside the Chapbook and SugarCube directories need tickets 18 and 19.

**Blocked by:** None (can start immediately).

**Status:** closed

- [x] No Chapbook or SugarCube module imports the registry.
- [x] `js-parser` and the main parser do not depend on the registry through a cycle.
- [x] Callers that need only the shared types import them from the new location.
- [x] `import-x/no-cycle` reports nothing for `js-parser`, `parser`, `validator` and the registry (check with a temporary all-of-`server/src` config if ticket 20 has not landed).
- [x] Typecheck and `npm test` pass.

## Comments

Done. Shared types, helper, `ParsingState`, `ParseLevel` and `ParserCallbacks` now live in `passage-text-parsers/types.ts`; the registry (`passage-text-parsers/index.ts`) only picks parsers. `parser.parse` no longer imports the registry (defaults to no parser; `indexer` supplies it). `referencesToDiagnostics` moved from `validator` to `reference-diagnostics.ts` to break the validator cycle. no-cycle clean for js-parser, parser, validator, registry; typecheck and tests pass.

### Follow-up: module moves (2026-10-15)

`ParseLevel` and `ParserCallbacks` moved to `server/src/parser-types.ts`, next to the Twee parser. `ParsingState` stays in `passage-text-parsers/types.ts` with `StoryFormatParser`, because the two refer to each other. `reference-diagnostics.ts` is gone; `referencesToDiagnostics` now lives in `diagnostics.ts` (it imports `project-index` with `import type`). `parse()` now requires `getParser` instead of silently defaulting to no parser.
