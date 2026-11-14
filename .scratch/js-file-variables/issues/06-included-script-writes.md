# Do writes in included scripts count against variable-never-set

Type: grilling
Status: resolved
Blocked by: 01

## Question

An included script runs only if something loads it, so its writes may never happen. Should an included script's assignments count as evidence that a story variable gets set, which suppresses `variable-never-set`, given the governing principle to under-report assignments? Options: count always; count only if the story contains a load call that plausibly names the file (`importScripts("…")`); never count, so they contribute references only. Does the answer differ by format?

## Answer

Yes. Writes in included scripts always count, and the answer is the same for both formats.

- **Always count.** A write in an included script is an ordinary assignment. It suppresses `variable-never-set` and is a go-to-definition target, exactly like a write in a story script file. There is no "weak write" category that does one job but not the other.
- **Why not gate it on a load call.** `importScripts()` paths are relative to the built HTML, not the source tree. They are often computed, and the call can live in any story script file or included script. Chapbook has no standard loader to match against.
- **Why not never count.** A variable set only in an included script would get a warning that the author can only silence by disabling the diagnostic.
- **How this reads the governing principle.** "Under-report assignments" is about uncertainty over whether an occurrence *is* a write. Whether the code runs is a reachability question, and the index ignores reachability everywhere else: writes in uncalled functions and unreachable passages already count.
- **Formats.** Under ADR-0005, Chapbook bare names are never assignments, so in both formats the only writes in an included script are explicit state-root writes. SugarCube writes there are spelled through `SugarCube.State.*`.
