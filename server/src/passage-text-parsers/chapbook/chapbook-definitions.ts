import { Definition, Location, Position } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { ProjectIndex } from "../../project-index";
import { getChapbookDefinitions } from "./chapbook-parser";
import { isDisqualifiedConditionalAt } from "./chapbook-references";
import { OChapbookSymbolKind } from "./types";

const variableKinds: number[] = [
    OChapbookSymbolKind.Variable,
    OChapbookSymbolKind.VariableSet,
    OChapbookSymbolKind.ConditionalReference,
];

export function getDefinitionAt(
    document: TextDocument,
    position: Position,
    index: ProjectIndex,
): Definition | undefined {
    // The index will find all regular definitions and references.
    // It won't work for custom inserts and modifiers, however, as they're
    // matched through a regex test, or for story variables, whose
    // definitions are every location that sets them.

    const ref = index.getAllReferencesAt(document.uri, position);
    if (ref === undefined) return undefined;

    if (variableKinds.includes(ref.kind)) {
        if (isDisqualifiedConditionalAt(document.uri, position, index))
            return undefined;
        const locations: Location[] = [];
        for (const uri of index.getIndexedUris()) {
            for (const setRef of index.getReferences(
                uri,
                OChapbookSymbolKind.VariableSet,
            ) ?? []) {
                if (setRef.contents === ref.contents)
                    locations.push(...setRef.locations);
            }
        }
        return locations.length > 0 ? locations : undefined;
    }

    const definition = getChapbookDefinitions(ref.kind, index).find((def) =>
        def.match.test(ref.contents),
    );
    return definition?.location;
}
