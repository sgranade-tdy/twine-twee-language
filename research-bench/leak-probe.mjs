// Why does acorn-loose's recovery on mid-edit jquery.js leak ~600 extra unresolved refs?
import fs from "node:fs";
import * as loose from "acorn-loose";
import * as eslintScope from "eslint-scope";
const src = fs.readFileSync("inputs/broken-midedit.js", "utf8");
const ast = loose.parse(src, { ecmaVersion: "latest", ranges: true });
console.log("top-level statements:", ast.body.length, ast.body.map((s) => s.type + "@" + s.start + "-" + s.end).slice(0, 8));
const sm = eslintScope.analyze(ast, { ecmaVersion: 2026, optimistic: true });
const names = {};
for (const r of sm.globalScope.through) names[r.identifier.name] = (names[r.identifier.name] || 0) + 1;
const sorted = Object.entries(names).sort((a, b) => b[1] - a[1]);
console.log("distinct through names:", sorted.length, sorted.slice(0, 25).map(([n, c]) => n + "×" + c).join(" "));
const first = sm.globalScope.through.map((r) => r.identifier.range[0]).sort((a, b) => a - b);
const midByte = src.indexOf("foo.bar(baz.");
console.log("fault at", midByte, "; through refs before fault:", first.filter((x) => x < midByte).length, "after:", first.filter((x) => x >= midByte).length);
