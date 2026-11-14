# What counts as a story variable in a .js file

Type: grilling
Status: resolved
Blocked by: 01

## Question

Per format (SugarCube 2, Chapbook 2), and separately for story script files and included scripts: which names and occurrences in a `.js` file are story variables, properties or assignments? Examples: SugarCube `State.variables.x`, `variables().x`, `State.temporary`; Chapbook `engine.state.get/set`; bare unbound identifiers; top-level declarations. Does ADR-0003's "unbound ⇒ story variable" rule, which the script-passage paths apply today with `isAssignmentContext: true`, hold for these files, or does it need amending? Does every write in such a file count as an assignment? Research (ticket 01) found that story script files and `script` passages share one concatenated scope, so should binding be resolved across that whole blob rather than per file? The spike (ticket 04) found these concretely. Root-level declarations in vendor files become hundreds of story variables (three.js: 653). UMD names (`module`, `define`, `exports`, `global`, `self`) are indexed. Chapbook doesn't exclude `engine`/`config` and doesn't index `engine.state.get('x')` reads. SugarCube misses `State.variables` aliases. Which of these does the spec fix, and do the fixes also apply to `script` passages?

## Answer

ADR-0005 holds the rule. The **State root** and revised **Story variable** entries in `GLOSSARY.md` hold the terms.

- **Scope.** These semantics apply to every path that shares the code: story script files, included scripts, `script` passages, SugarCube JS `<<script>>` blocks and Chapbook `[JavaScript]` blocks. All of them are specified in this effort, which graduates the "Fixing today's script-passage semantics" fog. ADR-0003 still governs expression code.
- **SugarCube.**
  - No bare identifier is a story variable, including `$x`, which isn't desugared in JS.
  - Story variables are reached through state roots: `State.variables`/`State.temporary`, `variables()`/`temporary()`, `SugarCube.State.*` (also via `window.`), and `State.getVar('$x')`/`setVar` with a string literal. All of these are recognized in both kinds of `.js` file, and the rename mapping must cover each one.
  - A `var`/`let`/`const` whose initializer is exactly a state root and which is never reassigned is an alias. Members reached through it are story variables. Any other aliasing is dropped, and so is any cross-file alias.
- **Chapbook.**
  - A bare unbound name is a **reference**, never an assignment, but only when both of these hold:
    - the project defines that variable elsewhere: a vars section, `engine.state.set`/`setDefault`, or, for `a`, a dotted `a.b`;
    - no root-level declaration in any story script file or `script` passage binds the name. Those all run as one concatenated scope.
  - `engine.state.get('x')` is a read. `set` and `setDefault` are assignments. A dotted literal is a property, and a non-literal key is dropped.
  - `engine`, `go` and `restart` are excluded. `config` is a story variable.
- **Declarations** are never story variables, at the root or anywhere else. This strikes ADR-0004's consequence and removes the vendor-file flood, including UMD names.
- **Assignments.** In story script files and script code, every write-shaped use of a state root counts. Included scripts are left to **Do writes in included scripts count against variable-never-set**.
