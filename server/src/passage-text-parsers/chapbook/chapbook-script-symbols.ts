import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";

import {
    ScriptPropertyOccurrence,
    ScriptSymbolExtractor,
    ScriptVariableOccurrence,
} from "../../js-parser";
import { createScriptAnalysis } from "../../script-analysis";

const identifierRegexp = /^[A-Za-z_$][\w$]*$/;

// acorn-loose's marker for a missing identifier
const MISSING_IDENTIFIER = "✖";

/**
 * Chapbook names that are never story variables, even when unbound.
 */
const excludedNames: ReadonlySet<string> = new Set(["engine", "go", "restart"]);

/**
 * Create an extractor for Chapbook script code, per ADR-0005.
 *
 * `engine.state.get`/`set`/`setDefault` with a literal key (or a
 * never-reassigned alias of `engine.state`) yield story variables and
 * properties. Every other unbound bare name yields a conditional reference,
 * which is never an assignment. Declarations are never story variables.
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

        acornWalk.full(ast, (rawNode) => {
            const node = rawNode as acorn.AnyNode;
            if (
                node.type !== "CallExpression" ||
                node.callee.type !== "MemberExpression" ||
                !isEngineState(node.callee.object)
            )
                return;
            const method = memberName(node.callee)?.name;
            if (method !== "get" && method !== "set" && method !== "setDefault")
                return;
            const key =
                node.arguments[0] && staticKeyName(node.arguments[0], true);
            if (!key) return;
            const segments = key.name.split(".");
            if (!segments.every((s) => identifierRegexp.test(s))) return;

            const assigned = method !== "get";
            let at = key.start;
            segments.forEach((segment, i) => {
                if (i === 0) {
                    variables.push({ text: segment, at, assigned });
                } else {
                    properties.push({
                        text: segment,
                        at,
                        scope: segments.slice(0, i).join("."),
                        assigned,
                        isCallee: false,
                    });
                }
                at += segment.length + 1;
            });
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
                const at = (ref.identifier as unknown as acorn.Node).start;
                bareNames.set(at, {
                    text: name,
                    at,
                    assigned: false,
                    role: "conditional",
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
