# 05: SugarCube macros — `for…range` and receivers

**What to build:** Format-forced writes from SugarCube macros mark their variables opaque per `../spec.md`, so iterating over a list of objects or reading a receiver's value doesn't warn on its properties.

**Blocked by:** 02 (Tracer bullet — call results are opaque in `<<set>>`)

**Status:** done

- [x] `<<for _item range $list>>` then `_item.name` doesn't warn
- [x] In `<<for _k, _v range $obj>>`, `_v` is opaque and `_k` is not
- [x] Every receiver (`<<listbox>>`, `<<cycle>>`, `<<textbox>>`, `<<numberbox>>`, `<<radiobutton>>`, `<<checkbox>>`, …) marks its variable opaque, with no per-macro value modelling

## Comments

- Receivers are handled once, in the generic `receiver` argument type, so every built-in receiver macro and any custom macro (via `t3lt.twee-config`) that declares a `receiver` argument is opaque.
- A receiver is parsed as the target of an assignment, so only the path it writes is opaque. A quoted `"$p.stats"` reads `$p` and makes `$p.stats` opaque; in `` `$a[_i]` ``, `_i` is a read, not opaque.
- A back-ticked receiver that can't be an assignment target (`` `"$" + _name` ``) builds the name at runtime, so we can't tell what it writes. Its references are all reads, and nothing is opaque.
- In `<<for>>`, the collection expression after `range` stays an ordinary read.
- The range form accepts `_k,_v` with no space after the comma, matching SugarCube's own `\s*,\s*`.
