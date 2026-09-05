import { dejargon } from "./dejargon";
import { ParseFailure } from "./parse-failure";
import type { ErrorWithParserState } from "./parser-state";
import {
    fallbackImprovement,
    rules,
    unclosedDelimiterRule,
    unknownImprovement,
    unterminatedStringRule,
} from "./rules";
import type { Improvement } from "./rules";

/**
 * A `SyntaxError` as Acorn throws it: the standard message plus the position
 * fields Acorn attaches, and (when the parse went through `ParserWithState`)
 * the captured parser state.
 */
export type AcornSyntaxError = ErrorWithParserState & {
    pos?: number;
    loc?: {
        line: number;
        column: number;
    };
    raisedAt?: number;
};

/**
 * Acorn messages that say only that something went wrong, without saying what.
 *
 * These are the ones worth improving, and the only ones the rules run against:
 * every other Acorn message already names a specific problem, and `dejargon`
 * rewrites the hostile ones. Letting rules loose on those would replace an
 * accurate message with a guess.
 */
function isGenericMessage(message: string): boolean {
    return (
        message.startsWith("Unexpected token") ||
        message.startsWith("Unexpected character") ||
        message.startsWith("Unexpected keyword") ||
        message.includes("Unexpected token")
    );
}

/**
 * Choose among the rules that matched.
 *
 * Acorn's reported position is the one piece of ground truth available, so the
 * winner is the candidate closest to it without being past it -- an objective
 * arbiter that doesn't ask every future rule author to invent and calibrate a
 * confidence score against rules they've never read. Rule order breaks ties.
 *
 * @param candidates Improvements proposed by the rules, in rule order.
 * @param pos Position Acorn reported the failure at.
 * @returns The winning improvement, or `undefined` if there are no candidates.
 */
function arbitrate(
    candidates: Improvement[],
    pos: number,
): Improvement | undefined {
    // A rule shouldn't report a position past the failure, since every rule
    // recognizes something Acorn had already read. If one does, it's still
    // better than nothing, so it's considered only when nothing else is.
    const atOrBefore = candidates.filter((c) => c.start <= pos);
    const eligible = atOrBefore.length > 0 ? atOrBefore : candidates;

    let winner: Improvement | undefined;
    for (const candidate of eligible) {
        // `<`, not `<=`, so that an equal distance leaves the earlier -- and
        // therefore higher-priority -- rule in place.
        if (
            winner === undefined ||
            Math.abs(candidate.start - pos) < Math.abs(winner.start - pos)
        ) {
            winner = candidate;
        }
    }

    return winner;
}

/**
 * Improve Acorn's not-that-great error messages.
 *
 * @param text Text containing the error.
 * @param err Error as reported by Acorn.
 * @param offset Document offset at which `text` begins, used to rebase the
 * returned span into document-relative coordinates.
 * @returns Updated diagnostic, with a document-relative span.
 */
export function improveAcornErrorMessage(
    text: string,
    err: AcornSyntaxError,
    offset = 0,
): {
    start: number;
    end: number;
    message: string;
} {
    const failure = new ParseFailure(text, err);

    // Every return rebases the span by `offset` in one place, so there's never
    // a moment where only part of a diagnostic's position has been rebased.
    const toResult = (improvement: Improvement) => ({
        start: improvement.start + offset,
        end: improvement.end + offset,
        message: improvement.message,
    });

    // Unterminated strings and templates come first and stay special-cased:
    // they're lexical failures, so there's no parser state to arbitrate over.
    const unterminated = unterminatedStringRule(failure);
    if (unterminated !== undefined) return toResult(unterminated);

    if (!isGenericMessage(failure.message)) {
        return toResult(
            fallbackImprovement(failure, dejargon(failure.message)),
        );
    }

    const candidates: Improvement[] = [];
    let unclosedDelimiterCandidate: Improvement | undefined;
    for (const rule of rules) {
        const improvement = rule(failure);
        if (improvement === undefined) continue;
        if (rule === unclosedDelimiterRule) {
            unclosedDelimiterCandidate = improvement;
        }
        candidates.push(improvement);
    }

    // The one hard-wired precedence. At end of input Acorn's position means
    // only "the text ran out": it carries no signal about where the problem
    // is, so measuring distance to it would measure nothing. An open delimiter
    // does say where the problem is, so it wins outright.
    if (failure.isAtEof() && unclosedDelimiterCandidate !== undefined) {
        return toResult(unclosedDelimiterCandidate);
    }

    const winner = arbitrate(candidates, failure.pos);
    return toResult(
        winner ?? unknownImprovement(failure, failure.failingToken()),
    );
}
