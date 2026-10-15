import { Range } from "vscode-languageserver";

import type { StoryFormatParsingState } from "../types";
import type { MacroInfo } from "./macros/types";
import type { EnumRecord } from "./sc2/t3lt-parameters";

/**
 * Location information about a macro
 */
export interface MacroLocationInfo {
    /**
     * The macro's name (ex: "if")
     */
    name: string;
    /**
     * The full text of a macro (ex: "<<if $v > 1>>")
     */
    fullText: string;
    /**
     * Index where the full text occurs.
     */
    at: number;
    /**
     * Macro ID, to disambiguate macros with the same name
     */
    id: number;
}

/**
 * SugarCube-specific parsing state information.
 */
export interface SugarCubeParsingState extends StoryFormatParsingState {
    /**
     * Container macros that are open (i.e. no close macro has been encountered).
     */
    unclosedMacros: MacroLocationInfo[];
    /**
     * Ranges of <<widget>> macros in the document, since they create variables.
     */
    widgetMacroRanges: Range[];
    api: SugarCubeParserAPI;
}

/**
 * Macro and macro-enum lookups that the SugarCube parser uses.
 */
export interface SugarCubeParserAPI {
    allMacros: () => Readonly<Record<string, MacroInfo>>;
    allMacroEnums: () => Readonly<EnumRecord>;
}
