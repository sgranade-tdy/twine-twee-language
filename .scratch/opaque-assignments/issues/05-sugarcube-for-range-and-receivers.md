# 05: SugarCube macros — `for…range` and receivers

**What to build:** Format-forced writes from SugarCube macros mark their variables opaque per `../spec.md`, so iterating over a list of objects or reading a receiver's value doesn't warn on its properties.

**Blocked by:** 02 (Tracer bullet — call results are opaque in `<<set>>`)

**Status:** done

- [x] `<<for _item range $list>>` then `_item.name` doesn't warn
- [x] In `<<for _k, _v range $obj>>`, `_v` is opaque and `_k` is not
- [x] Every receiver (`<<listbox>>`, `<<cycle>>`, `<<textbox>>`, `<<numberbox>>`, `<<radiobutton>>`, `<<checkbox>>`, …) marks its variable opaque, with no per-macro value modelling

## Comments

- Receivers are handled once, in the generic `receiver` argument type, so every built-in receiver macro and any custom macro (via `t3lt.twee-config`) that declares a `receiver` argument is opaque.
- In a back-ticked receiver expression, every reference is already treated as a write, so every reference is also opaque (`` `$a[_i]` `` makes `_i` opaque too). Such receivers are rare enough that we don't distinguish the written target from index expressions.
- In `<<for>>`, the collection expression after `range` stays an ordinary read.
