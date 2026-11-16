# 05: SugarCube macros — `for…range` and receivers

**What to build:** Format-forced writes from SugarCube macros mark their variables opaque per `../spec.md`, so iterating over a list of objects or reading a receiver's value doesn't warn on its properties.

**Blocked by:** 02 (Tracer bullet — call results are opaque in `<<set>>`)

**Status:** done

- [x] `<<for _item range $list>>` then `_item.name` doesn't warn
- [x] In `<<for _k, _v range $obj>>`, `_v` is opaque and `_k` is not
- [x] Every quoted receiver (`<<listbox>>`, `<<cycle>>`, `<<textbox>>`, `<<numberbox>>`, `<<radiobutton>>`, `<<checkbox>>`, …) marks its variable opaque, with no per-macro value modelling

## Comments

- Receivers are handled once, in the generic `receiver` argument type, so every built-in receiver macro and any custom macro (via `t3lt.twee-config`) that declares a `receiver` argument is opaque.
- A quoted receiver is parsed as the target of an assignment, so only the path it writes is opaque. `"$p.stats"` reads `$p` and makes `$p.stats` opaque; in `"$a[_i]"`, `_i` is a read, not opaque.
- A quoted receiver that can't be an assignment target (`"$junk + 1"`) records nothing: no reference, no semantic token.
- A back-ticked or bare receiver is an expression whose value is the receiver's name (`` <<set $target to "$name">><<textbox `$target` "">> ``), so every reference in it is a read and nothing is written or opaque. The bare-variable diagnostic still suggests back-ticks.
- In `<<for>>`, the collection expression after `range` stays an ordinary read.
- The range form accepts `_k,_v` with no space after the comma, matching SugarCube's own `\s*,\s*`.
