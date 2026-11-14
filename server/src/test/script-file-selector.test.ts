import { expect } from "chai";
import "mocha";

import { buildScriptFileSelector } from "../script-file-selector";

describe("Script file selector", () => {
    it("should list each file by exact path", () => {
        expect(
            buildScriptFileSelector(["file:///w/a.js", "file:///w/b.js"]),
        ).to.eql([
            { scheme: "file", pattern: "/w/a.js" },
            { scheme: "file", pattern: "/w/b.js" },
        ]);
    });

    it("should escape glob metacharacters and decode the path", () => {
        expect(buildScriptFileSelector(["file:///w/a%20{b}*[c]%3F.js"])).to.eql(
            [{ scheme: "file", pattern: "/w/a [{]b[}][*][[]c][?].js" }],
        );
    });
});
