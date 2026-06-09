/**
 * editor.ts — zero-dependency, syntax-highlighted code editor for the playground.
 *
 * Implements the classic "overlay" editing technique: a transparent `<textarea>`
 * floats exactly on top of a `<pre>` highlight layer. The textarea owns text
 * input, the caret, selection, and scrolling; the `<pre>` behind it shows the
 * coloured tokens. Because both layers share identical box geometry (font,
 * line-height, padding, `white-space: pre`, no wrap) and the highlight layer's
 * scroll offset is slaved to the textarea's, the colours stay pixel-aligned
 * under the caret at any horizontal or vertical scroll offset — including the
 * wide-line case the playground requires (feature 33 §2: long lines scroll
 * left/right rather than wrap).
 *
 * This module owns ONLY the editor widget: DOM construction, highlight refresh,
 * and scroll sync. It does NOT own Satsuma tokenizing (the caller injects a
 * highlight function — see highlight.ts), the model pipeline, debouncing, or
 * persistence. Those are app-level concerns kept out of the widget so it stays
 * small, testable, and reusable.
 *
 * CodeMirror 6 remains the documented fallback if richer editing is ever needed;
 * this overlay is the deliberate minimal-dependency choice for v1.
 */

// Stable element ids so the chrome CSS in index.html and the Playwright geometry
// assertions can target the two layers without coupling to internal structure.
const HIGHLIGHT_LAYER_ID = "source-highlight"; // the coloured <pre> behind the text
const INPUT_LAYER_ID = "source-input"; // the transparent <textarea> the user types in

/** Configuration for a SatsumaEditor instance. */
export interface SatsumaEditorOptions {
  /**
   * Turn source text into HTML for the highlight layer. Must HTML-escape its
   * input and preserve whitespace verbatim so the coloured tokens line up
   * character-for-character with the textarea. In practice this is
   * `highlightSatsuma` from highlight.ts.
   */
  highlight: (source: string) => string;
  /**
   * Called after every *user* edit (typing, paste, cut) with the new buffer
   * value. Programmatic `setValue` does NOT fire this — only genuine user input
   * does — so the app can treat the callback as "the user changed the source".
   */
  onInput: (value: string) => void;
}

/**
 * An editable, syntax-highlighted source buffer mounted into a host element.
 *
 * The buffer (the textarea's value) is the single source of truth for both the
 * highlight layer and, via `onInput`, the app's model pipeline.
 */
export class SatsumaEditor {
  private readonly highlightEl: HTMLPreElement; // coloured layer, scroll-slaved to input
  private readonly inputEl: HTMLTextAreaElement; // transparent editable layer on top
  private readonly highlight: (source: string) => string;

  /**
   * Build the overlay inside `host`. The host must be a positioned container
   * (the CSS gives `#source-editor` `position: relative`) so the two absolutely
   * positioned layers fill it exactly.
   */
  constructor(host: HTMLElement, options: SatsumaEditorOptions) {
    this.highlight = options.highlight;

    // Highlight layer: a <pre> that shows the coloured tokens. It never receives
    // pointer or keyboard events; the textarea on top handles all interaction.
    this.highlightEl = document.createElement("pre");
    this.highlightEl.id = HIGHLIGHT_LAYER_ID;
    this.highlightEl.className = "code-layer";
    this.highlightEl.setAttribute("aria-hidden", "true");

    // Input layer: a transparent textarea. `wrap="off"` (plus CSS
    // `white-space: pre`) keeps wide lines on one line so they scroll
    // horizontally instead of wrapping — the explicit feature-33 requirement.
    this.inputEl = document.createElement("textarea");
    this.inputEl.id = INPUT_LAYER_ID;
    this.inputEl.className = "code-layer";
    this.inputEl.setAttribute("wrap", "off");
    this.inputEl.spellcheck = false;
    this.inputEl.autocapitalize = "off";
    this.inputEl.autocomplete = "off";
    this.inputEl.setAttribute("aria-label", "Satsuma source editor");

    host.appendChild(this.highlightEl);
    host.appendChild(this.inputEl);

    // Repaint colours on every keystroke (cheap regex) and notify the app.
    this.inputEl.addEventListener("input", () => {
      this.refreshHighlight();
      options.onInput(this.inputEl.value);
    });

    // Keep the highlight layer's scroll offset locked to the textarea's so the
    // colours stay under the caret at any horizontal/vertical scroll position.
    this.inputEl.addEventListener("scroll", () => this.syncScroll());
  }

  /** The current buffer value — the single source of truth for the pipeline. */
  getValue(): string {
    return this.inputEl.value;
  }

  /**
   * Replace the buffer programmatically (e.g. when a document is loaded into the
   * editor). Repaints the highlight and resets the scroll to the top-left so a
   * freshly loaded document starts at its first line. Does NOT fire `onInput` —
   * this is a load, not a user edit.
   */
  setValue(value: string): void {
    this.inputEl.value = value;
    this.refreshHighlight();
    this.inputEl.scrollTo(0, 0);
    this.syncScroll();
  }

  /** Move keyboard focus into the editor. */
  focus(): void {
    this.inputEl.focus();
  }

  /** Rebuild the coloured layer from the current buffer, then re-align scroll. */
  private refreshHighlight(): void {
    // Safe: `highlight` HTML-escapes all source text, so no raw input reaches
    // the DOM as markup.
    this.highlightEl.innerHTML = this.highlight(this.inputEl.value); // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // Content width may have changed; re-sync so a horizontal scroll offset that
    // is now out of range collapses in lock-step on both layers.
    this.syncScroll();
  }

  /** Mirror the textarea's scroll position onto the highlight layer. */
  private syncScroll(): void {
    this.highlightEl.scrollTop = this.inputEl.scrollTop;
    this.highlightEl.scrollLeft = this.inputEl.scrollLeft;
  }
}
