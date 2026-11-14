# 21: Index story script files and included scripts (tracer bullet)

**What to build:** When the workspace loads, the server indexes story-variable occurrences in every **Story script file** and **Included script**, using the project's story format from StoryData. Find-references and go-to-definition started in a `.tw` file then land in `.js` files, and `.js` writes count against `variable-never-set` (spec: Index plumbing; user stories 1, 18, 21, 22, 39–41, 47).

- The find-twee-files request becomes one discovery request that returns the three lists from the shared file-set resolution helper.
- A dedicated script-file indexer entry sits beside the existing project indexer. It takes the document, its file kind and the index, and it skips the StoryData scan and `::` splitting.
  - It runs the format's script path at offset 0 under a synthetic, unemitted `script` passage, so offsets map one-to-one.
  - Only the full parse level does anything.
  - It uses no-op callbacks for embedded documents, tokens, folding, decorations and parse errors.
- Story script files feed the shared root-declaration set. Included scripts are filtered only by their own scope.
- Workspace indexing order is all `.tw` files, then all `.js` files, then validation. `.js` files are never validated.
- An unknown format extracts nothing, and a format change re-parses every `.js` file.

**Blocked by:** 17, 19, 20

**Status:** ready-for-agent

- [ ] Find-references on `$gold` in a `.tw` file lists `State.variables.gold` in a story script file and in an included script
- [ ] Go-to-definition on a `.tw` read lands on a `.js` assignment
- [ ] A variable set only in a story script file or an included script gets no `variable-never-set`, in both formats
- [ ] A Chapbook root-level declaration in a story script file stops a bare name from qualifying in any other story script file or `script` passage, but not in an included script
- [ ] A `.js` file matched by both settings is indexed once, as a story script file
- [ ] With no StoryData format, `.js` files contribute nothing. Setting the format re-parses them
- [ ] No diagnostics are reported on `.js` files
