/**
 * diagnostic-refresh.ts — decides when the server republishes diagnostics for
 * open documents that the user did not just edit.
 *
 * Why this exists: an open file's semantic diagnostics are computed from the
 * shared workspace index, not from that file alone. Duplicate-definition and
 * undefined-ref read the file's import closure; missing-import reads every
 * file in the folder. So a change to b.stm can add or clear a diagnostic on
 * a.stm even when a.stm does not import b.stm. Before bsw-r1wl the server
 * republished only the edited document, and every other open document kept
 * its stale result until the user edited it too.
 *
 * The rule (the user's decision for bsw-r1wl):
 *   - The caller publishes the document the change came from immediately, so
 *     typing feedback in the active editor is never delayed.
 *   - Every other open document is republished once the index has been quiet
 *     for DEPENDENT_REFRESH_DELAY_MS. Each new change restarts the wait, so a
 *     burst of keystrokes costs one refresh pass rather than one per key.
 *   - "Every other" means every open document, not only importers of the
 *     changed file, because the folder-wide missing-import rule can change the
 *     result of a file that imports nothing.
 *
 * What this module does not own: computing or sending diagnostics. The server
 * supplies both the list of open documents and the publish function, which
 * keeps this logic testable without a language-server connection.
 */

import { canonicalizeFileUri } from "./workspace-index";

/**
 * How long the index must be quiet before the other open documents are
 * republished. Long enough to coalesce a run of keystrokes, short enough that
 * the change appears to land at once in a neighbouring editor.
 */
export const DEPENDENT_REFRESH_DELAY_MS = 150;

/** The timer functions the refresher schedules with; injectable for tests. */
export interface RefreshTimers {
  /** Run `callback` once after `delayMs`; returns a handle for `clear`. */
  set(callback: () => void, delayMs: number): unknown;
  /** Cancel a pending callback by the handle `set` returned. */
  clear(handle: unknown): void;
}

/** What the server provides to a DependentDiagnosticsRefresher. */
export interface DependentRefreshOptions {
  /** The URIs of the currently open documents, read when the refresh runs. */
  openUris: () => Iterable<string>;
  /** Recompute and send the diagnostics for one open document. */
  publish: (uri: string) => void;
  /** Override for DEPENDENT_REFRESH_DELAY_MS. */
  delayMs?: number;
  /** Override for the global setTimeout/clearTimeout. */
  timers?: RefreshTimers;
}

const NODE_TIMERS: RefreshTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Debounced republisher for the open documents a workspace-index change may
 * affect. Call `indexChanged` after every mutation of the index.
 */
export class DependentDiagnosticsRefresher {
  private readonly openUris: () => Iterable<string>;
  private readonly publish: (uri: string) => void;
  private readonly delayMs: number;
  private readonly timers: RefreshTimers;

  /** Handle of the scheduled refresh, or null when none is pending. */
  private pending: unknown = null;
  /**
   * Canonical URI the caller already published after the latest change, which
   * the pending refresh can skip; null when every open document needs it.
   */
  private alreadyFresh: string | null = null;

  constructor(options: DependentRefreshOptions) {
    this.openUris = options.openUris;
    this.publish = options.publish;
    this.delayMs = options.delayMs ?? DEPENDENT_REFRESH_DELAY_MS;
    this.timers = options.timers ?? NODE_TIMERS;
  }

  /**
   * Record that the workspace index changed and (re)start the wait before the
   * other open documents are republished.
   *
   * `freshUri` names the document whose diagnostics the caller has just
   * published against the changed index, so the refresh skips it. Pass null
   * when nothing was published (a closed file changed on disk, or a document
   * was closed): every open document is then refreshed.
   *
   * Only the latest change's `freshUri` is skipped. A document published for
   * an earlier change in the same burst is refreshed again, because a later
   * change may have altered its result.
   */
  indexChanged(freshUri: string | null): void {
    this.alreadyFresh = freshUri === null ? null : canonicalizeFileUri(freshUri);
    if (this.pending !== null) this.timers.clear(this.pending);
    this.pending = this.timers.set(() => this.flush(), this.delayMs);
  }

  /** Run any pending refresh now. Does nothing when none is pending. */
  flush(): void {
    if (this.pending === null) return;
    this.timers.clear(this.pending);
    this.pending = null;
    for (const uri of this.openUris()) {
      if (canonicalizeFileUri(uri) !== this.alreadyFresh) this.publish(uri);
    }
  }
}
