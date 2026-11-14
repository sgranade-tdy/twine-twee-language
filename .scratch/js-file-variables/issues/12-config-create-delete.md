# Noticing tt3.config.json being created or deleted

Type: grilling
Status: resolved
Blocked by: 07

## Question

The client's config watcher in `client/src/extension.ts` listens only for `onDidChange`. Creating or deleting `tt3.config.json` doesn't update the configuration and doesn't trigger a reindex, so the resolved file sets go stale.

This expands the effort's scope. It's in scope anyway: it keeps discovery consistent now that the config decides which `.js` files are claimed.

Decide:

- **Create:** does creating the file behave exactly like a change, so the config is loaded and `RequestReindex` runs?
- **Delete:** does the client fall back to the schema defaults, or keep the last-loaded config? How does that interact with the older `StoryFilesDirectory` workspace setting, which `extension.ts` migrates into the config?
- **Registration:** after a delete, are the dynamic `.js` registrations torn down or rebuilt against the defaults?

## Answer

- **One debounced reload handler.** The config watcher subscribes to create, change and delete, and all three feed one handler, debounced at about 300 ms (like the `.js` re-resolve). Atomic saves (delete plus create) and bursts of changes then cause one reload. When the handler fires, it checks the file's *current* state on disk, not the event type:
  - **File exists:** load it, as `updateConfigFromFile` does today. An invalid file (bad JSON or a schema error) keeps the last good config and shows the existing error message.
  - **File missing:** reset `currentConfig` to the schema defaults (`Tt3ConfigSchema.parse({})`).
  - Either way, send one `RequestReindex`.
- **Create** therefore behaves exactly like a change. That includes the "disable diagnostic" quick action writing the file for the first time.
- **Delete** falls back to schema defaults, not the last-loaded config, so the editor never follows settings that no longer exist on disk. Legacy migration (`StoryFilesDirectory` and others) is **not** re-run, because activation already migrated and erased those settings and nothing is left to fall back to. The client doesn't recreate the file.
- **Registrations** aren't torn down on delete. The normal `RequestReindex` path resolves the file sets again against the defaults (`src/**/*.js`, `include/**/*.js`) and re-registers the dynamic `.js` selector. `disabledDiagnostics` resets to empty, and because the client middleware filters diagnostics, the reindexed diagnostics reflect that.
- **Location** is unchanged: `tt3.config.json` at the root of the first workspace folder, where it's loaded and written today. Multi-root behaviour doesn't change.
