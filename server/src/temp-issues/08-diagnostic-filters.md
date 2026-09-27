# 08 — Stop exempting the author's own property names

Type: task
Status: open
Blocked by: 07

`VariableNeverSet` fires on any property reference whose full dotted path is
never written. Two allowlists suppress it, and both are too broad in the same
way: they exempt names that are *also* the most natural property names a Twine
author will ever pick.

`isBuiltinJSObjectInstanceProperty` (`js-parser.ts:395`) matches the last path
segment against ~25 names. Matching the last segment at any depth is **correct**
and should stay — `$player.stats.length` is a legitimate built-in read at depth
two. The problem is the names themselves:

| Reference | Suppressed because | Verdict |
| --- | --- | --- |
| `$inventory.length` | `Array.length` | right |
| `$player.stats.length` | `Array.length` | right |
| `$player.name` | `Function.name` | wrong |
| `$item.description` | `Symbol.description` | wrong |
| `$err.cause`, `$re.source`, `$bag.size`, `$cfg.global`, `$x.flags`, `$y.message`, `$z.buffer` | assorted | wrong |

The failure is silent and hits exactly the properties authors use most: a typo'd
`$player.nmae = "Bob"` beside a correct `$player.name` read produces no warning
at all, so the diagnostic's whole purpose is defeated for `name`-like fields.

`builtinSugarCubeProperties` (`sugarcube-variables.ts:86`) repeats it, worse. It
holds `MacroContext` and `Passage` members — `name`, `id`, `tags`, `text`,
`output`, `self`, `parent`, `payload`, `args` — and matches them against *any*
root variable. So SugarCube exempts `$player.name` via its own list regardless of
what the JavaScript list does.

## Work

1. **Prune the JS list** to names an author is unlikely to choose: `length`,
   `prototype`, `constructor`, `arguments`, `caller`, `lastIndex`, `byteLength`,
   `byteOffset`, `detached`, `maxByteLength`, `resizable`, `growable`,
   `disposed`, `dotAll`, `hasIndices`, `ignoreCase`, `multiline`, `sticky`,
   `unicode`, `unicodeSets`. Drop `name`, `description`, `message`, `source`,
   `cause`, `size`, `global`, `flags`, `buffer`.
2. **Add built-in method names**, required by issue 07: `push`, `pop`, `shift`,
   `unshift`, `slice`, `splice`, `concat`, `join`, `indexOf`, `lastIndexOf`,
   `includes`, `find`, `findIndex`, `filter`, `map`, `reduce`, `forEach`,
   `some`, `every`, `sort`, `reverse`, `flat`, `trim`, `toUpperCase`,
   `toLowerCase`, `replace`, `split`, `startsWith`, `endsWith`, `padStart`,
   `padEnd`, `repeat`, `charAt`, `toString`, `valueOf`, `hasOwnProperty`,
   `get`, `set`, `has`, `add`, `delete`, `clear`, `keys`, `values`, `entries`,
   `then`, `catch`, `finally`. Without this, issue 07 turns every `$arr.push(x)`
   into a false "never set".
3. **Scope SugarCube's list to its roots.** `MacroContext` members are only
   reachable from `_args` and friends; `Passage` members from a passage object.
   Key the list by root rather than exempting `.name` on everything. If that's
   too large a change, at minimum drop the entries unreachable from an arbitrary
   story variable.
4. **Unify the two name conventions.** In the same `if`
   (`sugarcube-diagnostics.ts:75-81`), one condition takes the last segment
   (`split(".").pop()`) and the other takes everything after the first dot
   (`slice(indexOf(".") + 1)`). Pick one meaning of "the property name" and use
   it in both.
5. Fix the stale comment above the JS list, which says "root properties" while
   the code matches at any depth.

## Not in scope

Type inference. We can't know whether `$x` is an Array, so `$x.length` stays
name-disambiguated. The trade is deliberate: `$err.message` on a real caught
error now warns, but `VariableNeverSet` is user-disableable, and a silently
missing warning isn't recoverable at all.

## Done when

- `$player.name` and `$item.description` produce a `VariableNeverSet` diagnostic
  in **both** formats when never set.
- `$inventory.length`, `$player.stats.length` and `$arr.push(x)` produce none.
- Both conditions in `sugarcube-diagnostics.ts` agree on what a property name is.
- `npm test` green.
