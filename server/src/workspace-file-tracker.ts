import { TextDocument } from "vscode-languageserver-textdocument";

import { ProjectFiles } from "@tt3/shared";
import { IndexingQueue } from "./indexing-queue";
import { Index, ScriptFileRole, scriptFileRoles } from "./project-index";

/** How long to wait after the last `.js` edit before re-parsing. */
export const scriptReparseDebounceMs = 300;

/** How long to wait after the last create or delete event before acting on them. */
export const fileEventDebounceMs = 300;

/** `.js` files bigger than this on disk aren't parsed, indexed or registered. */
export const maxScriptFileBytes = 5 * 1024 * 1024;

const sizeLimitText = `${maxScriptFileBytes / (1024 * 1024)} MB`;

/**
 * Everything the tracker needs from the outside world.
 */
export interface WorkspaceFileTrackerDeps {
    index: Pick<Index, "hasDocument" | "removeDocument" | "getStoryDataUri">;
    queue: Pick<IndexingQueue, "indexFile" | "indexWorkspace">;
    /** Ask the client for the project's resolved file sets. */
    findProjectFiles(): Promise<ProjectFiles>;
    /** Whether the editor has the document open (and so owns its contents). */
    isOpen(uri: string): boolean;
    parseMacroFile(uri: string): Promise<void>;
    onMacroChanges(): void;
    logError(message: string): void;
    /** Re-index an open `.js` buffer. */
    indexScriptFile(document: TextDocument, role: ScriptFileRole): void;
    /** Get a document's contents: the open buffer if there is one, else the file on disk. */
    readDocument(uri: string): Promise<TextDocument | undefined>;
    /** The set of resolved `.js` files changed, so features should be re-registered. */
    scriptFilesChanged(uris: string[]): void;
    /** Re-validate every open Twee document. */
    revalidateOpenTweeDocuments(): Promise<void>;
    /** Get a file's on-disk metadata. */
    stat(uri: string): Promise<{ size: number }>;
    /** Write a line to the output channel. */
    log(message: string): void;
    /** Show the author a warning notification. */
    showWarning(message: string): void;
}

/**
 * A watched file's URI and what happened to it.
 */
export interface WatchedFileChange {
    uri: string;
    kind: "created" | "changed" | "deleted";
}

/**
 * Follow-up work owed for deletes since the last file-event flush.
 */
interface PendingDeletes {
    /** A deleted file held StoryData, so the whole workspace must be reindexed. */
    storyData: boolean;
    /** A deleted file was a resolved `.js` file, so features must be re-registered. */
    scriptFiles: boolean;
    /** Something was removed from the index, so open Twee documents must be revalidated. */
    any: boolean;
}

function noPendingDeletes(): PendingDeletes {
    return { storyData: false, scriptFiles: false, any: false };
}

/**
 * Handles watched-file events and open-buffer edits.
 */
export class WorkspaceFileTracker {
    private pendingScripts = new Map<string, TextDocument>();
    private tweeFiles: Set<string> | undefined;
    private scriptRoles: Map<string, ScriptFileRole> | undefined;
    private scriptTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingCreates = new Set<string>();
    private pendingDeletes = noPendingDeletes();
    private fileEventTimer: ReturnType<typeof setTimeout> | undefined;
    /** Resolves run one at a time, so a slow one can't overwrite a newer result. */
    private resolveChain: Promise<unknown> = Promise.resolve();
    /** Resolved `.js` files skipped for size, as of the last resolve. */
    private oversizedScripts = new Set<string>();
    /** Oversized files already reported in the output channel. */
    private loggedOversized = new Set<string>();
    private warnedOversized = false;

    constructor(private readonly deps: WorkspaceFileTrackerDeps) {}

    /**
     * Note an edit to an open resolved `.js` buffer; it's re-parsed after a debounce.
     */
    handleScriptBufferChanged(document: TextDocument): void {
        this.pendingScripts.set(document.uri, document);
        clearTimeout(this.scriptTimer);
        this.scriptTimer = setTimeout(
            () => this.flushPendingScripts(),
            scriptReparseDebounceMs,
        );
    }

    /**
     * Synchronously re-parse every pending `.js` buffer, then revalidate open Twee documents.
     */
    flushPendingScripts(): void {
        clearTimeout(this.scriptTimer);
        this.scriptTimer = undefined;
        if (this.pendingScripts.size === 0) return;
        const pending = [...this.pendingScripts.values()];
        this.pendingScripts.clear();
        for (const doc of pending) {
            const role = this.scriptRoles?.get(doc.uri);
            if (role !== undefined) {
                this.deps.indexScriptFile(doc, role);
            }
        }
        void this.deps.revalidateOpenTweeDocuments();
    }

    /**
     * Record the resolved file sets that decide which watcher events matter.
     */
    setFileSets(files: ProjectFiles): void {
        this.tweeFiles = new Set(files.tweeFiles);
        this.scriptRoles = scriptFileRoles(files);
    }

    /**
     * Handle watcher events.
     */
    async handleWatchedFileChanges(
        changes: WatchedFileChange[],
    ): Promise<void> {
        const tweeChanges: WatchedFileChange[] = [];
        const scriptChanges: WatchedFileChange[] = [];
        for (const change of changes) {
            if (/\.twee-config\.(json|ya?ml)$/.test(change.uri)) {
                void this.deps.parseMacroFile(change.uri);
                this.deps.onMacroChanges();
            } else if (change.kind === "created") {
                this.pendingCreates.add(change.uri);
                this.scheduleFileEventFlush();
            } else if (change.kind === "deleted") {
                this.handleDeleted(change.uri);
            } else if (change.uri.endsWith(".js")) {
                scriptChanges.push(change);
            } else {
                tweeChanges.push(change);
            }
        }
        if (tweeChanges.length === 0 && scriptChanges.length === 0) return;

        if (!(await this.ensureFileSets())) return;
        // Open files are checked too, as sync doesn't tell us their on-disk size
        const scripts = await this.withoutSizeChanges(
            scriptChanges.map((c) => c.uri),
        );
        await this.reindexScriptsFromDisk(
            scripts.filter((uri) => !this.deps.isOpen(uri)),
        );
        for (const change of tweeChanges) {
            if (
                this.isTrackedTweeFile(change.uri) &&
                !this.deps.isOpen(change.uri)
            ) {
                this.deps.queue.indexFile(change.uri);
            }
        }
    }

    /**
     * Find changed `.js` files that crossed the size limit, and re-resolve the
     * file sets for them, so they leave or join the sets like a delete or create.
     *
     * @returns The files that didn't cross the limit.
     */
    private async withoutSizeChanges(uris: string[]): Promise<string[]> {
        const sizes = await Promise.all(
            uris.map(async (uri) =>
                this.scriptRoles?.has(uri) || this.oversizedScripts.has(uri)
                    ? await this.isOversized(uri)
                    : undefined,
            ),
        );
        return uris.filter((uri, i) => {
            const oversized = sizes[i];
            if (
                oversized === undefined ||
                oversized === this.oversizedScripts.has(uri)
            ) {
                return true;
            }
            this.pendingCreates.add(uri);
            this.scheduleFileEventFlush();
            return false;
        });
    }

    /**
     * Ask the client for the resolved file sets, minus any `.js` file too big
     * to scan, after any resolve already running.
     */
    fetchScannableFileSets(): Promise<ProjectFiles> {
        return this.serialize(() => this.findScannableFileSets());
    }

    private async findScannableFileSets(): Promise<ProjectFiles> {
        const files = await this.deps.findProjectFiles();
        const scripts = [...files.storyScriptFiles, ...files.includedScripts];
        const oversized = new Set<string>();
        await Promise.all(
            scripts.map(async (uri) => {
                if (await this.isOversized(uri)) oversized.add(uri);
            }),
        );
        this.oversizedScripts = oversized;
        for (const uri of scripts.filter((u) => oversized.has(u))) {
            this.reportOversized(uri);
        }
        return {
            tweeFiles: files.tweeFiles,
            storyScriptFiles: files.storyScriptFiles.filter(
                (uri) => !oversized.has(uri),
            ),
            includedScripts: files.includedScripts.filter(
                (uri) => !oversized.has(uri),
            ),
        };
    }

    /**
     * Whether a file is over the size limit on disk. A file we can't stat
     * isn't, so reading it reports the failure.
     */
    private async isOversized(uri: string): Promise<boolean> {
        try {
            return (await this.deps.stat(uri)).size > maxScriptFileBytes;
        } catch {
            return false;
        }
    }

    /**
     * Tell the author about a skipped file: an output line once per file,
     * and a warning once per session.
     */
    private reportOversized(uri: string): void {
        if (this.loggedOversized.has(uri)) return;
        this.loggedOversized.add(uri);
        const reason = `it's over ${sizeLimitText}, so rename and find-references won't see story variable uses in it`;
        this.deps.log(`Skipped ${uri}: ${reason}.`);
        if (this.warnedOversized) return;
        this.warnedOversized = true;
        this.deps.showWarning(
            `${uri} wasn't scanned because ${reason}. Add it to "ignores" in tt3.config.json to silence this warning.`,
        );
    }

    /**
     * Remove a deleted file from the index at once, so requests never see it,
     * and defer the follow-up work to the file-event flush.
     * A rename arrives as delete + create, so both land in the same flush.
     */
    private handleDeleted(uri: string): void {
        if (!this.deps.index.hasDocument(uri)) return;
        const pending = this.pendingDeletes;
        if (this.deps.index.getStoryDataUri() === uri) pending.storyData = true;
        if (this.scriptRoles?.delete(uri)) pending.scriptFiles = true;
        this.tweeFiles?.delete(uri);
        this.deps.index.removeDocument(uri);
        pending.any = true;
        this.scheduleFileEventFlush();
    }

    /**
     * Re-read a closed Twee file from disk so unsaved edits don't linger in the index.
     */
    async handleDocumentClosed(uri: string): Promise<void> {
        if (!(await this.ensureFileSets())) return;
        if (this.isTrackedTweeFile(uri)) {
            this.deps.queue.indexFile(uri);
        } else {
            await this.reindexScriptsFromDisk(
                await this.withoutSizeChanges([uri]),
            );
        }
    }

    /**
     * Re-read resolved `.js` files and re-index them, then revalidate open Twee documents.
     * Files outside the resolved sets are ignored.
     */
    private async reindexScriptsFromDisk(uris: string[]): Promise<void> {
        const resolved: [string, ScriptFileRole][] = [];
        for (const uri of uris) {
            const role = this.scriptRoles?.get(uri);
            if (role !== undefined) resolved.push([uri, role]);
        }
        if (await this.reindexScripts(resolved)) {
            await this.deps.revalidateOpenTweeDocuments();
        }
    }

    /**
     * Read and re-index `.js` files with the given roles.
     *
     * @returns Whether any file was re-indexed.
     */
    private async reindexScripts(
        scripts: Iterable<[string, ScriptFileRole]>,
    ): Promise<boolean> {
        let reindexed = false;
        for (const [uri, role] of scripts) {
            const doc = await this.deps.readDocument(uri);
            if (doc === undefined) continue;
            this.deps.indexScriptFile(doc, role);
            reindexed = true;
        }
        return reindexed;
    }

    /**
     * Bring the index in step with a changed script file set.
     *
     * @param previous The script files and roles before the change.
     * @returns Whether the set's membership changed, and whether the index changed.
     */
    private async applyScriptSetChange(
        previous: Map<string, ScriptFileRole>,
    ): Promise<{ membershipChanged: boolean; indexChanged: boolean }> {
        const current = this.scriptRoles ?? new Map<string, ScriptFileRole>();
        const removed = [...previous.keys()].filter((uri) => !current.has(uri));
        const changed = [...current].filter(
            ([uri, role]) => previous.get(uri) !== role,
        );
        for (const uri of removed) this.deps.index.removeDocument(uri);
        const reindexed = await this.reindexScripts(changed);
        return {
            membershipChanged:
                removed.length > 0 ||
                changed.some(([uri]) => !previous.has(uri)),
            indexChanged: removed.length > 0 || reindexed,
        };
    }

    private scheduleFileEventFlush(): void {
        clearTimeout(this.fileEventTimer);
        this.fileEventTimer = setTimeout(
            () => void this.flushFileEvents(),
            fileEventDebounceMs,
        );
    }

    /**
     * Act on the creates and deletes since the last flush: re-resolve the file
     * sets if anything was created, then re-register and revalidate once.
     */
    private flushFileEvents(): Promise<void> {
        this.fileEventTimer = undefined;
        const created = [...this.pendingCreates];
        this.pendingCreates.clear();
        const deletes = this.pendingDeletes;
        this.pendingDeletes = noPendingDeletes();
        if (deletes.storyData) {
            // A workspace index re-resolves, re-registers and revalidates everything
            this.deps.queue.indexWorkspace();
            return Promise.resolve();
        }
        return this.serialize(async () => {
            let reregister = deletes.scriptFiles;
            let revalidate = deletes.any;
            let tweeQueued = false;
            const previous = this.scriptRoles;
            if (created.length > 0 && (await this.fetchFileSets())) {
                if (previous !== undefined) {
                    const change = await this.applyScriptSetChange(previous);
                    reregister ||= change.membershipChanged;
                    revalidate ||= change.indexChanged;
                }
                for (const uri of created) {
                    if (this.isTrackedTweeFile(uri)) {
                        this.deps.queue.indexFile(uri);
                        tweeQueued = true;
                    }
                }
            }
            if (reregister) {
                this.deps.scriptFilesChanged([
                    ...(this.scriptRoles?.keys() ?? []),
                ]);
            }
            // The queue revalidates after indexing, so revalidating now would
            // briefly show diagnostics from a half-applied rename
            if (revalidate && !tweeQueued) {
                await this.deps.revalidateOpenTweeDocuments();
            }
        });
    }

    /**
     * Whether the URI is in the resolved Twee file set.
     */
    private isTrackedTweeFile(uri: string): boolean {
        return this.tweeFiles?.has(uri) ?? false;
    }

    /**
     * Make sure the file sets are known, resolving them if we haven't yet
     * (as when events arrive before the first workspace index).
     */
    private async ensureFileSets(): Promise<boolean> {
        return this.tweeFiles !== undefined || (await this.resolveFileSets());
    }

    /**
     * Ask the client for the file sets, after any resolve already running.
     */
    private resolveFileSets(): Promise<boolean> {
        return this.serialize(() => this.fetchFileSets());
    }

    /**
     * Run a task after every earlier one, so a slow resolve can't overwrite a newer result.
     */
    private serialize<T>(task: () => Promise<T>): Promise<T> {
        const result = this.resolveChain.then(task);
        this.resolveChain = result.catch(() => undefined);
        return result;
    }

    /**
     * Ask the client for the file sets. On failure, log and return false:
     * a reindex would make the same failing request.
     */
    private async fetchFileSets(): Promise<boolean> {
        try {
            this.setFileSets(await this.findScannableFileSets());
            return true;
        } catch (err) {
            this.deps.logError(`Couldn't resolve the project's files: ${err}`);
            return false;
        }
    }
}
