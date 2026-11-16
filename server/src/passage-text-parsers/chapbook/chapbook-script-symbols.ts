import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";

import {
    isCallee,
    isEcmaScriptGlobal,
    argumentShape,
    assignedValue,
    assignmentShape,
    isWriteTarget,
    objectLiteralProperties,
    parentOf,
    ScriptPropertyOccurrence,
    ScriptSymbolExtractor,
    ScriptVariableOccurrence,
} from "../../js-parser";
import { shapeFlags } from "../../project-index";
import { browserGlobals } from "../host-globals";
import {
    createScriptAnalysis,
    isIdentifierName,
    MISSING_IDENTIFIER,
    StaticName,
} from "../../script-analysis";

/**
 * Chapbook names that are never story variables, even when unbound.
 */
const excludedNames: ReadonlySet<string> = new Set(["engine", "go", "restart"]);

/**
 * Say why a bare name in Chapbook script code can never be a story variable.
 *
 * @param name Bare name.
 * @returns What the name already is, or undefined if it can be a story variable.
 */
export function excludedBareName(name: string): string | undefined {
    if (excludedNames.has(name)) return "a Chapbook built-in";
    if (isEcmaScriptGlobal(name)) return "a JavaScript global";
    if (browserGlobals.has(name)) return "a browser global";
    return undefined;
}

/**
 * Chapbook names that are always story variables when unbound, rather than
 * conditional references.
 */
const storyVariableNames: ReadonlySet<string> = new Set(["config"]);

/**
 * Create an extractor for Chapbook script code, per ADR-0005.
 *
 * `engine.state.get`/`set`/`setDefault` with a literal key (or a
 * never-reassigned alias of `engine.state`) yield story variables and
 * properties, and static member accesses off a `get` call continue its path
 * (`get('p').a` is `p.a`). A `set`/`setDefault` whose value could be an object of unknown
 * shape marks its path opaque. An unbound bare `config` is a story variable, and every other
 * unbound bare name yields a conditional reference, which is never an
 * assignment. Escaped spellings (`g\u006Fld`) yield nothing. Declarations
 * are never story variables.
 *
 * @param options Extractor options.
 * @param options.recordRootDeclarations True to also record root-level
 * declarations, which conditional references are later filtered against. Only
 * code that shares the story's script scope (`script` passages and story
 * script files) should do so.
 */
export function createChapbookScriptExtractor({
    recordRootDeclarations,
}: {
    recordRootDeclarations: boolean;
}): ScriptSymbolExtractor {
    return ({ ast, text, scopeManager, isGlobalName }) => {
        const variables: ScriptVariableOccurrence[] = [];
        const properties: ScriptPropertyOccurrence[] = [];
        const { isUnbound, staticKeyName, memberName, aliasRoot } =
            createScriptAnalysis(text, scopeManager);

        // `engine.state`, or a never-reassigned alias of it
        const isEngineState = (node: acorn.Node): boolean => {
            if (node.type === "Identifier") {
                return !!aliasRoot(node as acorn.Identifier, isEngineState);
            }
            if (node.type !== "MemberExpression") return false;
            const member = node as acorn.MemberExpression;
            return (
                memberName(member)?.name === "state" &&
                member.object.type === "Identifier" &&
                (member.object as acorn.Identifier).name === "engine" &&
                isUnbound(member.object)
            );
        };

        // `engine.state.get`/`set`/`setDefault` call with a literal key
        const engineStateCall = (
            node: acorn.AnyNode,
        ):
            | { method: "get" | "set" | "setDefault"; key: StaticName }
            | undefined => {
            if (
                node.type !== "CallExpression" ||
                node.callee.type !== "MemberExpression" ||
                !isEngineState(node.callee.object)
            )
                return undefined;
            const method = memberName(node.callee)?.name;
            if (method !== "get" && method !== "set" && method !== "setDefault")
                return undefined;
            const key =
                node.arguments[0] && staticKeyName(node.arguments[0], true);
            return key ? { method, key } : undefined;
        };

        // Path an `engine.state.get` call, or a static member chain off one,
        // reaches, so `set('s', get('p').a)` copies `p.a` and a
        // self-reference like `set('inv', get('inv') || {})` is ignored
        const statePathOf = (node: acorn.AnyNode): string | undefined => {
            if (node.type === "ChainExpression") {
                return statePathOf(node.expression);
            }
            if (node.type === "MemberExpression") {
                const name = memberName(node);
                const parent = name && statePathOf(node.object);
                return parent && `${parent}.${name.name}`;
            }
            const call = engineStateCall(node);
            return call?.method === "get" ? call.key.name : undefined;
        };

        // Static member accesses off a `get` call (`get('p').a.b`) continue
        // its path, up to the first indexed segment or call
        const captureChain = (
            call: acorn.AnyNode,
            path: string,
            ancestors: acorn.Node[],
        ) => {
            let current = call;
            let depth = ancestors.length - 2;
            while (depth >= 0) {
                const up = ancestors[depth] as acorn.AnyNode;
                if (up.type !== "MemberExpression" || up.object !== current)
                    break;
                const prop = memberName(up);
                if (!prop || !isIdentifierName(prop.name)) break;
                const upAncestors = ancestors.slice(0, depth + 1);
                const assigned = isWriteTarget(up, upAncestors, true);
                properties.push({
                    text: prop.name,
                    at: prop.start,
                    scope: path,
                    assigned,
                    isCallee: isCallee(up, parentOf(upAncestors)),
                    ...shapeFlags(
                        assigned
                            ? assignmentShape(up, upAncestors, statePathOf)
                            : {},
                    ),
                });
                path = `${path}.${prop.name}`;
                if (assigned) {
                    properties.push(
                        ...objectLiteralProperties(
                            assignedValue(up, upAncestors),
                            path,
                            statePathOf,
                            { assigned: true },
                        ),
                    );
                }
                current = up;
                depth--;
            }
        };

        acornWalk.fullAncestor(ast, (rawNode, _, ancestors) => {
            const node = rawNode as acorn.AnyNode;
            const call = engineStateCall(node);
            if (!call) return;
            const { method, key } = call;
            const segments = key.name.split(".");
            if (!segments.every((s) => isIdentifierName(s))) return;
            if (method === "get") captureChain(node, key.name, ancestors);

            const assigned = method !== "get";
            const value = (node as acorn.CallExpression).arguments[1];
            const shape = assigned
                ? argumentShape(value, key.name, statePathOf)
                : {};
            let at = key.start;
            segments.forEach((segment, i) => {
                const flag = shapeFlags(i === segments.length - 1 ? shape : {});
                if (i === 0) {
                    variables.push({ text: segment, at, assigned, ...flag });
                } else {
                    properties.push({
                        text: segment,
                        at,
                        scope: segments.slice(0, i).join("."),
                        assigned,
                        isCallee: false,
                        ...flag,
                    });
                }
                at += segment.length + 1;
            });
            if (assigned) {
                properties.push(
                    ...objectLiteralProperties(value, key.name, statePathOf, {
                        assigned: true,
                    }),
                );
            }
        });

        // Keyed by position so a read-and-write like `a += 1` yields one occurrence
        const bareNames = new Map<number, ScriptVariableOccurrence>();
        for (const scope of scopeManager.scopes) {
            for (const ref of scope.references) {
                if (ref.resolved) continue;
                const name = ref.identifier.name;
                if (
                    !name ||
                    name === MISSING_IDENTIFIER ||
                    excludedNames.has(name) ||
                    isGlobalName(name)
                )
                    continue;
                const id = ref.identifier as unknown as acorn.Node;
                if (text.slice(id.start, id.end) !== name) continue;
                bareNames.set(id.start, {
                    text: name,
                    at: id.start,
                    assigned: false,
                    ...(storyVariableNames.has(name)
                        ? {}
                        : { role: "conditional-reference" as const }),
                });
            }
        }
        variables.push(...bareNames.values());

        if (recordRootDeclarations) {
            for (const scope of scopeManager.scopes) {
                if (scope.type !== "global" && scope.type !== "module")
                    continue;
                for (const variable of scope.variables) {
                    for (const def of variable.defs) {
                        if (
                            def.type !== "Variable" &&
                            def.type !== "FunctionName" &&
                            def.type !== "ClassName"
                        )
                            continue;
                        variables.push({
                            text: def.name.name,
                            at: (def.name as unknown as acorn.Node).start,
                            assigned: false,
                            role: "root-declaration",
                        });
                    }
                }
            }
        }

        variables.sort((a, b) => a.at - b.at);
        properties.sort((a, b) => a.at - b.at);
        return { variables, properties };
    };
}
