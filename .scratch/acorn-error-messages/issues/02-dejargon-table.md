# 02 — Dejargon table for Acorn's hostile messages

Type: task
Status: closed
Blocked by: 01

Roughly twenty of Acorn's messages are accurate but meaningless to a Twine
author. They need no parser context, no tokens, no AST — just a rewrite table.
Independent of every other phase, so it ships user-visible value early and
exercises the new test harness before the risky structural work starts.

## Work

Add `server/src/acorn-errors/dejargon.ts`: a table mapping Acorn message text to
plain-language replacements, applied to the raw message. Note these messages
never reach the `Unexpected token` path the rules key off, so this is the only
part of the effort that improves them.

Messages to cover (line refs into `node_modules/acorn/dist/acorn.js`):

- `Assigning to rvalue` (`:2214`), `Binding rvalue` (`:2418`)
- `Binding member expression` (`:2410`), `Binding parenthesized expression` (`:2414`)
- `Parenthesized pattern` (`:841`)
- `Shorthand property assignments are valid only in destructuring patterns` (`:850`)
- `Complex binding patterns require an initialization value` (`:1482`)
- `Comma is not permitted after the rest element` (`:839`, `:2289`, `:3435`)
- `Rest elements cannot have a default value` (`:2192`)
- `Setter cannot use rest params` (`:1701`)
- `Unsyntactic break` / `Unsyntactic continue` (`:1117`)
- `Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses` (`:2843`)
- `Redefinition of __proto__ property` (`:852`, `:2679`)
- `Object pattern can't contain getter or setter` (`:2178`)
- `Optional chaining cannot appear in left-hand side` (`:2207`, `:2406`) and its
  `new` (`:2975`) and tagged-template (`:3023`) variants
- `Escape sequence in keyword <kw>` (`:5473`)
- `Illegal 'use strict' directive in function with non-simple parameter list` (`:3615`)
- `Argument name clash` (`:2398`)
- `Identifier directly after number` (`:5959`)
- `Invalid use of 'super'` (`:3353`)

Some carry interpolated values, so entries need to support pattern matching, not
just literal keys.

## Style

- Plain language; state what is wrong and name the offending construct.
- Sentence case, no trailing period.
- Prefer "missing" and "incomplete" over "unexpected".
- Prefer "invalid" over "illegal". Never use "rvalue", "binding", "unsyntactic".
- No mandatory "what to do" clause — many of these have no single obvious fix,
  and forcing one produces filler.

## Done when

- Every message above has a rewrite, tested by a row in the phase 01 table.
- Messages with interpolated values keep their values in the rewritten text.
- `npm test` is green.
