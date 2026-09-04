import { expect } from "chai";
import "mocha";

import { dejargon } from "../acorn-errors/dejargon";

/**
 * Three of the table's entries -- "Binding rvalue", "Binding parenthesized
 * expression", and "Binding member expression" -- are messages Acorn's
 * grammar can't actually produce through this codebase's parse entry points
 * (see the comments in `dejargon.ts`), so they can't get a row in
 * `acorn-errors.test.ts`'s parse-driven corpus. They, and every other entry,
 * still get a direct unit test of the rewrite here.
 */
describe("dejargon", () => {
    it("should leave a message with no matching entry unchanged", () => {
        expect(dejargon("Some message Acorn never actually sends")).to.equal(
            "Some message Acorn never actually sends",
        );
    });

    it("should rewrite 'Assigning to rvalue'", () => {
        expect(dejargon("Assigning to rvalue")).to.equal(
            "Invalid assignment target",
        );
    });

    it("should rewrite 'Binding rvalue'", () => {
        expect(dejargon("Binding rvalue")).to.equal(
            "Invalid destructuring target",
        );
    });

    it("should rewrite 'Binding parenthesized expression'", () => {
        expect(dejargon("Binding parenthesized expression")).to.equal(
            "Parenthesized expression can't be a destructuring target",
        );
    });

    it("should rewrite 'Binding member expression'", () => {
        expect(dejargon("Binding member expression")).to.equal(
            "Member expression can't be a destructuring target",
        );
    });

    it("should rewrite 'Parenthesized pattern'", () => {
        expect(dejargon("Parenthesized pattern")).to.equal(
            "Parenthesized expression can't be a destructuring target",
        );
    });

    it("should rewrite the shorthand property assignment message", () => {
        expect(
            dejargon(
                "Shorthand property assignments are valid only in destructuring patterns",
            ),
        ).to.equal(
            "Shorthand property assignment is only valid in a destructuring pattern",
        );
    });

    it("should rewrite the complex binding pattern message", () => {
        expect(
            dejargon(
                "Complex binding patterns require an initialization value",
            ),
        ).to.equal("Destructuring pattern needs an initial value");
    });

    it("should rewrite the rest-element-comma message", () => {
        expect(
            dejargon("Comma is not permitted after the rest element"),
        ).to.equal("A rest element can't be followed by a comma");
    });

    it("should rewrite the rest-element-default-value message", () => {
        expect(dejargon("Rest elements cannot have a default value")).to.equal(
            "A rest element can't have a default value",
        );
    });

    it("should rewrite the setter-rest-params message", () => {
        expect(dejargon("Setter cannot use rest params")).to.equal(
            "A setter can't use rest parameters",
        );
    });

    it("should rewrite 'Unsyntactic break', keeping the keyword", () => {
        expect(dejargon("Unsyntactic break")).to.equal(
            "Invalid 'break': no enclosing loop or switch",
        );
    });

    it("should rewrite 'Unsyntactic continue', keeping the keyword", () => {
        expect(dejargon("Unsyntactic continue")).to.equal(
            "Invalid 'continue': no enclosing loop or switch",
        );
    });

    it("should rewrite the mixed logical/coalesce message", () => {
        expect(
            dejargon(
                "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses",
            ),
        ).to.equal(
            "Mixing '??' with '&&' or '||' needs parentheses around one of them",
        );
    });

    it("should rewrite the '__proto__' redefinition message", () => {
        expect(dejargon("Redefinition of __proto__ property")).to.equal(
            "Duplicate '__proto__' property",
        );
    });

    it("should rewrite the object-pattern-getter-or-setter message", () => {
        expect(
            dejargon("Object pattern can't contain getter or setter"),
        ).to.equal("A destructuring pattern can't contain a getter or setter");
    });

    it("should rewrite the optional-chaining-in-left-hand-side message", () => {
        expect(
            dejargon("Optional chaining cannot appear in left-hand side"),
        ).to.equal("'?.' can't appear on the left side of an assignment");
    });

    it("should rewrite the optional-chaining-before-new message", () => {
        expect(
            dejargon(
                "Optional chaining cannot appear in the callee of new expressions",
            ),
        ).to.equal("'?.' can't appear before 'new'");
    });

    it("should rewrite the optional-chaining-before-tagged-template message", () => {
        expect(
            dejargon(
                "Optional chaining cannot appear in the tag of tagged template expressions",
            ),
        ).to.equal("'?.' can't appear before a tagged template");
    });

    it("should rewrite the escape-sequence-in-keyword message, keeping the keyword", () => {
        expect(dejargon("Escape sequence in keyword if")).to.equal(
            "Invalid escape sequence in the keyword 'if'",
        );
    });

    it("should rewrite the non-simple-parameter-list 'use strict' message", () => {
        expect(
            dejargon(
                "Illegal 'use strict' directive in function with non-simple parameter list",
            ),
        ).to.equal(
            "'use strict' can't be used with default, rest, or destructured parameters",
        );
    });

    it("should rewrite the argument-name-clash message", () => {
        expect(dejargon("Argument name clash")).to.equal(
            "Duplicate parameter name",
        );
    });

    it("should rewrite the identifier-after-number message", () => {
        expect(dejargon("Identifier directly after number")).to.equal(
            "Missing space between a number and the following identifier",
        );
    });

    it("should rewrite the invalid-use-of-super message", () => {
        expect(dejargon("Invalid use of 'super'")).to.equal(
            "'new' can't be used with 'super'",
        );
    });
});
