// Error-recovery matrix: insert one mid-edit fault into a clean file at a statement
// boundary near the middle, then see what each parser gives back. Reports:
//   T   = throws (no AST at all)
//   E   = returns an empty Program (oxc behaviour on a fatal error)
//   ids/through = Identifier count and eslint-scope globalScope.through count, to compare
//                 with the clean file's (more `through` = locals leaking out as "globals",
//                 i.e. junk story-variable candidates).
import fs from "node:fs";
import * as walk from "acorn-walk";
import * as eslintScope from "eslint-scope";
import { parsers } from "./parsers.mjs";

const faults = {
    "dangling-dot": "\tfoo.\n",
    "unclosed-call": "\tfoo(bar\n",
    "if-missing-paren": "\tif (x {\n\t}\n",
    "missing-initializer": "\tvar a = ;\n",
    "unterminated-string": "\tvar s = \"abc;\n",
    "extra-close-brace": "\t}\n",
    "half-typed-keyword": "\tfunc\n",
    "sugarcube-dangling": "\tState.variables.\n",
};

function stats(ast) {
    let ids = 0;
    walk.fullAncestor(ast, (n) => { if (n.type === "Identifier") ids++; });
    const sm = eslintScope.analyze(ast, { ecmaVersion: 2026, sourceType: ast.sourceType === "module" ? "module" : "script", optimistic: true });
    return `${ids}/${sm.globalScope.through.length}`;
}

const files = { "jquery.js": fs.readFileSync("inputs/jquery.js", "utf8"), "story.js": fs.readFileSync("inputs/story.js", "utf8") };
// Statement boundaries chosen by hand: inside a function body near the middle of each file.
function insertionPoint(src, name) {
    if (name === "story.js") return src.indexOf("\n    if (v.inventory") + 1;
    const mid = Math.floor(src.length / 2);
    return src.lastIndexOf("\n", mid) + 1;
}
const only = process.argv[2];
const rows = [];
for (const [pname, mk] of Object.entries(parsers)) {
    if (only && !pname.startsWith(only)) continue;
    const parse = await mk();
    for (const [fname, src] of Object.entries(files)) {
        const row = { parser: pname, file: fname };
        try { const r = parse(src); row.clean = r.nonEstree ? "ok" : stats(r.ast); } catch (e) { row.clean = "T"; }
        const at = insertionPoint(src, fname);
        for (const [fault, text] of Object.entries(faults)) {
            const broken = src.slice(0, at) + text + src.slice(at);
            let cell;
            try {
                const r = parse(broken);
                if (r.nonEstree) cell = r.errors.length ? "ok+err" : "ok";
                else if (r.ast.body.length === 0) cell = "E";
                else cell = stats(r.ast) + (r.errors.length ? ` (${r.errors.length}err)` : "");
            } catch (e) { cell = "T"; }
            row[fault] = cell;
        }
        rows.push(row);
        console.log(JSON.stringify(row));
    }
}
