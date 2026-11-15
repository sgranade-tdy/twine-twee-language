# 05: SugarCube macros — `for…range` and receivers

**What to build:** Format-forced writes from SugarCube macros mark their variables opaque per `../spec.md`, so iterating over a list of objects or reading a receiver's value doesn't warn on its properties.

**Blocked by:** 02 (Tracer bullet — call results are opaque in `<<set>>`)

**Status:** ready-for-agent

- [ ] `<<for _item range $list>>` then `_item.name` doesn't warn
- [ ] In `<<for _k, _v range $obj>>`, `_v` is opaque and `_k` is not
- [ ] Every receiver (`<<listbox>>`, `<<cycle>>`, `<<textbox>>`, `<<numberbox>>`, `<<radiobutton>>`, `<<checkbox>>`, …) marks its variable opaque, with no per-macro value modelling
