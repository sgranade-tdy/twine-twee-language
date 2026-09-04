/**
 * Rewrite table for Acorn's jargon-heavy messages.
 *
 * These messages are accurate but meaningless to a Twine author: they need
 * no parser context, no tokens, no AST, just a plain-language replacement
 * for the raw text. They never reach the generic `Unexpected token` path
 * that `rules.ts` (and, before this module existed, the ad hoc regexes in
 * `index.ts`) key off, so a rewrite table is the only lever available to
 * improve them.
 *
 * Entries are tried in order. An `"exact"` entry matches the message text
 * literally. A `"regex"` entry matches with a pattern and builds the
 * replacement from the match, for messages that carry an interpolated value
 * (a keyword, an identifier) that must survive into the rewritten text.
 */

interface ExactDejargonEntry {
    kind: "exact";
    pattern: string;
    replacement: string;
}

interface RegexDejargonEntry {
    kind: "regex";
    pattern: RegExp;
    replacement: (match: RegExpExecArray) => string;
}

type DejargonEntry = ExactDejargonEntry | RegexDejargonEntry;

const table: DejargonEntry[] = [
    // `checkLValSimple`'s `default:` case at acorn.js:2418 and the shared
    // `default:` at acorn.js:2214 both raise a message built from
    // `(isBind ? "Binding" : "Assigning to") + " rvalue"`. In practice
    // `toAssignable` (acorn.js:2141-2210) intercepts every convertible
    // pattern shape and raises "Assigning to rvalue" itself before
    // `checkLValSimple` ever runs with `isBind` true, so "Binding rvalue"
    // is not reachable through this codebase's parse entry points -- kept
    // here anyway, since Acorn's message catalog isn't ours to prune.
    {
        kind: "exact",
        pattern: "Assigning to rvalue",
        replacement: "Invalid assignment target",
    },
    {
        kind: "exact",
        pattern: "Binding rvalue",
        replacement: "Invalid destructuring target",
    },
    // Also unreachable without `preserveParens: true` (this codebase does
    // not set it): `toAssignable` never sees a `ParenthesizedExpression`
    // node, so `checkLValSimple`'s `ParenthesizedExpression` case at
    // acorn.js:2414 cannot fire.
    {
        kind: "exact",
        pattern: "Binding parenthesized expression",
        replacement: "Parenthesized expression can't be a destructuring target",
    },
    // Reachable via `checkLValSimple`'s `MemberExpression` case at
    // acorn.js:2409-2411, but only when `isBind` is true, which -- as
    // above -- requires a path this codebase's grammar doesn't reach.
    {
        kind: "exact",
        pattern: "Binding member expression",
        replacement: "Member expression can't be a destructuring target",
    },
    // Reachable: `((a), b) => a` -- an arrow parameter list containing a
    // doubly-parenthesized name.
    {
        kind: "exact",
        pattern: "Parenthesized pattern",
        replacement: "Parenthesized expression can't be a destructuring target",
    },
    // Reachable: `({a = 1})`.
    {
        kind: "exact",
        pattern:
            "Shorthand property assignments are valid only in destructuring patterns",
        replacement:
            "Shorthand property assignment is only valid in a destructuring pattern",
    },
    // Reachable: `let {a} = {}, {b}` -- the second declarator's pattern has
    // no initializer.
    {
        kind: "exact",
        pattern: "Complex binding patterns require an initialization value",
        replacement: "Destructuring pattern needs an initial value",
    },
    // Reachable: `let [a, ...b,] = []`.
    {
        kind: "exact",
        pattern: "Comma is not permitted after the rest element",
        replacement: "A rest element can't be followed by a comma",
    },
    // Reachable: `([...a = []] = [])`.
    {
        kind: "exact",
        pattern: "Rest elements cannot have a default value",
        replacement: "A rest element can't have a default value",
    },
    // Reachable: `let obj = {set a(...args) {}}`.
    {
        kind: "exact",
        pattern: "Setter cannot use rest params",
        replacement: "A setter can't use rest parameters",
    },
    // Reachable: bare `break` / `continue` with no enclosing loop, switch,
    // or label. `keyword` (acorn.js:1117) is always literally "break" or
    // "continue".
    {
        kind: "regex",
        pattern: /^Unsyntactic (break|continue)$/,
        replacement: (m) => `Invalid '${m[1]}': no enclosing loop or switch`,
    },
    // Reachable: `a ?? b || c`.
    {
        kind: "exact",
        pattern:
            "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses",
        replacement:
            "Mixing '??' with '&&' or '||' needs parentheses around one of them",
    },
    // Reachable: `({__proto__: 1, __proto__: 2})`.
    {
        kind: "exact",
        pattern: "Redefinition of __proto__ property",
        replacement: "Duplicate '__proto__' property",
    },
    // Reachable: `({get a() {}} = {})` -- a getter used as a destructuring
    // assignment target.
    {
        kind: "exact",
        pattern: "Object pattern can't contain getter or setter",
        replacement: "A destructuring pattern can't contain a getter or setter",
    },
    // Reachable: `a?.b = 1`.
    {
        kind: "exact",
        pattern: "Optional chaining cannot appear in left-hand side",
        replacement: "'?.' can't appear on the left side of an assignment",
    },
    // Reachable: `new a?.b()`.
    {
        kind: "exact",
        pattern:
            "Optional chaining cannot appear in the callee of new expressions",
        replacement: "'?.' can't appear before 'new'",
    },
    // Reachable: `` a?.b`template` ``.
    {
        kind: "exact",
        pattern:
            "Optional chaining cannot appear in the tag of tagged template expressions",
        replacement: "'?.' can't appear before a tagged template",
    },
    // Reachable: an escaped character inside a keyword, e.g. the source
    // `\u0069f (1) {}` (an escaped "if"). `this.type.keyword` is
    // interpolated, so the rewrite has to preserve it.
    {
        kind: "regex",
        pattern: /^Escape sequence in keyword (.+)$/,
        replacement: (m) => `Invalid escape sequence in the keyword '${m[1]}'`,
    },
    // Reachable: `function f() { 'use strict'; }` where `f`'s parameter
    // list isn't a plain list of simple names (default, rest, or
    // destructured parameters).
    {
        kind: "exact",
        pattern:
            "Illegal 'use strict' directive in function with non-simple parameter list",
        replacement:
            "'use strict' can't be used with default, rest, or destructured parameters",
    },
    // Reachable: `function f(a, a) { 'use strict'; }`.
    {
        kind: "exact",
        pattern: "Argument name clash",
        replacement: "Duplicate parameter name",
    },
    // Reachable: `1identifier`.
    {
        kind: "exact",
        pattern: "Identifier directly after number",
        replacement:
            "Missing space between a number and the following identifier",
    },
    // Reachable: `new super()` inside a method that is not a subclass
    // constructor -- the only path that reaches this specific check rather
    // than the generic "'super' keyword outside a method" one. The fault
    // here is pairing `super` with `new`, not using `super` outside a
    // method (the parse already got that far).
    {
        kind: "exact",
        pattern: "Invalid use of 'super'",
        replacement: "'new' can't be used with 'super'",
    },
];

/**
 * Rewrite an Acorn message using the dejargon table, or return it unchanged
 * if no entry matches.
 *
 * @param message Acorn's message, with any trailing "(line, column)"
 * location already stripped.
 */
export function dejargon(message: string): string {
    for (const entry of table) {
        if (entry.kind === "exact") {
            if (message === entry.pattern) {
                return entry.replacement;
            }
        } else {
            const m = entry.pattern.exec(message);
            if (m) {
                return entry.replacement(m);
            }
        }
    }

    return message;
}
