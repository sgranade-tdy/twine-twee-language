// A typical Chapbook story script: engine.state, engine.extend, and window-mirrored bare names.
import fs from "node:fs";
let s = `/* Chapbook Story JavaScript */
engine.extend('2.0.0', () => {
    config.template.inserts = [{
        match: /{inventory}/i,
        render: () => engine.state.get('inventory').join(', '),
    }, ...config.template.inserts];
});
engine.state.set('gold', 10);
window.addGold = function (amount) {
    engine.state.set('gold', engine.state.get('gold') + amount);
    return gold;
};
`;
for (let i = 0; i < 60; i++)
    s += `window.handler${i} = function (ev) { let x${i} = engine.state.get('counter${i % 7}') + ${i}; engine.state.set('flag${i}', x${i} > 3); return x${i}; };\n`;
fs.writeFileSync("inputs/chapbook-story.js", s);
