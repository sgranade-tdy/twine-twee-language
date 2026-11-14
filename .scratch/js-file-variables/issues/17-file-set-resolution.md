# 17: Prefactor: shared file-set resolution helper

**What to build:** One pure client helper takes the `tt3.config.json` config and a workspace provider and returns three lists: `tweeFiles`, **story script files** and **included scripts**. The build and (later) the index both use it, so the index sees exactly what the build ships. The build switches to it with no change in output.

Rules (spec: Discovery, registration and watching):

- Story script files are `.js` files matched by `storySourceFiles` minus `ignores`.
- For included scripts, a directory entry in `includeSourcePaths` becomes `<dir>/**/*`, a file entry stays as written, `ignores` is subtracted, and only `.js` files are kept.
- A file in both sets is a story script file only.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Fake-workspace tests cover directory versus file entries, `ignores`, `.js` filtering and overlap precedence
- [ ] A parity test shows the included scripts the helper lists are the `.js` files the build copies
- [ ] The build uses the helper, and the existing build tests pass
