// Hack: skip ts-estree's "throw on parseDiagnostics" and run its (unexported) Converter
// on TypeScript's error-recovered SourceFile, then run eslint-scope on the result.
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as eslintScope from "eslint-scope";
const require = createRequire(import.meta.url);
const { Converter } = require("./node_modules/@typescript-eslint/typescript-estree/dist/convert.js");
const files = ["jquery.js", "broken-midedit.js", "broken-string.js", "broken-truncated.js"];
const faults = ["\tfoo.\n", "\tfoo(bar\n", "\tif (x {\n\t}\n", "\tvar a = ;\n", "\t}\n", "\tState.variables.\n"];
const jq = fs.readFileSync("inputs/jquery.js", "utf8");
const at = jq.lastIndexOf("\n", Math.floor(jq.length / 2)) + 1;
const cases = files.map((f) => [f, fs.readFileSync("inputs/" + f, "utf8")]).concat(faults.map((x) => ["jquery+" + JSON.stringify(x.trim()), jq.slice(0, at) + x + jq.slice(at)]));
for (const [name, src] of cases) {
    const t0 = performance.now();
    const sf = ts.createSourceFile("x.js", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let out;
    try {
        const est = new Converter(sf, { allowInvalidAST: true, errorOnUnknownASTType: false, shouldPreserveNodeMaps: false, suppressDeprecatedPropertyWarnings: true }).convertProgram();
        const ms = performance.now() - t0;
        const sm = eslintScope.analyze(est, { ecmaVersion: 2026, sourceType: "script", optimistic: true });
        out = `body ${est.body.length}  through ${sm.globalScope.through.length}  diags ${sf.parseDiagnostics.length}  parse+convert ${ms.toFixed(0)}ms`;
    } catch (e) { out = "THROWS " + e.message.slice(0, 100); }
    console.log(name.padEnd(28), out);
}
