// Release cadence / maintainer metadata from the npm registry (primary source for releases).
const pkgs = ["acorn", "acorn-loose", "acorn-walk", "eslint-scope", "meriyah", "oxc-parser", "@babel/parser", "@swc/core", "@swc/wasm", "@typescript-eslint/typescript-estree", "typescript", "espree", "esbuild"];
const now = new Date("2026-10-26");
console.log("| package | latest | published | stable releases in last 12 mo | first published | last majors | npm maintainers | repo |\n|---|---|---|---:|---|---|---:|---|");
for (const p of pkgs) {
    const j = await (await fetch("https://registry.npmjs.org/" + p.replace("/", "%2f"))).json();
    const latest = j["dist-tags"].latest;
    const vs = Object.entries(j.time).filter(([k]) => !["created", "modified"].includes(k) && !k.includes("-"));
    const yr = vs.filter(([, v]) => now - new Date(v) < 365 * 864e5).length;
    const majorFirst = {};
    for (const [k, v] of vs) { const m = k.split(".")[0] === "0" ? "0." + k.split(".")[1] : k.split(".")[0]; if (!majorFirst[m] || v < majorFirst[m]) majorFirst[m] = v; }
    const lastMajors = Object.entries(majorFirst).sort((a, b) => a[1].localeCompare(b[1])).slice(-3).map(([m, d]) => `${m}.x@${d.slice(0, 7)}`).join(", ");
    const repo = (j.repository?.url || "").replace(/^git\+/, "").replace(/\.git$/, "");
    console.log(`| ${p} | ${latest} | ${j.time[latest].slice(0, 10)} | ${yr} | ${j.time.created.slice(0, 10)} | ${lastMajors} | ${(j.maintainers || []).length} | ${repo} |`);
}
