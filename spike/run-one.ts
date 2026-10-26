// Parse one input file as a `script`-tagged passage through the real parse() path.
// Usage: tsx run-one.ts <sugarcube|chapbook> <input> [parseLevel]
// Prints one JSON line.
import fs from "node:fs";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "../server/src/parser";
import { ParseLevel } from "../server/src/parser-types";
import { getStoryFormatParser } from "../server/src/passage-text-parsers";
import { MockCallbacks } from "../server/src/test/builders";
import { OSugarCubeSymbolKind } from "../server/src/passage-text-parsers/sugarcube/types";
import { OChapbookSymbolKind } from "../server/src/passage-text-parsers/chapbook/types";

const [format, inputPath, levelArg] = process.argv.slice(2);
const level = levelArg === "names" ? ParseLevel.PassageNames : ParseLevel.Full;
const storyFormat =
    format === "sugarcube"
        ? { format: "SugarCube", formatVersion: "2.37.3" }
        : { format: "Chapbook", formatVersion: "2.2.0" };
const kinds: Record<number, string> = {};
const O = format === "sugarcube" ? OSugarCubeSymbolKind : OChapbookSymbolKind;
for (const [k, v] of Object.entries(O)) kinds[v as number] = k;

const js = fs.readFileSync(inputPath, "utf8");
const header =
    `:: StoryTitle\nSpike\n\n:: StoryData\n` +
    JSON.stringify({ ifid: "D674C58C-DEFA-4F70-B7A2-27742230C0FC", format: storyFormat.format, "format-version": storyFormat.formatVersion }) +
    `\n\n:: Story JavaScript [script]\n`;
const docText = header + js;
const doc = TextDocument.create("file:///spike.twee", "twee3", 1, docText);

function runOnce(): { cb: MockCallbacks; ms: number; threw?: string } {
    const cb = new MockCallbacks();
    const t0 = performance.now();
    let threw: string | undefined;
    try {
        parse(doc, cb, level, storyFormat, getStoryFormatParser);
    } catch (e) {
        threw = String((e as Error)?.stack ?? e).split("\n").slice(0, 4).join(" | ");
    }
    return { cb, ms: performance.now() - t0, threw };
}

global.gc?.();
const heap0 = process.memoryUsage().heapUsed;
const first = runOnce();
const heap1 = process.memoryUsage().heapUsed;
const times = [first.ms];
for (let i = 0; i < 4; i++) times.push(runOnce().ms);
const warm = times.slice(1).sort((a, b) => a - b);

const cb = first.cb;
const syms = [
    ...cb.references.map((s) => ({ ...s, role: "ref" })),
    ...cb.definitions.map((s) => ({ ...s, role: "def" })),
];
const byKind: Record<string, number> = {};
const uniqueByKind: Record<string, Set<string>> = {};
let offsetOk = 0;
const offsetBad: string[] = [];
for (const s of syms) {
    const kind = (kinds[s.kind] ?? `k${s.kind}`) + (s.role === "def" ? "(def)" : "");
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    (uniqueByKind[kind] ??= new Set()).add(s.contents);
    if (s.kind === O.Variable || s.kind === O.Property || s.kind === O.VariableSet || s.kind === O.PropertySet) {
        const text = doc.getText(s.location.range);
        const last = s.contents.split(".").pop()!;
        // Variables: range text should be the name (SugarCube may include `$`/`State.variables.`).
        if (text === s.contents || text === last || text.endsWith(last) || text.replace(/^\$/, "") === s.contents.replace(/^\$/, "")) offsetOk++;
        else if (offsetBad.length < 8) offsetBad.push(`${s.contents} -> ${JSON.stringify(text)}`);
    }
}
const varNames = [...(uniqueByKind["Variable"] ?? [])];
const propNames = [...(uniqueByKind["Property"] ?? [])];

console.log(
    JSON.stringify({
        format,
        file: inputPath.split("/").pop(),
        bytes: js.length,
        level: levelArg ?? "full",
        threw: first.threw,
        coldMs: Math.round(first.ms),
        warmMedianMs: Math.round(warm[Math.floor(warm.length / 2)]),
        heapDeltaMB: +((heap1 - heap0) / 1048576).toFixed(1),
        maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
        parseErrors: cb.errors.length,
        firstError: cb.errors[0]?.message?.slice(0, 120),
        semanticTokens: cb.tokens.length,
        embeddedDocs: cb.embeddedDocuments.length,
        byKind,
        uniqueCounts: Object.fromEntries(Object.entries(uniqueByKind).map(([k, v]) => [k, v.size])),
        varSample: varNames.slice(0, 25),
        propSample: propNames.slice(0, 15),
        offsetChecked: offsetOk + offsetBad.length,
        offsetOk,
        offsetBad,
    }),
);
