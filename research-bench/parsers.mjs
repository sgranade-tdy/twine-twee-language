// Adapters: each returns { ast, errors } where ast is (ideally) an ESTree Program with
// node.range populated (eslint-scope needs it) or throws on unrecoverable error.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const isModule = (src) => /^\s*(import|export)\b/m.test(src);

export const parsers = {
    // Current stack, as js-parser.ts calls it (parseJSStrict, then acorn-loose on failure).
    "acorn": async () => {
        const acorn = await import("acorn");
        return (src) => ({ ast: acorn.parse(src, { ecmaVersion: "latest", sourceType: isModule(src) ? "module" : "script", ranges: true }), errors: [] });
    },
    "acorn-loose": async () => {
        const loose = await import("acorn-loose");
        return (src) => ({ ast: loose.parse(src, { ecmaVersion: "latest", sourceType: isModule(src) ? "module" : "script", ranges: true }), errors: [] });
    },
    // What parseJS does today: strict, and on SyntaxError, loose (time includes the failed strict attempt).
    "acorn→loose (parseJS)": async () => {
        const acorn = await import("acorn");
        const loose = await import("acorn-loose");
        return (src) => {
            const opts = { ecmaVersion: "latest", sourceType: isModule(src) ? "module" : "script", ranges: true };
            try { return { ast: acorn.parse(src, opts), errors: [] }; }
            catch (e) { return { ast: loose.parse(src, opts), errors: [e.message] }; }
        };
    },
    "espree": async () => {
        const espree = await import("espree");
        return (src) => ({ ast: espree.parse(src, { ecmaVersion: "latest", sourceType: isModule(src) ? "module" : "script", range: true }), errors: [] });
    },
    "meriyah": async () => {
        const m = await import("meriyah");
        return (src) => ({ ast: m.parse(src, { sourceType: isModule(src) ? "module" : "script", next: true, ranges: true, webcompat: true }), errors: [] });
    },
    "oxc-parser (native)": async () => {
        const oxc = await import("oxc-parser");
        return (src) => {
            const r = oxc.parseSync("x.js", src, { lang: "js", sourceType: isModule(src) ? "module" : "script", range: true, preserveParens: false });
            return { ast: r.program, errors: r.errors.map((e) => e.message) };
        };
    },
    "oxc-parser (native, raw transfer)": async () => {
        const oxc = await import("oxc-parser");
        return (src) => {
            const r = oxc.parseSync("x.js", src, { lang: "js", sourceType: isModule(src) ? "module" : "script", range: true, preserveParens: false, experimentalRawTransfer: true });
            return { ast: r.program, errors: r.errors.map((e) => e.message) };
        };
    },
    "oxc-parser (wasm)": async () => {
        // In oxc-parser 0.155.0 the Node WASI loader (NAPI_RS_FORCE_WASI) fails: its
        // @napi-rs/wasm-runtime 1.2.x pulls emnapi 1.x while the binding pins 2.0.0-alpha.6.
        // So load the self-contained browser bundle, shimming fetch() for its file:// .wasm URL.
        const fs = await import("node:fs");
        const of = globalThis.fetch;
        globalThis.fetch = async (u, ...a) => String(u).startsWith("file:") ? new Response(fs.readFileSync(new URL(String(u))), { headers: { "content-type": "application/wasm" } }) : of(u, ...a);
        const oxc = await import(new URL("./node_modules/@oxc-parser/binding-wasm32-wasip1/browser-bundle.js", import.meta.url).href);
        return (src) => {
            const r = oxc.parseSync("x.js", src, { lang: "js", sourceType: isModule(src) ? "module" : "script", range: true, preserveParens: false });
            return { ast: r.program, errors: r.errors.map((e) => e.message) };
        };
    },
    "@babel/parser (estree, recovery)": async () => {
        const babel = await import("@babel/parser");
        return (src) => {
            const f = babel.parse(src, { sourceType: isModule(src) ? "module" : "script", plugins: ["estree"], errorRecovery: true, ranges: true });
            return { ast: f.program, errors: (f.errors || []).map((e) => e.message) };
        };
    },
    "@typescript-eslint/typescript-estree": async () => {
        const ts = await import("@typescript-eslint/typescript-estree");
        return (src) => ({ ast: ts.parse(src, { range: true, loc: false, jsDocParsingMode: "none", allowInvalidAST: true, filePath: "x.js" }), errors: [] });
    },
    // Non-ESTree: swc returns its own AST (Span with byte offsets), not walkable by acorn-walk/eslint-scope.
    "@swc/core (native)": async () => {
        const swc = require("@swc/core");
        return (src) => ({ ast: swc.parseSync(src, { syntax: "ecmascript", isModule: isModule(src) }), errors: [], nonEstree: true });
    },
    "@swc/wasm": async () => {
        const swc = require("@swc/wasm");
        return (src) => ({ ast: swc.parseSync(src, { syntax: "ecmascript", isModule: isModule(src) }), errors: [], nonEstree: true });
    },
};
