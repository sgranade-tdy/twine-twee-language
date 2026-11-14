# Discovering and keeping .js files fresh

Type: grilling
Status: resolved
Blocked by: 02

## Question

How does the server learn the resolved set of story script files and included scripts, and keep their content current? Today `FindTweeFilesRequest` resolves `storySourceFiles` minus `ignores` client-side, then filters to `.tw/.twee`, and `includeSourcePaths` is unused server-side. Decide: one request or several; glob semantics for `includeSourcePaths` (directories, recursive); watching `.js` creates, changes and deletes; re-resolving when `tt3.config.json` changes; and whether open, unsaved `.js` buffers are read live or only from disk. Ticket 02 found these are entangled with how far the server claims `.js` files. Pick among options A–F in `docs/research/lsp-js-document-coexistence.md` (on branch `research/lsp-js-document-coexistence`): no claim; text sync only; or full providers registered dynamically for the resolved file set. Should references, rename and definition be invokable *from* a `.js` file? The spike (ticket 04) measured re-parsing at about 60 ms for a 250 KB file and 250 ms for 1.4 MB, which bears on live per-keystroke parsing of open buffers.

## Answer

- **Claim level: option C**, from `docs/research/lsp-js-document-coexistence.md`. The server dynamically registers text sync, references, definition and rename (with prepareRename) for story script files and included scripts, and for nothing else.
  - No other feature is registered for `.js`: no hover, completions, semantic tokens or diagnostics.
  - Our `prepareRename` returns `null` anywhere other than a story-variable occurrence, so TypeScript keeps handling rename there.
  - References and definitions merge with TypeScript's results, and only exact-range duplicates collapse.
- **Discovery: one request returning three lists.** `FindTweeFilesRequest` becomes a single request that returns `{ tweeFiles, storyScriptFiles, includedScripts }`, and the client still resolves the globs.
  - Included scripts follow the build's exact rules: a directory entry becomes `<dir>/**/*`, a file entry stays as written, `ignores` is subtracted, and only `.js` files are kept.
  - The build and the index call one shared helper, so the index sees exactly what the build copies.
- **Overlap.** A `.js` file matched by both `storySourceFiles` and `includeSourcePaths` is a story script file only, and it's indexed once.
- **Selector.** The dynamic registration's document selector lists each resolved file as an exact path, with glob metacharacters escaped. It's unregistered and registered again whenever the resolved set changes. Raw globs can't express `ignores`, and they would sync excluded vendor files.
- **Watching the disk.** `**/*.js` joins the client's `fileEvents` watcher.
  - **Create or delete:** resolve the sets again (debounced) and update the selector. A delete also removes the file from the index.
  - **Change to a file in the set that isn't open:** read it from disk again and index it again.
  - **Change to an open file:** ignored, because sync already has the buffer.
- **Config changes.** A change to `tt3.config.json` goes through the existing `RequestReindex` path, which now also resolves the `.js` sets again and re-registers the selector.
- **Open buffers** are read live through sync, so rename edits can carry document versions. Changes to an open `.js` buffer are debounced (about 300 ms after the last edit) before the file is parsed again. `.tw` keeps its current undebounced behaviour. The per-file size policy stays with **Vendor and oversized files**.
- **Scope expansion.** The same watching behaviour for `.tw`, and noticing when `tt3.config.json` is created or deleted, are now in scope. Consistency between file kinds is worth the extra scope. These are filed as **Watching .tw files on disk** and **Noticing tt3.config.json being created or deleted**.
