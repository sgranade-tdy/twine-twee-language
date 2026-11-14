# 19: SugarCube script code reaches story variables only via state roots (ADR-0005)

**What to build:** In SugarCube `script` passages and JS `<<script>>` blocks, a **Story variable** is reached only through a **State root** or a single-initializer alias of one. Today's rule, where an unbound or root-declared name counts as a story variable, is removed. That stops vendor and UMD code from flooding the index. ADR-0003 still governs expression code (spec: Semantics; user stories 2–9, 16, 17).

State roots:

- `State.variables`, `State.temporary`, `variables()` and `temporary()`;
- `SugarCube.State.*`, with or without a leading `window.`;
- `State.getVar`/`setVar` with a string or no-substitution template literal, where the sigil sits inside the string.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Each state root, including `window.SugarCube.State.variables`, yields a read or assignment of the right variable
- [ ] `getVar('$gold')`/`setVar('$gold', 1)` and template-literal keys are indexed, and other strings are not
- [ ] `const v = State.variables; v.gold` is indexed. A reassigned alias, or one whose initializer isn't exactly a state root, is dropped
- [ ] `const { gold, hp: h } = State.variables` yields reads of `$gold` and `$hp`
- [ ] `State.variables['gold']` is indexed, and escaped spellings such as `'\x66oo'` are not
- [ ] Bare identifiers (including `$x`), `Config`, declarations and UMD names (`module`, `define`, `exports`, `global`, `self`) yield no story variables
- [ ] Ranges never include the sigil and set the explicit sigil flag correctly (or the equivalent, if ticket 16 hasn't landed yet)
- [ ] Existing SugarCube parser tests that encode "unbound ⇒ story variable" are updated to ADR-0005
