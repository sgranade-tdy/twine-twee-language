import { expect } from "chai";
import "mocha";
import { TextDocument } from "vscode-languageserver-textdocument";

import { updateProjectIndex, updateScriptFileIndex } from "../indexer";
import { ParseLevel } from "../parser-types";
import { Index } from "../project-index";
import { getDefinitionAt } from "../definition";
import { getReferencesToSymbolAt } from "../references";
import { generateDiagnostics } from "../validator";

const storyData =
    ':: StoryData\n{"ifid": "x", "format": "SugarCube", "format-version": "2.36.1"}\n\n';

describe("Working from .js files", () => {
    function build(js: string, passageText = "<<print $gold>>") {
        const index = new Index();
        const tw = TextDocument.create(
            "file:///story.tw",
            "twee3",
            1,
            storyData + `:: Start\n${passageText}\n`,
        );
        const script = TextDocument.create("file:///s.js", "javascript", 1, js);
        updateProjectIndex(tw, ParseLevel.Full, index);
        updateScriptFileIndex(script, "story-script", ParseLevel.Full, index);
        return { index, tw, script };
    }

    it("should find .tw and .js references from a story variable in a .js file", () => {
        const { index, script } = build("State.variables.gold = 2;\n");

        const refs = getReferencesToSymbolAt(
            script.uri,
            script.positionAt(script.getText().indexOf("gold")),
            index,
            true,
        );

        expect(refs?.map((r) => r.uri).sort()).to.eql([
            "file:///s.js",
            "file:///story.tw",
        ]);
    });

    it("should go from a story variable in a .js file to where it's set in .tw and .js files", () => {
        const { index, script } = build(
            "State.variables.gold = 2;\n",
            "<<set $gold to 1>>",
        );

        const definition = getDefinitionAt(
            script,
            script.positionAt(script.getText().indexOf("gold")),
            index,
        );

        expect(
            [definition]
                .flat()
                .map((d) => d?.uri)
                .sort(),
        ).to.eql(["file:///s.js", "file:///story.tw"]);
    });

    it("should clear variable-never-set in an open .tw once a .js sets the variable", async () => {
        const { index, tw } = build("// nothing\n");
        const codes = async () =>
            (await generateDiagnostics(tw, index)).map((d) => d.code);
        expect(await codes()).to.include("variable-never-set");

        updateScriptFileIndex(
            TextDocument.create(
                "file:///s.js",
                "javascript",
                2,
                "State.variables.gold = 2;\n",
            ),
            "story-script",
            ParseLevel.Full,
            index,
        );

        expect(await codes()).to.not.include("variable-never-set");
    });
});
