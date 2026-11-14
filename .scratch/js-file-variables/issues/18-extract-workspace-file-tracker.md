# 18: Prefactor: extract the workspace file tracker from server startup

**What to build:** The server's watched-file handling and indexing-queue wiring move out of server startup code into a **workspace file tracker** module. The indexing queue moves into its own **indexing queue** module, which the tracker receives as an injected collaborator. Each module gets only the collaborators it uses today; later tickets inject the rest as they need them (timeouts in 26, registration in 26, stat in 27). Behaviour is unchanged. Later tickets add `.js` debounce, registration, watcher events and the size gate to this module (spec: Discovery, registration and watching).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Server startup delegates watched-file and indexing-queue handling to the tracker
- [ ] The tracker and the indexing queue can be built in tests with fakes for every collaborator they use
- [ ] A small seam test pins today's behaviour, and the existing tests pass

## Comments

- Review follow-up: the indexing queue is split out of the tracker into `server/src/indexing-queue.ts` and injected into it. Stat, registration and `setTimeout` are deferred to the tickets that first use them (26, 27) instead of being added unused now.
