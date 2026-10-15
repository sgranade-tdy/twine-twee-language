# 06 — Rename `defined` to `assigned`

Type: task
Status: closed
Blocked by: 03

The label field `defined` names the wrong thing. Twine variables are never
declared, so `defined` promises a declaration site that doesn't exist.
`GLOSSARY.md` calls an occurrence that writes a name an **assignment**, distinct
from a **declaration** (a JavaScript binding form).

This ticket is a pure rename, with no behaviour change, so that the behaviour
changes in tickets 11 and 12 show up cleanly in the corpus diff.

Originally this ticket also covered assignment semantics. That work was split
out:

- **11** — write rules inside `js-parser.ts`: function declarations, and
  identifier targets of destructuring, `++`/`--` and `for` heads.
- **12** — properties honour `isAssignmentContext`, only the final chain
  segment is written, and call-site changes.

## Work

Rename `defined` → `assigned` on `JSVariableLabel` and `JSPropertyLabel` in
`server/src/js-parser.ts`, and update their doc comments to use the
**assignment** vocabulary. Also rename the internal `defined` fields and
parameters in `extractSymbols` (`RawVariableOccurrence`,
`RawPropertyOccurrence`, `captureProperty`) and `_isDefinition` on
`ScopedIdentifier`, so the vocabulary is consistent end to end.

Consumers (line numbers as of `923a8c3`):

| File                                                              | Lines           | Use                                                                                                            |
| ----------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `passage-text-parsers/chapbook/chapbook-parser.ts`                | 112–142         | `createVariableAndPropertyReferences` reads `v.defined` / `p.defined`; also the `isSet` doc comment            |
| `passage-text-parsers/chapbook/chapbook-parser.ts`                | 938–943         | `findAndParseEngineStateSets` hand-patches `defined = true`                                                    |
| `passage-text-parsers/sugarcube/sugarcube-utils.ts`               | 13, 67, 94, 123 | `createVariableAndPropertyReferences` reads it, and line 94 copies it into a new label for `State.variables.*` |
| `passage-text-parsers/sugarcube/sugarcube-parser.ts`              | 533–537         | receiver arguments hand-patch `defined = true`                                                                 |
| `passage-text-parsers/sugarcube/macros/control.ts`                | 154–157         | `<<for>>` index/value variables hand-patch `defined = true`                                                    |
| `test/js-parser.test.ts`                                          | throughout      | ~30 uses                                                                                                       |
| `test/passage-text-parsers/sugarcube/sc2/sc2-twinescript.test.ts` | throughout      | 4 uses                                                                                                         |

Also rename the `assignmentIsDefinition` parameter, which has the same problem:
it claims assignments are definitions. It's a statement about where the code
comes from (see **Assignment context** in `GLOSSARY.md`).

- `js-parser.ts` (`tokenizeJavaScript`, `annotateVariableScopes`) and the
  `js-parser.test.ts` corpus: `isAssignmentContext`. The shared parser stays
  free of story-format vocabulary.
- SugarCube wrappers (`tokenizeTwineScriptExpression` in
  `sc2/sc2-twinescript.ts`, `parseArgsAsTwineScriptExpression` in
  `macros/types.ts`): `isSetterContext`, SugarCube's own word for code that
  exists to change state. They pass it through as `isAssignmentContext`.
- Update `GLOSSARY.md`: **Assignment** is an occurrence the parser _counts_ as a
  write, and the new **Assignment context** entry defines the flag. The `isSet`
  doc comments note that `isSet` forces writes, where the flag only lets
  write-shaped syntax count.

## Not in scope

Any change to _which_ occurrences are writes. That's tickets 11 and 12.

## Done when

- No `defined` field remains in `js-parser.ts` or its consumers.
- No `assignmentIsDefinition` remains in `server/src`.
- No corpus row in `js-parser.test.ts` changes its expectations.
- `npm test` green.

## Comments

### Closed (2026-10-13)

Done in 98f58ff. No `defined` or `assignmentIsDefinition` remains in `server/src`.
