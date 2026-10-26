// Mid-edit fault in a minified file (one long line): acorn-loose vs TypeScript-recovered ESTree.
import fs from "node:fs";
import { createRequire } from "node:module";
import * as loose from "acorn-loose";
import ts from "typescript";
import * as eslintScope from "eslint-scope";
const require = createRequire(import.meta.url);
const { Converter } = require("./node_modules/@typescript-eslint/typescript-estree/dist/convert.js");
const an = (ast) => eslintScope.analyze(ast, { ecmaVersion: 2026, optimistic: true }).globalScope.through.length;
for (const f of ["lodash.min.js", "jquery.min.js"]) {
    const src = fs.readFileSync("inputs/" + f, "utf8");
    const at = src.indexOf(";", Math.floor(src.length / 2)) + 1;
    console.log(f, "clean: loose through", an(loose.parse(src, { ecmaVersion: "latest", ranges: true })));
    for (const fault of ["foo.", "foo(bar", "var a=;", "State.variables."]) {
        const b = src.slice(0, at) + fault + src.slice(at);
        const l = an(loose.parse(b, { ecmaVersion: "latest", ranges: true }));
        let t;
        try { t = an(new Converter(ts.createSourceFile("x.js", b, 99, true, 1), { allowInvalidAST: true, suppressDeprecatedPropertyWarnings: true }).convertProgram()); } catch (e) { t = "throws"; }
        console.log("  ", JSON.stringify(fault).padEnd(20), "acorn-loose through", l, "| ts→estree through", t);
    }
}
