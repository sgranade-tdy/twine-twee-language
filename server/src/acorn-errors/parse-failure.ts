import * as acorn from "acorn";

import type { ErrorWithParserState, ParserState } from "./parser-state";

/**
 * A token at or around the parse failure.
 *
 * This is deliberately *not* an `acorn.Token`: rules ask the parse failure
 * context questions and never touch Acorn's own structures, so that an Acorn
 * upgrade that reshapes them changes this file and nothing else.
 */
export interface FailureToken {
    /** Acorn's token-type label: `"name"`, `"num"`, `"eof"`, `"}"`, ... */
    label: string;
    /** The token's value, for tokens that carry one. */
    value: unknown;
    /** Start offset in the text being parsed. */
    start: number;
    /** End offset in the text being parsed. */
    end: number;
    /** The source text the token spans. Empty for `eof`. */
    text: string;
}

/**
 * An opening delimiter that was still open when the parse failed.
 */
export interface OpenDelimiter {
    /** The opening delimiter character. */
    open: string;
    /** The closing delimiter that would have matched it. */
    close: string;
    /** Start offset of the opening delimiter in the text being parsed. */
    start: number;
    /** End offset of the opening delimiter in the text being parsed. */
    end: number;
}

/** A line of source text, with the offset at which it begins. */
export interface SourceLine {
    text: string;
    start: number;
}

const closerFor: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
};

const openers = new Set(Object.keys(closerFor));
const closers = new Set(Object.values(closerFor));

/**
 * Delimiters that appear both in Acorn's `context` stack and in the token
 * stream, so that the two can be correlated. Measured: `(` and `{` push a
 * `TokContext`, but `[` does not -- an unclosed bracket leaves no trace in the
 * parser's context at all. Template frames (`` ` ``, `${`) are in the context
 * but have no bracket-token counterpart, so they take no part in the
 * correlation either.
 */
const contextTrackedDelimiters = new Set(["(", "{"]);

/**
 * Tokenize `text`, keeping whatever was produced before any lexical fault.
 *
 * `getToken()` throws when it hits a character it can't tokenize, but the
 * tokens it already returned remain valid, so a partial stream is still the
 * best information available for the text up to that point.
 *
 * @param text Text to tokenize.
 * @returns The tokens produced, in source order, excluding `eof`.
 */
function tokenize(text: string): acorn.Token[] {
    const tokens: acorn.Token[] = [];

    try {
        const tokenizer = acorn.tokenizer(text, { ecmaVersion: 2020 });
        // Every token covers at least one character, so the text's length is
        // a hard ceiling on how many there can be. The bound is insurance
        // against a future Acorn that could stop advancing without throwing.
        for (let i = 0; i <= text.length; i++) {
            const token = tokenizer.getToken();
            if (token.type === acorn.tokTypes.eof) break;
            tokens.push(token);
        }
    } catch {
        // A lexical fault. Keep the tokens produced before the throw.
    }

    return tokens;
}

/**
 * The parse failure context: everything known about a failed parse, exposed as
 * queries.
 *
 * Rules (`rules.ts`) ask this object questions. They never walk Acorn's token
 * or context structures themselves, because those structures are undocumented
 * and can shift between Acorn releases; this class is the one place that has
 * to absorb such a shift.
 *
 * Its inputs are the source text and the `SyntaxError` Acorn threw, which
 * carries the parser state captured at `raise` (ADR-0001). When that state is
 * absent -- purely lexical faults, or an Acorn whose internals no longer look
 * the way `parser-state.ts` expects -- every query falls back to a token
 * stream produced by tokenizing the text.
 */
export class ParseFailure {
    /** The text that failed to parse. */
    readonly text: string;
    /** The offset Acorn reported the failure at, within `text`. */
    readonly pos: number;

    private readonly parserState: ParserState | undefined;
    private tokenCache: acorn.Token[] | undefined;

    /**
     * @param text Text that failed to parse.
     * @param err Error Acorn threw, optionally carrying parser state.
     */
    constructor(text: string, err: ErrorWithParserState & { pos?: number }) {
        this.text = text;
        this.pos = err.pos ?? 0;
        this.parserState = err.parserState;
    }

    /**
     * The token the parse failed at.
     *
     * A lexical fault -- an unterminated string or template -- raises from
     * inside the tokenizer, so the parser's own token fields describe the
     * *previous* token at the *current* position: a zero-width token that
     * isn't `eof`, and so isn't a token at all. That state is discarded here
     * rather than reported as a failing token.
     *
     * @returns The failing token, or `undefined` if the failure was at a
     * character that isn't part of any token.
     */
    failingToken(): FailureToken | undefined {
        if (this.parserState !== undefined) {
            const { type, value, start, end } = this.parserState;
            if (end > start || type.label === "eof") {
                return {
                    label: type.label,
                    value,
                    start,
                    end,
                    text: this.text.slice(start, end),
                };
            }
        }

        const token = this.tokens().find((t) => t.end > this.pos);
        if (token !== undefined) return this.toFailureToken(token);

        return this.isAtEof()
            ? {
                  label: "eof",
                  value: undefined,
                  start: this.text.length,
                  end: this.text.length,
                  text: "",
              }
            : undefined;
    }

    /**
     * The token immediately before the failure.
     *
     * When the parser state is present it says which token it last consumed
     * (`lastTokEnd`), which is more reliable than picking the last token
     * before `pos`: Acorn's call sites pass `this.pos`, `this.lastTokEnd`, and
     * `node.start` to `raise`, so `pos` is not always a token boundary.
     *
     * @returns The preceding token, or `undefined` if the parse failed at the
     * first token.
     */
    tokenBefore(): FailureToken | undefined {
        const lastTokEnd = this.parserState?.lastTokEnd;
        if (lastTokEnd !== undefined) {
            const token = this.tokens().find((t) => t.end === lastTokEnd);
            return token === undefined ? undefined : this.toFailureToken(token);
        }

        const before = this.tokensBeforeFailure();
        const token = before[before.length - 1];
        return token === undefined ? undefined : this.toFailureToken(token);
    }

    /**
     * The innermost delimiter still open when the parse failed.
     *
     * Positions come from the token stream, since Acorn's `context` stack
     * carries labels but no offsets. The parser state, when present, decides
     * whether a delimiter is genuinely still open: Acorn updates its context
     * as it *reads* each token, so a delimiter it has already matched --
     * `{a: }`, which fails at the closing brace -- is gone from the context
     * even though the token scan, which stops short of the failure, still
     * shows it open. Correlation is by delimiter label, innermost first;
     * token-stack entries the parser no longer shows open are skipped.
     *
     * @returns The innermost open delimiter, or `undefined` if none is open.
     */
    unclosedDelimiter(): OpenDelimiter | undefined {
        const stack = this.openDelimiterStack();
        if (this.parserState === undefined) {
            return stack[stack.length - 1];
        }

        // Frame 0 is the implicit context Acorn pushes before it reads
        // anything, not a delimiter anyone wrote. Template frames are dropped
        // too: they have no counterpart in the delimiter stack, so treating
        // one as the innermost open delimiter would veto every entry the
        // token scan found -- an unterminated template inside a call would
        // hide the call's own unclosed paren.
        const openFrames = this.parserState.context
            .slice(1)
            .filter((token) => contextTrackedDelimiters.has(token));
        const innermostFrame = openFrames[openFrames.length - 1];

        for (let i = stack.length - 1; i >= 0; i--) {
            const delimiter = stack[i];
            // `[` never reaches Acorn's context stack, so the token scan is
            // the only witness it has and there's nothing to corroborate.
            if (!contextTrackedDelimiters.has(delimiter.open)) return delimiter;
            if (delimiter.open === innermostFrame) return delimiter;
            // The parser has matched this one already; look further out.
        }

        return undefined;
    }

    /**
     * Whether the parse failed because the text ran out.
     *
     * @returns True if the failure is at end of input.
     */
    isAtEof(): boolean {
        if (this.parserState !== undefined) {
            return this.parserState.type.label === "eof";
        }
        return this.pos >= this.text.length;
    }

    /**
     * The source text preceding the failure.
     *
     * @returns Everything in `text` before the failure position.
     */
    textBefore(): string {
        return this.text.slice(0, this.pos);
    }

    /**
     * The last line with content before the failure, truncated at the failure
     * position -- the window the pattern-matching rules look at.
     *
     * @returns The line's text and the offset at which it begins.
     */
    lineBefore(): SourceLine {
        const before = this.textBefore();
        const lines = [...before.matchAll(/(?<=^|\n).*?(?=\r?\n|$)/dg)];
        if (lines.length === 0) return { text: "", start: 0 };

        let ndx = lines.length - 1;
        while (ndx > 0 && /^\s*$/.test(lines[ndx][0])) {
            ndx--;
        }

        return {
            text: lines[ndx][0],
            start: lines[ndx].indices?.at(0)?.at(0) ?? 0,
        };
    }

    /**
     * The token stream for the whole text, tokenized on first use.
     */
    private tokens(): acorn.Token[] {
        if (this.tokenCache === undefined) {
            this.tokenCache = tokenize(this.text);
        }
        return this.tokenCache;
    }

    /**
     * The tokens that precede the failure.
     *
     * Tokens at or after the failure position are unreliable: Acorn stopped
     * parsing there, and the tokenizer can itself go wrong past that point.
     */
    private tokensBeforeFailure(): acorn.Token[] {
        return this.tokens().filter((t) => t.start < this.pos);
    }

    /**
     * The delimiters open at the failure, outermost first, according to the
     * token stream alone.
     */
    private openDelimiterStack(): OpenDelimiter[] {
        const stack: OpenDelimiter[] = [];

        for (const token of this.tokensBeforeFailure()) {
            const label = token.type.label;
            if (openers.has(label)) {
                stack.push({
                    open: label,
                    close: closerFor[label],
                    start: token.start,
                    end: token.end,
                });
            } else if (closers.has(label)) {
                // A close that doesn't match its opener isn't a close of
                // anything; leaving the opener on the stack is what lets the
                // mismatched-delimiter case be recognized later.
                const top = stack[stack.length - 1];
                if (top !== undefined && top.close === label) stack.pop();
            }
        }

        return stack;
    }

    private toFailureToken(token: acorn.Token): FailureToken {
        return {
            label: token.type.label,
            // Acorn's tokens carry a `value` at runtime, but its `Token`
            // declaration (`acorn.d.ts:889`) omits it.
            value: (token as acorn.Token & { value?: unknown }).value,
            start: token.start,
            end: token.end,
            text: this.text.slice(token.start, token.end),
        };
    }
}
