import { TextDocumentFilter } from "vscode-languageserver/node";

/**
 * Escape glob metacharacters in a literal path so it matches only itself.
 */
export function escapeGlob(path: string): string {
    return path.replace(/[*?[{}]/g, (c) => `[${c}]`);
}

/**
 * Build a document selector matching exactly the given `file:` script URIs.
 *
 * @param uris URIs of the resolved script files.
 */
export function buildScriptFileSelector(
    uris: readonly string[],
): TextDocumentFilter[] {
    const filters: TextDocumentFilter[] = [];
    for (const uri of uris) {
        let path: string;
        try {
            const url = new URL(uri);
            if (url.protocol !== "file:") continue;
            path = decodeURIComponent(url.pathname);
        } catch {
            continue;
        }
        filters.push({ scheme: "file", pattern: escapeGlob(path) });
    }
    return filters;
}
