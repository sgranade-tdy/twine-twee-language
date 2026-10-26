// Are node offsets UTF-16 string indexes (what js-parser.ts + TextDocument expect) for non-ASCII input?
import { parsers } from "./parsers.mjs";
const src = 'var s = "héllo 😀"; State.variables.gold = 1;';
const want = src.indexOf("State");
for (const n of ["acorn", "meriyah", "oxc-parser (native)", "oxc-parser (native, raw transfer)", "oxc-parser (wasm)", "@babel/parser (estree, recovery)", "@typescript-eslint/typescript-estree"]) {
    const ast = (await parsers[n]())(src).ast;
    const e = ast.body[1].expression.left.object.object;
    console.log(n.padEnd(38), "start", e.start, "range", JSON.stringify(e.range), "expected", want);
}
