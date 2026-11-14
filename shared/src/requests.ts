// For interfaces and constants that need to be the same on client and server side

import { RequestType, RequestType0, URI } from "vscode-languageserver-protocol";

/**
 * The project's files that the server indexes, grouped by role.
 *
 * @typeParam U How a file is identified. Defaults to a URI string.
 */
export interface ProjectFiles<U = URI> {
    /** `.tw` and `.twee` files matched by `storySourceFiles` minus `ignores`. */
    tweeFiles: U[];
    /** `.js` files matched by `storySourceFiles` minus `ignores`. They're concatenated into the Story JavaScript. */
    storyScriptFiles: U[];
    /** `.js` files under `includeSourcePaths` minus `ignores`, excluding any story script file. They're copied beside the built story. */
    includedScripts: U[];
}

/**
 * Request from the server that the client find the project's Twee files,
 * story script files and included scripts.
 *
 * This isn't just a file glob (as per below) so clients can offer users more
 * control over what counts as part of a Twee 3 project.
 */
export const FindProjectFilesRequest: RequestType0<ProjectFiles, unknown> =
    new RequestType0("twee3/findProjectFiles");

/**
 * Request from the server that the client find files by a glob.
 */
export const FindFilesRequest: RequestType<string, URI[], unknown> =
    new RequestType("twee3/findFiles");

/**
 * Request from the server that the client read a file.
 */
export const ReadFileRequest: RequestType<
    { uri: URI; encoding?: string },
    string,
    unknown
> = new RequestType("fs/readFile");
