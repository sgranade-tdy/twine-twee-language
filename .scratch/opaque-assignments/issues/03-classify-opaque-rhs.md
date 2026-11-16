# 03: Classify every opaque right-hand side

**What to build:** Extend opaque-assignment detection from calls to the full classification in `../spec.md`, so the common aliasing and construction patterns stop producing never-set noise in expression code (both formats) and in script code that writes through bare names.

**Blocked by:** 02 (Tracer bullet — call results are opaque in `<<set>>`)

**Status:** done

- [x] Opaque: identifiers (`_p to $player`), member access (`$x to setup.items.sword`), element access (`_a to $arr[0]`), `new`, `this`, `await`, `yield`
- [x] Conditional and logical expressions (`?:`, `||`, `??`) are opaque when any branch is
- [x] A branch that is the assigned path itself is ignored: `$inv to $inv || {}` is _not_ opaque, so `$inv.typo` still warns
- [x] Spread in an object literal (`{...$base, a: 1}`) makes the parent path opaque while `a` is still recorded as a property write
- [x] Destructuring from an opaque source makes each target opaque (`[_a, _b] to fn()`)
- [x] Known shape stays non-opaque: literals, template strings, arithmetic, comparisons, unary `typeof`/`!`/`-`, string concatenation
- [x] Opaque wins: a path with both a literal write (`{hp: 10}`) and an opaque write (`clone($saved)`) doesn't warn on `$player.hpp`
