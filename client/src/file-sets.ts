import { URI, Utils as UriUtils } from "vscode-uri";

import { FileType, WorkspaceProvider } from "./workspace-provider";

/**
 * The parts of the project config that decide which files belong to a story.
 */
export interface FileSetConfig {
    build: {
        storySourceFiles: string[];
        includeSourcePaths?: string[];
        ignores?: string[];
    };
}

/**
 * The project's files, grouped by role.
 */
export interface FileSets {
    /** `.tw` and `.twee` files matched by `storySourceFiles` minus `ignores`. */
    tweeFiles: URI[];
    /** `.js` files matched by `storySourceFiles` minus `ignores`. */
    storyScriptFiles: URI[];
    /** `.js` files under `includeSourcePaths` minus `ignores`, excluding any story script file. */
    includedScripts: URI[];
}

function removeEndingSlash(str: string): string {
    return str.endsWith("/") ? str.slice(0, -1) : str;
}

/**
 * Find files that match a source list of globs w/optional ignored patterns.
 * @param sources Files to find as a list of glob patterns.
 * @param ignores Files to be ignored, also as a list of glob patterns.
 * @param workspaceProvider Workspace provider.
 * @returns List of found files.
 */
export async function getFilesFromSources(
    sources: string[],
    ignores: string[] | undefined,
    workspaceProvider: WorkspaceProvider,
): Promise<URI[]> {
    sources = sources.map((source) => source.trim());
    ignores = ignores?.map((ignore) => ignore.trim());

    const joinedSources = !sources.some((p) => p.includes("{"))
        ? "{" + sources.join(",") + "}"
        : undefined;
    // There's no ignores, just sources
    if (ignores === undefined) {
        if (joinedSources) {
            // Simple case: no groups in sources, so we can concatenate them
            return await workspaceProvider.findFiles(joinedSources, null);
        } else {
            // Moderate case: iterate over sources
            const sourceURIs = (
                await Promise.all(
                    sources.map(async (source) => {
                        return await workspaceProvider.findFiles(source, null);
                    }),
                )
            ).flat();
            return [...new Set(sourceURIs)];
        }
    }

    const joinedIgnores = !ignores.some((p) => p.includes("{"))
        ? "{" + ignores.join(",") + "}"
        : undefined;
    // There's ignores, and they can be concatentated
    if (joinedIgnores) {
        if (joinedSources) {
            // Simple case: no groups in sources or ignores
            return await workspaceProvider.findFiles(
                joinedSources,
                joinedIgnores,
            );
        } else {
            // Moderate case: iterate over sources w/a single ignores
            const sourceURIs = (
                await Promise.all(
                    sources.map(async (source) => {
                        return await workspaceProvider.findFiles(
                            source,
                            joinedIgnores,
                        );
                    }),
                )
            ).flat();
            return [...new Set(sourceURIs)];
        }
    }

    // There's ignores, and we need to iterate over them
    if (joinedSources) {
        // Moderate case: iterate over ignores w/a single sources
        const sourceURIs = (
            await Promise.all(
                ignores.map(async (ignore) => {
                    return await workspaceProvider.findFiles(
                        joinedSources,
                        ignore,
                    );
                }),
            )
        ).flat();
        return [...new Set(sourceURIs)];
    } else {
        // Complex case: iterate over sources and ignores
        // (sigh, hello combinatoric explosion)
        // TODO When we target es2024 (starting w/VS Code 1.123 2026-06-03), use Set operations
        const sourceURIs: URI[] = [];
        for (const source of sources) {
            // For any given source, find the set intersection of files
            // that are present in every iteration of `ignores`
            let singleSourceList = await workspaceProvider.findFiles(
                source,
                ignores[0],
            );
            for (const ignore of ignores.slice(1)) {
                const newSourceList = await workspaceProvider.findFiles(
                    source,
                    ignore,
                );
                singleSourceList = singleSourceList.filter((source) =>
                    newSourceList.includes(source),
                );
            }
            sourceURIs.push(...singleSourceList);
        }
        return [...new Set(sourceURIs)];
    }
}

/**
 * Resolve one `includeSourcePaths` entry the way the build does: a directory becomes
 * `<dir>/**\/*`, a file stays as written, and `ignores` is subtracted.
 * @param entry Entry from `includeSourcePaths`, without a trailing slash.
 * @param ignores Glob patterns to ignore.
 * @param workspaceProvider Workspace provider.
 * @returns Whether the entry is a directory, its URI, and the files it yields.
 * @throws If the entry can't be stat'd.
 */
export async function resolveIncludeEntry(
    entry: string,
    ignores: string[] | undefined,
    workspaceProvider: WorkspaceProvider,
): Promise<{ isDirectory: boolean; sourceUri: URI; files: URI[] }> {
    const sourceUri = UriUtils.joinPath(
        workspaceProvider.rootWorkspaceUri() ?? URI.file("."),
        entry,
    );
    const isDirectory =
        (await workspaceProvider.fs.stat(sourceUri)).type ===
        FileType.Directory;
    const files = await getFilesFromSources(
        [isDirectory ? entry + "/**/*" : entry],
        ignores,
        workspaceProvider,
    );
    return { isDirectory, sourceUri, files };
}

function hasExtension(uri: URI, extensions: string[]): boolean {
    const path = uri.path.toLowerCase();
    return extensions.some((ext) => path.endsWith(ext));
}

/**
 * Resolve the project's Twee files, story script files and included scripts.
 * @param config Project config.
 * @param workspaceProvider Workspace provider.
 */
export async function resolveFileSets(
    config: FileSetConfig,
    workspaceProvider: WorkspaceProvider,
): Promise<FileSets> {
    const sourceFiles = await getFilesFromSources(
        config.build.storySourceFiles,
        config.build.ignores,
        workspaceProvider,
    );
    const tweeFiles = sourceFiles.filter((f) =>
        hasExtension(f, [".tw", ".twee"]),
    );
    const storyScriptFiles = sourceFiles.filter((f) =>
        hasExtension(f, [".js"]),
    );
    const storyScriptKeys = new Set(storyScriptFiles.map((f) => f.toString()));

    const included = new Map<string, URI>();
    for (const rawEntry of config.build.includeSourcePaths ?? []) {
        let files: URI[];
        try {
            files = (
                await resolveIncludeEntry(
                    removeEndingSlash(rawEntry),
                    config.build.ignores,
                    workspaceProvider,
                )
            ).files;
        } catch {
            continue; // Missing entries just contribute nothing
        }
        for (const f of files) {
            const key = f.toString();
            if (hasExtension(f, [".js"]) && !storyScriptKeys.has(key)) {
                included.set(key, f);
            }
        }
    }

    return {
        tweeFiles,
        storyScriptFiles,
        includedScripts: [...included.values()],
    };
}
