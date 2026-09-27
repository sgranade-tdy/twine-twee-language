import * as acorn from "acorn";
import * as acornLoose from "acorn-loose";
import * as acornWalk from "acorn-walk";
import { DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { improveAcornErrorMessage } from "./acorn-errors";
import { ParserWithState } from "./acorn-errors/parser-state";
import { createLocationFor } from "./parser";
import {
    StoryFormatParsingState,
    capturePreSemanticTokenFor,
} from "./passage-text-parsers";
import { Label } from "./project-index";
import { ETokenType, TokenModifier, TokenType } from "./semantic-tokens";

/**
 * The ECMA version we're going to parse with.
 */
export const EcmaVersion: acorn.ecmaVersion = 2020;

/**
 * Conversion from Javascript typeof string to semantic token type.
 */
const typeofToSemantic: Record<string, TokenType> = {
    string: ETokenType.string,
    number: ETokenType.number,
    boolean: ETokenType.keyword,
};


/**
 * Label for a parsed javascript variable.
 */
export interface JSVariableLabel extends Label {
    /**
     * Whether the variable is being defined.
     */
    defined?: boolean;
}

/**
 * Label for a parsed javascript property.
 */
export interface JSPropertyLabel extends Label {
    /**
     * The property's prefix, if known. A reference for `subprop` from `var.prop.subprop` will
     * have a prefix of `var.prop`.
     */
    prefix?: string;
    /**
     * Whether the property is being defined.
     */
    defined?: boolean;
}

export namespace JSPropertyLabel {
    /**
     * Type guard for JSPropertyLabel.
     */
    export function is(val: unknown): val is JSPropertyLabel {
        if (typeof val !== "object" || Array.isArray(val) || val === null)
            return false;
        return (
            (val as JSPropertyLabel).contents !== undefined &&
            (val as JSPropertyLabel).location !== undefined &&
            ((val as JSPropertyLabel).prefix !== undefined ||
                (val as JSPropertyLabel).defined !== undefined)
        );
    }
}

/**
 * Errors from javascript parsing.
 */
export interface JSDiagnostic {
    /**
     * Start index in the document where the diagnostic occurs.
     */
    start: number;
    /**
     * End index in the document where the diagnostic occurs.
     */
    end: number;
    message: string;
    severity: DiagnosticSeverity;
}

/**
 * Results of tokenizing JavaScript
 */
export interface TokenizedJS {
    variables: JSVariableLabel[];
    properties: JSPropertyLabel[];
    error?: JSDiagnostic;
}


const builtInObjects = new Set([
    // Taken from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects
    "Object",
    "Function",
    "Boolean",
    "Symbol",
    "Error",
    "Number",
    "BigInt",
    "Math",
    "Date",
    "Temporal",
    "String",
    "Array",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "ArrayBuffer",
    "SharedArrayBuffer",
    "DataView",
    "Atomics",
    "JSON",
    "WeakRef",
    "FinalizationRegistry",
    "Iterator",
    "AsyncIterator",
    "Promise",
    "GeneratorFunction",
    "AsyncGeneratorFunction",
    "Generator",
    "AsyncGenerator",
    "AsyncFunction",
    "DisposableStack",
    "AsyncDisposableStack",
    "Reflect",
    "Proxy",
    "Intl",
    // These next are actually keywords
    "undefined",
    "null,",
    // Commonly-referred-to API objects
    "console",
    "document",
    "window",
]);

// This is hacky, but we're going to ignore root properties whose names
// match static properties of built-in objects' instances.
// Taken from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects
const builtInJSObjectInstanceProperties = new Set([
    "prototype", // Object
    "arguments", // Function
    "caller", // Function
    "length", // Function, String, Array
    "name", // Function, Error
    "description", // Symbol
    "cause", // Error
    "message", // Error
    "dotAll", // RegExp
    "flags", // RegExp
    "global", // RegExp
    "hasIndices", // RegExp
    "ignoreCase", // RegExp
    "multiline", // RegExp
    "source", // RegExp
    "sticky", // RegExp
    "unicode", // RegExp
    "unicodeSets", // RegExp
    "lastIndex", // RegExp
    "size", // Map
    "byteLength", // ArrayBuffer, SharedArrayBuffer, DataView
    "detached", // ArrayBuffer
    "maxByteLength", // ArrayBuffer, SharedArrayBuffer
    "resizable", // ArrayBuffer
    "growable", // SharedArrayBuffer
    "buffer", // DataView
    "byteOffset", // DataView
    "disposed", // DisposableStack, AsyncDisposableStack
]);

/**
 * Scope in which identifiers will be found and bound.
 */
interface Scope {
    type: "global" | "function" | "block";
    parent?: Scope;
    bindings: Set<string>;
}

/**
 * Add scope information to an Acorn identifier.
 */
interface ScopedIdentifier extends acorn.Identifier {
    _isDefinition?: boolean;
    _scopeType?: "global" | "function" | "block";
}

/**
 * Create a scope.
 *
 * @param type Type of scope to create.
 * @param parent The new scope's parent, if any.
 */
function createScope(type: Scope["type"], parent?: Scope): Scope {
    return {
        type,
        parent,
        bindings: new Set(),
    };
}

/**
 * Get the function (or global) scope that contains a block.
 */
function nearestFunctionScope(scope: Scope): Scope {
    let current = scope;

    while (current.type === "block") {
        current = current.parent!; // Blocks should always have parents
    }

    return current;
}

/**
 * Bind a declared identifier.
 *
 * @param scope Scope in which to declare the binding.
 * @param name Identifier name.
 * @param kind Kind of binding.
 * @returns Scope to which the identifier was bound.
 */
function bindIdentifier(
    scope: Scope,
    name: string,
    kind:
        | "var"
        | "let"
        | "const"
        | "param"
        | "function"
        | "using"
        | "await using",
): Scope {
    const target = kind === "var" ? nearestFunctionScope(scope) : scope;

    target.bindings.add(name);

    return target;
}

/**
 * Find the scope to which an identifier is bound.
 *
 * @param scope Scope to start with.
 * @param name Identifier to find.
 * @returns Scope to which the identifier is bound, or undefined if none.
 */
function findBindingScope(scope: Scope, name: string): Scope | undefined {
    let current: Scope | undefined = scope;

    while (current) {
        if (current.bindings.has(name)) {
            return current;
        }

        current = current.parent;
    }

    return undefined;
}

/**
 * Collect identifiers from patterns such as destructuring and function params.
 *
 * @param pattern Pattern to collect identifiers from.
 * @param callback Visitor function to call when an identifier is found.
 */
function collectPatternIdentifiers(
    pattern: acorn.AnyNode,
    callback: (id: acorn.Identifier) => void,
): void {
    switch (pattern.type) {
        case "Identifier":
            callback(pattern as ScopedIdentifier);
            break;

        case "ObjectPattern":
            for (const prop of pattern.properties) {
                if (prop.type === "Property") {
                    collectPatternIdentifiers(
                        prop.value as acorn.AnyNode,
                        callback,
                    );
                } else {
                    collectPatternIdentifiers(
                        prop.argument as acorn.AnyNode,
                        callback,
                    );
                }
            }
            break;

        case "ArrayPattern":
            for (const element of pattern.elements) {
                if (element) {
                    collectPatternIdentifiers(
                        element as acorn.AnyNode,
                        callback,
                    );
                }
            }
            break;

        case "AssignmentPattern":
            collectPatternIdentifiers(pattern.left, callback);
            break;

        case "RestElement":
            collectPatternIdentifiers(pattern.argument, callback);
            break;
    }
}

/**
 * How an identifier functions in the AST: whether it's a declaration
 * (a name being bound, e.g. `var`/`let`/`const`, a function name or
 * parameter, or a `catch` parameter), a reference (an occurrence that reads
 * -- or, if the caller treats assignment as definition, writes -- a bound or
 * unbound name), or neither (a property key, a label, or an import binding,
 * none of which are ever variables).
 *
 * This is the single source of truth for that question. Both the scope-
 * annotating walk (which needs to know whether to bind a name) and the
 * tokenizing/extraction walk (which needs to know whether an identifier is a
 * candidate occurrence at all) consult it instead of re-deriving the answer
 * from ancestor types themselves.
 */
type IdentifierRole = "declaration" | "reference" | "neither";

/**
 * Classify an identifier given its ancestors.
 *
 * @param node Node to classify.
 * @param ancestors Node's ancestors, ending with `node` itself (the
 * acorn-walk `fullAncestor` convention).
 * @returns The identifier's role.
 */
function classifyIdentifier(
    node: acorn.AnyNode,
    ancestors: acorn.Node[],
): IdentifierRole {
    const parent = ancestors[ancestors.length - 2] as acorn.AnyNode | undefined;

    // Consider parent-less identifiers as a reference for times when we just parse the tiniest snippet
    if (!parent) return "reference";

    switch (parent.type) {
        case "VariableDeclarator":
            return parent.id === node ? "declaration" : "reference";

        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
            if (parent.id === node) return "declaration"; // function name
            if (parent.params.includes(node as acorn.Pattern))
                return "declaration"; // parameter
            return "reference";

        case "Property":
            // Static key isn't a reference or a declaration -- it's a property name
            return parent.key === node && !parent.computed
                ? "neither"
                : "reference";

        case "MemberExpression":
            // Non-computed property key -- same reasoning as above
            return parent.property === node && !parent.computed
                ? "neither"
                : "reference";

        case "MethodDefinition":
        case "PropertyDefinition":
            // Non-computed key is a property name, not a variable -- same
            // reasoning as "Property"
            return parent.key === node && !parent.computed
                ? "neither"
                : "reference";

        case "CatchClause":
            return parent.param === node ? "declaration" : "reference";

        case "ClassDeclaration":
        case "ClassExpression":
            return parent.id === node ? "declaration" : "reference";

        case "LabeledStatement":
        case "BreakStatement":
        case "ContinueStatement":
            return "neither"; // a label, not a variable

        case "ImportSpecifier":
        case "ImportDefaultSpecifier":
        case "ImportNamespaceSpecifier":
            return "neither"; // an import binding, not a variable

        default: // Treat all other cases as references
            return "reference";
    }
}

/**
 * Annotate variable definitions or references along with their scope.
 *
 * @param ast AST to annotate.
 */
function annotateVariableScopes(
    ast: acorn.Node,
    assignmentIsDefinition: boolean,
) {
    const globalScope = createScope("global");

    function visit(node: acorn.AnyNode, scope: Scope, ancestors: acorn.Node[]) {
        switch (node.type) {
            case "Program":
            case "BlockStatement": {
                const newScope =
                    node.type === "BlockStatement"
                        ? createScope("block", scope)
                        : scope;
                for (const child of node.body)
                    visit(child, newScope, [...ancestors, child]);
                return;
            }

            case "FunctionDeclaration": {
                if (node.id) {
                    const boundScope = bindIdentifier(
                        scope,
                        node.id.name,
                        "function",
                    );
                    (node.id as ScopedIdentifier)._isDefinition = true;
                    (node.id as ScopedIdentifier)._scopeType = boundScope.type;
                }
                const fnScope = createScope("function", scope);
                for (const param of node.params) {
                    collectPatternIdentifiers(param as acorn.AnyNode, (id) => {
                        bindIdentifier(fnScope, id.name, "param");
                    });
                }
                visit(node.body, fnScope, [...ancestors, node.body]);
                return;
            }

            case "FunctionExpression":
            case "ArrowFunctionExpression": {
                const fnScope = createScope("function", scope);
                for (const param of node.params) {
                    collectPatternIdentifiers(param as acorn.AnyNode, (id) => {
                        bindIdentifier(fnScope, id.name, "param");
                    });
                }
                visit(node.body, fnScope, [...ancestors, node.body]);
                return;
            }

            case "VariableDeclaration": {
                for (const decl of node.declarations) {
                    collectPatternIdentifiers(
                        decl.id as acorn.AnyNode,
                        (id) => {
                            const boundScope = bindIdentifier(
                                scope,
                                id.name,
                                node.kind,
                            );
                            (id as ScopedIdentifier)._isDefinition = true;
                            (id as ScopedIdentifier)._scopeType =
                                boundScope.type;
                        },
                    );
                    if (decl.init)
                        visit(decl.init, scope, [...ancestors, decl.init]);
                }
                return;
            }

            case "ForStatement": {
                // The loop head gets its own scope: `let`/`const` bind
                // per-iteration there, while `var` still hoists out to the
                // nearest function scope via `bindIdentifier`.
                const loopScope = createScope("block", scope);
                if (node.init)
                    visit(node.init, loopScope, [...ancestors, node.init]);
                if (node.test)
                    visit(node.test, loopScope, [...ancestors, node.test]);
                if (node.update)
                    visit(node.update, loopScope, [...ancestors, node.update]);
                visit(node.body, loopScope, [...ancestors, node.body]);
                return;
            }

            case "ForOfStatement":
            case "ForInStatement": {
                // Same reasoning as ForStatement: the loop head (`left`) is
                // its own scope. `left` may be a VariableDeclaration (bound
                // here) or an existing reference (e.g. `for (a of b)`).
                const loopScope = createScope("block", scope);
                visit(node.left, loopScope, [...ancestors, node.left]);
                visit(node.right, loopScope, [...ancestors, node.right]);
                visit(node.body, loopScope, [...ancestors, node.body]);
                return;
            }

            case "CatchClause": {
                const catchScope = createScope("block", scope);
                if (node.param) {
                    // The param is a pattern -- `catch ({message})` is legal.
                    collectPatternIdentifiers(
                        node.param as acorn.AnyNode,
                        (id) => {
                            bindIdentifier(catchScope, id.name, "param");
                        },
                    );
                }
                visit(node.body, catchScope, [...ancestors, node.body]);
                return;
            }

            case "ClassDeclaration": {
                if (node.id) {
                    const boundScope = bindIdentifier(
                        scope,
                        node.id.name,
                        "function",
                    );
                    (node.id as ScopedIdentifier)._isDefinition = true;
                    (node.id as ScopedIdentifier)._scopeType = boundScope.type;
                }
                if (node.superClass)
                    visit(node.superClass, scope, [
                        ...ancestors,
                        node.superClass,
                    ]);
                visit(node.body, scope, [...ancestors, node.body]);
                return;
            }

            case "ClassExpression": {
                // Unlike a class declaration's name, a class expression's
                // name is only visible inside its own body.
                let bodyScope = scope;
                if (node.id) {
                    bodyScope = createScope("block", scope);
                    const boundScope = bindIdentifier(
                        bodyScope,
                        node.id.name,
                        "function",
                    );
                    (node.id as ScopedIdentifier)._isDefinition = true;
                    (node.id as ScopedIdentifier)._scopeType = boundScope.type;
                }
                if (node.superClass)
                    visit(node.superClass, scope, [
                        ...ancestors,
                        node.superClass,
                    ]);
                visit(node.body, bodyScope, [...ancestors, node.body]);
                return;
            }

            case "Identifier": {
                const idNode = node as ScopedIdentifier;
                if (classifyIdentifier(node, ancestors) !== "reference") break;

                const resolved = findBindingScope(scope, node.name);
                // The identifier is a reference...
                idNode._isDefinition = false;
                idNode._scopeType = resolved?.type ?? "global";

                // ...unless it's the LHS of an assignment and we're forcing assignment to be definition
                if (assignmentIsDefinition) {
                    const parent = ancestors[ancestors.length - 2] as
                        acorn.AnyNode | undefined;
                    if (
                        parent &&
                        parent.type === "AssignmentExpression" &&
                        parent.left === node
                    ) {
                        idNode._isDefinition = true;
                    }
                }
                break;
            }
        }

        // Recursively visit all children
        for (const key in node) {
            const child = (node as any)[key];
            if (!child || typeof child !== "object") continue;
            if (Array.isArray(child)) {
                for (const c of child) {
                    if (c && typeof c === "object" && "type" in c)
                        visit(c as acorn.AnyNode, scope, [...ancestors, c]);
                }
            } else if ("type" in child) {
                visit(child as acorn.AnyNode, scope, [...ancestors, child]);
            }
        }
    }

    visit(ast as acorn.AnyNode, globalScope, [ast as acorn.AnyNode]);
}

/**
 * Helper type for capturing the variable and all properties in a MemberExpression.
 */
type MemberChain = {
    root: ScopedIdentifier;
    properties: { name: string; start: number }[];
    dynamic: boolean; // true if the chain includes any non-static computed property
};

/**
 * Does a property's scope correspond to a built-in JS object?
 *
 * @param scope Scope to inspect.
 * @returns True if the scope is for a built-in JS object.
 */
function isBuiltinObjectScope(scope: string): boolean {
    return builtInObjects.has(scope.split(".", 1)[0]);
}

/**
 * Does a property correspond to a built-in JS object's instance property?
 *
 * @param property Property to inspect, including full path (e.g. `var.prop1.prop2` for `prop2`).
 * @returns True if the property matches a built-in JS object's instance property.
 */
export function isBuiltinJSObjectInstanceProperty(property: string): boolean {
    return builtInJSObjectInstanceProperties.has(
        property.split(".").pop() || "",
    );
}

/**
 * Get the static name of a node that is a property.
 *
 * @param property Node that contains the property.
 * @param computed Whether the property is a computed one.
 * @returns The static property name, or undefined if the property is computed and non-static.
 */
function getStaticPropertyName(
    property: acorn.AnyNode,
    computed: boolean,
): string | undefined {
    if (!computed && property.type === "Identifier") {
        // Loose parsing can synthesize a `✖` placeholder identifier for a
        // missing property name (e.g. `obj.`); never treat it as a real name.
        return property.name !== "✖" ? property.name : undefined;
    }

    if (
        computed &&
        property.type === "Literal" &&
        typeof property.value === "string"
    ) {
        return property.value;
    }

    return undefined;
}

/**
 * Determine if a member expression is defining stuff (i.e. is part of an assignment expression).
 *
 * @param node Member expression being inspected.
 * @param ancestors The node's ancestors.
 * @returns True if the member expression is defining stuff.
 */
function isMemberExpressionDefinition(
    node: acorn.MemberExpression,
    ancestors: acorn.Node[],
): boolean {
    const parent = ancestors[ancestors.length - 2] as acorn.AnyNode | undefined;
    return parent?.type === "AssignmentExpression" && parent.left === node;
}

/**
 * Get all of the members of a member expression.
 *
 * @param node Member expression to capture all members.
 * @returns The chain of members, or undefined if an unhandleable object type is encountered in the expression.
 */
function captureMemberChain(
    node: acorn.MemberExpression,
): MemberChain | undefined {
    const props: { name: string; start: number }[] = [];
    let current: acorn.Expression | acorn.Super = node;
    let root: ScopedIdentifier | undefined;
    let dynamic = false;

    while (true) {
        if (current.type === "MemberExpression") {
            // Capture the property
            const propName = getStaticPropertyName(
                current.property,
                current.computed,
            );
            if (!propName) dynamic = true;
            const start =
                current.computed &&
                current.property.type === "Literal" &&
                typeof current.property.value === "string"
                    ? current.property.start + 1
                    : current.property.start;

            props.unshift({ name: propName ?? "<dynamic>", start });
            current = current.object; // Head up the chain in the expression
        } else if (current.type === "Identifier") {
            // This is the variable at the root
            root = current as ScopedIdentifier;
            break;
        } else {
            return undefined; // Don't handle other object types
        }
    }

    if (!root) return undefined;
    return { root: root, properties: props, dynamic };
}

/**
 * Recursively capture all properties in an object expression.
 *
 * @param node ObjectExpression node.
 * @param parentScope Parent scope for the object expression.
 * @param capturePropertyCallback Callback for capturing a property's token.
 */
function captureObjectExpressionProperties(
    node: acorn.ObjectExpression,
    parentScope: string,
    capturePropertyCallback: (
        name: string,
        start: number,
        scope?: string,
        defined?: boolean,
    ) => void,
) {
    const isBuiltinObject = isBuiltinObjectScope(parentScope);

    for (const prop of node.properties) {
        if (prop.type !== "Property") continue; // We only care about properties

        const propName = getStaticPropertyName(
            prop.key,
            prop.computed ?? false,
        );
        if (!propName) continue;

        // Capture the property. Note we blank out the scope for built-in objects
        // so their properties get semantic tokens but aren't otherwise tracked
        capturePropertyCallback(
            propName,
            prop.key.start,
            isBuiltinObject ? undefined : parentScope,
            true,
        );

        // Recurse for contained object literals
        if (prop.value.type === "ObjectExpression") {
            // Compute new scope including this property
            const newScope = parentScope
                ? `${parentScope}.${propName}`
                : propName;

            captureObjectExpressionProperties(
                prop.value,
                newScope,
                capturePropertyCallback,
            );
        }
    }
}

/**
 * Is an identifier's immediate ancestor a call/new callee or an excluded
 * declaration (a function/arrow expression's own name or parameter)?
 *
 * Shared by both passes so neither re-derives the same exclusion rules
 * differently. A call or `new` expression's callee (`foo` in `foo(bar)`,
 * `Foo` in `new Foo(bar)`) isn't a story-variable occurrence yet -- it's a
 * function/constructor reference, which is issue 07's business. Neither are
 * `new Foo(bar)`'s arguments (also issue 07). Nor are a function or arrow
 * expression's own name and parameters (issue 06 is what starts treating
 * declarations as story-variable writes). Nor -- pre-existing defect 10,
 * out of scope here -- is a shorthand object-literal property's value (e.g.
 * `a` in `{a}`): its position collides with its own key, so it's always
 * reported as the property, never as the variable read it also is. Everything
 * else -- references, including plain call arguments, plus
 * `var`/`let`/`const` and `catch` declarations -- is a real occurrence today.
 *
 * @param role The identifier's classified role.
 * @param ancestor The identifier's immediate parent node, if any.
 * @param node The identifier (or, for a member-expression callee, the outermost `MemberExpression`) itself.
 * @returns True if the identifier should be excluded from both highlighting and extraction.
 */
function isExcludedIdentifier(
    role: IdentifierRole,
    ancestor: acorn.AnyNode | undefined,
    node: acorn.AnyNode,
): boolean {
    if (ancestor?.type === "NewExpression") return true;
    if (ancestor?.type === "CallExpression" && ancestor.callee === node)
        return true;
    if (ancestor?.type === "Property" && ancestor.shorthand) return true;
    return (
        role === "declaration" &&
        (ancestor?.type === "FunctionDeclaration" ||
            ancestor?.type === "FunctionExpression" ||
            ancestor?.type === "ArrowFunctionExpression")
    );
}

/**
 * A semantic token before it's been reported to the story format parsing state.
 */
interface PreSemanticToken {
    text: string; // Actual token text
    at: number; // Token location
    type: TokenType; // Type of the token
    modifiers: TokenModifier[]; // Modifiers for the token
}

/**
 * Compute semantic tokens for a parsed JavaScript program or expression.
 *
 * This pass only cares about what a token looks like (its text, position,
 * and type) and never consults scope, so it doesn't need `annotateVariableScopes`
 * to have run first.
 *
 * @param text Original unparsed text.
 * @param ast Parsed text.
 * @returns Object whose keys are the token's location in the unparsed text and whose values are semantic tokens.
 */
function computeSemanticTokens(
    text: string,
    ast: acorn.Node,
): Record<number, PreSemanticToken> {
    const tokens: Record<number, PreSemanticToken> = {};

    // We end up setting semantic tokens for some nodes multiple times (for
    // example, an Identifier and then again for a property that's an identifier).
    // We don't worry about that, though, because the walker visits the bottom-most
    // node first, then moves up to the containing expression or property, and the
    // last-set semantic token is the one that's reported.
    const addToken = (start: number, tokenText: string, type: TokenType) => {
        tokens[start] = { text: tokenText, at: start, type, modifiers: [] };
    };

    // Helper function to add a variable token if it's not a built-in JS object
    const captureVariable = (id: ScopedIdentifier) => {
        if (!id.name || id.name === "✖" || builtInObjects.has(id.name))
            return;
        addToken(id.start, id.name, ETokenType.variable);
    };

    // Helper function to add a property token if it's not dynamic
    const captureProperty = (name: string, start: number) => {
        if (!name || name === "<dynamic>" || name === "✖") return;
        addToken(start, name, ETokenType.property);
    };

    acornWalk.fullAncestor(ast, (rawNode, _, ancestors) => {
        const node = rawNode as acorn.AnyNode;
        switch (node.type) {
            case "Identifier": {
                const role = classifyIdentifier(node, ancestors);
                if (role === "neither") break;
                const ancestor = ancestors[ancestors.length - 2] as
                    | acorn.AnyNode
                    | undefined;
                if (!isExcludedIdentifier(role, ancestor, node)) {
                    captureVariable(node as ScopedIdentifier);
                }
                break;
            }

            case "Literal": {
                if (node.raw !== undefined) {
                    const semanticType = typeofToSemantic[typeof node.value];
                    if (semanticType !== undefined) {
                        addToken(node.start, node.raw, semanticType);
                    }
                }
                break;
            }

            case "AssignmentExpression":
            case "BinaryExpression":
            case "LogicalExpression": {
                const at = text.indexOf(node.operator, node.left.end);
                addToken(at, node.operator, ETokenType.operator);
                break;
            }

            case "CallExpression": {
                if (node.callee.type === "Identifier") {
                    addToken(
                        node.callee.start,
                        node.callee.name,
                        ETokenType.function,
                    );
                } else if (node.callee.type === "MemberExpression") {
                    const chain = captureMemberChain(node.callee);
                    if (chain && chain.properties) {
                        const lastProp =
                            chain.properties[chain.properties.length - 1];
                        addToken(
                            lastProp.start,
                            lastProp.name,
                            ETokenType.function,
                        );
                    }
                }
                break;
            }

            case "UnaryExpression":
            case "UpdateExpression": {
                const at = node.prefix
                    ? node.start
                    : node.end - node.operator.length;
                addToken(at, node.operator, ETokenType.operator);
                break;
            }

            case "MemberExpression": {
                const chain = captureMemberChain(node);
                if (!chain) break;

                // Highlighting doesn't care about scope, so (unlike extraction)
                // we don't bail out for a non-global root here.
                captureVariable(chain.root);
                for (const prop of chain.properties) {
                    captureProperty(prop.name, prop.start);
                }
                break;
            }

            case "Property": {
                const propName = getStaticPropertyName(
                    node.key,
                    node.computed ?? false,
                );
                if (!propName) break;

                // Unlike extraction, highlighting doesn't need to walk up the
                // ancestors to find a scope prefix: every property key gets its
                // own token regardless of nesting.
                captureProperty(propName, node.key.start);
                break;
            }

            case "VariableDeclaration": {
                addToken(node.start, node.kind, ETokenType.keyword);
                break;
            }
        }
    });

    return tokens;
}

/**
 * A variable occurrence found while extracting symbols, before it's turned into a `JSVariableLabel`.
 */
interface RawVariableOccurrence {
    text: string;
    at: number;
    defined: boolean;
}

/**
 * A property occurrence found while extracting symbols, before it's turned into a `JSPropertyLabel`.
 */
interface RawPropertyOccurrence {
    text: string;
    at: number;
    scope?: string;
    defined: boolean;
}

/**
 * Extract story-variable and story-property occurrences from a parsed JavaScript
 * program or expression.
 *
 * This pass consults scope (as annotated by `annotateVariableScopes`, which must
 * have already run) to resolve names and never cares about operators, literals,
 * or keywords.
 *
 * @param ast Parsed text, already annotated by `annotateVariableScopes`.
 * @returns Variable and property occurrences, in ascending order of position.
 */
function extractSymbols(ast: acorn.Node): {
    variables: RawVariableOccurrence[];
    properties: RawPropertyOccurrence[];
} {
    // Keyed by position (like the old shared token map) purely so that, when
    // converted to an array below, occurrences come out in ascending source
    // position order -- matching what callers (and tests) expect.
    const variableTokens: Record<number, RawVariableOccurrence> = {};
    const propertyTokens: Record<number, RawPropertyOccurrence> = {};

    // Helper function to add a variable occurrence if it's a global and not a built-in JS object
    const captureVariable = (id: ScopedIdentifier) => {
        if (!id.name || id.name === "✖" || builtInObjects.has(id.name))
            return;
        if (id._scopeType !== "global") return;
        variableTokens[id.start] = {
            text: id.name,
            at: id.start,
            defined: !!id._isDefinition,
        };
    };

    // Helper function to add a property occurrence if it's not dynamic and has a known scope
    const captureProperty = (
        name: string,
        start: number,
        scope?: string,
        defined = false,
    ) => {
        if (!name || name === "<dynamic>" || name === "✖") return;
        // Properties without a scope (e.g. built-in objects') get semantic
        // tokens but aren't otherwise tracked.
        if (scope === undefined) return;
        propertyTokens[start] = {
            text: name,
            at: start,
            scope,
            defined,
        };
    };

    acornWalk.fullAncestor(ast, (rawNode, _, ancestors) => {
        const node = rawNode as acorn.AnyNode;
        switch (node.type) {
            case "Identifier": {
                const role = classifyIdentifier(node, ancestors);
                if (role === "neither") break;
                const ancestor = ancestors[ancestors.length - 2] as
                    | acorn.AnyNode
                    | undefined;
                if (!isExcludedIdentifier(role, ancestor, node)) {
                    captureVariable(node as ScopedIdentifier);
                }
                break;
            }

            case "MemberExpression": {
                const chain = captureMemberChain(node);
                if (!chain) break;

                // If the root isn't in the global scope, bail out
                if (chain.root._scopeType !== "global") {
                    break;
                }

                const defined = isMemberExpressionDefinition(node, ancestors);
                const isBuiltin = isBuiltinObjectScope(chain.root.name);

                // Add the root variable
                captureVariable(chain.root);

                // If this member expression is itself a call's callee (e.g.
                // `obj.method` in `obj.method(x)`), its last segment is a
                // function reference, not a property occurrence -- that's
                // issue 07's business, same as a plain call's callee.
                const ancestor = ancestors[ancestors.length - 2] as
                    | acorn.AnyNode
                    | undefined;
                const lastIsCallCallee =
                    ancestor?.type === "CallExpression" &&
                    ancestor.callee === node;

                // Track dynamic properties incrementally
                let dynamicEncountered = false;

                chain.properties.forEach((prop, i) => {
                    if (prop.name === "<dynamic>") {
                        dynamicEncountered = true;
                        return; // Skip capturing dynamic property itself
                    }
                    if (
                        lastIsCallCallee &&
                        i === chain.properties.length - 1
                    ) {
                        return; // Skip the callee's own name
                    }

                    // Scope is valid only until the first dynamic property
                    const scope =
                        !dynamicEncountered && !isBuiltin
                            ? [
                                  chain.root.name,
                                  ...chain.properties
                                      .slice(0, i)
                                      .map((p) => p.name),
                              ].join(".")
                            : undefined;

                    // Only count the property as defined if it's being defined on a global variable
                    captureProperty(
                        prop.name,
                        prop.start,
                        scope,
                        defined && chain.root._scopeType === "global",
                    );
                });
                break;
            }

            case "Property": {
                const propName = getStaticPropertyName(
                    node.key,
                    node.computed ?? false,
                );
                // If we're a non-static property, bail out
                if (!propName) break;

                // Find the parent scope (if any) for the property
                let parentScope: string | undefined;

                for (let i = ancestors.length - 2; i >= 0; i--) {
                    const ancestor = ancestors[i] as acorn.AnyNode;

                    // var.prop1.prop2... = { ... } (for any number of properties)
                    if (
                        ancestor.type === "AssignmentExpression" &&
                        ancestor.right.type === "ObjectExpression"
                    ) {
                        // Get the scope from the left side to prepend to the property scopes
                        const left = ancestor.left;
                        if (left.type === "Identifier") {
                            if (
                                (left as ScopedIdentifier)._scopeType ===
                                "global"
                            ) {
                                parentScope = left.name;
                                captureObjectExpressionProperties(
                                    ancestor.right,
                                    parentScope,
                                    captureProperty,
                                );
                            }
                            break;
                        } else if (left.type === "MemberExpression") {
                            const chain = captureMemberChain(left);
                            if (
                                chain &&
                                !chain.dynamic &&
                                chain.root._scopeType === "global"
                            ) {
                                // If it's dynamic, then we don't save the properties
                                parentScope = [
                                    chain.root.name,
                                    ...chain.properties.map((p) => p.name),
                                ].join(".");
                                captureObjectExpressionProperties(
                                    ancestor.right,
                                    parentScope,
                                    captureProperty,
                                );
                                break;
                            }
                        }
                    }

                    // const obj = { ... }
                    if (
                        ancestor.type === "VariableDeclarator" &&
                        ancestor.id.type === "Identifier" &&
                        ancestor.init?.type === "ObjectExpression"
                    ) {
                        const id = ancestor.id as ScopedIdentifier;

                        if (id._scopeType === "global") {
                            parentScope = id.name;
                            captureObjectExpressionProperties(
                                ancestor.init,
                                parentScope,
                                captureProperty,
                            );
                        }
                        break;
                    }
                }

                // Capture the property. Note we blank out the scope for built-in
                // objects so they don't get tracked as occurrences.
                captureProperty(
                    propName,
                    node.key.start,
                    isBuiltinObjectScope(parentScope || "")
                        ? undefined
                        : parentScope || undefined,
                    true,
                );
                break;
            }
        }
    });

    return {
        variables: Object.values(variableTokens),
        properties: Object.values(propertyTokens),
    };
}

/**
 * Check whether every identifier that could be a story variable in a parsed
 * JavaScript AST satisfies a caller-supplied predicate.
 *
 * This walks the AST once and, for each identifier that `classifyIdentifier`
 * says is a real occurrence (not a property key, label, or import binding,
 * and not a built-in JS object, callee/argument of `new`, or a function/arrow
 * expression's own name/parameter), asks the predicate whether it counts as a
 * variable. It's the same set of identifiers `extractSymbols` treats as
 * variable occurrences, minus the scope resolution extraction needs -- useful
 * for callers (like `isTwineScriptExpression`) that only need a yes/no answer
 * about the identifiers themselves, not their scope.
 *
 * @param ast Parsed AST to walk.
 * @param isVariable Predicate called with each candidate identifier's name and start position.
 * @returns True if every candidate identifier satisfies the predicate.
 */
export function isEveryIdentifierAVariable(
    ast: acorn.Node,
    isVariable: (name: string, start: number) => boolean,
): boolean {
    let allValid = true;

    acornWalk.fullAncestor(ast, (rawNode, _, ancestors) => {
        const node = rawNode as acorn.AnyNode;
        if (node.type !== "Identifier") return;

        const role = classifyIdentifier(node, ancestors);
        if (role === "neither") return;

        const ancestor = ancestors[ancestors.length - 2] as
            | acorn.AnyNode
            | undefined;
        if (isExcludedIdentifier(role, ancestor, node)) return;

        if (!node.name || node.name === "✖" || builtInObjects.has(node.name))
            return;

        if (!isVariable(node.name, node.start)) allValid = false;
    });

    return allValid;
}

/**
 * Parse text as a JavaScript program or expression.
 *
 * This performs strict parsing, and throws an augmented SyntaxError if
 * the program doesn't parse correctly.
 *
 * A program has to have full statements. An expression can be just a snippet.
 *
 * @param text Text to parse as JavaScript.
 * @param isProgram Whether the text is a full program or just an expression.
 * @returns Top-most node in the AST.
 */
export function parseJSStrict(text: string, isProgram: boolean): acorn.Node {
    // n.b. we're using ParserWithState so's we get actual useful information
    // out of any thrown SyntaxError.
    if (isProgram) {
        return ParserWithState.parse(text, {
            ecmaVersion: EcmaVersion,
            sourceType: "script",
        });
    } else {
        return ParserWithState.parseExpressionAt(text, 0, {
            ecmaVersion: EcmaVersion,
            sourceType: "script",
        });
    }
}

/**
 * Parse a JavaScript program or expression.
 *
 * This performs strict parsing (first a full parse, then as an expression), then loose parsing,
 * and does not throw an exception.
 *
 * @param text Text to parse as JavaScript.
 * @param isProgram Whether to parse it as a full JS program or a small expression
 * @param offset Offset into the containing document where the text occurs.
 * @returns Top-most node in the AST, or undefined if the parsing failed.
 */
export function parseJS(
    text: string,
    isProgram: boolean,
    offset = 0,
): [acorn.Node | undefined, JSDiagnostic | undefined] {
    // Don't do anything if no text is passed (as that would create an error)
    if (!text.trim()) return [undefined, undefined];

    let diagnostic: JSDiagnostic | undefined;
    try {
        return [parseJSStrict(text, isProgram), undefined];
    } catch (err) {
        if (!(err instanceof SyntaxError)) {
            return [undefined, undefined];
        }
        diagnostic = {
            ...improveAcornErrorMessage(
                text,
                err as SyntaxError & {
                    pos?: number;
                    loc?: {
                        line: number;
                        column: number;
                    };
                    raisedAt?: number;
                },
                offset,
            ),
            severity: DiagnosticSeverity.Error,
        };
    }

    // Finally try whatever parsing we can get away with
    return [
        acornLoose.parse(text, {
            ecmaVersion: EcmaVersion,
        }),
        diagnostic,
    ];
}

/**
 * Tokenize a JavaScript program or expression and find referenced variables and properties in it.
 *
 * Returned properties are only those for which the parser could trace their "ownership"
 * back to a root variable.
 *
 * @param isProgram Whether to parse it as a program (true) or expression (false).
 * @param text Text to parse.
 * @param offset Offset into the document where the expression occurs.
 * @param document Document containing the expression.
 * @param storyFormatState Story format parsing state that will collect semantic tokens.
 * @param assignmentIsDefinition If true, variable assignment will be treated as variable definition. (Needed for e.g. SugarCube passage link setters.)
 * @returns Tokenized variables and properties and any parsing error.
 */
export function tokenizeJavaScript(
    isProgram: boolean,
    text: string,
    offset: number,
    document: TextDocument,
    storyFormatState: StoryFormatParsingState,
    assignmentIsDefinition?: boolean,
): TokenizedJS {
    const tokenized: TokenizedJS = {
        variables: [],
        properties: [],
    };

    const [ast, diagnostic] = parseJS(text, isProgram, offset);
    tokenized.error = diagnostic;
    if (ast !== undefined) {
        annotateVariableScopes(ast, !!assignmentIsDefinition);

        // Highlighting pass: every token, no scope.
        const semanticTokens = computeSemanticTokens(text, ast);
        for (const token of Object.values(semanticTokens)) {
            capturePreSemanticTokenFor(
                token.text,
                offset + token.at,
                token.type,
                token.modifiers,
                storyFormatState,
            );
        }

        // Extraction pass: scope-resolved variables and properties, no operators/literals/keywords.
        const { variables, properties } = extractSymbols(ast);
        for (const variable of variables) {
            tokenized.variables.push({
                contents: variable.text,
                location: createLocationFor(
                    variable.text,
                    offset + variable.at,
                    document,
                ),
                defined: variable.defined,
            });
        }
        for (const property of properties) {
            tokenized.properties.push({
                contents: property.text,
                location: createLocationFor(
                    property.text,
                    offset + property.at,
                    document,
                ),
                prefix: property.scope,
                defined: property.defined,
            });
        }
    }

    return tokenized;
}
