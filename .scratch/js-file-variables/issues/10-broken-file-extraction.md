# What to extract from a .js file that fails strict parsing

Type: grilling
Status: resolved
Blocked by: 04

## Question

Ticket 03 found that acorn-loose turns one fault in a large file into hundreds of spurious unbound names, which would become story-variable occurrences that rename would then rewrite. When a whole `.js` file fails strict parsing, mid-edit or otherwise, should the server use the loose parse anyway, keep the file's last good extraction, index nothing from the file, or use the loose parse only below some size? The governing principle says to over-report references, but junk occurrences break rename. Does the answer differ between story script files and included scripts, and between open buffers and files on disk? The spike (ticket 04) found the real path far less noisy than ticket 03 predicted: a mid-edit fault in jquery.js added 4 junk names, not about 600. Weigh that against the remaining leaks (locals, keyword properties).

## Answer

**Extract from the acorn-loose tree.** When a whole `.js` file fails both the script-mode and module-mode strict parses, the server falls back to acorn-loose, exactly as `script` passages do today.

- **Why loose is safe enough now.** Under ADR-0005 (**What counts as a story variable in a .js file**), declarations are never story variables, and SugarCube reaches story variables only through state roots. So loose-parse junk can only matter for a Chapbook bare name that leaks out of its scope *and* matches a project-defined variable. Before ADR-0005, the spike measured just 4–5 junk names on broken jquery or minified lodash.
- **Rejected alternatives.**
  - Keeping the last good extraction is unsafe: its offsets go stale in an edited buffer, so rename would rewrite the wrong text.
  - Indexing nothing would make rename silently miss real sites.
  - A loose-only-below-a-size threshold adds nothing, because the 5 MB cap (**Handling vendor, minified and oversized .js files**) already bounds cost.
- **One rule everywhere.** Story script files and included scripts are treated alike, and so are open dirty buffers and files on disk.
- **Chapbook shared scope.** A broken story script file contributes whatever root declarations its loose tree yields to the concatenated-blob exclusion set. Nothing is remembered from earlier parses, which avoids the staleness problem.
- **No extra signal.** There's no notification and no `prepareRename` refusal when a file was loose-parsed. VS Code's JS service already shows the syntax error, and a warning would fire constantly mid-edit.
- No ADR (cheap to reverse) and no glossary change.
