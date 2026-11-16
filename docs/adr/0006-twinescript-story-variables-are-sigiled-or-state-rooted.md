# In TwineScript, story variables are sigiled names or reached through state roots

Status: accepted

ADR-0003 treats a name unbound within its snippet as a story variable in
expression code. For SugarCube's TwineScript (macro arguments, `<<set>>`,
`<<run>>`, `<<print>>`, link setters), that rule produces noise:

- SugarCube keeps story state only in sigiled names. It desugars `$x` to
  `State.variables.x` and `_x` to `State.temporary.x`. A bare name such as
  `fn` in `<<run State.variables.r = fn()>>` is a JavaScript global. It's never
  story state, but the old rule warned that it was never set.
- Authors also write TwineScript in the script style, as in
  `<<run State.setVar('$x', 5)>>` or `<<set _p to State.variables.player>>`.
  ADR-0005's state roots describe that code exactly, but ADR-0005 only covered
  script code.

In TwineScript, therefore, a story variable is one of:

- a sigiled name (`$x`, `_x`)
- an occurrence reached through a state root, as ADR-0005 defines for SugarCube

Properties count when they're rooted in one of those, or in SugarCube's
`settings` or `setup` objects. Other bare names and their properties are plain
JavaScript and aren't indexed. Macro arguments that are barewords already
followed this rule.

This supersedes ADR-0003 for SugarCube TwineScript and extends ADR-0005's state
roots to it. Chapbook expression code still follows ADR-0003.

## Considered options

- **Keep "unbound ⇒ story variable" and drop only callees.** This still
  indexes non-callee globals (`<<set $r to myGlobal>>`, `Engine.play`) that
  SugarCube can never treat as story state.
- **Extend the legacy rewrite of `State.variables.x` labels to `$x`.** It
  misses `getVar`/`setVar`, `variables()` and `SugarCube.State`, and it can't
  trace shape sources through them.

## Consequences

- A missing sigil (`<<if gold>>` for `<<if $gold>>`) is no longer reported as a
  never-set story variable. That warning was misleading anyway, since the name
  is a global, not a variable.
- TwineScript shape sources reached through a state root are already sigiled
  (`$player`). Those from sigiled names are resugared from their desugared form.
