# Watching .tw files on disk

Type: grilling
Status: resolved
Blocked by: 07

## Question

**Discovering and keeping .js files fresh** decided how the server watches `.js` files on disk. Should `.tw`/`.twee` files get the same behaviour, and does anything about them need different handling?

This expands the effort's scope, because the Destination is about `.js` files. It's in scope anyway: every kind of source file should behave the same, and the change is small once the `.js` watcher exists.

Today the client's `fileEvents` watcher matches only `*.twee-config.*`. `server.ts`'s `onDidChangeWatchedFiles` has a branch for deleted `.tw` files, but that branch never fires, and creates and on-disk changes go unnoticed until a reindex.

Decide:

- **Create:** does a new `.tw` file go through the same debounced re-resolve as `.js`? If it holds StoryData, can it change the story format and trigger a full reindex?
- **On-disk change to a file that isn't open:** is it parsed again from disk at the same level as the initial index pass?
- **Delete:** is the file removed from the index, and if it held StoryData, is the story format detected again?
- **Watcher scope:** do the events pass through the resolved `tweeFiles` set, so that ignored files stay out?

## Answer

- **Watcher scope.** `**/*.{tw,twee}` joins the client's `fileEvents` watcher. The server decides relevance by membership in the resolved `tweeFiles` set it holds from the three-list discovery request, so ignored files stay out. `isTweeFile` (`/.tw(ee)?/`, which has no anchor and would match `.js` paths such as `atwork.js`) is retired from event handling.
- **Create.** A new `.tw` file triggers the same debounced re-resolve of the file sets as `.js`. Newly resolved twee files are queued with `Heartbeat.indexFile`. If a new file holds StoryData that changes the format, the existing `parseTextDocument` path requests the full reindex, so no new format logic is needed.
- **On-disk change to a file that isn't open.** `Heartbeat.indexFile` re-reads the file at `ParseLevel.Full` and validates it, which matches the initial pass. Changes to open files are ignored because sync owns the buffer. Bursts such as a git checkout need no threshold, because Heartbeat's request set already coalesces them.
- **Delete.** `removeDocument`, then revalidate open documents. If the file was the StoryData file (`_storyDataUri`), request `Heartbeat.indexWorkspace()`. That finds StoryData elsewhere or leaves the format unknown, and an unknown format drops `.js` extraction. No new "format cleared" notification is added, so the client's language mode stays as it was.
- **One path for file operations.** The client's `workspace/didCreateFiles`, `didDeleteFiles` and `didRenameFiles` notifications and `isIncludedSourceFile` are retired. The file watcher is the single path for `.tw` and `.js`, covering both in-editor and external operations. A rename arrives as a delete plus a create and causes a re-parse instead of `renameDocument`.
