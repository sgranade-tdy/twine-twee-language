import * as acorn from "acorn";
import * as acornLoose from "acorn-loose";
import * as acornWalk from "acorn-walk";
import * as eslintScope from "eslint-scope";
import type * as ESTree from "estree";
import { DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { improveAcornErrorMessage } from "./acorn-errors";
import { ParserWithState } from "./acorn-errors/parser-state";
import { EcmaVersion, ScopeEcmaVersion } from "./ecma-version";
import { createLocationFor } from "./parser";
import {
    StoryFormatParsingState,
    capturePreSemanticTokenFor,
} from "./passage-text-parsers";
import { Label } from "./project-index";
import { ETokenType, TokenModifier, TokenType } from "./semantic-tokens";

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
     * Whether the variable is being assigned to.
     */
    assigned?: boolean;
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
     * Whether the property is being assigned to.
     */
    assigned?: boolean;
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
                (val as JSPropertyLabel).assigned !== undefined)
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

// The marker `acorn-loose` uses for a missing identifier.
const MISSING_IDENTIFIER = "✖";

/**
 * JavaScript's own global names, which are never story variables. Browser and
 * library globals aren't JavaScript; story formats supply those as
 * `StoryFormatParsingState.hostGlobals`.
 */
const ecmaScriptGlobals: ReadonlySet<string> = new Set([
    // Taken from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects
    "Object",
    "Function",
    "Boolean",
    "Symbol",
    "Error",
    "AggregateError",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SuppressedError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "Number",
    "BigInt",
    "Math",
    "Date",
    "Temporal",
    "String",
    "RegExp",
    "Array",
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "BigInt64Array",
    "BigUint64Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
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
    // Value properties. (`null` is a keyword that parses as a `Literal`, so it
    // never reaches a name check and isn't listed.)
    "undefined",
    "NaN",
    "Infinity",
    "globalThis",
    // Function properties
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "encodeURI",
    "encodeURIComponent",
    "decodeURI",
    "decodeURIComponent",
    "escape",
    "unescape",
    "eval",
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

type ScopeType = "global" | "function" | "block";

/**
 * Add scope information to an Acorn identifier.
 */
interface ScopedIdentifier extends acorn.Identifier {
    _isAssignment?: boolean;
    _scopeType?: ScopeType;
}

/**
 * How an identifier functions in the AST: whether it's a declaration
 * (a name being bound, e.g. `var`/`let`/`const`, a function or class name,
 * a function parameter, or a `catch` parameter), a reference (an occurrence that reads
 * -- or, if the caller forces assignments to count as writes, writes -- a
 * bound or unbound name), or neither (a property key, a label, or an import
 * binding, none of which are ever variables).
 *
 * The highlighting and extraction walks consult it to decide whether an
 * identifier is a candidate occurrence at all. Binding and scope come from
 * eslint-scope, not from here.
 */
type IdentifierRole = "declaration" | "reference" | "neither";

/**
 * Get a node's parent from its ancestors.
 *
 * @param ancestors Node's ancestors, ending with the node itself (the
 * acorn-walk `fullAncestor` convention).
 * @returns The node's parent, or undefined if it has none.
 */
function parentOf(ancestors: acorn.Node[]): acorn.AnyNode | undefined {
    return ancestors[ancestors.length - 2] as acorn.AnyNode | undefined;
}

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
    const parent = parentOf(ancestors);

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
 * Is a reference a write, given the caller's assignment context?
 *
 * A declaration's initializer always writes. Any other write-shaped syntax
 * (`a = 1`, `a++`, `[a] = b`, `for (a of b)`) writes only in an assignment
 * context, since elsewhere it's more often a `==` typo or a side effect.
 *
 * @param ref eslint-scope reference to the identifier.
 * @param isAssignmentContext True if write-shaped syntax counts as an assignment.
 */
function isWriteReference(
    ref: eslintScope.Reference,
    isAssignmentContext: boolean,
): boolean {
    return ref.init === true || (isAssignmentContext && ref.isWrite());
}

/**
 * Does the top level of a program use `import` or `export`?
 */
function hasModuleSyntax(program: ESTree.Program): boolean {
    return program.body.some((node) => /^(Import|Export)/.test(node.type));
}

/**
 * Get a `Program` for eslint-scope to analyze. An expression parse has no
 * `Program` root, so it's wrapped in one.
 */
function toProgram(ast: acorn.Node): ESTree.Program {
    if (ast.type === "Program") return ast as unknown as ESTree.Program;
    const range: [number, number] = [ast.start, ast.end];
    return {
        type: "Program",
        sourceType: "script",
        start: ast.start,
        end: ast.end,
        range,
        body: [
            {
                type: "ExpressionStatement",
                start: ast.start,
                end: ast.end,
                range,
                expression: ast,
            },
        ],
    } as unknown as ESTree.Program;
}

/**
 * Annotate variable definitions or references along with their scope.
 *
 * Scope resolution comes from eslint-scope (see ADR-0004). A reference counts
 * as being in the "global" scope, i.e. a story variable, if nothing resolves
 * it or it resolves to a root-level declaration (global or module scope).
 *
 * @param ast AST to annotate.
 * @param isAssignmentContext True if write-shaped syntax counts as an assignment.
 */
function annotateVariableScopes(ast: acorn.Node, isAssignmentContext: boolean) {
    const program = toProgram(ast);
    const scopeManager = eslintScope.analyze(program, {
        ecmaVersion: ScopeEcmaVersion,
        sourceType: hasModuleSyntax(program) ? "module" : "script",
        optimistic: true,
    });

    const scopeTypeOf = (scope: eslintScope.Scope): ScopeType =>
        scope.type === "global" || scope.type === "module"
            ? "global"
            : scope.type === "function"
              ? "function"
              : "block";

    for (const scope of scopeManager.scopes) {
        for (const ref of scope.references) {
            const id = ref.identifier as unknown as ScopedIdentifier;
            id._isAssignment = isWriteReference(ref, isAssignmentContext);

            let variable = ref.resolved;
            // A class's name inside its own body resolves to an inner
            // binding. Redirect to the outer variable the class declares.
            if (variable?.scope.type === "class") {
                const def = variable.defs[0];
                variable =
                    def?.node.type === "ClassDeclaration"
                        ? findOuterClassVariable(variable)
                        : variable;
            }
            id._scopeType = variable ? scopeTypeOf(variable.scope) : "global";
        }
    }

    // Root-level declarations are assignments, whether or not they have an
    // initializer (and so a write reference).
    const rootScopes = scopeManager.scopes.filter(
        (scope) => scope.type === "global" || scope.type === "module",
    );
    for (const scope of rootScopes) {
        for (const variable of scope.variables) {
            for (const def of variable.defs) {
                if (
                    def.type === "Variable" ||
                    def.type === "FunctionName" ||
                    def.type === "ClassName"
                ) {
                    const id = def.name as unknown as ScopedIdentifier;
                    id._isAssignment = true;
                    id._scopeType = "global";
                }
            }
        }
    }
}

/**
 * Find the outer variable that a class declaration's inner self-binding stands for.
 */
function findOuterClassVariable(
    inner: eslintScope.Variable,
): eslintScope.Variable | null {
    for (
        let scope: eslintScope.Scope | null = inner.scope.upper;
        scope;
        scope = scope.upper
    ) {
        const outer = scope.set.get(inner.name);
        if (outer) return outer;
    }
    return null;
}

/**
 * Helper type for capturing the variable and all properties in a MemberExpression.
 */
type MemberChain = {
    root: ScopedIdentifier;
    properties: MemberSegment[];
};

/**
 * One property segment of a member chain. `name` is undefined for a computed,
 * non-static segment (`obj[k]`), which has no name to track or highlight.
 */
type MemberSegment = { name: string | undefined; start: number };

/**
 * Does a member chain include any computed, non-static segment?
 *
 * @param chain Chain to inspect.
 * @returns True if any segment has no static name.
 */
function isDynamicChain(chain: MemberChain): boolean {
    return chain.properties.some((p) => p.name === undefined);
}

/**
 * Predicate for names that are globals (JavaScript's own, or the host globals
 * a story format supplies) and so are never story variables.
 */
type IsGlobalName = (name: string) => boolean;

/**
 * Build the global-name predicate for one parse.
 *
 * @param hostGlobals Host globals supplied by the story format, if any.
 * @returns Predicate that's true for JavaScript and host globals.
 */
function globalNamePredicate(hostGlobals?: ReadonlySet<string>): IsGlobalName {
    return (name) => ecmaScriptGlobals.has(name) || !!hostGlobals?.has(name);
}

/**
 * Does a property's scope correspond to a global object?
 *
 * @param scope Scope to inspect.
 * @param isGlobalName Global-name predicate for this parse.
 * @returns True if the scope is rooted in a global object.
 */
function isGlobalObjectScope(
    scope: string,
    isGlobalName: IsGlobalName,
): boolean {
    return isGlobalName(scope.split(".", 1)[0]);
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
        // Don't treat a missing identifier marker from loose parsing as a name.
        return property.name !== MISSING_IDENTIFIER ? property.name : undefined;
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
 * Determine if a member expression is being assigned to.
 *
 * @param node Member expression being inspected.
 * @param ancestors The node's ancestors.
 * @returns True if the member expression is being assigned to.
 */
function isMemberExpressionAssignment(
    node: acorn.MemberExpression,
    ancestors: acorn.Node[],
): boolean {
    const parent = parentOf(ancestors);
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
    const props: MemberSegment[] = [];
    let current: acorn.Expression | acorn.Super = node;
    let root: ScopedIdentifier | undefined;

    while (true) {
        if (current.type === "MemberExpression") {
            // Capture the property
            const propName = getStaticPropertyName(
                current.property,
                current.computed,
            );
            const start =
                current.computed &&
                current.property.type === "Literal" &&
                typeof current.property.value === "string"
                    ? current.property.start + 1
                    : current.property.start;

            props.unshift({ name: propName, start });
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
    return { root: root, properties: props };
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
        assigned?: boolean,
    ) => void,
    isGlobalName: IsGlobalName,
) {
    const isGlobalObject = isGlobalObjectScope(parentScope, isGlobalName);

    for (const prop of node.properties) {
        if (prop.type !== "Property") continue; // We only care about properties

        const propName = getStaticPropertyName(
            prop.key,
            prop.computed ?? false,
        );
        if (!propName) continue;

        // Capture the property. Note we blank out the scope for globals
        // so their properties aren't tracked
        capturePropertyCallback(
            propName,
            prop.key.start,
            isGlobalObject ? undefined : parentScope,
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
                isGlobalName,
            );
        }
    }
}

/**
 * Is a node the callee of a call or `new` expression (`foo` in `foo(bar)`,
 * `obj.method` in `obj.method(x)`, `Foo` in `new Foo(bar)`)?
 *
 * This is the one place every pass asks that question, so calls and
 * constructions are always treated alike.
 *
 * @param node Node to test.
 * @param parent The node's immediate parent, if any.
 * @returns True if the node is a call or `new` callee.
 */
function isCallee(
    node: acorn.AnyNode,
    parent: acorn.AnyNode | undefined,
): boolean {
    return (
        (parent?.type === "CallExpression" ||
            parent?.type === "NewExpression") &&
        parent.callee === node
    );
}

/**
 * Is an identifier a function declaration's or function expression's own
 * name or parameter?
 *
 * @param role The identifier's classified role.
 * @param parent The identifier's immediate parent, if any.
 * @returns True if the identifier is a function's own name or parameter.
 */
function isFunctionOwnBinding(
    role: IdentifierRole,
    parent: acorn.AnyNode | undefined,
): boolean {
    return (
        role === "declaration" &&
        (parent?.type === "FunctionDeclaration" ||
            parent?.type === "FunctionExpression")
    );
}

/**
 * Is an identifier excluded from highlighting and extraction because of its
 * immediate parent: a call/`new` callee, a shorthand property's value, or a
 * function's own name or parameter?
 *
 * A callee isn't a story-variable occurrence yet -- it's a function/constructor
 * reference, which is issue 07's business. Its arguments, though, are ordinary
 * reads. Nor are a function declaration's or function expression's own name
 * and parameters occurrences (issue 06 is what starts treating declarations as
 * story-variable writes). Arrow-function parameters aren't excluded here: they
 * never resolve to a story variable because they're never scope-annotated, but
 * they're still highlighted as variables. Nor -- pre-existing defect 10, out of
 * scope here -- is a shorthand object-literal property's value (e.g. `a` in
 * `{a}`): it's always reported as the property, never as the variable read it
 * also is. Everything else -- references, plus `var`/`let`/`const` and `catch`
 * declarations -- is a real occurrence today.
 *
 * Callee and shorthand exclusions are temporary (issue 07 removes them), so
 * `isEveryIdentifierAVariable` deliberately doesn't use this.
 *
 * @param role The identifier's classified role.
 * @param parent The identifier's immediate parent node, if any.
 * @param node The identifier itself.
 * @returns True if the identifier should be excluded from both highlighting and extraction.
 */
function isExcludedIdentifier(
    role: IdentifierRole,
    parent: acorn.AnyNode | undefined,
    node: acorn.AnyNode,
): boolean {
    if (isCallee(node, parent)) return true;
    if (parent?.type === "Property" && parent.shorthand) return true;
    return isFunctionOwnBinding(role, parent);
}

/**
 * Is the name potentially a variable we want to track?
 *
 * We don't track empty names, missing identifiers from loose
 * parsing, or globals.
 *
 * @param name Identifier name.
 * @param isGlobalName Global-name predicate for this parse.
 * @returns True if the name could be a variable to be tracked.
 */
function isPotentialTrackedVariableName(
    name: string,
    isGlobalName: IsGlobalName,
): boolean {
    return !!name && name !== MISSING_IDENTIFIER && !isGlobalName(name);
}

/**
 * Is an identifier a candidate variable occurrence -- that is, one that
 * highlighting marks as a variable and extraction considers (subject to scope)
 * as a story variable?
 *
 * This is the one place every pass asks that question, combining
 * `classifyIdentifier`, `isExcludedIdentifier`, and `isPotentialTrackedVariableName`.
 *
 * @param node Identifier to test.
 * @param ancestors Node's ancestors, ending with `node` itself.
 * @param isGlobalName Global-name predicate for this parse.
 * @returns True if the identifier is a candidate variable occurrence.
 */
function isCandidateVariable(
    node: acorn.Identifier,
    ancestors: acorn.Node[],
    isGlobalName: IsGlobalName,
): boolean {
    const role = classifyIdentifier(node, ancestors);
    if (role === "neither") return false;
    if (isExcludedIdentifier(role, parentOf(ancestors), node)) return false;
    return isPotentialTrackedVariableName(node.name, isGlobalName);
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
 * @param isGlobalName Global-name predicate for this parse.
 * @returns Object whose keys are the token's location in the unparsed text and whose values are semantic tokens.
 */
function computeSemanticTokens(
    text: string,
    ast: acorn.Node,
    isGlobalName: IsGlobalName,
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

    // Helper function to add a variable token if it's not a global
    const captureVariable = (id: ScopedIdentifier) => {
        if (!isPotentialTrackedVariableName(id.name, isGlobalName)) return;
        addToken(id.start, id.name, ETokenType.variable);
    };

    // Helper function to add a property token if it's not dynamic
    const captureProperty = (name: string | undefined, start: number) => {
        if (!name) return;
        addToken(start, name, ETokenType.property);
    };

    acornWalk.fullAncestor(ast, (rawNode, _, ancestors) => {
        const node = rawNode as acorn.AnyNode;
        switch (node.type) {
            case "Identifier": {
                if (isCandidateVariable(node, ancestors, isGlobalName)) {
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

            case "CallExpression":
            case "NewExpression": {
                if (node.callee.type === "Identifier") {
                    addToken(
                        node.callee.start,
                        node.callee.name,
                        ETokenType.function,
                    );
                } else if (node.callee.type === "MemberExpression") {
                    const chain = captureMemberChain(node.callee);
                    const lastProp = chain?.properties.at(-1);
                    // A non-static callee (`obj[k](x)`) has no name to mark
                    // as a function; `k` keeps its own variable token.
                    if (lastProp && lastProp.name !== undefined) {
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
                // we don't bail out for a locally bound root here.
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
    assigned: boolean;
}

/**
 * A property occurrence found while extracting symbols, before it's turned into a `JSPropertyLabel`.
 */
interface RawPropertyOccurrence {
    text: string;
    at: number;
    scope?: string;
    assigned: boolean;
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
function extractSymbols(
    ast: acorn.Node,
    isGlobalName: IsGlobalName,
): {
    variables: RawVariableOccurrence[];
    properties: RawPropertyOccurrence[];
} {
    // Keyed by position (like the old shared token map) purely so that, when
    // converted to an array below, occurrences come out in ascending source
    // position order -- matching what callers (and tests) expect.
    const variableTokens: Record<number, RawVariableOccurrence> = {};
    const propertyTokens: Record<number, RawPropertyOccurrence> = {};

    // Helper function to add a variable occurrence if it's an unbound (story) variable and not a global
    const captureVariable = (id: ScopedIdentifier) => {
        if (!isPotentialTrackedVariableName(id.name, isGlobalName)) return;
        if (id._scopeType !== "global") return;
        variableTokens[id.start] = {
            text: id.name,
            at: id.start,
            assigned: !!id._isAssignment,
        };
    };

    // Helper function to add a property occurrence if it's not dynamic and has a known scope
    const captureProperty = (
        name: string | undefined,
        start: number,
        scope?: string,
        assigned = false,
    ) => {
        if (!name) return;
        // Properties without a scope (e.g. globals') aren't tracked.
        if (scope === undefined) return;
        propertyTokens[start] = {
            text: name,
            at: start,
            scope,
            assigned,
        };
    };

    acornWalk.fullAncestor(ast, (rawNode, _, ancestors) => {
        const node = rawNode as acorn.AnyNode;
        switch (node.type) {
            case "Identifier": {
                if (isCandidateVariable(node, ancestors, isGlobalName)) {
                    captureVariable(node as ScopedIdentifier);
                }
                break;
            }

            case "MemberExpression": {
                const chain = captureMemberChain(node);
                if (!chain) break;

                // If the root is locally bound (not a story variable), bail out
                if (chain.root._scopeType !== "global") {
                    break;
                }

                const assigned = isMemberExpressionAssignment(node, ancestors);
                const isGlobal = isGlobalName(chain.root.name);

                // Add the root variable
                captureVariable(chain.root);

                // If this member expression is itself a call or `new` callee
                // (e.g. `obj.method` in `obj.method(x)`, `obj.Foo` in
                // `new obj.Foo(x)`), its last segment is a function reference,
                // not a property occurrence -- that's issue 07's business,
                // same as a plain callee.
                const lastIsCallee = isCallee(node, parentOf(ancestors));

                // Track dynamic properties incrementally
                let dynamicEncountered = false;

                chain.properties.forEach((prop, i) => {
                    if (prop.name === undefined) {
                        dynamicEncountered = true;
                        return; // Skip capturing dynamic property itself
                    }
                    if (lastIsCallee && i === chain.properties.length - 1) {
                        return; // Skip the callee's own name
                    }

                    // Scope is valid only until the first dynamic property
                    const scope =
                        !dynamicEncountered && !isGlobal
                            ? [
                                  chain.root.name,
                                  ...chain.properties
                                      .slice(0, i)
                                      .map((p) => p.name),
                              ].join(".")
                            : undefined;

                    // Only count the property as assigned if its root is a story variable
                    captureProperty(
                        prop.name,
                        prop.start,
                        scope,
                        assigned && chain.root._scopeType === "global",
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
                                    isGlobalName,
                                );
                            }
                            break;
                        } else if (left.type === "MemberExpression") {
                            const chain = captureMemberChain(left);
                            if (
                                chain &&
                                !isDynamicChain(chain) &&
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
                                    isGlobalName,
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
                                isGlobalName,
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
                    isGlobalObjectScope(parentScope || "", isGlobalName)
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
 * Check whether every identifier that a story format would need to resolve as a
 * variable in a parsed JavaScript AST satisfies a caller-supplied predicate.
 *
 * This walks the AST once and asks the predicate about every identifier that
 * reads or writes a name, skipping property keys, labels, import bindings,
 * globals, a function declaration's/expression's own name and
 * parameters, and call/`new` callees. Callees are skipped because they name
 * story-format or JS functions (`either(...)`, `visited(...)`), not variables.
 *
 * Unlike `isCandidateVariable`, this doesn't follow extraction's temporary
 * exclusions: a shorthand property's value (`a` in `{a}`) is a read, so it's
 * checked. It's purpose-built for callers like `isTwineScriptExpression` that
 * only need a yes/no answer about the identifiers themselves, not their scope.
 *
 * @param ast Parsed AST to walk.
 * @param isVariable Predicate called with each candidate identifier's name and start position.
 * @param hostGlobals Host globals supplied by the story format, if any.
 * @returns True if every candidate identifier satisfies the predicate.
 */
export function isEveryIdentifierAVariable(
    ast: acorn.Node,
    isVariable: (name: string, start: number) => boolean,
    hostGlobals?: ReadonlySet<string>,
): boolean {
    let allValid = true;
    const isGlobalName = globalNamePredicate(hostGlobals);

    acornWalk.fullAncestor(ast, (rawNode, _, ancestors) => {
        const node = rawNode as acorn.AnyNode;
        if (node.type !== "Identifier") return;
        const role = classifyIdentifier(node, ancestors);
        if (role === "neither") return;
        const parent = parentOf(ancestors);
        if (isCallee(node, parent) || isFunctionOwnBinding(role, parent))
            return;
        if (!isPotentialTrackedVariableName(node.name, isGlobalName)) return;

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
            ranges: true,
        });
    } else {
        return ParserWithState.parseExpressionAt(text, 0, {
            ecmaVersion: EcmaVersion,
            sourceType: "script",
            ranges: true,
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
            ranges: true,
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
 * @param storyFormatState Story format parsing state that will collect semantic tokens, and that supplies the format's host globals.
 * @param isAssignmentContext True if the code comes from a construct whose purpose is to set state (an assignment context), so write-shaped syntax counts as an assignment. Otherwise such writes are reported as reads, since outside an assignment context they're more often a `==` typo or a side effect. Declarations are assignments either way.
 * @returns Tokenized variables and properties and any parsing error.
 */
export function tokenizeJavaScript(
    isProgram: boolean,
    text: string,
    offset: number,
    document: TextDocument,
    storyFormatState: StoryFormatParsingState,
    isAssignmentContext?: boolean,
): TokenizedJS {
    const tokenized: TokenizedJS = {
        variables: [],
        properties: [],
    };

    const [ast, diagnostic] = parseJS(text, isProgram, offset);
    tokenized.error = diagnostic;
    if (ast !== undefined) {
        annotateVariableScopes(ast, !!isAssignmentContext);
        const isGlobalName = globalNamePredicate(storyFormatState.hostGlobals);

        // Highlighting pass: every token, no scope.
        const semanticTokens = computeSemanticTokens(text, ast, isGlobalName);
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
        const { variables, properties } = extractSymbols(ast, isGlobalName);
        for (const variable of variables) {
            tokenized.variables.push({
                contents: variable.text,
                location: createLocationFor(
                    variable.text,
                    offset + variable.at,
                    document,
                ),
                assigned: variable.assigned,
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
                assigned: property.assigned,
            });
        }
    }

    return tokenized;
}
