# 18: Prefactor: extract the workspace file tracker from server startup

**What to build:** The server's watched-file handling and indexing-queue wiring move out of server startup code into a **workspace file tracker** module. Its collaborators are injected: clock and timers, stat, file reader, the registration call and the indexing queue. Behaviour is unchanged. Later tickets add `.js` debounce, registration, watcher events and the size gate to this module (spec: Discovery, registration and watching).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Server startup delegates watched-file and indexing-queue handling to the tracker
- [ ] The tracker can be built in tests with fake timers, stat, reader, registration and queue
- [ ] A small seam test pins today's behaviour, and the existing tests pass
