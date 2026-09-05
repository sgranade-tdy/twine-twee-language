import { expect } from "chai";
import "mocha";
import * as acorn from "acorn";

import { ParserWithState } from "../acorn-errors/parser-state";
import type { ErrorWithParserState } from "../acorn-errors/parser-state";

/**
 * Parse `input` through `ParserWithState` and return the `SyntaxError` it
 * raises, or throw if the input actually parses.
 */
function parseAndCaptureError(input: string): ErrorWithParserState {
    try {
        ParserWithState.parse(input, {
            ecmaVersion: 2020,
            sourceType: "script",
        });
    } catch (err) {
        if (err instanceof SyntaxError) return err as ErrorWithParserState;
        throw err;
    }
    throw new Error(`expected "${input}" to fail to parse, but it parsed`);
}

/**
 * Message shown on canary failure: name the cause and the remediation, so
 * that an Acorn upgrade that reshapes its internals produces a red build
 * that explains itself instead of a mystery.
 */
const canaryFailureMessage =
    "Acorn's parser internals changed shape; see " +
    "`acorn-errors/parser-state.ts` and ADR-0001";

describe("ParserWithState", () => {
    // This suite is load-bearing (ADR-0001): `parserState` is captured by
    // reading Acorn's undocumented internals, and graceful degradation is
    // silent by construction, so nothing else will fail loudly if a future
    // Acorn upgrade reshapes them. These assertions pin the exact shapes
    // ADR-0001 measured.

    it("captures the open-delimiter context stack for an unclosed call", () => {
        const err = parseAndCaptureError("foo(");

        expect(err.parserState, canaryFailureMessage).to.not.be.undefined;
        expect(err.parserState?.context, canaryFailureMessage).to.deep.equal([
            "{",
            "(",
        ]);
    });

    it("captures the failing token's type, value, and span for a bare identifier run", () => {
        const err = parseAndCaptureError("a b c");

        expect(err.parserState, canaryFailureMessage).to.not.be.undefined;
        expect(
            err.parserState?.type.label,
            canaryFailureMessage,
        ).to.equal("name");
        expect(err.parserState?.value, canaryFailureMessage).to.equal("b");
        expect(err.parserState?.start, canaryFailureMessage).to.equal(2);
        expect(err.parserState?.end, canaryFailureMessage).to.equal(3);
    });

    it("captures the failing token's type and span for an empty object property value", () => {
        const err = parseAndCaptureError("{a: }");

        expect(err.parserState, canaryFailureMessage).to.not.be.undefined;
        expect(err.parserState?.type.label, canaryFailureMessage).to.equal(
            "}",
        );
        expect(err.parserState?.start, canaryFailureMessage).to.equal(4);
        expect(err.parserState?.end, canaryFailureMessage).to.equal(5);
    });

    it("attaches no parserState when the internals are missing or misshapen", () => {
        // A parser whose `context` doesn't look like Acorn's TokContext stack
        // should degrade gracefully instead of throwing or attaching a
        // malformed `parserState`.
        class MisshapenParser extends ParserWithState {}
        const parser = new (MisshapenParser as unknown as new (
            options: acorn.Options,
            input: string,
        ) => MisshapenParser)(
            { ecmaVersion: 2020, sourceType: "script" },
            "foo(",
        );
        (parser as unknown as { context: unknown }).context = ["not", "a", "context"];

        let caught: ErrorWithParserState | undefined;
        try {
            parser.raise(0, "test message");
        } catch (err) {
            if (err instanceof SyntaxError) caught = err as ErrorWithParserState;
        }

        expect(caught, "raise should still throw a SyntaxError").to.not.be
            .undefined;
        expect(caught?.parserState, canaryFailureMessage).to.be.undefined;
    });

    it("does not affect successful parses", () => {
        expect(() =>
            ParserWithState.parse("const x = 1;", {
                ecmaVersion: 2020,
                sourceType: "script",
            }),
        ).to.not.throw();
    });
});
