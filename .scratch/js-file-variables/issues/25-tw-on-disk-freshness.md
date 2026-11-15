# 25: On-disk .tw freshness via the file watcher

**What to build:** `.tw`/`.twee` files changed outside the editor, for example by a git checkout, are re-indexed. Deleting the file that holds StoryData rediscovers or clears the story format (spec: Discovery, registration and watching; user stories 44–46).

- The workspace file tracker handles watcher events for `**/*.{tw,twee}`:
  - **Create** re-resolves the file sets.
  - **Change to a closed file** re-reads it, re-indexes it at full level and validates.
  - **Change to an open file** is ignored, because sync owns it.
  - **Delete** removes the file and revalidates. If the file held StoryData, the whole workspace is reindexed.
  - **Rename** arrives as a delete plus a create.
- Closing an open `.tw` buffer without saving re-reads the file from disk and re-indexes it, so unsaved edits don't linger in the index.
- Relevance is decided by membership in the resolved sets. The unanchored `.tw` URI test is retired.
- The client's `workspace/didCreateFiles`, `didDeleteFiles` and `didRenameFiles` notifications are removed.

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] A closed `.tw` file changed on disk updates references and diagnostics
- [ ] Changing an open `.tw` file on disk doesn't override the synced buffer
- [ ] Closing an edited, unsaved `.tw` buffer restores the on-disk contents in the index
- [ ] Deleting or renaming a `.tw` file, in the editor or outside it, updates the index
- [ ] Deleting the StoryData file triggers one workspace reindex, and the story format is cleared or rediscovered
- [ ] The client no longer sends file-operation notifications
- [ ] Tracker tests use fakes and assert observable index and diagnostic results

## Comments

- Create events are debounced here, not in 26: the tracker waits `fileSetResolveDebounceMs` (300 ms) after the last create, then re-resolves the file sets once and indexes the created files that landed in them. Re-resolves are serialized, so a slow one can't overwrite a newer result.
- The tracker keeps only the resolved Twee file set. The story-script and included-script sets are left for 26, which is the first ticket that reads them.
- If resolving the file sets fails, the tracker logs the error and drops the event. It doesn't fall back to a workspace reindex, because the reindex would make the same failing request.
