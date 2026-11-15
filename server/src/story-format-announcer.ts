import { StoryFormat } from "@tt3/shared";

/** How long to wait after the last story format edit before reacting to it. */
export const storyFormatEditDebounceMs = 300;

/**
 * Do two story formats differ in format or version?
 */
export function storyFormatsDiffer(
    a: StoryFormat | undefined,
    b: StoryFormat | undefined,
): boolean {
    return a?.format !== b?.format || a?.formatVersion !== b?.formatVersion;
}

/**
 * Everything the announcer needs from the outside world.
 */
export interface StoryFormatAnnouncerDeps {
    /** The project's current story format. */
    getStoryFormat(): StoryFormat | undefined;
    /** React to a changed story format. */
    announce(format: StoryFormat): void;
    /** Request a full workspace reindex. */
    reindexWorkspace(): void;
}

/**
 * Announces story format changes: at once when found during a workspace
 * index, and after a debounce when the author is editing StoryData.
 */
export class StoryFormatAnnouncer {
    private lastAnnounced: StoryFormat | undefined;
    private editTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly deps: StoryFormatAnnouncerDeps) {}

    /**
     * Note that an edit changed the story format; after a debounce, announce
     * the current format and reindex, unless it's the one last announced.
     */
    formatEdited(): void {
        clearTimeout(this.editTimer);
        this.editTimer = setTimeout(
            () => this.flushEdits(),
            storyFormatEditDebounceMs,
        );
    }

    private flushEdits(): void {
        this.editTimer = undefined;
        const format = this.deps.getStoryFormat();
        if (!format?.format || !storyFormatsDiffer(format, this.lastAnnounced))
            return;
        this.announceNow(format);
        this.deps.reindexWorkspace();
    }

    /**
     * Announce a story format at once.
     */
    announceNow(format: StoryFormat): void {
        this.lastAnnounced = format;
        this.deps.announce(format);
    }
}
