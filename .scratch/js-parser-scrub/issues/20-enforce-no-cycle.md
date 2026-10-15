# 20: Enforce no import cycles across all of server/src

**What to build:** `import-x/no-cycle` runs on all non-test code in `server/src`, with no exceptions, so a new import cycle fails lint. Ticket 10's narrow rule scope and its note are replaced by this.

**Blocked by:** 16, 17, 18, 19.

**Status:** closed

- [x] The rule applies to all non-test files under `server/src`, including `js-parser.ts`.
- [x] `npm run lint` reports no cycle errors.
- [x] A note on ticket 10 says the scope is now complete.
- [x] Typecheck and `npm test` pass.

### Done

Rule scope is now `server/src/**/*.ts` minus tests. Verified it fires on a deliberate two-file cycle.
