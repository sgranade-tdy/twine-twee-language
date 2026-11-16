# 12: Capture each assigned object literal once in the default extractor

**What to build:** A refactor with no change in behavior. In `extractSymbols` (`server/src/js-parser.ts`), the `Property` case walks up from *every* key of an object literal to the enclosing assignment or declaration and then captures the *whole* literal again via `captureObjectLiteral`. Results are keyed by position, so the duplicates collapse, but a literal with *n* keys (counting nested ones) is captured about *n* times, and in an assignment context each capture runs `shapeOfValue` on every key: roughly *n*² work. Capture the literal once, from the `AssignmentExpression`/`VariableDeclarator` that owns it.

**Blocked by:** none

**Status:** done

- [x] Each assigned or declared object literal is captured once, from its owning `AssignmentExpression` (`x = {…}`, `x.a.b = {…}`) or `VariableDeclarator` (`var x = {…}`)
- [x] Nested literals (`x = {a: {b: 1}}`) are still captured through the outer one, and a literal nested in a non-literal value (`x = f({a: 1})`) still isn't
- [x] The existing suite passes unchanged

## Comments

- Came out of the ticket 09 code review (Middle Man on `captureObjectExpressionProperties`, since folded into `objectLiteralProperties`).
