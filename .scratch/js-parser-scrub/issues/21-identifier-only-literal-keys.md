# 21 — Index literal keys only when they're valid identifiers

Type: task
Status: closed
Blocked by: none

Decided in a grilling session on 2026-10-14 while reviewing ticket 07
(`6cd9a10`). Partly reverses ticket 07's item 3, and changes how bracket access
behaved before ticket 07.

## Why

Ticket 07 accepted string and numeric literal keys so `obj = {'k': 1}` would
match `obj['k'] = 1` (spec defect 6). Numeric keys and string keys that aren't
identifiers cost more than they're worth:

- **Collisions.** `{'a.b': 1}` and `$o['a.b']` index as `$o.a.b`, which is
  the same as the chain `$o.a.b`. References, "never set" and rename confuse
  them, and `$o['a.b'].c` invents the path `$o.a.b.c`.
- **Wrong names.** `{1.0: 1}` indexes `$o.1.0`, and `{0x10: 1}` indexes
  `$o.0x10`, though JavaScript's key is `"16"`.
- **Little value.** Completions would insert `$o.1` or `$o.my key`, which are
  syntax errors. Numeric reads (`$o[1]`) aren't indexed, and indexing them
  would index every array index (`$inv[0]`). Lookup tables are read
  dynamically (`$days[$n]`) anyway.

`GLOSSARY.md` already says it: "A property whose path can't be spelled isn't a
story property at all."

## Work

In `getStaticPropertyName` (`js-parser.ts`):

1. Drop numeric literal keys.
2. Accept a string literal key, computed (`$o['k']`) or not (`{'k': 1}`), only
   when its value is a valid JavaScript identifier name:
   `/^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u`. Reserved words are
   allowed (`$o.class` is valid JavaScript). Also require that the source text
   between the quotes is the value itself (no escapes), so the label range
   matches what rename rewrites.
3. A rejected key returns `undefined`, so it's a dynamic step: nothing after it
   in the chain is a property (`$o['a.b'].c` yields variable `$o` only, like
   `$o[x].c`).

## Done when

- [x] `{1: 'x'}`, `{0x10: 1}`, `{1.0: 1}` yield no property.
- [x] `{'1': 1}`, `$o['1']`, `{'a.b': 1}`, `$o['a.b']`, `$o['my key']`,
      `{'\u0061': 1}` yield no property; `$o['a.b'].c` yields none either.
- [x] `{'k': 1}`, `$o['k']`, `$o['class']`, `{'café': 1}` still yield
      `$o.k` / `$o.class` / `$o.café`.
- [x] Corpus rows `obj['a b']`, `obj['a.b']` and `obj = {1: 'x'}` updated.
- [x] Typecheck, lint and `npm test` pass.
