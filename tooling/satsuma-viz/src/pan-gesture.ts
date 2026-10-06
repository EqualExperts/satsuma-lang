/**
 * pan-gesture.ts — the rules that decide when a pointer press pans the canvas.
 *
 * The viz canvas pans like Miro or Figma (gh-513, sl-u3x8): left-drag on empty
 * canvas, Space+drag from anywhere, plus the older middle-drag and Alt+drag.
 * This module owns only the decisions — which press starts a pan, what counts
 * as empty canvas, and which key targets must keep Space for typing. It does not touch the DOM or pan
 * offsets; `SatsumaViz` reads elements, applies these rules and moves the
 * canvas. Kept free of DOM types so the rules are unit-testable in plain Node.
 */

// ── Empty canvas ──────────────────────────────────────────────────────────

/**
 * Rule: a press pans on a plain left-drag only when it lands on one of these
 * background elements. It is an allow-list, not a deny-list, so a new card,
 * row or button is safe by default: it keeps its clicks, and its text stays
 * selectable, without anyone remembering to exclude it.
 *
 * - `viewport`, `viewport-inner`, `detail-inner`: the pan/zoom frame shared by
 *   every view (satsuma-viz.ts).
 * - `canvas`, `card-layer`: the overview's background around the cards. The
 *   edge layers above them are `pointer-events: none` except on the edges
 *   themselves, so empty space reaches these.
 * - `layout`, `column`: the mapping detail view's grid and the gaps between
 *   its cards (sz-mapping-detail.ts).
 * - `chain-rail`, `chain-column`: the chain view's rail and the gaps between
 *   its hop cards (sz-chain-view.ts).
 * - `pan-overlay`: the transparent cover shown while Space is held or a pan is
 *   under way (see SatsumaViz).
 */
export const EMPTY_CANVAS_CLASSES: ReadonlySet<string> = new Set([
  "viewport",
  "viewport-inner",
  "detail-inner",
  "canvas",
  "card-layer",
  "layout",
  "column",
  "chain-rail",
  "chain-column",
  "pan-overlay",
]);

/**
 * True when an element with these classes is canvas background. Callers pass
 * the classes of the innermost element the press landed on — the first entry
 * of the event's composed path, which sees through the cards' shadow roots.
 */
export function isEmptyCanvasElement(classNames: Iterable<string>): boolean {
  for (const name of classNames) {
    if (EMPTY_CANVAS_CLASSES.has(name)) return true;
  }
  return false;
}

// ── Starting a pan ────────────────────────────────────────────────────────

/** Mouse button numbers from the DOM `PointerEvent.button` field. */
const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;

/** What the component knows about a press when deciding whether to pan. */
export interface PanPress {
  /** `PointerEvent.button`: 0 primary, 1 middle. */
  button: number;
  /** Alt (Option) held: Alt+drag pans from anywhere, as before sl-u3x8. */
  altKey: boolean;
  /** Space held over the viewport: the "hand tool", pans from anywhere. */
  spaceHeld: boolean;
  /** The press landed on canvas background (see {@link isEmptyCanvasElement}). */
  onEmptyCanvas: boolean;
}

/**
 * Whether a press starts a pan. Middle-drag, Alt+drag and Space+drag pan from
 * anywhere; a plain left-drag pans only from empty canvas, so pressing a card
 * keeps its click and its text selection.
 */
export function startsPan(press: PanPress): boolean {
  if (press.button === MIDDLE_BUTTON) return true;
  if (press.button !== PRIMARY_BUTTON) return false;
  return press.altKey || press.spaceHeld || press.onEmptyCanvas;
}

// ── Space key ─────────────────────────────────────────────────────────────

/** The key target fields this rule reads, so it needs no DOM types. */
export interface KeyTarget {
  tagName: string;
  isContentEditable: boolean;
}

/** Elements where Space types a character, so it must not arm panning. */
const TEXT_ENTRY_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * True when Space pressed on this target is typing, not the hand tool: form
 * fields and editable regions, such as the playground's source editor.
 */
export function isTextEntryTarget(target: KeyTarget | null | undefined): boolean {
  if (!target) return false;
  return target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName.toUpperCase());
}
