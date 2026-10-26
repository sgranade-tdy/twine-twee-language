// Builds the benchmark corpus in ./inputs from npm packages plus a few synthetic files.
import fs from "node:fs";
const nm = "node_modules/";
const copy = (src, dst) => fs.copyFileSync(nm + src, "inputs/" + dst);
copy("jquery/dist/jquery.js", "jquery.js");
copy("jquery/dist/jquery.min.js", "jquery.min.js");
copy("lodash/lodash.js", "lodash.js");
copy("lodash/lodash.min.js", "lodash.min.js");
copy("three/build/three.module.js", "three.module.js"); // ES module
copy("three/build/three.core.js", "three.core.js"); // ~1.4MB ES module

// A typical SugarCube story script (a few KB).
let story = `/* Story JavaScript */
Config.history.maxStates = 1;
setup.items = ["sword", "shield", "potion"];
window.addGold = function (amount) {
    State.variables.gold = (State.variables.gold || 0) + amount;
    return State.variables.gold;
};
setup.describe = (name) => {
    const v = State.variables;
    if (v.inventory.includes(name)) {
        return \`You have the \${name}.\`;
    }
    return "You don't have that.";
};
`;
for (let i = 0; i < 60; i++)
    story += `setup.handler${i} = function (ev) { let x${i} = State.variables.counter${i % 7} + ${i}; State.variables.flag${i} = x${i} > 3; return x${i}; };\n`;
fs.writeFileSync("inputs/story.js", story);

// Broken mid-edit variants of jquery.js (unminified, 285KB).
const jq = fs.readFileSync("inputs/jquery.js", "utf8");
const mid = Math.floor(jq.length / 2);
const lineStart = jq.lastIndexOf("\n", mid) + 1;
// 1) half-typed member expression + unclosed call in the middle of the file
fs.writeFileSync("inputs/broken-midedit.js",
    jq.slice(0, lineStart) + "\tfoo.bar(baz.\n" + jq.slice(lineStart));
// 2) file truncated at ~60% (e.g. mid-save / mid-paste)
fs.writeFileSync("inputs/broken-truncated.js", jq.slice(0, Math.floor(jq.length * 0.6)));
// 3) unterminated string literal in the middle
fs.writeFileSync("inputs/broken-string.js",
    jq.slice(0, lineStart) + "\tvar s = \"unterminated;\n" + jq.slice(lineStart));
for (const f of fs.readdirSync("inputs")) console.log(f.padEnd(24), fs.statSync("inputs/" + f).size);
