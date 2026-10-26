// Speed + memory benchmark. Each (parser, file) pair runs in a fresh child process
// (node --expose-gc bench.mjs --one <parser> <file>) so JIT state and heap don't leak across.
// Reports: module load ms, first (cold) parse ms, median warm parse ms, retained AST memory
// (heapUsed + external + arrayBuffers delta across a parse whose result is kept alive, after GC),
// and, for ESTree parsers, median eslint-scope analyze ms on that parser's AST.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import ts from "typescript";
import * as eslintScope from "eslint-scope";

const extra = {
    // TypeScript's own parser (non-ESTree), for its recovery behaviour.
    "typescript createSourceFile": async () => (src) => ({ ast: ts.createSourceFile("x.js", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS), errors: [], nonEstree: true }),
};

if (process.argv[2] === "--one") {
    const [, , , pname, file] = process.argv;
    const src = fs.readFileSync("inputs/" + file, "utf8");
    const t0 = performance.now();
    const { parsers } = await import("./parsers.mjs");
    const mk = parsers[pname] ?? extra[pname];
    const parse = await mk();
    const loadMs = performance.now() - t0;
    let t = performance.now();
    let r;
    try { r = parse(src); } catch (e) { console.log(JSON.stringify({ parser: pname, file, loadMs, error: String(e.message).slice(0, 60) })); process.exit(0); }
    const coldMs = performance.now() - t;
    for (let i = 0; i < 3; i++) parse(src);
    const times = [];
    const deadline = performance.now() + 2000;
    while (times.length < 5 || (times.length < 40 && performance.now() < deadline)) {
        t = performance.now(); parse(src); times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const mem = () => { global.gc(); global.gc(); const m = process.memoryUsage(); return m.heapUsed + m.external + m.arrayBuffers; };
    r = null;
    const m0 = mem();
    let keep = parse(src);
    const m1 = mem();
    const out = { parser: pname, file, kb: +(src.length / 1024).toFixed(0), loadMs: +loadMs.toFixed(1), coldMs: +coldMs.toFixed(1), warmMs: +times[times.length >> 1].toFixed(1), retainedMB: +((m1 - m0) / 1048576).toFixed(1), rssMB: +(process.memoryUsage().rss / 1048576).toFixed(0) };
    if (!keep.nonEstree && keep.ast.body.length) {
        const st = [];
        for (let i = 0; i < 7; i++) {
            const s = performance.now();
            eslintScope.analyze(keep.ast, { ecmaVersion: 2026, sourceType: keep.ast.sourceType === "module" ? "module" : "script", optimistic: true });
            st.push(performance.now() - s);
        }
        st.sort((a, b) => a - b);
        out.scopeMs = +st[3].toFixed(1);
    }
    keep = null;
    console.log(JSON.stringify(out));
    process.exit(0);
}

const { parsers } = await import("./parsers.mjs");
const names = [...Object.keys(parsers), ...Object.keys(extra)].filter((n) => !process.argv[2] || n.startsWith(process.argv[2]));
const files = ["story.js", "jquery.min.js", "lodash.min.js", "jquery.js", "lodash.js", "three.module.js", "three.core.js", "broken-midedit.js"];
for (const n of names) {
    for (const f of files) {
        try {
            process.stdout.write(execFileSync(process.execPath, ["--expose-gc", "bench.mjs", "--one", n, f], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter((l) => l.startsWith("{")).join("\n") + "\n");
        } catch (e) { console.log(JSON.stringify({ parser: n, file: f, crashed: true })); }
    }
}
