# In script code, story variables are reached through state roots, not by being unbound

Status: accepted

ADR-0003 treats any identifier left unbound in its snippet as a story variable.
That is right for expression code, such as SugarCube macro arguments and
Chapbook vars sections, where the format puts story variables in scope. It is
wrong for script code: Story JavaScript, `script` passages, SugarCube's JS
`<<script>>`, Chapbook's `[JavaScript]` blocks, story script files and included
scripts. Research on 2026-10 (`docs/research/format-script-execution.md` on
branch `research/format-script-execution`) found the following:

- SugarCube runs this code in a strict `eval`, where a bare name is never state.
- Chapbook mirrors a state variable onto `window` only once that variable exists.
- Both formats keep top-level declarations local.

On whole files the old rule turned vendor libraries into hundreds of junk
story variables.

In script code, therefore, a story variable is an occurrence reached through a
**state root**. The SugarCube state roots are `State.variables`/`State.temporary`,
`variables()`/`temporary()`, `SugarCube.State.*` and `getVar`/`setVar` with a
string literal. Chapbook's are `engine.state.get`/`set`/`setDefault` with a
string literal. A state root also includes any never-reassigned binding whose
initializer is one of those.

Chapbook has one exception. A bare unbound name is a reference, never an
assignment, when the project defines that variable elsewhere and no root-level
declaration in any story script file or `script` passage binds that name. This
is because all of those run as one concatenated scope.

Declarations are never story variables in any context. This supersedes ADR-0003
for script code and strikes ADR-0004's "root-level declarations are story state"
consequence.

## Considered options

- **Keep "unbound ⇒ story variable" for script code.** This produced junk from
  UMD names and vendor globals, and in SugarCube it indexed bare names that can
  never be state.
- **Never treat Chapbook bare names as story variables.** That misses real
  references, and rename would skip them.

## Consequences

- Extracting Chapbook bare names depends on project-wide knowledge: which
  variables are defined, and which names are declared across the script blob.
  It is no longer a property of one snippet.
- SugarCube aliases are recognized only within one file. A cross-file alias is
  dropped, which loses a reference but never misindexes one.
