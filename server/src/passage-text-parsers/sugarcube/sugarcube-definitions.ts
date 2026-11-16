import { Definition, Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { ProjectIndex } from "../../project-index";
import { getAssignmentLocations } from "../assignments";
import { OSugarCubeSymbolKind } from "./types";

// Which kind of assignment defines each kind of reference
const assignmentKinds: Record<number, number> = {
    [OSugarCubeSymbolKind.Variable]: OSugarCubeSymbolKind.VariableSet,
    [OSugarCubeSymbolKind.VariableSet]: OSugarCubeSymbolKind.VariableSet,
    [OSugarCubeSymbolKind.Property]: OSugarCubeSymbolKind.PropertySet,
    [OSugarCubeSymbolKind.PropertySet]: OSugarCubeSymbolKind.PropertySet,
};

/**
 * Get a story variable or story property's assignments.
 */
export function getDefinitionAt(
    document: TextDocument,
    position: Position,
    index: ProjectIndex,
): Definition | undefined {
    const ref = index.getAllReferencesAt(document.uri, position);
    if (ref === undefined) return undefined;
    const assignmentKind = assignmentKinds[ref.kind];
    if (assignmentKind === undefined) return undefined;

    return getAssignmentLocations(index, assignmentKind, ref.contents);
}
