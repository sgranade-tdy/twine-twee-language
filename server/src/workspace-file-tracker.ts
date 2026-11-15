import { TextDocument } from "vscode-languageserver-textdocument";

import { ProjectFiles } from "@tt3/shared";
import { IndexingQueue } from "./indexing-queue";
import { Index, ScriptFileRole } from "./project-index";

/** How long to wait after the last `.js` edit before re-parsing. */
export const scriptReparseDebounceMs = 300;

/** How long to wait after the last create event before re-resolving the file sets. */
export const fileSetResolveDebounceMs = 300;

/**
 * Everything the tracker needs from the outside world.
 */
export interface WorkspaceFileTrackerDeps {
    index: Pick<
        Index,
        "removeDocument" | "getScriptFileRole" | "getStoryDataUri"
    >;
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
    /** Re-validate every open Twee document. */
    revalidateOpenTweeDocuments(): Promise<void>;
}

/**
 * A watched file's URI and what happened to it.
 */
export interface WatchedFileChange {
    uri: string;
    kind: "created" | "changed" | "deleted";
}

/**
 * Handles watched-file events and open-buffer edits.
 */
export class WorkspaceFileTracker {
    private pendingScripts = new Map<string, TextDocument>();
    private tweeFiles: Set<string> | undefined;
    private scriptTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingCreates = new Set<string>();
    private createTimer: ReturnType<typeof setTimeout> | undefined;
    /** Resolves run one at a time, so a slow one can't overwrite a newer result. */
    private resolveChain: Promise<unknown> = Promise.resolve();

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
            const role = this.deps.index.getScriptFileRole(doc.uri);
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
    }

    /**
     * Handle watcher events.
     */
    async handleWatchedFileChanges(
        changes: WatchedFileChange[],
    ): Promise<void> {
        const tweeChanges: WatchedFileChange[] = [];
        for (const change of changes) {
            if (/\.twee-config\.(json|ya?ml)$/.test(change.uri)) {
                void this.deps.parseMacroFile(change.uri);
                this.deps.onMacroChanges();
            } else if (change.kind === "created") {
                this.handleCreated(change.uri);
            } else {
                tweeChanges.push(change);
            }
        }
        if (tweeChanges.length === 0) return;

        if (!(await this.ensureFileSets())) return;
        for (const change of tweeChanges) {
            if (!this.isTrackedTweeFile(change.uri)) continue;
            if (change.kind === "deleted") {
                await this.handleTweeDeleted(change.uri);
            } else if (!this.deps.isOpen(change.uri)) {
                this.deps.queue.indexFile(change.uri);
            }
        }
    }

    /**
     * Re-read a closed Twee file from disk so unsaved edits don't linger in the index.
     */
    async handleDocumentClosed(uri: string): Promise<void> {
        if (!(await this.ensureFileSets())) return;
        if (this.isTrackedTweeFile(uri)) {
            this.deps.queue.indexFile(uri);
        }
    }

    /**
     * Note a created file; the file sets are re-resolved after a debounce.
     */
    private handleCreated(uri: string): void {
        this.pendingCreates.add(uri);
        clearTimeout(this.createTimer);
        this.createTimer = setTimeout(
            () => void this.flushPendingCreates(),
            fileSetResolveDebounceMs,
        );
    }

    private async flushPendingCreates(): Promise<void> {
        this.createTimer = undefined;
        const created = [...this.pendingCreates];
        this.pendingCreates.clear();
        if (!(await this.resolveFileSets())) return;
        for (const uri of created) {
            if (this.isTrackedTweeFile(uri)) {
                this.deps.queue.indexFile(uri);
            }
        }
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
     * Ask the client for the file sets. On failure, log and drop the event:
     * a reindex would make the same failing request.
     */
    private resolveFileSets(): Promise<boolean> {
        const result = this.resolveChain.then(async () => {
            try {
                this.setFileSets(await this.deps.findProjectFiles());
                return true;
            } catch (err) {
                this.deps.logError(
                    `Couldn't resolve the project's files: ${err}`,
                );
                return false;
            }
        });
        this.resolveChain = result;
        return result;
    }

    private async handleTweeDeleted(uri: string): Promise<void> {
        this.tweeFiles?.delete(uri);
        const heldStoryData = this.deps.index.getStoryDataUri() === uri;
        this.deps.index.removeDocument(uri);
        if (heldStoryData) {
            this.deps.queue.indexWorkspace();
        } else {
            await this.deps.revalidateOpenTweeDocuments();
        }
    }
}
