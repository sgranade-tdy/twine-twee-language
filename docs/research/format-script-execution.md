# How SugarCube 2 and Chapbook 2 execute story JavaScript and runtime-loaded scripts

Research note (2026-10-26) supporting story-variable extraction from local `.js` files.

- **Story script file**: a `.js` matched by `build.storySourceFiles`; compiled into the story's Story JavaScript.
- **Included script**: a `.js` under `build.includeSourcePaths`; copied next to the built story, and it runs only if something loads it at runtime.

Sources are pinned to these commits:

| Source | Version | Commit |
| --- | --- | --- |
| tmedwards/sugarcube-2 (`develop`) | 2.38.0-alpha.10 | [`ba17b12`](https://github.com/tmedwards/sugarcube-2/tree/ba17b12343728d191b5cc6a82e4dc5713379863d) |
| klembot/chapbook (`develop`) | 2.3.1 | [`d910779`](https://github.com/klembot/chapbook/tree/d910779908d429ebd4d8a2c1d05dc0e2445f2c79) |
| tmedwards/tweego (`master`) | 2.1.1 | [`243cf70`](https://github.com/tmedwards/tweego/tree/243cf70ed79e0c76caf7eeec34dc47a3aa12a922) |

## Summary

| | SugarCube 2: Story JavaScript | SugarCube 2: `importScripts()` | Chapbook 2: Story JavaScript | Chapbook 2: dynamic `<script>` (Cookbook) |
| --- | --- | --- | --- | --- |
| Mechanism | Direct `eval()` inside an engine function | `<script src>` appended to `<head>` | `new Function(script).apply(window)` | `<script src>` appended to `<head>` |
| Strict mode | **Yes**. The whole engine is inside a `"use strict"` IIFE, so the eval is strict | No (classic script), unless the file opts in | No, unless the code opts in | No (classic script), unless the file opts in |
| `this` | `null` | `window` | `window` | `window` |
| Top-level `var`/`function` | Local to the eval | **Globals** (`window` properties) | Local to the function | **Globals** (`window` properties) |
| Top-level `let`/`const`/`class` | Local to the eval | Global lexical bindings, not `window` properties | Local to the function | Global lexical bindings, not `window` properties |
| Assigning an undeclared name | Throws `ReferenceError` | Creates a `window` property | Creates a `window` property, or writes state if a state proxy already exists | Same as Story JavaScript |
| Format built-ins as bare names | Everything in the engine closure: `State`, `setup`, `Config`, `Story`, `Engine`, `Macro`, `variables()`, `temporary()`, `importScripts()`, … | Only `window.SugarCube.*` (for example `SugarCube.State`) | `engine` (`engine.state.get/set`), `go`, `restart`, plus `window` proxies for state variables | Same as Story JavaScript (all are `window` properties) |
| Reaching story variables | `State.variables.x`, `variables().x`, `State.getVar('$x')`. `$x` sigils are **not** desugared | `SugarCube.State.variables.x` | Bare `x` (`window` proxy, if the variable already exists), `engine.state.get('x')`, `engine.state.set('x', v)` | Same as Story JavaScript |
| Timing | Synchronous, once at startup, before `StoryInit` and the first passage render | Asynchronous. Returns a `Promise` and is not tied to passage rendering | Synchronous, once at startup, after saved state is restored and before the first render (a microtask) | Asynchronous (`async = true`, `onload` callback) |
| Path resolution | n/a | Relative to the story HTML document | n/a | Relative to the story HTML document |

Tweego and this repo's built-in compiler both concatenate **all** story script files into a single `<script id="twine-user-script">` element. Each file gets a comment header and nothing is wrapped. Files are ordered by lexical path. Each format therefore runs one combined script, all in one scope.

## 1. How `.js` sources become Story JavaScript

**Tweego.**

- Every `.js` source becomes a passage tagged `script`. The passage is named after the file's base name ([`storyload.go` L49–52][TW-load], [`loadTagged` L376–389][TW-loadTagged]).
- A duplicate passage name replaces the earlier passage, with a warning ([`story.go` L114–127][TW-append]). Two files with the same base name in different directories therefore collide.
- Twine 2 output collects all non-private `script` passages and writes them into one `<script role="script" id="twine-user-script" type="text/twine-javascript">`. With more than one passage, each gets a `/* twine-user-script #N: "name" */` header and a newline separator. There is no IIFE or other wrapper ([`storyout.go` L221–275][TW-out]).
- Order is passage order. Source paths are collected with `filepath.Walk` ([`filesystem.go` L38–89][TW-fs]), which [walks in lexical order](https://pkg.go.dev/path/filepath#Walk).
- Tweego's docs: `.js` files are "JavaScript source files to bundle" ([usage.md][TW-usage]), and script passages are mostly unnecessary because Tweego "will automatically bundle any JavaScript source files" ([special-passages-and-tags.md][TW-sp]).
- Unrelated to `includeSourcePaths`: Tweego's `-m/--module` option inlines `.js` files as separate `<script>` elements in `<head>`, where they run as ordinary global scripts.

**This repo's compiler** mirrors Tweego:

- Files are sorted "to match Tweego order" (`client/src/build-system.ts` L516).
- Each `.js` file becomes a `script` passage named by its base name (`client/src/build/story-loader.ts` L207–214). Unlike Tweego, these passages are not de-duplicated by name.
- Scripts are written into one `twine-user-script` element with the same comment headers (`client/src/build/story-output.ts` L103–146).
- Include paths are copied into `outputPath`, keeping their subdirectory structure below the include root (`client/src/build-system.ts` L565–640). For example, `include/lib/a.js` becomes `build/lib/a.js`, next to the story HTML.

## 2. SugarCube 2

### (a) Story JavaScript

- **Collection.** In Twine 2 mode, every `<script>` child of `<tw-storydata>` becomes a script passage ([`story.js` L251–257][SC-story]). Tweego emits exactly one.
- **Execution.** `Engine.runUserScripts()` calls `Scripting.evalJavaScript(script.text)` once per script. Errors are caught, logged, and shown in an alert ([`engine.js` L183–192][SC-engine]).
- **Scope.** `evalJavaScript` is a direct `eval` inside an inner function: `(function (code, output, SCRIPT$DATA$) { return eval(code); }).call(output ? { output } : null, …)` ([`scripting.js` L652–656][SC-eval]).
  - That function sits inside the `Scripting` IIFE ([L11][SC-scripting-top]).
  - The entire engine bundle is wrapped in `(function (window, document, jQuery, undefined) { "use strict"; … })` ([`template/intro.js`][SC-intro], [`template/outro.js`][SC-outro], applied in [`build.js` L72–74 / L319][SC-build]).
- **Consequences** (ECMAScript [PerformEval](https://tc39.es/ecma262/#sec-performeval): strict direct eval gets its own variable environment):
  - Top-level `var`, `function`, `let`, `const`, and `class` are **local to that one eval call**. They do not become `window` properties.
  - `this` is `null`. `.call(null)` in strict code does not substitute the global object.
  - Assigning an undeclared identifier throws `ReferenceError`. Reading one throws unless it is in scope.
- **Built-ins in scope.** Because the eval is direct, the code sees the eval function's whole lexical chain:
  - the `Scripting` IIFE locals, including the documented "global" functions `variables()` ([L281–283][SC-variables]), `temporary()` ([L254–256][SC-temporary]), `importScripts()`/`importStyles()`, `passage()`, `tags()`, `visited()`, …;
  - every top-level binding in the engine bundle: `State`, `setup` ([`globals.js` L40][SC-globals]), `settings`, `storage`, `session`, `Config`, `Story`, `Engine`, `Macro`, `Dialog`, `UI`, `Save`, `Setting`, `L10n`, `Wikifier`, `SimpleAudio`, and others;
  - the wrapper parameters (`window`, `document`, `jQuery`) and real browser globals.
- **Story variables** are reachable only through objects:
  - `State.variables.x` ([api-state.md L182][SC-api-state]), `variables().x` ([functions.md L1137][SC-fn-variables]), and `State.getVar('$x')`/`State.setVar` ([api-state.md L198–213][SC-api-state-getvar]).
  - Story JavaScript is evaluated by `evalJavaScript`, not `evalTwineScript`, so TwineScript sigil desugaring (`$x` → `State.variables.x`) does **not** apply. `$x` is an ordinary JavaScript identifier there.
- **Timing.**
  - Startup is: `Story.init()`, then `State.init()`, then UI init, then `Engine.runUserScripts()`, all synchronously ([`sugarcube.js` L40–65][SC-main]).
  - Only after a later `Promise` resolves do `Engine.runUserInit()` (`StoryInit`) and `Engine.start()` (first passage render) run ([L93–101][SC-main-then]).
- **Docs.** The only documented global escape hatch is setting properties on `window`, which "becomes an auto-global … regardless of scope" ([twinescript.md L28][SC-tsdoc]).

### (b) `importScripts()`

- **Implementation.** `importScripts(...urls)` creates a `<script>`, appends it to `document.head`, sets `src = url`, and resolves a `Promise` on `load` ([`scripting.js` L380–452][SC-import]).
  - Loose URLs load concurrently. URLs in an array load sequentially.
  - The docs say: "Loading is done asynchronously at run time … use the `Promise`" ([functions.md L344–354][SC-fn-import]).
- **Scope.** The file runs as an ordinary classic script in global scope. It is not eval'd inside the engine.
  - Sloppy mode unless the file says `"use strict"`, and `this` is `window`.
  - Top-level `var` and `function` become `window` properties. Top-level `let`, `const`, and `class` go into the shared global lexical scope.
- **Built-ins.**
  - None of SugarCube's closure names (`State`, `setup`, `variables`, `Config`, …) are globals.
  - The only engine global is `window.SugarCube`, a sealed object exposing `State`, `setup`, `Config`, `Engine`, `Story`, `Macro`, `Save`, `settings`, `storage`, and others ([`sugarcube.js` L127–160][SC-global]). Its comment describes it as "for debugging purposes and allows scripts to detect if they're running in SugarCube".
  - So story variables are reachable as `SugarCube.State.variables.x`, or through anything Story JavaScript explicitly put on `window`.
- **Paths.** `src` is resolved relative to the document's URL ([HTML spec, "prepare the script element"](https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element)), which is the built story HTML. Here, `importScripts('lib/a.js')` loads `build/lib/a.js`.
- **Timing.** Asynchronous and not coordinated with the loading screen or passage rendering. It is typically called from Story JavaScript, so the file runs some time after Story JavaScript finishes, possibly after the first passage renders.

## 3. Chapbook 2

### (a) Story JavaScript

- **Collection.** `loadFromData` collects the text of every `[type="text/twine-javascript"]` element ([`story.ts` L46–48][CB-story-load]).
- **Execution.** `runCustomScripts()` runs `new Function(script).apply(window)` for each one ([`story.ts` L96–102][CB-story-run]).
- **Scope.** A `Function`-constructor body closes over the **global** scope only ([CreateDynamicFunction](https://tc39.es/ecma262/#sec-createdynamicfunction); [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/Function)).
  - The body is sloppy unless it starts with `"use strict"`.
  - Top-level `var`, `let`, `const`, `function`, and `class` are locals of that function.
  - `this` is `window`.
  - Assigning an undeclared name creates a `window` property.
  - No Chapbook module internals are visible.
- **Built-ins.** Only what Chapbook put on `window`:
  - `engine` = `{extend, log, state, story, template, warn}` ([`extensibility.ts` L16–66][CB-ext]);
  - `go` and `restart` ([`index.ts` L45][CB-index]).
- **Story variables.**
  - Every `state.set()` or `setDefault()` defines a `window` getter/setter proxy for that name ([`state.ts` L25–62, L172–208][CB-state]). For dotted names (`a.b`), it also defines a proxy for each parent (`a`). If `window` already has a truthy property with that name, it does nothing.
  - So in plain JS, a bare `x` reads or writes state **only if** the proxy already exists. Otherwise `x = 1` just creates an ordinary `window.x`.
  - `engine.state.get('x')` and `engine.state.set('x', v)` always work.
  - The guide says vars-section variables can be used "as you would expect in JavaScript", that new ones need `engine.state.set()`, and that `let`/`const` declarations "will *not* be visible to other Chapbook code" ([using-javascript-in-passages.md L26–50][CB-guide-js]). That page covers the `[JavaScript]` modifier, which uses the same `new Function(...).apply(window)` mechanism ([`javascript.ts` L14–22][CB-jsmod]).
  - Vars-section expressions are also compiled with `new Function` at global scope ([`parse.ts` L66–69][CB-parse]). That is why bare variable names resolve through the `window` proxies.
- **Timing.**
  - `init()` runs as soon as the runtime script loads ([`index.ts` L28–73][CB-index]). It loads data, installs `engine`, initializes state, restores saved state (outside testing mode), and **then** runs styles and custom scripts last, synchronously.
  - The first passage render happens in a microtask: `coalesceCalls`, triggered by the `trail` state change ([`display/events.ts` L7–31][CB-events], [`coalesce-calls.ts` L17–23][CB-coalesce]). So Story JavaScript runs before the first render.
  - Restored variables already have `window` proxies when Story JavaScript runs. Variables first set in a vars section do not have one until that passage renders.

### (b) Runtime-loaded scripts (Cookbook recipe)

- **Recipe.** Chapbook has no built-in loader. The [Twine Cookbook recipe](https://twinery.org/cookbook/importexternaljs/chapbook/chapbook_importexternaljs.html) (written for Chapbook 1.0.0) defines `setup.loadScript(url, onload)`, which creates a `<script>`, sets `async = true` and `src = url`, and appends it to `document.head`. The recipe has to create `window.setup = {}` itself.
- **Scope.** Same classic-script semantics as SugarCube's `importScripts()`:
  - global scope, sloppy unless opted in, `this` is `window`;
  - top-level `var` and `function` become `window` properties, and `let`/`const` go into the global lexical scope.
- **Built-ins.** The same `window` globals as Story JavaScript: `engine`, `go`, `restart`, and the state proxies that exist when the script executes.
- **Paths.** Relative to the story HTML document.
- **Timing.** Asynchronous, with completion signalled by `onload`.

## 4. Implications for "what is a story variable in a `.js` file" (facts only)

1. **Story script files are not independent snippets.** All of a story's `.js` sources (and `script`-tagged twee passages) are concatenated into one blob, which each format runs in one scope: one strict `eval` for SugarCube, one `new Function` body for Chapbook. A top-level declaration in `a.js` is in scope in `b.js`. Duplicate top-level `let`/`const` across files is a `SyntaxError` for the whole blob. Scope analysis done per file would see these cross-file references as unbound.
2. **SugarCube Story JavaScript:**
   - An unbound bare identifier can never be a story variable. It is one of three things: a SugarCube closure name (`State`, `setup`, `variables`, …), a browser global, or a `window` property set by other code.
   - Writing an undeclared one throws in strict mode.
   - Story variables appear only as member accesses: `State.variables.x`, `variables().x`, or the string form `State.getVar('$x')`/`setVar`.
3. **SugarCube included scripts:** unbound bare identifiers are browser globals, `window` properties, or `SugarCube`. Story variables appear as `SugarCube.State.variables.x`. Top-level `var`/`function` declarations here *create* globals visible to everything that runs later.
4. **Chapbook, both kinds:**
   - A bare unbound identifier *can* be a story variable, because state variables are mirrored as `window` accessor properties. This holds only for variables that already exist when the code runs: restored, defaulted, or set earlier.
   - Otherwise the same identifier is an ordinary global, or a `ReferenceError` on read.
   - `engine.state.get/set('name')` is the explicit, string-keyed form. Names may be dotted (`'a.b'`).
5. **Not every unbound identifier is format-specific.** In all four contexts, unbound identifiers also include browser globals (`document`, `console`, …), jQuery (`$`/`jQuery`, bundled with SugarCube), and globals created by other included scripts. None of these is a story variable.
6. **Included scripts run only if loaded, and asynchronously.** Nothing at build time says whether (or in what order) an included script runs. That is decided at runtime by the `importScripts()` or `loadScript()` calls and their URLs, which resolve relative to the built story HTML in `outputPath`.

[TW-load]: https://github.com/tmedwards/tweego/blob/243cf70ed79e0c76caf7eeec34dc47a3aa12a922/storyload.go#L49-L52
[TW-loadTagged]: https://github.com/tmedwards/tweego/blob/243cf70ed79e0c76caf7eeec34dc47a3aa12a922/storyload.go#L376-L389
[TW-append]: https://github.com/tmedwards/tweego/blob/243cf70ed79e0c76caf7eeec34dc47a3aa12a922/story.go#L114-L127
[TW-out]: https://github.com/tmedwards/tweego/blob/243cf70ed79e0c76caf7eeec34dc47a3aa12a922/storyout.go#L221-L275
[TW-fs]: https://github.com/tmedwards/tweego/blob/243cf70ed79e0c76caf7eeec34dc47a3aa12a922/filesystem.go#L38-L89
[TW-usage]: https://github.com/tmedwards/tweego/blob/243cf70ed79e0c76caf7eeec34dc47a3aa12a922/docs/core/usage.md
[TW-sp]: https://github.com/tmedwards/tweego/blob/243cf70ed79e0c76caf7eeec34dc47a3aa12a922/docs/core/special-passages-and-tags.md
[SC-story]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/story.js#L251-L257
[SC-engine]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/engine.js#L183-L192
[SC-eval]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/markup/scripting.js#L652-L656
[SC-scripting-top]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/markup/scripting.js#L11
[SC-intro]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/template/intro.js
[SC-outro]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/template/outro.js
[SC-build]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/build.js#L72-L74
[SC-variables]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/markup/scripting.js#L281-L283
[SC-temporary]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/markup/scripting.js#L254-L256
[SC-globals]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/globals.js#L40
[SC-api-state]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/docs/api/api-state.md#L182
[SC-api-state-getvar]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/docs/api/api-state.md#L198-L213
[SC-fn-variables]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/docs/core/functions.md#L1137
[SC-main]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/sugarcube.js#L40-L65
[SC-main-then]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/sugarcube.js#L93-L101
[SC-tsdoc]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/docs/core/twinescript.md#L28
[SC-import]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/markup/scripting.js#L380-L452
[SC-fn-import]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/docs/core/functions.md#L344-L354
[SC-global]: https://github.com/tmedwards/sugarcube-2/blob/ba17b12343728d191b5cc6a82e4dc5713379863d/src/sugarcube.js#L127-L160
[CB-story-load]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/story/story.ts#L46-L48
[CB-story-run]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/story/story.ts#L96-L102
[CB-ext]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/extensibility.ts#L16-L66
[CB-index]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/index.ts#L28-L73
[CB-state]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/state/state.ts#L25-L62
[CB-guide-js]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/guide/en/advanced/using-javascript-in-passages.md#L26-L50
[CB-jsmod]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/template/modifiers/javascript.ts#L14-L22
[CB-parse]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/template/parse.ts#L66-L69
[CB-events]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/display/events.ts#L7-L31
[CB-coalesce]: https://github.com/klembot/chapbook/blob/d910779908d429ebd4d8a2c1d05dc0e2445f2c79/src/runtime/util/coalesce-calls.ts#L17-L23
