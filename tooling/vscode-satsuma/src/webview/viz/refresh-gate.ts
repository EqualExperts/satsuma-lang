/**
 * refresh-gate.ts — latest-wins guard for overlapping async loads (sl-jar4).
 *
 * The viz panel refreshes on save, on active-editor change, and on manual
 * request; nothing serialises the LSP round-trips those trigger, so a slow
 * earlier response could land after a newer one and overwrite fresh webview
 * state with stale data. This module owns only the ordering rule: each load
 * takes a token, and only the holder of the newest token may publish its
 * result. It knows nothing about VS Code or the LSP, so the rule stays
 * unit-testable in plain Node.
 */

/**
 * Monotonic generation counter shared by all loads that publish to one
 * consumer (one webview). Begin a load with {@link begin}; before publishing
 * its result, check {@link isCurrent} and drop the result if it fails.
 */
export class RefreshGate {
  /** Generation of the most recently started load. */
  private generation = 0;

  /** Start a new load, superseding every load started earlier. */
  begin(): number {
    return ++this.generation;
  }

  /**
   * Token of the most recently started load, without superseding it. Lets a
   * dependent request (e.g. lineage expansion) detect that the model it was
   * computed against has since been replaced.
   */
  latest(): number {
    return this.generation;
  }

  /** True while no newer load has started since `token` was issued. */
  isCurrent(token: number): boolean {
    return token === this.generation;
  }
}
