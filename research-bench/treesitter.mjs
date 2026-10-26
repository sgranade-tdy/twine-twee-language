// tree-sitter (WASM) on the same inputs: parse time and whether structure survives mid-edit faults.
// Output is a concrete syntax tree (not ESTree), so eslint-scope can't run on it.
import fs from "node:fs";
// Needs web-tree-sitter + tree-sitter-javascript installed (see README.md).
import { Parser, Language } from "web-tree-sitter";
const t0 = performance.now();
await Parser.init();
const JS = await Language.load("node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm");
const p = new Parser(); p.setLanguage(JS);
console.log("init+load ms", (performance.now() - t0).toFixed(1));
const dir = "inputs/";
const jq = fs.readFileSync(dir + "jquery.js", "utf8");
const at = jq.lastIndexOf("\n", Math.floor(jq.length / 2)) + 1;
const cases = ["story.js", "jquery.min.js", "lodash.min.js", "jquery.js", "lodash.js", "three.module.js", "three.core.js", "broken-midedit.js", "broken-truncated.js"].map((f) => [f, fs.readFileSync(dir + f, "utf8")])
    .concat(["\tfoo(bar\n", "\tif (x {\n\t}\n", "\t}\n"].map((x) => ["jquery+" + JSON.stringify(x.trim()), jq.slice(0, at) + x + jq.slice(at)]));
for (const [name, src] of cases) {
    let tree = p.parse(src); tree.delete();
    const times = [];
    for (let i = 0; i < 7; i++) { const s = performance.now(); tree = p.parse(src); times.push(performance.now() - s); if (i < 6) tree.delete(); }
    times.sort((a, b) => a - b);
    const root = tree.rootNode;
    let errs = 0; const c = root.walk();
    // count ERROR / MISSING nodes
    const stack = [root]; while (stack.length) { const n = stack.pop(); if (n.type === "ERROR" || n.isMissing) errs++; if (n.hasError) for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)); }
    console.log(name.padEnd(26), "median ms", times[3].toFixed(1).padStart(6), " top-level children", root.namedChildCount, " ERROR/MISSING nodes", errs);
    tree.delete();
}
