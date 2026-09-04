import { expect } from "chai";
import "mocha";
import * as acorn from "acorn";

import * as uut from "../acorn-errors";

/**
 * One row of the baseline corpus.
 *
 * `expectedEnd` is derived from `contents.length`, mirroring the disguise
 * described in the spec: `createDiagnosticFor` builds a diagnostic's end
 * position from the improved error's `contents` string length, not from a
 * real end offset.
 */
interface TestCase {
    description: string;
    input: string;
    expectedMessage: string;
    expectedStart: number;
    expectedEnd: number;
}

/**
 * Parse `input` the same way `parseJS` does and return the resulting
 * SyntaxError, or throw if the input actually parses.
 */
function parseAndCaptureError(
    input: string,
): SyntaxError & { pos?: number; loc?: { line: number; column: number } } {
    acorn.parse(input, { ecmaVersion: 2020, sourceType: "script" });
    throw new Error(`expected "${input}" to fail to parse, but it parsed`);
}

const testCases: TestCase[] = [
    // --- Systematic sweep of Acorn's three generic messages ---
    {
        description: "generic sweep: bare identifiers",
        input: "a b c",
        expectedMessage: "Unexpected token",
        expectedStart: 2,
        expectedEnd: 2,
    },
    {
        description: "generic sweep: empty object property value",
        input: "{a: }",
        expectedMessage: "Expected value after ':'",
        expectedStart: 2,
        expectedEnd: 3,
    },
    {
        description: "generic sweep: unclosed call parens",
        input: "foo(",
        expectedMessage: "Opening '(' is missing a matching ')'",
        expectedStart: 3,
        expectedEnd: 4,
    },
    {
        description: "generic sweep: unclosed array",
        input: "[1,2",
        expectedMessage: "Opening '[' is missing a matching ']'",
        expectedStart: 0,
        expectedEnd: 1,
    },
    {
        description: "generic sweep: bare catch keyword",
        input: "catch ",
        expectedMessage: "Unexpected token",
        expectedStart: 0,
        expectedEnd: 0,
    },
    {
        description: "generic sweep: try with no catch or finally",
        input: "try{}",
        expectedMessage: "Missing catch or finally clause",
        expectedStart: 0,
        expectedEnd: 0,
    },
    {
        description: "generic sweep: unclosed if body",
        input: "if(a){",
        expectedMessage: "Opening '{' is missing a matching '}'",
        expectedStart: 5,
        expectedEnd: 6,
    },
    {
        description: "generic sweep: invalid character",
        input: "x = 1 @ y",
        expectedMessage: "Unexpected character '@'",
        expectedStart: 6,
        expectedEnd: 6,
    },
    {
        description: "generic sweep: numeric literal followed by identifier",
        input: "1_",
        expectedMessage: "Identifier directly after number",
        expectedStart: 1,
        expectedEnd: 1,
    },

    // --- Broken JavaScript harvested from existing story-format test fixtures ---
    {
        description:
            "harvested from chapbook-parser.test.ts's [javascript] engine.extend " +
            "fixture, truncated by dropping the trailing ');' as if an author saved " +
            "mid-edit",
        input: "engine.extend('2.0.1', () => {\nengine.template.inserts.add(\n{match: /hi/}\n);\n}",
        expectedMessage: "Opening '(' is missing a matching ')'",
        expectedStart: 13,
        expectedEnd: 14,
    },
    {
        description:
            "harvested from sugarcube-parser.test.ts's macro-argument fixture " +
            "\"<<a 'unterminated>>\" -- the JS fragment SugarCube hands to the parser",
        input: "'unterminated",
        expectedMessage: "Unterminated string constant",
        expectedStart: 0,
        expectedEnd: 13,
    },

    // --- One hand-written typo per existing rule ---
    {
        description: "rule: unterminated string constant",
        input: "let x = 'unterminated",
        expectedMessage: "Unterminated string constant",
        expectedStart: 8,
        expectedEnd: 21,
    },
    {
        description: "rule: unterminated template literal",
        input: "let x = `unterminated",
        expectedMessage: "Unterminated template",
        expectedStart: 9,
        expectedEnd: 21,
    },
    {
        description: "rule: unmatched opening paren",
        input: "let x = (1 + 2",
        expectedMessage: "Opening '(' is missing a matching ')'",
        expectedStart: 8,
        expectedEnd: 9,
    },
    {
        description: "rule: unmatched opening bracket",
        input: "let arr = [1, 2",
        expectedMessage: "Opening '[' is missing a matching ']'",
        expectedStart: 10,
        expectedEnd: 11,
    },
    {
        description: "rule: unmatched opening brace",
        input: "let obj = {a: 1",
        expectedMessage: "Opening '{' is missing a matching '}'",
        expectedStart: 10,
        expectedEnd: 11,
    },
    {
        description: "rule: missing property name after dot",
        input: "foo.",
        expectedMessage: "Expected property or method name after '.'",
        expectedStart: 3,
        expectedEnd: 4,
    },
    {
        description:
            "rule: optional chaining operator (falls through to the incomplete-expression rule, " +
            "not the property rule, because err.pos lands on the trailing '.' and excludes it " +
            "from the line context the property regex matches against)",
        input: "foo?.",
        expectedMessage:
            "Unexpected token; expression appears incomplete after operator",
        expectedStart: 3,
        expectedEnd: 4,
    },
    {
        description: "rule: incomplete expression after operator",
        input: "foo +",
        expectedMessage:
            "Unexpected token; expression appears incomplete after operator",
        expectedStart: 4,
        expectedEnd: 5,
    },
    {
        description: "rule: incomplete property definition",
        input: "let obj = {foo: }",
        expectedMessage: "Expected value after ':'",
        expectedStart: 14,
        expectedEnd: 15,
    },
    {
        description: "rule: incomplete if statement",
        input: "let x = 1; if ",
        expectedMessage: "Unexpected token; expected '('",
        expectedStart: 14,
        expectedEnd: 14,
    },
    {
        description: "rule: incomplete catch statement",
        input: "let x = 1; try {} catch ",
        expectedMessage: "Unexpected token; expected '{'",
        expectedStart: 24,
        expectedEnd: 24,
    },

    // --- Known-wrong behaviour, recorded as-is ---
    {
        description:
            "known bug (phase 06, findUnmatchedDelimiter position drift): a string " +
            "before the unclosed paren shifts the reported position left of the real '('," +
            " which is at index 14, not 7",
        input: "x = 'hello' + (1",
        expectedMessage: "Opening '(' is missing a matching ')'",
        expectedStart: 7,
        expectedEnd: 8,
    },
    {
        description:
            "known bug (phase 06, findUnmatchedDelimiter position drift): a string " +
            "before the unclosed bracket shifts the reported position left of the real '['," +
            " which is at index 12, not 7",
        input: 'x = "foo" + [1',
        expectedMessage: "Opening '[' is missing a matching ']'",
        expectedStart: 7,
        expectedEnd: 8,
    },
    {
        description:
            "known bug (phase 06, delimiter scan short-circuits ahead of every specific " +
            "rule): the unclosed '{' does mask a more specific incomplete-property-value " +
            "diagnostic for 'c:'",
        input: "let a = { b: 1, c:  \nlet d = 2;",
        expectedMessage: "Opening '{' is missing a matching '}'",
        expectedStart: 8,
        expectedEnd: 9,
    },
    {
        description:
            "known bug (phase 05, only one line of context is visible): the incomplete " +
            "'+' operator is on the line before the error, so the incomplete-expression " +
            "rule never sees it and the message falls back to the bare generic one",
        input: "let a = 1 +\nlet b = 2;",
        expectedMessage: "Unexpected token",
        expectedStart: 16,
        expectedEnd: 16,
    },
    {
        description:
            "known bug (phase 06, findUnmatchedDelimiter returns undefined on a " +
            "mismatched close): '(]' should report a mismatched delimiter, but the " +
            "scan bails out and the message falls back to the bare generic one",
        input: "let x = (]",
        expectedMessage: "Unexpected token",
        expectedStart: 9,
        expectedEnd: 9,
    },
];

describe("Acorn Error Messages", () => {
    for (const {
        description,
        input,
        expectedMessage,
        expectedStart,
        expectedEnd,
    } of testCases) {
        it(`should match today's behavior for: ${description}`, () => {
            const err = (() => {
                try {
                    return parseAndCaptureError(input);
                } catch (e) {
                    if (e instanceof SyntaxError) return e;
                    throw e;
                }
            })();

            const result = uut.improveAcornErrorMessage(input, err);

            expect(result.message).to.equal(expectedMessage);
            expect(result.at).to.equal(expectedStart);
            expect(result.at + result.contents.length).to.equal(expectedEnd);
        });
    }
});
