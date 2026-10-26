// For each parser x input: does it parse, how many errors, does acorn-walk.fullAncestor
// traverse it, does eslint-scope analyze it, and does the set of unresolved/global
// references match acorn's (the story-variable-relevant signal)?
import fs from "node:fs";
import * as walk from "acorn-walk";
import * as eslintScope from "eslint-scope";
import { parsers } from "./parsers.mjs";

const only = process.argv[2];
const inputs = fs.readdirSync("inputs").sort();
const refSig = {};

function idStats(ast) {
    let ids = 0, bad = 0;
    walk.fullAncestor(ast, (n) => { if (n.type === "Identifier") { ids++; if (n.name === "✖" || n.start === n.end) bad++; } });
    return { ids, bad };
}
function scopeSig(ast, src) {
    const sm = eslintScope.analyze(ast, { ecmaVersion: 2026, sourceType: ast.sourceType === "module" ? "module" : "script", optimistic: true });
    const g = sm.globalScope;
    const names = new Set(g.through.map((r) => r.identifier.name + "@" + r.identifier.range[0]));
    const offsetsOK = g.through.every((r) => src.slice(r.identifier.range[0], r.identifier.range[1]) === r.identifier.name);
    return { through: names, offsetsOK, scopes: sm.scopes.length };
}

for (const [name, mk] of Object.entries(parsers)) {
    if (only && !name.startsWith(only)) continue;
    const parse = await mk();
    for (const f of inputs) {
        const src = fs.readFileSync("inputs/" + f, "utf8");
        const row = { parser: name, file: f };
        let r;
        try { r = parse(src); } catch (e) { row.result = "THROWS: " + String(e.message).slice(0, 80); console.log(JSON.stringify(row)); continue; }
        row.errors = r.errors.length;
        if (r.errors.length) row.firstError = String(r.errors[0]).slice(0, 80);
        if (r.nonEstree) { row.result = "parsed (non-ESTree AST: type=" + r.ast.type + ")"; console.log(JSON.stringify(row)); continue; }
        try { Object.assign(row, idStats(r.ast)); } catch (e) { row.walk = "acorn-walk THROWS: " + e.message.slice(0, 80); }
        try {
            const s = scopeSig(r.ast, src);
            row.scopes = s.scopes; row.through = s.through.size; row.offsetsOK = s.offsetsOK;
            if (name === "acorn" || (name === "acorn→loose (parseJS)" && !refSig[f])) refSig[f] = s.through;
            if (refSig[f] && !name.startsWith("acorn")) {
                const ref = refSig[f];
                row.throughDiffVsAcorn = [...s.through].filter((x) => !ref.has(x)).length + "+/" + [...ref].filter((x) => !s.through.has(x)).length + "-";
            }
        } catch (e) { row.scope = "eslint-scope THROWS: " + e.message.slice(0, 80); }
        console.log(JSON.stringify(row));
    }
}
