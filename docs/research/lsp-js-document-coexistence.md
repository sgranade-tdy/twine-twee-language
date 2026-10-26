# Coexisting with VS Code's built-in JS/TS features when indexing `.js` files

Research date: 2026-10-26.

**Question.** If the Twine/Twee language server indexes story-variable occurrences in local `.js` files (a dynamic set taken from the `tt3.config.json` globs) so that find-references, go-to-definition and rename work across `.twee` and `.js`, how does that sit alongside VS Code's built-in TypeScript/JavaScript language features? What are the options for registering for `.js` documents, or for avoiding registration?

Current state: `client/src/extension.ts` uses `documentSelector: [{ scheme: "file", pattern: "**/*.{tw,twee}" }]`. `server/src/server.ts` statically advertises `definitionProvider`, `referencesProvider`, `renameProvider: { prepareProvider: true }` and `textDocumentSync`.

Sources are pinned to these commits/tags. Line numbers refer to them.

| Repo | Ref |
|---|---|
| microsoft/vscode | `a58fdc7c54` (main) |
| microsoft/vscode-languageserver-node | `4c009dc5e5` (main) |
| microsoft/language-server-protocol | `gh-pages`, `_specifications/lsp/3.17` |
| vuejs/language-tools | `016e22dd04` (main, v3.x), plus tags `v2.0.0` and `v1.8.27` |
| volarjs/volar.js | tag `v1.11.1` |
| sveltejs/language-tools | `c2a9be791b` (main) |
| withastro/astro | `3773941792` (main) |

## Summary

- **References and definitions merge.** VS Code queries every matching provider in parallel and concatenates the results. Before display, the results are sorted, and entries with an identical URI *and* identical range are collapsed. Results that differ in any way, even slightly (for example `$foo` vs `foo`), appear twice. If only one location remains, go-to-definition jumps to it. If more remain, it opens a peek.
- **Rename uses the first provider that produces a result, not a merge.** Providers are ordered by selector score, and higher scores go first. On a tie, **providers from built-in extensions (the TS extension is built-in) are put last**, and after that the most recently registered provider goes first. VS Code calls `prepareRename` on each provider in order. A rejection or `null` moves on to the next provider. The first provider that returns a range also does the rename. If its `provideRenameEdits` returns nothing, VS Code falls through to the next provider. As a result, a twee rename provider for `.js` normally runs before TypeScript's. Wherever our server's prepareRename returns `null`, TS still handles rename as usual.
- **Vue, Svelte and Astro no longer take over `.js`/`.ts`.** Their LSP clients select only their own languages (`vue`, `svelte`, `astro`). For TS/JS files they extend the built-in tsserver with a **TypeScript server plugin** (`contributes.typescriptServerPlugins`). Vue's 1.x "Take Over Mode" claimed `javascript`/`typescript` documents, but only when the user had disabled the built-in TS extension. Vue 2.0 deprecated Take Over Mode, and Vue 3 removed the remaining hybrid-mode configuration.
- **A client can be limited to a dynamic set of files.** Three ways: (a) server-side `client/registerCapability`/`unregisterCapability` with a `documentSelector` built from the resolved files or globs. vscode-languageclient supports this for sync and for every provider, and it sends `didOpen`/`didClose` for affected open documents when registrations change. (b) Client middleware that short-circuits for documents outside the set. (c) Restarting the client with a new `documentSelector`.
- **No `.js` registration is needed for results to point *into* `.js` files.** `Location`s and `WorkspaceEdit`s may target any URI. VS Code applies text edits to open (including dirty) buffers, and to unopened files by loading them as models. The `files.refactoring.autoSave` setting, on by default, saves them when the edit touches more than one file. But **features invoked *from* a `.js` file** need a provider registered for that `.js` document.
- **The server gets no `.js` buffer contents unless the client syncs them.** LSP sends `didOpen`/`didChange` only for documents that match the sync registration. Without sync, the server has two options: read from disk, which misses unsaved edits, plus `workspace/didChangeWatchedFiles`, which reports only on-disk changes; or use a custom client→server notification.

## Findings

### 1. Do results from several reference/definition providers merge or duplicate?

They merge, and only exact duplicates are removed.

- API contract for `registerDefinitionProvider` and `registerReferenceProvider`: "providers are asked in parallel and the results are merged. A failing provider (rejected promise or exception) will not cause failure of the whole operation." (`src/vscode-dts/vscode.d.ts` L14897–14905, L15030–15038)
- Implementation: `getLocationLinks` calls each provider from `registry.ordered(model)`, swallows errors, and returns `coalesce(values.flat())`. Definitions and references both use it. (`src/vs/editor/contrib/gotoSymbol/browser/goToSymbol.ts` L32–51, L53–57, L77–89)
- The UI wraps the result in `new ReferencesModel(...)` (`goToCommands.ts` L256 for definitions, L698/L726 for references). The `ReferencesModel` constructor sorts links and appends a link only if `_compareReferences(link, previous) !== 0`. `_compareReferences` compares URI, then range start (`Range.compareRangesUsingStarts`) (`referencesModel.ts` L158–187, L295–297). **Two providers that return the identical URI and range give one entry. Different ranges, even overlapping ones, give separate entries.**
- Go-to-definition jumps straight to the result if exactly one remains. With more than one it opens a peek, depending on the `editor.gotoLocation.*` settings (`goToCommands.ts` L180–185).
- What this means here: in a `.js` file, TS will often return its own reference/definition for the identifier under the cursor (for example the property `foo` in `State.variables.foo`). That result is merged with ours. Matching identical ranges avoids visible duplicates, as far as that is possible. *Inference, not verified:* what TS returns for `State.variables.foo` depends on whether types such as `@types/twine-sugarcube` are present.

### 2. Can two rename providers conflict? How does VS Code pick one?

Rename takes the first provider in score order that produces a result. Results are never merged.

- API contract: "providers are sorted by their score and asked in sequence. The first provider producing a result defines the result of the whole operation." (`vscode.d.ts` L15040–15051)
- Scoring (`languages.match` docs, `vscode.d.ts` ~L14750–14790): a filter field that does not match scores 0. Matching by equality *or by glob pattern* scores 10, and `*` scores 5. The selector's score is the maximum over its filters. The TS extension's `{ language: 'javascript', scheme: 'file' }` and our `{ scheme: 'file', pattern: '**/foo.js' }` both score **10**.
- Tie-break (`src/vs/editor/common/languageFeatureRegistry.ts` L202–222, L226–236): higher score first. Then **"De-prioritize built-in providers"**: selectors marked `isBuiltin` sort after non-built-in ones. Then newer registrations (`_time`) come first. The extension host sets `isBuiltin: extension?.isBuiltin` on every selector it forwards (`src/vs/workbench/api/common/extHostLanguageFeatures.ts` ~L193–205). `vscode.typescript-language-features` is a built-in extension, so **a third-party rename provider with an equal score is asked before TypeScript's.**
- An internal `exclusive` filter flag gives score 1000 and zeroes all other providers (`languageFeatureRegistry.ts` L183–195). It is not in the public `vscode.d.ts`; it is read through a cast tagged `TODO: microsoft/TypeScript#42768` in `extHostTypeConverters.ts` ~L1656–1662. Treat it as unavailable to us.
- Flow in `RenameSkeleton` (`src/vs/editor/contrib/rename/browser/rename.ts` L43–118):
  - `resolveRenameLocation` (prepareRename) loops over the ordered providers. A falsy result → `continue`. A `rejectReason` → collect the reason and `continue`. The first real location wins, and its index is remembered. **If the current provider has no `resolveRenameLocation`, the loop `break`s** and falls back to the word under the cursor, starting at provider 0.
  - `provideRenameEdits` starts at the remembered index. A falsy result or a `rejectReason` moves to the next provider (`i + 1`).
- The extension host registers `resolveRenameLocation` only if the extension's provider defines `prepareRename` (`RenameAdapter.supportsResolving`, `extHostLanguageFeatures.ts` ~L839–841; `mainThreadLanguageFeatures.ts` L513–521). Exceptions thrown by `prepareRename`/`provideRenameEdits` become `rejectReason`s (~L861–906).
- vscode-languageclient (`client/src/common/rename.ts` L94–128): it defines `prepareRename` only when the server advertises `prepareProvider: true`, which this server does. When the server returns `null`, an unrecognised value, or `{ defaultBehavior: false }`, the client turns it into `Promise.reject(new Error("The element can't be renamed."))`, which counts as a rejectReason, so VS Code tries the next provider (TS). `{ defaultBehavior: true }` maps to `null`, which also falls through. When the server's rename response is `null`, the client returns `null` (L70–86), and VS Code tries the next provider.
- The TS extension's `prepareRename` rejects with `renameInfo.localizedErrorMessage` when `!canRename` (`extensions/typescript-language-features/src/languageFeatures/rename.ts` L35–49).
- Consequences:
  - Where the server's prepareRename returns a range on a `.js` story-variable occurrence, the twee rename wins and TS is never asked at that position.
  - Elsewhere, returning `null` hands rename back to TS with no visible conflict, apart from the extra round trip.
  - If two providers both accept a position, the user cannot pick between them. Only the first one runs.

### 3. How do Vue (Volar), Svelte and Astro share `.js`/`.ts` with the built-in TS service?

**Vue Language Tools**
- v1.x Take Over Mode: `takeOverModeActive()` returns true only when `volar.takeOverMode.extension` names this extension **and** `vscode.extensions.getExtension('vscode.typescript-language-features')` is absent, i.e. the user disabled the built-in extension (volar.js `v1.11.1` `packages/vscode/index.ts` L12–17). When active, the Vue client's selector adds `javascript`, `typescript`, `javascriptreact`, `typescriptreact` (language-tools `v1.8.27` `extensions/vscode/src/common.ts` L193–200). So Take Over avoided coexistence by having the built-in extension switched off.
- v2.0.0 CHANGELOG L7–9: "Takeover Mode has been deprecated… TypeScript language support has been moved from Vue language server to TypeScript plugin."
- v3 (current) CHANGELOG ~L945: "remove hybrid mode configuration…".
- Current client: `documentSelector: config.server.includeLanguages`, which defaults to `["vue"]` (`extensions/vscode/src/extension.ts` L208; `package.json` L291–299).
- TS work is forwarded to the built-in tsserver. The server sends `tsserver/request`, and the client runs the `typescript.tsserverRequest` command (`extension.ts` L217–227).
- `patchTypeScriptExtension()` sets `contributes.typescriptServerPlugins` at runtime and patches the TS extension's bundled JS (`extension.ts` L273–300). `patch-tsserver.ts` adds `.vue` to tsserver's supported extensions.

**Svelte**
- `packages/svelte-vscode/package.json` L61–66 contributes `typescriptServerPlugins: [{ name: "typescript-svelte-plugin", enableForWorkspaceTypeScriptVersions: true }]`.
- Client selector: `[{ scheme: 'file', language: 'svelte' }]` (`src/extension.ts` L181).
- `packages/typescript-plugin/README.md`: the plugin provides "Rename, Find Usages, Go To Definition, Diagnostics… only available within TS/JS files". In other words, **cross-language rename and references inside `.ts`/`.js` are done by extending TS, not by a second provider**.

**Astro**
- `packages/language-tools/vscode/package.json` L50–55 contributes `typescriptServerPlugins: [{ name: "astro-ts-plugin-bundle", … }]`.
- Client selector: `{ language: 'astro' }`, plus optional markdown/mdx/markdoc (`src/client.ts` L82–85).

**Pattern across all three:** never register an LSP client for `javascript`/`typescript` alongside the built-in service. Extend tsserver with a plugin instead (`contributes.typescriptServerPlugins`, documented at <https://code.visualstudio.com/api/references/contribution-points#contributes.typescriptServerPlugins>). Their situation differs from ours: their foreign files are TS-compilable after virtual-code transformation. *Inference:* a twee TS plugin would have to get twee results from somewhere, probably by IPC to our server or by duplicating the index, and add them to tsserver's `findReferences`/`findRenameLocations`.

### 4. Can a LanguageClient restrict itself to a dynamic set of files?

Yes. There are three mechanisms.

**Document selector content**
- VS Code `DocumentFilter.pattern` is a `GlobPattern` "matched on the absolute path of the document", and a `RelativePattern` can be used instead (`vscode.d.ts` ~L2395–2403).
- LSP 3.17 `DocumentFilter.pattern` is a glob string (`types/documentFilter.md`).
- In vscode-languageserver-protocol, `pattern` is typed `GlobPattern` (string | `RelativePattern`), "@since 3.18.0 – support for relative patterns", depending on the client capability `textDocument.filters.relativePatternSupport` (`protocol/src/common/protocol.ts` L153–160, L2320–2325).
- vscode-languageclient sets `relativePatternSupport = true` (`client/src/common/client.ts` ~L2152) and converts `RelativePattern{baseUri}` into `vscode.RelativePattern` (`protocolConverter.ts` ~L1509–1514).
- Patterns can therefore be the tt3.config globs relative to the workspace folder, or exact file paths. *Inference:* exact paths that contain glob metacharacters such as `[]{}?*` would need escaping.

**Server-driven dynamic registration (`client/registerCapability`)**
- LSP 3.17 lets servers register and unregister capabilities after `initialize`. `TextDocumentRegistrationOptions.documentSelector` scopes them (`_includes/messages/3.17/registerCapability.md` L34, L58–60, L105; `specification.md` L867).
- vscode-languageclient declares `synchronization.dynamicRegistration = true` (`textSynchronization.ts` L96, L229, L326).
- `DidOpenTextDocumentFeature.register` sends `didOpen` for already-open documents that newly match (L110–131).
- `DidCloseTextDocumentFeature.unregister` sends `didClose` for synced documents that no longer match any selector (L253–274).
- Provider features take `documentSelector` from the registration, or fall back to the client options selector for static registrations (`features.ts` L557–570).
- So the server could register sync and references/definition/rename for `[{ scheme: 'file', pattern: <glob> }, …]` built from tt3.config.json, and re-register when the config changes.
- Static capabilities in `initialize` keep using the client's `documentSelector` (the `.tw`/`.twee` one). Dynamic registrations are added on top.

**Client middleware**
- `middleware.didOpen/didChange/didClose`, `provideReferences`, `provideDefinition`, `prepareRename` and `provideRenameEdits` all receive `(document, …, next)`. They can skip `next` for documents outside the set (`TextDocumentEventFeature.callback` in `features.ts` L407–419; `rename.ts` L28, L129–131).
- The provider is still *registered* for the wider selector. For references/definitions, a skipped call simply contributes nothing to the merge. For rename, a `null` falls through to the next provider (§2).
- *Inference:* skipping `next` in `didOpen` middleware while the feature still records the document as synced (`_syncedDocuments.set`, L131) can leave open/close bookkeeping uneven. Filtering by selector registration is cleaner than filtering in middleware.

**Restart**
- `LanguageClient` takes `documentSelector` at construction (`client.ts` L347, L716). Changing it means stopping and recreating the client, which is heavier and drops server state.

### 5. Without claiming `.js`, can Locations/WorkspaceEdits point into `.js` and be applied, including to dirty buffers?

Yes, for features invoked from a document the server *does* claim, such as a `.twee` passage.

- A `Location`/`LocationLink` holds any URI. Nothing in `getLocationLinks`/`ReferencesModel` filters on the providers' selectors (§1).
- **Applying edits:**
  - The LSP `WorkspaceEdit` can use `changes` (unversioned) or `documentChanges`. In `documentChanges`, `TextDocumentEdit` carries an `OptionalVersionedTextDocumentIdentifier` (`types/workspaceEdit.md` L3–40).
  - vscode-languageclient's `validateWorkspaceEdit` rejects the edit only when a `TextDocumentEdit` has a non-null version that differs from the version of an *open* document (`client.ts` L2293–2308).
  - VS Code's bulk text edit then checks `versionId` only when one was supplied (`src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts` L61, L88, L212–220).
  - Files that are not open are loaded through `textModelResolverService.createModelReference` (L233) and edited as models.
  - Edits go into the buffer, so they apply to dirty open buffers as well.
  - After applying, if `files.refactoring.autoSave` is true (the default) and more than one resource changed, the edited working copies are saved (`bulkEditService.ts` L270–273, L332–340). Rename passes `respectAutoSaveConfig: true` (`rename.ts` L312).
- **Caveat:** an unversioned edit computed from *disk* content is applied to the *buffer* without any check. If a `.js` buffer is dirty and differs from disk, offsets can land in the wrong place. Versioned edits need the server to know the buffer version, which it only gets if the document is synced.
- **Limit:** without a provider registered for `.js`, invoking find-references, go-to-definition or rename *while the cursor is in a `.js` file* never reaches our server.

### 6. Is the server told about open `.js` buffers if they are not in the selector? What else is there?

No.

- LSP: open/change/close notifications are controlled by the synchronization registration (`specification.md` L486). After `didOpen`, "the document's content is now managed by the client and the server must not try to read the document's content using the document's Uri" (`textDocument/didOpen.md` L3).
- vscode-languageclient sends `didOpen`/`didChange` only when `this.matches(document)` against the registered selectors (`features.ts` L407–419; `textSynchronization.ts` L72).

Alternatives:

| Mechanism | What it sees | Source |
|---|---|---|
| Sync-only dynamic registration for `.js` globs (didOpen/didChange/didClose), registering *no* providers for `.js` | Live buffer contents and versions. TS providers are not affected, because sync is not a language feature provider | `textSynchronization.ts` L110–131; `registerCapability.md` |
| `workspace/didChangeWatchedFiles` (client `synchronize.fileEvents`, already used for `*.twee-config.*`; or server-registered `FileSystemWatcher` with `GlobPattern`/`RelativePattern` and `WatchKind`) | On-disk create/change/delete only. No unsaved edits | `workspace/didChangeWatchedFiles.md` L47–127 |
| Server reads files from disk (`fs`) | On-disk content only | n/a |
| Custom notification: the client forwards `vscode.workspace.onDidOpenTextDocument`/`onDidChangeTextDocument` for matching files | Live buffers, but outside the LSP sync contract. Hand-rolled | VS Code `workspace` events API |

## Options and their trade-offs

These are facts, not a recommendation.

| Option | Features from `.twee` | Features from `.js` | Unsaved `.js` content | Interaction with TS |
|---|---|---|---|---|
| **A. Don't register for `.js`. Read from disk plus file watchers.** | References/definition/rename results can include `.js`, and edits apply (§5) | None | Not seen. Unversioned edits may misplace in dirty buffers | None |
| **B. Sync-only registration for the configured `.js` globs** (dynamic, no `.js` providers) | Same as A, with live content. Edits can be versioned | None | Seen | None. Sync has no UI effect |
| **C. Sync plus references/definition/rename registered dynamically for the configured `.js` globs** | Yes | Yes | Seen | References/definitions merge with TS results; only exact-range duplicates collapse. Rename: ours is asked first (built-ins de-prioritized at equal score). TS takes over wherever our prepareRename returns `null`. Diagnostics, hover etc. are unaffected unless also registered |
| **D. Same as C, but registered for all `**/*.js` with middleware filtering** | Yes | Yes | Seen (if sync is filtered, risk of uneven open/close bookkeeping) | Same as C. The provider is active in every `.js`, and middleware returns nothing outside the set |
| **E. TypeScript server plugin (Svelte/Astro/Vue approach)** | Unchanged | Through tsserver: one merged result set from TS itself, so no second rename provider | tsserver sees buffers | No provider competition. Requires a separate tsserver plugin package and a way to share the twee index with it. Only active when the built-in TS extension is enabled and the plugin is loaded |
| **F. Take Over (claim `javascript` and expect users to disable the built-in TS extension)** | Yes | Yes | Seen | Removes the built-in JS features entirely. Vue abandoned this approach in 2.0 |
