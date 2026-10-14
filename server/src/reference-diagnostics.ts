import { Diagnostic } from "vscode-languageserver";

import { DiagnosticCode } from "@tt3/shared";
import { createDiagnosticFromRange } from "./diagnostics";
import { ProjectIndex, References } from "./project-index";

/**
 * Create diagnostics from references.
 *
 * @param index Project index.
 * @param refs References.
 * @param code Diagnostic code to apply.
 * @param message Optional diagnostic message.
 * @returns Diagnostics.
 */
export function referencesToDiagnostics(
    index: ProjectIndex,
    refs: References,
    code: DiagnosticCode,
    message?: string,
): Diagnostic[] {
    return refs.locations
        .filter((loc) => !index.diagnosticIsDisabled(loc.uri, code, loc.range))
        .map((loc) => createDiagnosticFromRange(code, loc.range, message));
}
