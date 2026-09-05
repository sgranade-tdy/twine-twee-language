import * as acorn from "acorn";

/**
 * Parser state captured at the moment Acorn raised a `SyntaxError`.
 *
 * See ADR-0001 for why this is worth capturing: Acorn's own error object
 * carries almost nothing (a position, a line/column, and a string), while the
 * parser itself knows the failing token, its exact span, and the stack of
 * still-open delimiters.
 */
export interface ParserState {
    /** The failing token's type. */
    type: acorn.TokenType;
    /** The failing token's value, if any. */
    value: unknown;
    /** The failing token's start offset (in the text being parsed). */
    start: number;
    /** The failing token's end offset (in the text being parsed). */
    end: number;
    /** The end offset of the token before the failing one. */
    lastTokEnd: number;
    /**
     * The open-delimiter stack, innermost last, as the raw token labels
     * (`"{"`, `"("`, `` "`" ``, `"function"`, ...) that Acorn's undocumented
     * `TokContext` objects carry.
     */
    context: string[];
}

/**
 * Acorn properties that exist at runtime (`node_modules/acorn/dist/acorn.js`)
 * but aren't part of its public, documented `Parser` type. Reading them is
 * exactly what `captureParserState` below has to defend against: an Acorn
 * upgrade can rename or reshape any of this without a type error to catch it.
 */
interface AcornParserInternals {
    type?: unknown;
    value?: unknown;
    start?: unknown;
    end?: unknown;
    lastTokEnd?: unknown;
    context?: unknown;
}

/**
 * Read `parser`'s undocumented internals and shape them into a `ParserState`.
 *
 * Returns `undefined` -- rather than throwing or returning a partial object --
 * if anything doesn't look like the shape ADR-0001 measured. That's the
 * graceful-degradation path: callers fall back to the token stream.
 *
 * @param parser Parser instance at the moment it raised.
 * @returns The captured parser state, or `undefined` if the internals are
 * missing or misshapen.
 */
function captureParserState(parser: acorn.Parser): ParserState | undefined {
    const internals = parser as unknown as AcornParserInternals;
    const { type, value, start, end, lastTokEnd, context } = internals;

    if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        typeof lastTokEnd !== "number" ||
        typeof type !== "object" ||
        type === null ||
        typeof (type as acorn.TokenType).label !== "string"
    ) {
        return undefined;
    }

    if (!Array.isArray(context)) {
        return undefined;
    }

    const contextLabels: string[] = [];
    for (const frame of context) {
        if (
            typeof frame !== "object" ||
            frame === null ||
            typeof (frame as { token?: unknown }).token !== "string"
        ) {
            return undefined;
        }
        contextLabels.push((frame as { token: string }).token);
    }

    return {
        type: type as acorn.TokenType,
        value,
        start,
        end,
        lastTokEnd,
        context: contextLabels,
    };
}

/**
 * The signature of Acorn's own `Parser.prototype.raise`
 * (`node_modules/acorn/dist/acorn.js:3807`). It isn't part of Acorn's public
 * type declarations -- it's assigned straight onto the prototype at runtime --
 * so there's nothing to `override`; this just types the function we're
 * wrapping.
 */
type RaiseFn = (this: acorn.Parser, pos: number, message: string) => never;

const baseRaise = (acorn.Parser.prototype as unknown as { raise: RaiseFn })
    .raise;

/**
 * A `SyntaxError` thrown by Acorn, augmented with the parser state captured
 * at the moment it was raised.
 */
export type ErrorWithParserState = SyntaxError & {
    parserState?: ParserState;
};

/**
 * Subclass of Acorn's `Parser` that attaches a `parserState` payload (see
 * `ParserState` above) to every `SyntaxError` it raises, before rethrowing.
 *
 * Per ADR-0001, `raise` is a plain prototype method on public API
 * (`acorn.Parser`), so this is a subclass, not a fork or a monkey-patch.
 * Successful parses never call `raise`, so they're unaffected.
 */
export class ParserWithState extends acorn.Parser {
    raise(pos: number, message: string): never {
        try {
            baseRaise.call(this, pos, message);
        } catch (err) {
            if (err instanceof SyntaxError) {
                const parserState = captureParserState(this);
                if (parserState !== undefined) {
                    (err as ErrorWithParserState).parserState = parserState;
                }
            }
            throw err;
        }
        // `baseRaise` always throws; this line only satisfies TypeScript's
        // control-flow analysis for a function typed to return `never`.
        throw new Error("unreachable: Acorn's raise returned without throwing");
    }
}
