# 01: Debounce the server's response to story-format edits

**What to build:** Typing a new format or version into an open StoryData passage, for example `2.3` → `2.36` → `2.36.1`, causes one story-format change: one download offer, one SugarCube macro index and one workspace reindex, all for the format that's current when typing stops.

- Today `parseTextDocument` in `server/src/server.ts` reacts to each format change at once. It calls `onStoryFormatChange`, which sends `UpdatedStoryFormat` and, for SugarCube, requests a macro index. With `reindexOnStoryFormatChange`, it also requests a full workspace reindex. The indexing queue only spaces runs 50 ms apart, so slow typing causes several full reindexes. The client then offers a download for each intermediate format.
- Debounce the edit-driven path, the `parseTextDocument` call with `reindexOnStoryFormatChange` set, by about 300 ms. When the timer fires, react once for the current format, and skip the reaction if that format is the one last announced.
- The workspace-index path (`IndexingQueue` calling `onStoryFormatChange` during `indexAllTweeFiles`) stays immediate. It already runs once per pass, and delaying it would only push back the language mode at startup.
- The server already debounces `.js` buffer re-parses and file create/delete events in `WorkspaceFileTracker`, using the global `setTimeout` faked with `sinon.useFakeTimers()` in tests. Follow that pattern, either in the tracker or in a small module, rather than adding an injected clock.
- On the client, `onUpdatedStoryFormat` (`client/src/extension.ts`) compares against `cachedStoryFormat`, which is only written after `downloadLocalStoryFormatIfNeeded` resolves. If a download prompt is still open, a repeated notification for the same format raises a second prompt. Have the client remember the last format it handled as soon as each notification arrives.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] A burst of StoryData edits that changes the format several times sends one `UpdatedStoryFormat` and requests one workspace reindex, for the final format (fake timers)
- [x] An edit burst that ends on the format already announced sends nothing and requests no reindex
- [x] A format change found during a workspace index is still announced at once
- [x] A second `UpdatedStoryFormat` for the same format, arriving while the first download prompt is still open, raises no second prompt

## Comments
