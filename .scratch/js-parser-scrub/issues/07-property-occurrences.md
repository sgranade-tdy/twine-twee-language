# 07 — Index callees, method properties, and literal keys

Type: task
Status: closed
Blocked by: 05, 11, 12, 15

Issue 11 makes `function f(){}` a written occurrence. On its own that makes
rename _worse_: the `CallExpression` branch gives `f()` a `function` semantic
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
   Built-in callees are mostly excluded by issue 05's per-format lists (see the
   ticket 05 review note below for the gaps, now filled).

    **Chapbook `alert`/`prompt`/`confirm`** (decided 2026-10-13): accept that
    these become story-variable reads when called under Chapbook. Ticket 05
    deliberately keeps them indexable there, and ticket 14 warns when one is
    set as a variable. Add a Chapbook corpus or parser row pinning `alert(x)` →
    `alert`, `x`.

2. **Method-call properties are occurrences.** `obj.method(x)` yields property
   `obj.method`; `obj.a.method(x)` yields `obj.a` and `obj.a.method`. This
   reverses a deliberate decision — `js-parser.test.ts` (~line 1093: "should not return a
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

    This applies to object _literals_ only. In a destructuring pattern
    (`({a} = c)`, `const {a} = o`, `function f({a}){}`), the shorthand `a` is a
    binding or assignment target, not a property of anything being built.
    Removing the shorthand exclusion from `isExcludedIdentifier` must not make
    these yield a property, and must not report `a` twice (key and value are
    separate nodes with the same range). Add corpus rows for all three, with and
    without the flag where it applies.

5. **Label method-call properties** (added 2026-10-13, for ticket 08). Add a
   field to `JSPropertyLabel` (e.g. `isCallee: boolean`) that is true when the
   property occurrence is the callee of a call or `new` (`$arr.push(x)`,
   `new $a.B()`). Carry it into the index reference, or into whatever ticket 08's
   filter can see, so 08 can exempt built-in _method_ names only when they're
   called. Use the existing `isCallee(node, parent)`, so there is one
   definition of a callee.

**Dotted keys inside a prefix** (decided 2026-10-13): accepted, not fixed.
`obj['a.b'].c` gets prefix `obj.a.b`, the same as `obj.a.b.c`, so rename by
prefix conflates them. That needs a key containing a `.`, which is rare in
Twine code, and fixing it would mean changing `JSPropertyLabel.prefix` from a
string to a segment array everywhere.

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
  has an explicit `(CallExpression || NewExpression) && parent.callee === node`
  check. (Since the ticket 02 review follow-up, that's the _only_ `new`
  exclusion: `new` arguments are ordinary reads, and `new Foo(bar)` already
  yields `bar`.) Removing it makes both `foo` in `foo(bar)` and `Thing` in
  `new Thing(a)` occurrences, which is most of item 1's work; the
  `computeSemanticTokens` pass doesn't need a matching change, since it already
  gets the right `function` token from `CallExpression`'s own case regardless
  (and gives `new` callees no token at all, which is unchanged).
- **Method-call properties** (work item 2): `extractSymbols`'s
  `case "MemberExpression"` computes `lastIsCallCallee` and skips capturing the
  chain's last segment when true. Removing that skip (and updating
  `js-parser.test.ts:994`, per this issue's own instructions) is item 2's work.
  It also covers string-literal callees: the corpus row `obj["m"](x)` currently
  yields no `obj.m` and should flip along with `obj.method(x)`.
  Same note as above: highlighting doesn't need a change.
- **Shorthand property values** (work item 4, defect 10): `isExcludedIdentifier`
  also has an `ancestor?.type === "Property" && ancestor.shorthand` check. This
  one only affects `extractSymbols` for the same reason (highlighting still
  gets the right `property` token from the dedicated `Property` case) — but
  since a shorthand identifier is _both_ the property and the variable read,
  item 4 also needs a matching call to `captureVariable` alongside
  `captureProperty` in extraction's `Property` case, not just removing the
  exclusion.

Item 3 (literal object-literal keys) is untouched by ticket 02 and still needs
`getStaticPropertyName` changed as described above.

## Not in scope

The diagnostic fallout. Step 2 makes `$arr.push(x)` a property reference that is
never set, and built-in _method_ names aren't in any filter list — so
`VariableNeverSet` will fire on `.push`, `.trim`, `.map` and friends until issue
08 lands. **These two must ship together**; don't release between them.

## Done when

- `foo(bar)` yields both `foo` and `bar`.
- `$utils.greet()` yields property `$utils.greet`.
- `obj = {'k': 1}`, `obj = {1: 'x'}` and `obj = {a}` corpus rows updated.
- `obj().a` and `obj[i].name` are unchanged.
- `$arr.push(x)` yields `$arr.push` labelled as a callee. `$arr.push = f` and
  `y = $arr.push` yield it labelled as not a callee.
- The destructuring-shorthand rows in item 4 yield no properties and no
  duplicate variables.
- `npm test` green.

## Comments

### Note from ticket 01 review

- **Compact property strings now quote names containing `.` or `=`.**
  `compact()` in `js-parser.test.ts` renders `obj['a.b']` as `obj."a.b"` (rows
  pin it), so item 3's literal-key rows can't collide with a longer chain.
  Residual: `prefix` is already a `.`-joined string in `JSPropertyLabel`, so a
  dotted key _inside_ a prefix (`obj['a.b'].c` → prefix `obj.a.b`) is ambiguous
  in the parser's own data, not just the test formatter. Rename by prefix would
  conflate it with `obj.a.b.c`; worth deciding whether that's acceptable here.
- **No compact highlighting baseline exists.** The corpus only checks
  `variables`/`properties`. If callee indexing touches code shared with the
  highlighting pass, rely on the longhand "Semantic Tokens" tests or add
  highlighting rows first (see ticket 02's note).

### Note from ticket 02 second review

This supersedes parts of "Update from ticket 02" above:

- **`isTwineScriptExpression` no longer depends on these exclusions.**
  `isEveryIdentifierAVariable` has its own filter and keeps skipping callees
  permanently, because `either(...)` and `visited(...)` name functions, not
  variables. Removing the callee or shorthand checks from
  `isExcludedIdentifier` won't affect it. Don't route the predicate back
  through `isCandidateVariable`. The `sc2-twinescript.test.ts` rows for
  `either("A", $b)` and `{a}` guard this.
- **Callees are now identified in one place.** `isCallee(node, parent)` covers
  both `CallExpression` and `NewExpression`. Extraction's member-chain skip is
  now `lastIsCallee`, not `lastIsCallCallee`, and it applies to `new` too. So
  item 2 flips `new a.B(x)` (corpus row now `properties: []`) along with
  `a.b(x)`.
- **`new` callees now get a `function` token**, the same as call callees. The
  statement above that `new` callees get no token is out of date.

### Note from ticket 03 review

`annotateVariableScopes` doesn't hoist. A binding exists only once the walk
reaches its declaration, so a reference earlier in an inner scope resolves as
global. Today that mostly goes unnoticed, because callees are excluded. Once
work item 1 indexes callees, every forward call to a helper inside an IIFE
becomes a story-variable read and draws `VariableNeverSet`. For example,
`(function(){ init(); function init(){} })()` would report `init`. That's the
standard SugarCube Story JavaScript shape. Non-call forward references already
leak today: `(function(){ on('x', handler); function handler(){} })()` reports
`handler`. Land hoisted pre-binding, or at least function-declaration
hoisting, before or alongside this ticket. Ticket 03's review comment has the
details.

Ticket 13 now owns hoisting and has been added to this ticket's Blocked by line.

### Note from ticket 05 review

Work item 1 says built-in callees are "already excluded by issue 05's list".
They aren't, not completely. The list lacks the `Error` subclasses, typed
arrays, `WebAssembly`, `escape`/`unescape`, and common host functions
(`requestAnimationFrame`, `fetch`, `structuredClone`, `queueMicrotask`,
`Audio`, `Image`, `URL`). With callees indexed, `throw new TypeError(…)` or
`requestAnimationFrame(tick)` would index the built-in as a story variable.
Fill those gaps before or with this ticket, and add corpus rows for a few of
them.

The ticket 05 review also recommends moving browser globals and `$`/`jQuery`
to a per-format list, because they swallow Chapbook story variables named
`location`/`history`. If that lands, "excluded by the list" for host
callees (`alert(…)`, `setTimeout(…)`) depends on which format supplies the
list. Re-check the `$('#x').hide()`/`setTimeout` corpus rows against it.

Update: ticket 05's review fixes filled the ECMAScript gaps and moved host
globals to per-format lists. Under Chapbook, a called `alert(…)`, `prompt(…)`
or `confirm(…)` will be indexed as a story variable once this ticket lands,
because those names are deliberately not excluded for Chapbook. Decide
whether that's acceptable, or whether callees need a separate exclusion.

### Update from ticket 15 (2026-10-13)

The hoisting concern in the ticket 03 note is handled by eslint-scope
(ADR-0004), which hoists natively. Ticket 15 replaced 13 as this ticket's
scope blocker.

### Note from ticket 11 (2026-10-14)

- Ticket 11 let a top-level `function f(){}`'s name through `isExcludedIdentifier`, so it's now a write (`f=`) with no call sites. Rename is slightly worse for functions until this ticket indexes callees.
- About ten corpus rows plus two tests in `js-parser.test.ts` (the function-local `o.x` token test and "globally-scoped variable references") now expect `f=` / an `f` token. Re-check them when callees are indexed.
- `isFunctionOwnBinding` is unchanged. Only the call in `isExcludedIdentifier` was narrowed, so SugarCube's `isEveryIdentifierAVariable` still skips function names.

### Note from ticket 12 (2026-10-14)

- Ticket 12 is done, so the block on it is cleared. Only the last chain segment is a write now. When you skip the callee's own name in `obj.method(x)`, that doesn't change.
- `isWriteTarget` is where a "which position is this node in?" question belongs. If callee handling needs a similar shape check, put it beside `isCallee` and `isWriteTarget` instead of adding a third classifier.
- Method-valued writes (`$utils.greet = function(){}`) already work on the write side. Only the matching read at `$utils.greet()` is left for this ticket.
- Script sites now treat a bare `a = 1` as a write, and that includes SugarCube Story JavaScript. Callee rows that expect a read there will change.

### Implementation notes (2026-10-14)

- Done in `6cd9a10`. `obj().a` now yields variable `obj` (it's a callee read); the "unchanged" wording above only holds for properties.
- `JSPropertyLabel.isCallee` is set only when true (omitted otherwise) so existing deep-equal tests didn't need churn. It is **not** plumbed into the index reference; ticket 08 must do that.
- Numeric literal keys use their source text (`0x10` stays `0x10`) so the label range matches. **Superseded by ticket 21**: numeric keys and non-identifier string keys are no longer indexed.
- Added SugarCube global functions to `sugarCubeHostGlobals` and skipped `output`/`output.*` inside `<<script>>` (`sugarcube-utils.ts`), both to avoid false references once callees are indexed.
- The Chapbook `alert(x)` row is a js-parser corpus row using `browserGlobals`, not a Chapbook parser test.
