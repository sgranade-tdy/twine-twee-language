# 01: Share the never-set check between formats

**What to build:** SugarCube and Chapbook currently each implement the `variable-never-set` check (collect project-wide variable and property writes, then test the document's variable and property occurrences against them, exempting built-in JS properties). Collapse this into one shared check parameterized by the format's symbol kinds, built-ins and message, so the opaque-assignment rule (see `../spec.md`) lands in exactly one place. Pure prefactor: no behaviour change.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] One shared never-set check is used by both SugarCube and Chapbook diagnostics
- [ ] Format-specific messages, built-in variables/properties and symbol kinds are still honoured
- [ ] All existing diagnostics tests pass unchanged
