# 07 — Index callees, method properties, and literal keys

Type: task
Status: open
Blocked by: 05, 06

Issue 06 makes `function f(){}` a written occurrence. On its own that makes
rename *worse*: the `CallExpression` branch gives `f()` a `function` semantic
token and nothing else, so `f` would have a write and zero reads, and renaming it
would rewrite the declaration while leaving every call site behind.

The same argument runs one level down. An author who writes
`$utils.greet = function(){}` and calls `$utils.greet()` needs both to rename
together.

## Work

1. **Called identifiers are occurrences.** `foo` in `foo(bar)` and `Thing` in
   `new Thing(a)` are story variable reads. They keep their `function` semantic
   token — after issue 02 the two passes are independent, so a token can be
   highlighted as a function and indexed as a variable without contradiction.
   Built-in callees are already excluded by issue 05's list.
2. **Method-call properties are occurrences.** `obj.method(x)` yields property
   `obj.method`; `obj.a.method(x)` yields `obj.a` and `obj.a.method`. This
   reverses a deliberate decision — `js-parser.test.ts:994` ("should not return a
   member function called on a variables as a property") asserts the opposite.
   Delete that test and record why in the commit.
3. **Literal object-literal keys** (defect 6). `getStaticPropertyName` accepts a
   string `Literal` only when `computed`, so `obj = {'k': 1}` and `obj = {1:'x'}`
   drop their keys while `obj['k'] = 1` yields `obj.k`. Accept non-computed
   string and numeric literal keys. Mind the position: the existing `start + 1`
   adjustment for quoted keys must apply here too, and numeric keys have no
   quotes to skip.
4. **Shorthand property values** (defect 10). `obj = {a}` yields property `obj.a`
   but loses the variable read `a`, though `obj = {a: b}` yields `b`. In
   shorthand the one identifier is both; report both.

Chains that can't be spelled are still truncated — `obj().a` yields nothing,
`obj[i].name` stops at `obj`. Unchanged, and deliberately so: a property indexed
under a guessed prefix renames the wrong thing.

## Update from ticket 02

Ticket 02's split turned three previously-implicit "last write wins" overwrites
(in the old shared, position-keyed `unprocessedTokens` map) into explicit,
named exclusions, since `extractSymbols` now writes variables and properties
into two separate arrays that no longer share position keys and so no longer
mask each other automatically. All three are exactly the behaviors this issue
reverses, and they're now single, clearly-commented checks instead of emergent
map-collision behavior:

- **Called identifiers** (work item 1): `js-parser.ts`'s `isExcludedIdentifier`
  has an explicit `ancestor?.type === "CallExpression" && ancestor.callee ===
  node` check. Removing it (for the `Identifier` case only — `NewExpression`
  callees stay excluded, out of scope here) is most of item 1's work; the
  `computeSemanticTokens` pass doesn't need a matching change, since it already
  gets the right `function` token from `CallExpression`'s own case regardless.
- **Method-call properties** (work item 2): `extractSymbols`'s
  `case "MemberExpression"` computes `lastIsCallCallee` and skips capturing the
  chain's last segment when true. Removing that skip (and updating
  `js-parser.test.ts:994`, per this issue's own instructions) is item 2's work.
  Same note as above: highlighting doesn't need a change.
- **Shorthand property values** (work item 4, defect 10): `isExcludedIdentifier`
  also has an `ancestor?.type === "Property" && ancestor.shorthand` check. This
  one only affects `extractSymbols` for the same reason (highlighting still
  gets the right `property` token from the dedicated `Property` case) — but
  since a shorthand identifier is *both* the property and the variable read,
  item 4 also needs a matching call to `captureVariable` alongside
  `captureProperty` in extraction's `Property` case, not just removing the
  exclusion.

Item 3 (literal object-literal keys) is untouched by ticket 02 and still needs
`getStaticPropertyName` changed as described above.

## Not in scope

The diagnostic fallout. Step 2 makes `$arr.push(x)` a property reference that is
never set, and built-in *method* names aren't in any filter list — so
`VariableNeverSet` will fire on `.push`, `.trim`, `.map` and friends until issue
08 lands. **These two must ship together**; don't release between them.

## Done when

- `foo(bar)` yields both `foo` and `bar`.
- `$utils.greet()` yields property `$utils.greet`.
- `obj = {'k': 1}`, `obj = {1: 'x'}` and `obj = {a}` corpus rows updated.
- `obj().a` and `obj[i].name` are unchanged.
- `npm test` green.
