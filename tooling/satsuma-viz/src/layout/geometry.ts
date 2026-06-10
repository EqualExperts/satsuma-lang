/**
 * geometry.ts — the shared card-chrome geometry contract.
 *
 * The ELK layout sizes every node from these constants BEFORE any DOM exists,
 * and edge anchor points are computed from the same numbers (see
 * overviewVisualAnchor in elk-layout.ts). The card components must therefore
 * render chrome of exactly these heights — if a card's rendered header or
 * namespace row drifts from the estimate, anchor dots land beside the cards
 * instead of on them (the sl-wixe bug was three independent copies of "24"
 * drifting apart). Import from here on both sides; never re-declare a value.
 */

/**
 * Height of a card's coloured header bar. Card components pin their `.header`
 * to this exact height (box-sizing: border-box) rather than letting padding
 * and line-height approximate it.
 */
export const HEADER_HEIGHT = 40;

/**
 * Height of the namespace pill row rendered ABOVE the header on cards that
 * belong to a named namespace. Cards without a namespace render no row at all
 * — the header is the top of the card.
 */
export const NAMESPACE_PILL_HEIGHT = 24;

/**
 * Metadata pills stack one per row (sl-dw9x) and are excluded from the card's
 * intrinsic width, so only their HEIGHT participates in layout: each pill row
 * is pinned to this height in the card CSS.
 */
export const META_PILL_ROW_HEIGHT = 16;

/** Vertical gap between stacked metadata pill rows. */
export const META_PILL_ROW_GAP = 4;

/**
 * Fixed chrome around the metadata pill stack: 4px top + 6px bottom padding
 * + 1px bottom border (see .metadata-pills in sz-schema-card.ts).
 */
export const METADATA_PILLS_CHROME = 11;
