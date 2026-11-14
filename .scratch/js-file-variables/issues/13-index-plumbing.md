# How a .js file enters the project index

Type: grilling
Status: resolved
Blocked by: 05, 07

## Question

A story script file or included script has no passages, no StoryData and no `currentPassage`. How does it enter `parse()` and `ProjectIndex`?

- **Document shape:** is it wrapped as a synthetic `script` passage, so it goes through the same per-format path as a `script`-tagged passage (as settled while charting)? Or is it a new kind of document? How do occurrence offsets map back to the file?
- **Unused work:** how does the server skip the work a `.js` file never uses? The format script paths compute semantic tokens and embedded documents for every script, which came to 63k tokens on a 1.4 MB file in the spike.
- **Project-wide inputs:** **What counts as a story variable in a .js file** made Chapbook bare names depend on two sets: the variables defined anywhere in the project, and the names declared at root level across every story script file and `script` passage. Where are those sets held, and what parses again when either one changes? Changes can come from a `.js` edit (debounced, per **Discovering and keeping .js files fresh**) or from a `.tw` edit.
- **Dropping a file:** how does a deleted or newly ignored file leave the index? **Watching .tw files on disk** made the file watcher the single path for creates, deletes and renames (the `workspace/did*` notifications are retired), filtered by the resolved sets.

## Answer

- **Document shape.** A `.js` file gets its own entry point beside `parse()`. It does no StoryData scan and no `::` splitting, and calls no `onPassage`. It calls the format's script path (`parseScript` / `parseAsJavaScript`) directly at `textIndex` 0 of the real `TextDocument`, with `currentPassage` set to a synthetic `script` passage that's never emitted. Occurrence offsets map one-to-one onto the file. Only `ParseLevel.Full` does anything, and an unknown format extracts nothing.
- **Unused work.** The indexer uses no-op callbacks for a `.js` URI's embedded documents, semantic tokens, folding ranges, decorations and parse errors. Format parsers aren't changed. Tokenizing still runs because references come from it. A `ParsingState` flag is the fallback only if profiling shows a cost.
- **Project-wide inputs are resolved at query time.** The Chapbook parser indexes every unbound bare name in script code as a **Conditional reference** (a new glossary term) and records root-level declarations as their own kind for each URI. References, definition, rename and `variable-never-set` filter conditional references against both project-wide sets when they run, as `chapbook-diagnostics.ts` already does for the defined-variable set. No file is ever re-parsed because another file changed. Conditional references never raise `variable-never-set`.
- **Whose declarations count.** Only story script files and `script` passages feed the root-declaration exclusion set and are filtered by it. The Story JavaScript blob is a `new Function` scope, so its declarations can't shadow names in included scripts. Those run at global scope and are filtered only by their own scope (eslint-scope) and the project-defined test. The indexer passes each file's kind, taken from the server's resolved sets, into the parse.
- **Workspace indexing order.** `indexAllTweeFiles` parses `.js` files after the full `.tw` pass and before validation, so `.js` writes count for `variable-never-set`.
- **Revalidation.** After a `.js` re-parse (a debounced buffer edit or a disk change), the server revalidates the open `.tw` documents. The `.js` itself isn't validated.
- **Dropping a file.** Each debounced re-resolve diffs the new sets against the old. A URI that left both sets gets `removeDocument`. A URI whose kind changed is re-parsed. Either way, the open `.tw` documents are revalidated. A watcher delete for a URI in the set removes it directly. Config changes already rebuild everything through `RequestReindex`.
- No ADR (cheap to reverse).
