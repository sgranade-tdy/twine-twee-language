# 28: tt3.config.json create/delete lifecycle

**What to build:** Creating, changing or deleting `tt3.config.json` takes effect immediately, without a reload. That includes when the "disable diagnostic" quick action writes the file first (spec: Config lifecycle; user stories 48–51).

- The config watcher subscribes to create, change and delete. All three feed one client handler debounced at about 300 ms. When it fires, the handler checks the file on disk:
  - **File exists:** load it. An invalid file keeps the last good config and shows the existing error.
  - **File missing:** reset to schema defaults. Legacy settings are not migrated again, and the file isn't recreated.
  - Either way, send one reindex request. Once ticket 21 lands, that reindex re-resolves the file sets and re-registers the `.js` selector.
- The config location and multi-root behaviour are unchanged.
- A file that parses but lists unknown diagnostic codes isn't invalid. It applies with those codes dropped and shows the existing error, so one typo doesn't hold back the rest of the file.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Creating the file behaves like changing it
- [ ] Deleting it resets to schema defaults and sends a reindex
- [ ] An invalid file keeps the last good config and shows the existing error
- [ ] A burst of events, such as an atomic save, causes exactly one reload and one reindex (fake timers)
