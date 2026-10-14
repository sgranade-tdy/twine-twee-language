import { Diagnostic, Location } from "vscode-languageserver";

import { DiagnosticCode } from "@tt3/shared";

/**
 * A label, which has a name and a location.
 */
export interface Label {
    contents: string;
    location: Location;
}

/**
 * Twine diagnostic.
 */
export interface TwineDiagnostic extends Diagnostic {
    code: DiagnosticCode;
}
