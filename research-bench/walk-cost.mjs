// Cost of the acorn-walk.fullAncestor passes js-parser.ts makes over the AST (it makes ~3).
import fs from "node:fs";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
for (const f of ["jquery.js", "three.core.js"]) {
    const ast = acorn.parse(fs.readFileSync("inputs/" + f, "utf8"), { ecmaVersion: "latest", sourceType: "module", ranges: true });
    const t = [];
    for (let i = 0; i < 9; i++) { const s = performance.now(); let n = 0; walk.fullAncestor(ast, () => n++); t.push(performance.now() - s); }
    t.sort((a, b) => a - b);
    console.log(f, "one fullAncestor pass, median ms:", t[4].toFixed(1));
}
