# 26: .js file events and set diffing

**What to build:** Creating, deleting, renaming or changing a `.js` file on disk, in the editor or outside it, keeps the index and the registered `.js` selector in step with the resolved file sets (spec: Discovery, registration and watching; user stories 44, 45).

- The workspace file tracker also watches `**/*.js`, with the same event rules as `.tw`.
- Re-resolving is debounced. It diffs the new story-script and included-script sets against the old ones:
  - a URI that left both sets is removed from the index;
  - a URI whose kind changed is re-parsed;
  - a new URI is indexed.
- Registration is updated whenever the set changes, by unregistering and registering again.
- Any `.js` re-parse revalidates the open `.tw` documents.

- The debounce uses the global `setTimeout`/`clearTimeout`; tests fake them with `sinon.useFakeTimers()`, as the open-buffer debounce tests from 23 do. Registration goes through the `ScriptFeatureRegistrar` from 23 (`server/src/script-file-registration.ts`).
- Closing an open `.js` buffer without saving re-reads the file from disk and re-indexes it, so unsaved edits don't linger in the index.
- Follow-up while here: move `IndexingQueue` off its injected `Clock` onto the global timers, with sinon fake timers in its tests, and delete `Clock`.

**Blocked by:** 23, 25

**Status:** done

- [x] Creating a matched `.js` file indexes it and adds it to the selector
- [x] Deleting or renaming one removes its occurrences and updates the selector
- [x] A closed `.js` file changed on disk is re-indexed, and `variable-never-set` in open `.tw` files updates
- [x] A file that moves from included script to story script file is re-parsed with the new kind
- [x] A burst of create events causes one re-resolve
- [x] `.js` files outside the resolved sets are ignored
- [x] Closing an edited, unsaved `.js` buffer restores the on-disk contents in the index, and `variable-never-set` in open `.tw` files updates

## Comments

- From 25: the debounced re-resolve on create already exists (`fileSetResolveDebounceMs` and `flushPendingCreates` in `server/src/workspace-file-tracker.ts`), with serialized resolves. Extend it to `.js` creates rather than adding a second debounce.
- From 25: the tracker stores only the Twee file set (`tweeFiles`). Diffing needs the old story-script and included-script sets, so add them to what `setFileSets` keeps.
- Follow-up from review: deletes of `.tw` and `.js` files follow one rule. A delete of a file the index holds removes it at once, with no re-resolve. Revalidation, `.js` re-registration and (for StoryData) the workspace reindex wait for the create/delete debounce (`fileEventDebounceMs`), so a folder delete revalidates once and a `.tw` rename no longer flickers missing-passage diagnostics. A failed re-resolve still re-registers and revalidates for the deletes. Spec lines on Removal and Watcher events updated to match.
- Follow-up from review: the server's response to edit-driven story-format changes isn't debounced; see `.scratch/story-format-change-prompts/issues/01-debounce-story-format-change.md`.
