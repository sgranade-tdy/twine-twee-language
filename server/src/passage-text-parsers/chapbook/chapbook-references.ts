import { Location, Position } from "vscode-languageserver";

import { ProjectIndex } from "../../project-index";
import { OChapbookSymbolKind } from "./types";

const linkedTypes = {
    [OChapbookSymbolKind.Variable]: OChapbookSymbolKind.VariableSet,
    [OChapbookSymbolKind.VariableSet]: OChapbookSymbolKind.Variable,
    [OChapbookSymbolKind.Property]: OChapbookSymbolKind.PropertySet,
    [OChapbookSymbolKind.PropertySet]: OChapbookSymbolKind.Property,
};

/**
 * Get a predicate that says whether a conditional reference (a bare name in
 * script code) to a variable currently counts as a reference to it.
 *
 * It counts only if the project defines the variable somewhere and no
 * root-level declaration in a `script` passage binds that name (ADR-0005).
 * Evaluating this at query time means no file has to be re-parsed when another
 * file changes.
 *
 * @param index Project index.
 * @returns Predicate taking a variable's name.
 */
export function conditionalReferenceQualifier(
    index: ProjectIndex,
): (name: string) => boolean {
    const defined = new Set<string>();
    const declared = new Set<string>();
    for (const uri of index.getIndexedUris()) {
        for (const ref of index.getReferences(
            uri,
            OChapbookSymbolKind.VariableSet,
        ) ?? [])
            defined.add(ref.contents);
        for (const ref of index.getReferences(
            uri,
            OChapbookSymbolKind.RootDeclaration,
        ) ?? [])
            declared.add(ref.contents);
    }
    return (name) => defined.has(name) && !declared.has(name);
}

/**
 * Is the symbol at a position a conditional reference that doesn't currently
 * count as a reference?
 */
export function isDisqualifiedConditionalAt(
    documentUri: string,
    position: Position,
    index: ProjectIndex,
): boolean {
    const ref = index.getAllReferencesAt(documentUri, position);
    return (
        ref?.kind === OChapbookSymbolKind.ConditionalVariable &&
        !conditionalReferenceQualifier(index)(ref.contents)
    );
}

export function getReferencesToSymbolAt(
    documentUri: string,
    position: Position,
    index: ProjectIndex,
    includeDeclaration: boolean,
): Location[] | undefined {
    if (isDisqualifiedConditionalAt(documentUri, position, index))
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

    // Variable-ish references are all references to one variable, and so is
    // any conditional reference that qualifies
    const isVariableKind =
        kind === OChapbookSymbolKind.Variable ||
        kind === OChapbookSymbolKind.VariableSet ||
        kind === OChapbookSymbolKind.ConditionalVariable;
    const otherKinds: number[] = isVariableKind
        ? [
              OChapbookSymbolKind.Variable,
              OChapbookSymbolKind.VariableSet,
              OChapbookSymbolKind.ConditionalVariable,
          ].filter((k) => k !== kind)
        : Object.keys(linkedTypes).includes(kind.toString())
          ? [linkedTypes[kind as keyof typeof linkedTypes]]
          : [];
    if (otherKinds.length === 0) return refs.locations;

    const qualifies = conditionalReferenceQualifier(index);
    const locations: Location[] = refs.locations;
    for (const uri of index.getIndexedUris()) {
        for (const otherKind of otherKinds) {
            if (
                otherKind === OChapbookSymbolKind.ConditionalVariable &&
                !qualifies(refs.contents)
            )
                continue;
            for (const otherRef of index.getReferences(uri, otherKind) ?? []) {
                if (otherRef.contents === refs.contents)
                    locations.push(...otherRef.locations);
            }
        }
    }

    return locations;
}
