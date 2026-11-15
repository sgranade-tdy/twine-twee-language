import { Location, Position } from "vscode-languageserver";

import { ProjectIndex } from "../../project-index";
import { OChapbookSymbolKind } from "./types";

/**
 * Kinds whose references all refer to a story variable.
 */
export const variableKinds: readonly number[] = [
    OChapbookSymbolKind.Variable,
    OChapbookSymbolKind.VariableSet,
    OChapbookSymbolKind.ConditionalReference,
];

// Kinds whose references all refer to the same thing
const linkedKindGroups: (readonly number[])[] = [
    variableKinds,
    [OChapbookSymbolKind.Property, OChapbookSymbolKind.PropertySet],
];

/**
 * Does a document have its own script scope, rather than sharing the story's
 * concatenated one? Only included scripts do.
 */
function hasOwnScope(index: ProjectIndex, uri: string): boolean {
    return index.getScriptFileRole(uri) === "included-script";
}

/**
 * Get a predicate that says whether a conditional reference (a bare name in
 * script code) to a variable currently counts as a reference to it.
 *
 * It counts only if the project defines the variable somewhere and no
 * root-level declaration in a story script file or `script` passage binds that
 * name (ADR-0005). Included scripts have their own scope, so their
 * declarations don't count, and a reference inside one isn't affected by
 * declarations elsewhere.
 * Evaluating this at query time means no file has to be re-parsed when another
 * file changes.
 *
 * @param index Project index.
 * @returns Predicate taking a variable's name and the URI of the document that holds the reference.
 */
export function conditionalReferenceQualifier(
    index: ProjectIndex,
): (name: string, uri: string) => boolean {
    const defined = new Set(
        index
            .getProjectReferences([OChapbookSymbolKind.VariableSet])
            .map((ref) => ref.contents),
    );
    const declared = new Set(
        index
            .getProjectReferences(
                [OChapbookSymbolKind.RootDeclaration],
                (uri) => !hasOwnScope(index, uri),
            )
            .map((ref) => ref.contents),
    );
    return (name, uri) =>
        defined.has(name) && (hasOwnScope(index, uri) || !declared.has(name));
}

/**
 * Is the symbol at a position a conditional reference that doesn't currently
 * count as a reference?
 */
export function isDisqualifiedConditionalAt(
    documentUri: string,
    position: Position,
    index: ProjectIndex,
    qualifies?: (name: string, uri: string) => boolean,
): boolean {
    const ref = index.getAllReferencesAt(documentUri, position);
    if (ref?.kind !== OChapbookSymbolKind.ConditionalReference) return false;
    return !(qualifies ?? conditionalReferenceQualifier(index))(
        ref.contents,
        documentUri,
    );
}

export function getReferencesToSymbolAt(
    documentUri: string,
    position: Position,
    index: ProjectIndex,
    includeDeclaration: boolean,
): Location[] | undefined {
    const qualifies = conditionalReferenceQualifier(index);
    if (isDisqualifiedConditionalAt(documentUri, position, index, qualifies))
        return undefined;

    // Because we track variable references separately from variable-being-set locations,
    // when getting references to one of those (like a variable), we have to add in
    // the locations of the other (where that variable is set in a Chapbook vars section).
    const refs = index.getReferencesToSymbolAt(
        documentUri,
        position,
        includeDeclaration,
    );
    const kind = refs?.kind;
    if (refs === undefined || kind === undefined) return refs?.locations;

    const otherKinds = (
        linkedKindGroups.find((group) => group.includes(kind)) ?? []
    ).filter((k) => k !== kind);
    if (otherKinds.length === 0) return refs.locations;

    const otherLocations = otherKinds.flatMap((otherKind) =>
        index
            .getProjectReferences(
                [otherKind],
                (uri) =>
                    otherKind !== OChapbookSymbolKind.ConditionalReference ||
                    qualifies(refs.contents, uri),
            )
            .filter((otherRef) => otherRef.contents === refs.contents)
            .flatMap((otherRef) => otherRef.locations),
    );
    return [...refs.locations, ...otherLocations];
}
