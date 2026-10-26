// Cost of cheap pre-scans that could skip or classify a file before any parse.
import fs from "node:fs";
const re = /\bState\s*\.\s*(variables|temporary)\b|\bvariables\s*\(\s*\)|\btemporary\s*\(\s*\)|\bengine\s*\.\s*state\b/;
for (const f of ["story.js", "jquery.min.js", "jquery.js", "lodash.js", "three.core.js"]) {
    const src = fs.readFileSync("inputs/" + f, "utf8");
    const t = []; let hit, avg;
    for (let i = 0; i < 9; i++) {
        const s = performance.now();
        hit = re.test(src);
        const lines = src.split("\n"); avg = src.length / lines.length;
        t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    console.log(f.padEnd(16), "story-API regex hit:", String(hit).padEnd(5), " avg line length:", avg.toFixed(0).padStart(6), " regex+line-split median ms:", t[4].toFixed(2));
}
