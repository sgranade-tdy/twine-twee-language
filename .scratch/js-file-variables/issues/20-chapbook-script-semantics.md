# 20: Chapbook script code: engine.state and conditional references

**What to build:** In Chapbook `script` passages and `[JavaScript]` blocks:

- `engine.state.get` is indexed as a read, and `set`/`setDefault` as assignments.
- A dotted literal key is indexed as a property, and a non-literal key is dropped.
- Every unbound bare name is indexed as a **Conditional reference**, never an assignment.
- Root-level declarations are recorded per URI as their own kind.
- `engine`, `go`, `restart` and host globals are excluded, and `config` is a story variable.
- **Declarations** are never story variables.

References, definition, rename and `variable-never-set` filter conditional references at query time against two sets: the variables the project defines, and the root-level declarations from story script files and `script` passages. No file is re-parsed when another file changes (spec: Semantics, Index plumbing; user stories 10–17, 23).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `engine.state.get('gold')` shows up in find-references and rename for `gold`
- [ ] `set`/`setDefault` count as definitions and suppress `variable-never-set`
- [ ] `engine.state.get('a.b')` is indexed as the property `a.b`, and a non-literal key yields nothing
- [ ] A bare `gold` appears in references only when `gold` is defined elsewhere and no root-level declaration in a `script` passage binds it
- [ ] Conditional references never raise or suppress `variable-never-set`
- [ ] Excluded names yield nothing, and `config` is a story variable
- [ ] Escaped spellings are not indexed
- [ ] Existing Chapbook parser tests that encode the old rule are updated to ADR-0005
