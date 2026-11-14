# Claiming .js documents alongside VS Code's JS service

Type: research
Status: resolved

## Question

If the twee language server registers for `.js` documents (client `documentSelector`, references/rename/definition providers), how does that coexist with VS Code's built-in TypeScript/JavaScript language features? Do results merge or duplicate? Can two rename providers conflict? How do Vue, Svelte and Astro language tools handle sharing `.js`/`.ts` files? Can a server limit itself to a dynamic set of files (the resolved story script files and included scripts) instead of all `**/*.js`? Without claiming the documents, can references/rename *results* still point into `.js` files and apply `WorkspaceEdit`s there, including to unsaved open buffers?

## Answer

Findings are on branch `research/lsp-js-document-coexistence`, in `docs/research/lsp-js-document-coexistence.md`. That branch is never merged.

- **References and definition results merge** across providers. VS Code removes only exact duplicates (same URI and same range); overlapping ranges both appear.
- **Rename is first-result-wins, not merged.** At equal score, third-party providers come before built-ins, so ours is asked before TypeScript's. If our `prepareRename` returns `null`, VS Code falls through to TypeScript.
- **Vue, Svelte and Astro** claim only their own languages and reach `.js`/`.ts` through a TS server plugin. Vue's takeover mode required disabling the built-in TS extension and is deprecated.
- **Registration can be scoped to a dynamic file set** through `client/registerCapability` with a selector built from the tt3.config globs. Middleware filtering or restarting the client also work.
- **Without claiming `.js`,** references, rename and definition results can still point into `.js` files, and `WorkspaceEdit`s apply to unsaved buffers and unopened files. But nothing can start *from* a `.js` file, and the server sees only what's on disk plus watcher events.
- **A middle option** is to sync `.js` text without registering any `.js` feature providers. The doc compares six options (A–F) with their trade-offs.
