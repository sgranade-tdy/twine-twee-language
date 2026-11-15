import { Definition, Location, Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { ProjectIndex } from "../../project-index";
import { OSugarCubeSymbolKind } from "./types";

/**
 * Get the definition of a story variable: every location that sets it.
 */
export function getDefinitionAt(
    document: TextDocument,
    position: Position,
    index: ProjectIndex,
): Definition | undefined {
    const ref = index.getAllReferencesAt(document.uri, position);
    if (
        ref?.kind !== OSugarCubeSymbolKind.Variable &&
        ref?.kind !== OSugarCubeSymbolKind.VariableSet
    )
        return undefined;

    const locations: Location[] = [];
    for (const uri of index.getIndexedUris()) {
        for (const setRef of index.getReferences(
            uri,
            OSugarCubeSymbolKind.VariableSet,
        ) ?? []) {
            if (setRef.contents === ref.contents)
                locations.push(...setRef.locations);
        }
    }
    return locations.length > 0 ? locations : undefined;
}
