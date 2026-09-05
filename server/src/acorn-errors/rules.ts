import type { FailureToken, ParseFailure } from "./parse-failure";

/**
 * The kind of mistake a rule recognizes.
 *
 * Internal on purpose. It is deliberately *not* a `DiagnosticCode`: codes are
 * user-disableable, and a per-error taxonomy would hand authors a menu for
 * silencing individual syntax errors one at a time. It exists so a later
 * quick-fix effort has something to dispatch on, and so the rule inventory --
 * and with it the coverage gaps -- is legible in one place.
 */
export type ImprovementKind =
    | "unterminated-string"
    | "unclosed-delimiter"
    | "mismatched-delimiter"
    | "missing-property"
    | "incomplete-expression"
    | "missing-property-value"
    | "missing-control-parens"
    | "missing-catch-block"
    | "unknown";

/**
 * A diagnostic a rule proposes, in coordinates relative to the text that was
 * parsed.
 */
export interface Improvement {
    kind: ImprovementKind;
    /** Start of the text the diagnostic refers to. */
    start: number;
    /** End of the text the diagnostic refers to. */
    end: number;
    message: string;
}

/**
 * A rule: a pure function that recognizes one shape of mistake in a parse
 * failure context, or declines by returning `undefined`.
 *
 * Rules only ask the context questions. They never walk Acorn's tokens or
 * parser state, and they never look at the raw source text except through what
 * the context hands them.
 */
export type Rule = (failure: ParseFailure) => Improvement | undefined;

const endOfUnterminatedStringRegex = /(\\?)(?:\r?\n|$)/g;

/**
 * Extract an unterminated JavaScript string or template.
 *
 * @param text Text containing the unterminated string.
 * @param startIndex Index where the unterminated string begins.
 * @returns The unterminated string.
 */
function extractUnterminatedString(text: string, startIndex: number): string {
    let lineEnd = text.length - 1; // Default to the end of the excerpt
    let m: RegExpExecArray | null;

    endOfUnterminatedStringRegex.lastIndex = startIndex;
    do {
        m = endOfUnterminatedStringRegex.exec(text);
        // Go to the end of the line (if there's no line continuation char)
        if (m && m[1] !== "\\") {
            lineEnd = endOfUnterminatedStringRegex.lastIndex;
            break;
        }
    } while (m);

    return text.slice(startIndex, lineEnd);
}

/**
 * A string or template literal that never ends.
 *
 * This one is special-cased ahead of every other rule (see `index.ts`) because
 * it's a *lexical* failure: Acorn raises from inside the tokenizer, so there's
 * no coherent parser state to arbitrate over and no token stream past the
 * opening quote. The span has to come from the source text itself.
 */
export const unterminatedStringRule: Rule = (failure) => {
    if (
        !failure.message.startsWith("Unterminated string constant") &&
        !failure.message.startsWith("Unterminated template")
    ) {
        return undefined;
    }

    const contents = extractUnterminatedString(failure.text, failure.pos);
    return {
        kind: "unterminated-string",
        start: failure.pos,
        end: failure.pos + contents.length,
        message: failure.message,
    };
};

/**
 * An opening delimiter that never gets closed.
 *
 * Exported by name because arbitration (`index.ts`) has one hard-wired
 * precedence that needs to identify this rule's verdict.
 */
export const unclosedDelimiterRule: Rule = (failure) => {
    const open = failure.unclosedDelimiter();
    if (open === undefined) return undefined;

    return {
        kind: "unclosed-delimiter",
        start: open.start,
        end: open.end,
        message: `Opening '${open.open}' is missing a matching '${open.close}'`,
    };
};

/**
 * A closing delimiter that doesn't match the one it closes: `(]`.
 */
const mismatchedDelimiterRule: Rule = (failure) => {
    const mismatch = failure.mismatchedCloser();
    if (mismatch === undefined) return undefined;

    const { open, closer } = mismatch;
    return {
        kind: "mismatched-delimiter",
        start: closer.start,
        end: closer.end,
        message: `Opening '${open.open}' is closed by '${closer.text}' instead of '${open.close}'`,
    };
};

/**
 * A property access with no property after it: `foo.` or `foo?.`.
 */
const missingPropertyRule: Rule = (failure) => {
    const before = failure.tokenBefore();
    if (before === undefined) return undefined;

    // Acorn reads `?.` as one token, except when the text ends right after it
    // -- then it splits into `?` and `.`, and the `.` is what the parse fails
    // on.
    const failing = failure.failingToken();
    if (
        failing?.label === "." &&
        before.label === "?" &&
        before.end === failing.start
    ) {
        return optionalChainImprovement(before.start, failing.end);
    }

    if (before.label === "?.") {
        return optionalChainImprovement(before.start, before.end);
    }

    if (before.label === ".") {
        return {
            kind: "missing-property",
            start: before.start,
            end: before.end,
            message: "Missing property or method name after '.'",
        };
    }

    return undefined;
};

function optionalChainImprovement(start: number, end: number): Improvement {
    return {
        kind: "missing-property",
        start,
        end,
        message: "Missing property, method, or call after '?.'",
    };
}

/**
 * A property with a name and a colon but no value: `{foo: }`.
 */
const missingPropertyValueRule: Rule = (failure) => {
    const before = failure.tokenBefore();
    if (before?.label !== ":") return undefined;

    return {
        kind: "missing-property-value",
        start: before.start,
        end: before.end,
        message: "Missing value after ':'",
    };
};

/**
 * Token labels for the operators that can't end an expression.
 *
 * Acorn's labels aren't the operator's source text -- one label covers a
 * family (`"+/-"`, `"==/!=/===/!=="`) -- so the message uses the token's text
 * and the label is only used to recognize it. `.`, `?.`, and `:` are absent:
 * they have rules of their own that name the missing piece more precisely.
 */
const incompleteExpressionLabels = new Set([
    "+/-",
    "*",
    "/",
    "%",
    "**",
    "==/!=/===/!==",
    "</>/<=/>=",
    "<</>>/>>>",
    "&&",
    "||",
    "??",
    "|",
    "^",
    "&",
    "=",
    "_=",
    "!/~",
    "?",
    "=>",
    "in",
    "instanceof",
]);

/**
 * An expression that stops after an operator: `foo +`.
 */
const incompleteExpressionRule: Rule = (failure) => {
    const before = failure.tokenBefore();
    if (before === undefined || !incompleteExpressionLabels.has(before.label)) {
        return undefined;
    }

    return {
        kind: "incomplete-expression",
        start: before.start,
        end: before.end,
        message: `Incomplete expression after the operator '${before.text}'`,
    };
};

const controlKeywords = new Set(["if", "for", "while", "switch"]);

/**
 * A control statement whose condition parentheses are missing: `if x`.
 */
const missingControlParensRule: Rule = (failure) => {
    const before = failure.tokenBefore();
    if (before === undefined || !controlKeywords.has(before.label)) {
        return undefined;
    }

    return {
        kind: "missing-control-parens",
        start: before.start,
        end: before.end,
        message: `Missing '(' after '${before.text}'`,
    };
};

/**
 * A `catch` with no block after it, with or without a binding: `catch` or
 * `catch (e)`.
 */
const missingCatchBlockRule: Rule = (failure) => {
    const before = failure.tokenBefore();
    if (before?.label === "catch") {
        return missingCatchBlockImprovement(before);
    }

    const beforeBinding = failure.tokenBeforeMatchedOpener();
    if (beforeBinding?.label === "catch") {
        return missingCatchBlockImprovement(beforeBinding);
    }

    return undefined;
};

function missingCatchBlockImprovement(keyword: FailureToken): Improvement {
    return {
        kind: "missing-catch-block",
        start: keyword.start,
        end: keyword.end,
        message: "Missing '{' after 'catch'",
    };
}

/**
 * Every rule the arbiter (`index.ts`) considers, in priority order.
 *
 * Priority is only the *tiebreak*: arbitration goes by proximity to Acorn's
 * reported position first, and consults this order only when two rules propose
 * the same position. More specific rules therefore come first, so that a rule
 * naming the exact missing piece beats one that only knows an operator is
 * dangling.
 *
 * `unterminatedStringRule` is not in this list; it's special-cased ahead of
 * arbitration entirely.
 */
export const rules: readonly Rule[] = [
    mismatchedDelimiterRule,
    unclosedDelimiterRule,
    missingPropertyRule,
    missingPropertyValueRule,
    missingControlParensRule,
    missingCatchBlockRule,
    incompleteExpressionRule,
];

/**
 * What to report when nothing recognized the failure: the message as-is over
 * the context's fallback span.
 *
 * Both ends of the generic/non-generic split in `index.ts` land here, so the
 * "no rule matched" shape is built in one place.
 *
 * @param failure The parse failure context.
 * @param message The message to report.
 * @returns The improvement.
 */
export function fallbackImprovement(
    failure: ParseFailure,
    message: string,
): Improvement {
    return {
        kind: "unknown",
        ...failure.fallbackSpan(),
        message,
    };
}

/**
 * What to report when no rule matched.
 *
 * Acorn's generic messages name no token at all -- a bare `Unexpected token`
 * tells an author nothing about *which* token. Appending the offending source
 * text is what espree does in its own `unexpected` override, and it costs
 * nothing: the failing token is already in the context.
 *
 * @param failure The parse failure context.
 * @param token The failing token, if there is one.
 * @returns The fallback improvement.
 */
export function unknownImprovement(
    failure: ParseFailure,
    token: FailureToken | undefined,
): Improvement {
    let message = failure.message;

    if (message === "Unexpected token") {
        if (token?.label === "eof") {
            message = "Unexpected end of input";
        } else if (token !== undefined && token.text !== "") {
            message = `Unexpected token '${token.text}'`;
        }
    }

    return fallbackImprovement(failure, message);
}
