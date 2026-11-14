# 26: .js file events and set diffing

**What to build:** Creating, deleting, renaming or changing a `.js` file on disk, in the editor or outside it, keeps the index and the registered `.js` selector in step with the resolved file sets (spec: Discovery, registration and watching; user stories 44, 45).

- The workspace file tracker also watches `**/*.js`, with the same event rules as `.tw`.
- Re-resolving is debounced. It diffs the new story-script and included-script sets against the old ones:
  - a URI that left both sets is removed from the index;
  - a URI whose kind changed is re-parsed;
  - a new URI is indexed.
- Registration is updated whenever the set changes, by unregistering and registering again.
- Any `.js` re-parse revalidates the open `.tw` documents.

**Blocked by:** 23, 25

**Status:** ready-for-agent

- [ ] Creating a matched `.js` file indexes it and adds it to the selector
- [ ] Deleting or renaming one removes its occurrences and updates the selector
- [ ] A closed `.js` file changed on disk is re-indexed, and `variable-never-set` in open `.tw` files updates
- [ ] A file that moves from included script to story script file is re-parsed with the new kind
- [ ] A burst of create events causes one re-resolve
- [ ] `.js` files outside the resolved sets are ignored
