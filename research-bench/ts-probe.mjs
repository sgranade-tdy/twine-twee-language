// Does TypeScript's own (error-tolerant) parser keep the enclosing structure on mid-edit faults?
import fs from "node:fs";
import ts from "typescript";
for (const f of ["jquery.js", "broken-midedit.js", "broken-string.js", "broken-truncated.js"]) {
    const src = fs.readFileSync("inputs/" + f, "utf8");
    const t0 = performance.now();
    const sf = ts.createSourceFile("x.js", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const ms = performance.now() - t0;
    let ids = 0;
    (function v(n) { if (n.kind === ts.SyntaxKind.Identifier) ids++; ts.forEachChild(n, v); })(sf);
    console.log(f.padEnd(20), "topStmts", sf.statements.length, "ids", ids, "diags", sf.parseDiagnostics.length, "ms", ms.toFixed(1));
}
