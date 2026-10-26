// Added bundle size: bundle a minimal entry for each parser with esbuild (minified, same
// settings as the extension's production build: bundle, cjs, platform node) and gzip it.
// Native .node / .wasm artifacts can't be bundled into JS; their on-disk sizes are listed separately.
import * as esbuild from "esbuild";
import fs from "node:fs";
import zlib from "node:zlib";

const entries = {
    "current: acorn+acorn-loose+acorn-walk+eslint-scope": `import * as a from "acorn"; import * as l from "acorn-loose"; import * as w from "acorn-walk"; import * as s from "eslint-scope"; console.log(a.parse, l.parse, w.fullAncestor, s.analyze);`,
    "acorn+acorn-walk (no loose)": `import * as a from "acorn"; import * as w from "acorn-walk"; console.log(a.parse, w.fullAncestor);`,
    "acorn-loose (alone, shares acorn)": `import * as l from "acorn-loose"; console.log(l.parse);`,
    "eslint-scope (+esrecurse+estraverse)": `import * as s from "eslint-scope"; console.log(s.analyze);`,
    "meriyah": `import { parse } from "meriyah"; console.log(parse);`,
    "@babel/parser": `import { parse } from "@babel/parser"; console.log(parse);`,
    "espree (pulls acorn, acorn-jsx, eslint-visitor-keys)": `import { parse } from "espree"; console.log(parse);`,
    "oxc-parser JS glue (native loader; excludes .node)": `import { parseSync } from "oxc-parser"; console.log(parseSync);`,
    "@swc/core JS glue (excludes .node)": `const { parseSync } = require("@swc/core"); console.log(parseSync);`,
    "@swc/wasm JS glue (excludes .wasm)": `const { parseSync } = require("@swc/wasm"); console.log(parseSync);`,
    "@typescript-eslint/typescript-estree (+typescript)": `import { parse } from "@typescript-eslint/typescript-estree"; console.log(parse);`,
    "typescript (whole compiler; createSourceFile not tree-shakeable)": `import ts from "typescript"; console.log(ts.createSourceFile);`,
};
const rows = [];
for (const [name, code] of Object.entries(entries)) {
    try {
        const r = await esbuild.build({
            stdin: { contents: code, resolveDir: process.cwd(), loader: "js" },
            bundle: true, minify: true, format: "cjs", platform: "node", write: false, logLevel: "silent",
            external: ["*.node", "@oxc-parser/binding-*", "@swc/core-*"],
        });
        const buf = Buffer.from(r.outputFiles[0].contents);
        rows.push([name, (buf.length / 1024).toFixed(0), (zlib.gzipSync(buf, { level: 9 }).length / 1024).toFixed(0)]);
    } catch (e) { rows.push([name, "ERR " + e.message.split("\n")[0].slice(0, 80), ""]); }
}
console.log("| Entry | min KB | min+gz KB |\n|---|---:|---:|");
for (const r of rows) console.log("| " + r.join(" | ") + " |");
const art = {
    "oxc-parser linux-x64-gnu .node": "node_modules/@oxc-parser/binding-linux-x64-gnu/parser.linux-x64-gnu.node",
    "oxc-parser wasm32-wasip1 .wasm": "node_modules/@oxc-parser/binding-wasm32-wasip1/parser.wasm32-wasip1.wasm",
    "oxc-parser browser-bundle.js (wasm glue incl. emnapi runtime)": "node_modules/@oxc-parser/binding-wasm32-wasip1/browser-bundle.js",
    "@swc/core linux-x64-gnu .node": "node_modules/@swc/core-linux-x64-gnu/swc.linux-x64-gnu.node",
    "@swc/wasm wasm_bg.wasm": "node_modules/@swc/wasm/wasm_bg.wasm",
};
console.log("\n| Artifact | KB | gz KB |\n|---|---:|---:|");
for (const [n, p] of Object.entries(art)) {
    const b = fs.readFileSync(p);
    console.log(`| ${n} | ${(b.length / 1024).toFixed(0)} | ${(zlib.gzipSync(b, { level: 9 }).length / 1024).toFixed(0)} |`);
}
