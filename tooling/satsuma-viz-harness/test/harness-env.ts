/**
 * harness-env.ts — shared Playwright test environment for the viz harness.
 *
 * Owns the two things every suite needs:
 *
 *  - The typed `window.__satsumaHarness` global, declared ONCE here from the
 *    app's real exported interface. Test files previously each re-declared a
 *    local subset, which drifted from the automation contract and produced
 *    conflicting global augmentations; importing this module gives them the
 *    authoritative type instead.
 *
 *  - Virtual library URIs (sl-kd45): the picker and workspace are backed by
 *    the localStorage document library, whose built-in entries are keyed by
 *    deterministic `file:///examples/<path>` URIs derived from each example's
 *    corpus-relative path. Unlike the old server `pathToFileURL` URIs these
 *    are identical on every machine, so tests compute them directly instead
 *    of fetching /api/fixtures first.
 */

import type { SatsumaHarness, HarnessEvent } from "../src/client/app";

declare global {
  interface Window {
    __satsumaHarness: SatsumaHarness;
  }
}

export type { SatsumaHarness, HarnessEvent };

/** Virtual library URI for a built-in example's corpus-relative path. */
export function libraryUri(path: string): string {
  return `file:///examples/${path}`;
}
