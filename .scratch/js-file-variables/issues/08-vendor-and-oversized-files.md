# Handling vendor, minified and oversized .js files

Type: grilling
Status: resolved
Blocked by: 04

## Question

Given the spike's measurements, how should large, minified or third-party `.js` files (jQuery plugins under `include/`, bundled libraries) be handled so they neither stall indexing nor flood the index with junk? Options: size cap, minification heuristic, built-in default ignores (e.g. `*.min.js`, `node_modules`), relying solely on the user's `ignores`, or parsing them but indexing nothing. What, if anything, is surfaced to the user when a file is skipped? The spike (ticket 04) found speed tolerable even at 1.4 MB. The junk comes from root-level declarations and UMD names, not size, so this may reduce to whatever ticket 05 decides plus a size cap for responsiveness.

## Answer

**What counts as a story variable in a .js file** already removed the junk: declarations are never story variables, and script code reaches story variables only through state roots. So what's left is responsiveness.

- **No special vendor handling.** There are no built-in default ignores (`*.min.js`, `node_modules`), no minification heuristic, and no "parse but index nothing" mode. The user's `ignores` is the only way to exclude a file, so the index keeps seeing exactly what the build sees, per **Discovering and keeping .js files fresh**. A vendor file that touches no state roots contributes nothing. A Chapbook bare name in a vendor file that matches a project-defined variable is indexed as a reference, which is correct, because included scripts run at global scope.
- **Size cap.** A `.js` file over 5 MB (by file size) is skipped entirely: it's not parsed, not indexed, and not in the dynamic registration. Extrapolating the spike's timings, a 5 MB cold parse blocks the server for about 1.2 s. Ordinary libraries fit under the cap (three.core.js is 1.4 MB). The cap applies only to `.js` files.
- **The cap is fixed**, with no `tt3.config.json` setting. Add one if someone asks.
- **Telling the user.** Each skipped file gets an output-channel line plus a single warning notification per session, saying the file wasn't scanned, that rename and find-references won't see uses in it, and that adding it to `ignores` silences the warning. A skipped file is the one way rename can silently miss sites, so the user has to hear about it.
