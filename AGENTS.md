## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context domain documentation layout. See `docs/agents/domain.md`.

### Running tests

`npm test` runs the whole suite. `.mocharc.json` lists every test file under `spec`, so `npx mocha --import=tsx <file>` also runs all of them. To run one file, bypass the config: `npx mocha --no-config --extension ts --import=tsx server/src/test/<file>.test.ts`.
