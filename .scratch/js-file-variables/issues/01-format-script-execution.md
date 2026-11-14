# How SugarCube and Chapbook execute story and included scripts

Type: research
Status: resolved

## Question

How do SugarCube 2 and Chapbook 2 actually execute (a) Story JavaScript, which is where Tweego puts story script files, and (b) scripts loaded at runtime, via SugarCube's `importScripts()` and the Chapbook/Twine Cookbook dynamic-loading recipes (https://twinery.org/cookbook/importexternaljs/chapbook/chapbook_importexternaljs.html)? For each: what scope does the code run in, do top-level `var`/`let`/`const`/`function` declarations become browser globals or locals, which format built-ins are in scope (`State`, `setup`, `variables()`, `engine`, …), how are paths resolved relative to the built story, and is loading synchronous or asynchronous relative to passage rendering? Also confirm how Tweego compiles `.js` source files into the story (one Story JavaScript blob, file order, wrapping). Cite primary sources (format source code and docs).

## Answer

Findings are on branch `research/format-script-execution`, in `docs/research/format-script-execution.md`. That branch is never merged.

- **Tweego** joins every story script file, alphabetically by path, into a single Story JavaScript blob with only a comment header per file. A top-level declaration in one file is therefore in scope in the others, and in `script`-tagged passages.
- **SugarCube Story JavaScript** runs through strict-mode `eval`. Declarations stay local, assigning an undeclared name throws, and `$x` is not translated. Story variables are reachable only through objects: `State.variables.x`, `variables().x`, `State.temporary` and `temporary()`. A bare unbound identifier is never a story variable. The code runs synchronously, before `StoryInit`.
- **SugarCube `importScripts()`** loads an ordinary `<script>` asynchronously, at global scope. Only `window.SugarCube` is visible, so story variables are spelled `SugarCube.State.variables.x`.
- **Chapbook Story JavaScript** runs as `new Function(code)` in sloppy mode, with `this` set to `window`. Declarations stay local, and the built-ins are `engine` (`engine.state.get/set`), `go` and `restart`. Story variables are mirrored as `window` properties, so a bare name is a story variable only if that variable already exists. Otherwise `x = 1` creates an ordinary global.
- **Chapbook dynamic loading** works the same way: an ordinary `<script>`, loaded asynchronously, with paths relative to the built story's HTML.
- **Implication:** ADR-0003's "unbound ⇒ story variable" rule is wrong for SugarCube `.js` and only conditionally right for Chapbook. Per-file analysis also misses names declared in sibling story script files.
