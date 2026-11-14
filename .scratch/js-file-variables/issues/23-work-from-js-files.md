# 23: Work from inside .js files

**What to build:** An author can start find-references, go-to-definition and rename from a story-variable occurrence inside a resolved `.js` file. Edits there are reflected without touching the `.tw` file (spec: Discovery, registration and watching; Rename freshness; user stories 19, 20, 24, 34, 42, 43).

- Through `client/registerCapability`, the server registers text sync, references, definition and rename (with `prepareRename`) for the exact set of resolved `.js` files. Each file is listed by exact path, with glob metacharacters escaped. The server registers nothing else for `.js`.
- The workspace file tracker re-parses open `.js` buffers about 300 ms after the last edit. `.tw` stays undebounced.
- Every `.js` re-parse revalidates the open `.tw` documents.
- References, definition, `prepareRename` and rename first flush every pending `.js` parse synchronously.
- Our results merge with VS Code's own JS results, and other JS features are left to VS Code.

**Blocked by:** 18, 21

**Status:** ready-for-agent

- [ ] Only resolved `.js` files are in the registered selector, and paths with glob metacharacters are escaped
- [ ] Find-references and definition started from `State.variables.gold` in a `.js` file list the `.tw` and `.js` occurrences
- [ ] A burst of `.js` edits causes one re-parse after the debounce (fake timers)
- [ ] Setting a variable in an open `.js` buffer clears `variable-never-set` in an open `.tw` document without editing it
- [ ] A rename requested before the debounce fires uses the current buffer contents
