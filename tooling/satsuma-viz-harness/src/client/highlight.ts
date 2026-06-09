/**
 * highlight.ts — zero-dependency Satsuma syntax tokenizer for the browser.
 *
 * Translates Satsuma source text into HTML with `<span class="tok-*">` wrappers
 * whose colours are defined in index.html. It is a cheap, synchronous regex
 * tokenizer derived from the TextMate grammar in
 * tooling/vscode-satsuma/syntaxes/satsuma.tmLanguage.json — deliberately *not*
 * the tree-sitter parser, because highlighting must repaint on every keystroke
 * while the (heavier) WASM model build is deferred to an idle debounce.
 *
 * This module owns ONLY token-to-HTML rendering. It is the highlight function the
 * overlay editor (editor.ts) is given; it knows nothing about the editor widget,
 * the model pipeline, or the DOM. Every segment it emits is HTML-escaped, so its
 * output is safe to assign to `innerHTML`.
 */

// ---------- HTML escaping ----------

/** HTML-escape a plain-text segment so source text can never inject markup. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wrap an escaped segment in a token span of the given class. */
function wrap(cls: string, s: string): string {
  return `<span class="${cls}">${esc(s)}</span>`;
}

// ---------- Embedded @ref highlighting inside strings ----------

/**
 * @ref pattern from `variable.other.reference.satsuma` in the grammar: an `@`
 * followed by a (optionally backtick-quoted, optionally namespace-qualified,
 * dotted) identifier. Used to colour cross-references embedded in NL strings.
 */
const REF_RE =
  /@(?:`[^`]+`|[a-zA-Z_][a-zA-Z0-9_-]*)(?:::[a-zA-Z_][a-zA-Z0-9_-]*)?(?:\.(?:`[^`]+`|[a-zA-Z_][a-zA-Z0-9_-]*))*(?!\w)/g;

/**
 * Wrap the contents of a double-quoted string, further highlighting any `@ref`
 * cross-references embedded within it so references stay legible inside prose.
 */
function highlightStringContents(text: string): string {
  let html = `<span class="tok-string">`;
  let last = 0;
  for (const m of text.matchAll(REF_RE)) {
    html += esc(text.slice(last, m.index));
    html += `</span><span class="tok-ref">${esc(m[0])}</span><span class="tok-string">`;
    last = (m.index ?? 0) + m[0].length;
  }
  html += esc(text.slice(last)) + `</span>`;
  return html;
}

// ---------- Master token regex ──────────────────────────────────────────────

// Alternatives are listed in priority order (first match wins), mirroring the
// grammar's include order. Named capture groups map directly to the render
// switch below.
const TOKEN = new RegExp(
  [
    // Triple-quoted strings (multiline) must come before single-quoted.
    String.raw`(?<triple>"""[\s\S]*?(?:"""|$))`,
    // Double-quoted strings (single line, may contain @ref).
    String.raw`(?<string>"(?:[^"\\]|\\.)*"?)`,
    // Warning comments: //! take priority over plain //
    String.raw`(?<comment_warn>//!.*)`,
    // Question comments: //?
    String.raw`(?<comment_q>//\?.*)`,
    // Regular line comments.
    String.raw`(?<comment>//.*)`,
    // Mapping arrow operator.
    String.raw`(?<arrow>->)`,
    // Spread: ...
    String.raw`(?<spread>\.\.\.)`,
    // Pipe operator.
    String.raw`(?<pipe>\|)`,
    // Backtick-quoted identifiers: `field name`.
    String.raw`(?<backtick>` + "`[^`]*`)",
    // Block-level and structural keywords.
    String.raw`(?<kw>\b(?:namespace|schema|fragment|mapping|metric|transform|note|map|source|target|each|flatten|record|list_of|import|from|default)\b)`,
    // Data type names used in field declarations.
    String.raw`(?<type>\b(?:STRING|VARCHAR|INT|INTEGER|BIGINT|DECIMAL|CHAR|BOOLEAN|DATE|TIMESTAMPTZ|TIMESTAMP_NTZ|UUID|JSON|TEXT|NUMBER|INT32|FLOAT|DOUBLE|CURRENCY|PICKLIST|ID|PERCENT|DATETIME)\b)`,
    // Built-in pipeline function names.
    String.raw`(?<pipeline>\b(?:trim|lowercase|uppercase|coalesce|round|split|first|last|to_utc|to_iso8601|parse|null_if_empty|null_if_invalid|validate_email|now_utc|title_case|escape_html|truncate|to_number|prepend|max_length|assume_utc|join|dedup)\b)`,
    // Boolean and null literals.
    String.raw`(?<boolean>\b(?:true|false|null)\b)`,
    // Numeric literals (integer and decimal).
    String.raw`(?<number>-?\b\d+(?:\.\d+)?\b)`,
  ].join("|"),
  "g",
);

/**
 * Translate Satsuma source text to HTML with `<span class="tok-*">` wrappers.
 *
 * The returned string is fully HTML-escaped and preserves the source's
 * whitespace verbatim, so it can be assigned to a `<pre>`'s `innerHTML` and will
 * line up character-for-character with the same text in an overlaid textarea.
 */
export function highlightSatsuma(source: string): string {
  let html = "";
  let last = 0;

  for (const m of source.matchAll(TOKEN)) {
    // Emit any plain text that precedes this token.
    if ((m.index ?? 0) > last) html += esc(source.slice(last, m.index));

    const g = m.groups ?? {};
    const text = m[0];

    if (g.triple)        html += wrap("tok-string-triple", text);
    else if (g.string)   html += highlightStringContents(text);
    else if (g.comment_warn) html += wrap("tok-comment-warn", text);
    else if (g.comment_q)    html += wrap("tok-comment-q",    text);
    else if (g.comment)      html += wrap("tok-comment",       text);
    else if (g.arrow)    html += wrap("tok-arrow",    text);
    else if (g.spread)   html += wrap("tok-spread",   text);
    else if (g.pipe)     html += wrap("tok-pipe",     text);
    else if (g.backtick) html += wrap("tok-backtick", text);
    else if (g.kw)       html += wrap("tok-kw",       text);
    else if (g.type)     html += wrap("tok-type",     text);
    else if (g.pipeline) html += wrap("tok-pipeline", text);
    else if (g.boolean)  html += wrap("tok-boolean",  text);
    else if (g.number)   html += wrap("tok-number",   text);
    else                 html += esc(text);

    last = (m.index ?? 0) + text.length;
  }

  // Emit any remaining plain text after the last token.
  html += esc(source.slice(last));
  return html;
}
