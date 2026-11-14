# 27: Skip oversized .js files

**What to build:** A `.js` file over 5 MB (by on-disk size) isn't parsed, indexed or registered, so the server stays responsive. The author is told once why rename and find-references can't see inside it (spec: Size gate; user stories 54, 55). The limit is fixed, with no setting.

- The workspace file tracker gains an injected stat to read on-disk sizes.

**Blocked by:** 23

**Status:** ready-for-agent

- [ ] A faked 5 MB + 1 file is skipped: it isn't indexed or in the selector, it gets one output-channel line, and it raises one warning notification
- [ ] A second oversized file in the same session gets an output line but no second warning
- [ ] The warning says the file wasn't scanned, that rename and find-references won't see uses in it, and that adding it to `ignores` silences the warning
- [ ] A file just under the limit is indexed normally
