/**
 * markdown.ts — text-to-HTML rendering for Satsuma note and NL-string content.
 *
 * Owns two rendering levels and the rule that composes them:
 *
 *   - {@link highlightAtRefs} — inline only. Escapes, then marks `@ref` tokens.
 *     Used where the surrounding context is already a single line of prose
 *     (NL transform text, join descriptions, filter expressions).
 *   - {@link renderMarkdown} — block level. Headings, lists, emphasis, inline
 *     code and paragraphs, with `@ref` marking applied inside each inline run.
 *     Used for note bodies, where the spec promises Markdown support
 *     (SATSUMA-V2-SPEC.md:43).
 *
 * This module does not decide *where* notes render — see `notes.ts` for the
 * shared collapsible section and each component for its own placement.
 */

import { createAtRefRegex } from "@satsuma/core/nl-ref";

/**
 * @ref pattern matching — single source of truth lives in @satsuma/core/nl-ref.
 * A fresh regex instance is created so that mutating /g state in this module
 * cannot collide with other consumers of the shared pattern.
 */
const AT_REF_RE = createAtRefRegex();

/** HTML-escape special characters to prevent injection. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Wrap `@ref` tokens in `<span class="at-ref">`, assuming the input has ALREADY
 * been HTML-escaped. Kept separate from {@link highlightAtRefs} so the Markdown
 * renderer can escape once and then mark refs partway through its own inline
 * pipeline, rather than escaping twice.
 *
 * The shared `@ref` pattern only matches after a line start or one of a fixed
 * set of opening characters, so a ref is deliberately NOT marked when it is
 * wrapped in Markdown punctuation (`**@foo**`). That is why this runs before
 * emphasis in the inline pipeline: once emphasis has been converted to tags
 * the preceding character is `>`, which the pattern also rejects, so no
 * ordering recovers those cases. A ref inside inline code (`` `@foo` ``) is
 * never marked at all, because {@link renderInline} lifts code spans out
 * before this runs.
 */
function markAtRefs(escaped: string): string {
  return escaped.replace(AT_REF_RE, `<span class="at-ref">$&</span>`);
}

/**
 * Wraps @ref tokens in text with `<span class="at-ref">` for visual emphasis.
 * Input is HTML-escaped first to prevent injection.
 */
export function highlightAtRefs(text: string): string {
  return markAtRefs(escapeHtml(text));
}

/**
 * Strip the indentation a note body inherited from its position in the source.
 *
 * The spec keeps note content verbatim — "Leading indentation from the content
 * is preserved as-is" (SATSUMA-V2-SPEC.md:43) — so a note written inside a
 * schema arrives with every line carrying the source's indentation:
 *
 *     PHONE_NBR VARCHAR(50) (
 *       note """
 *       - **42%** `(555) 123-4567`
 *       """
 *     )
 *
 * Every block rule below anchors at the start of a line, so without this the
 * list above is prose and the note renders as one flat paragraph — the exact
 * failure vnm-kisd reported, still present after Markdown rendering is wired
 * up. Preserving the indentation is right for the model (the CLI and Excel
 * export want the author's text); removing it is a rendering concern and
 * belongs here.
 *
 * The first line is trimmed rather than measured: when content opens on the
 * same line as the delimiter (`note "Mapping assumptions:` …) its indentation
 * was consumed by the delimiter, so counting it would find a common indent of
 * zero and dedent nothing.
 */
function dedentNoteBody(text: string): string {
  const lines = text.split("\n");
  const [first = "", ...rest] = lines;

  let commonIndent = Infinity;
  for (const line of rest) {
    if (line.trim() === "") continue;
    commonIndent = Math.min(commonIndent, line.length - line.trimStart().length);
  }

  if (!Number.isFinite(commonIndent) || commonIndent === 0) {
    return [first.trimStart(), ...rest].join("\n");
  }
  return [
    first.trimStart(),
    ...rest.map((line) => (line.trim() === "" ? line : line.slice(commonIndent))),
  ].join("\n");
}

// ---------- Inline formatting ----------

/** An inline code span: a backtick-delimited run with no backtick inside. */
const CODE_SPAN_RE = /`([^`]+)`/g;

/**
 * Stands in for one code span while emphasis runs, so emphasis can neither see
 * nor pair across the span's contents. A Unicode private-use character: it
 * carries no meaning in authored note text (any stray one is dropped before
 * substitution, so restoration cannot misalign), and it is not one of the
 * `@ref` pattern's opening characters, so a ref straight after a code span
 * stays unmarked exactly as it did when the backtick preceded it.
 */
const CODE_SPAN_PLACEHOLDER = "\uE000";
const CODE_SPAN_PLACEHOLDER_RE = /\uE000/g;

/**
 * Emphasis delimiters follow CommonMark's flanking rule in its simplest form:
 * the text just inside each delimiter must not be whitespace. So `*note*` is
 * emphasis but `amount * 100 * rate` is arithmetic (bsw-5b3m).
 */
const STRONG_RE = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const EMPHASIS_RE = /\*(?=\S)(.+?)(?<=\S)\*/g;

/**
 * Apply inline formatting to an already-escaped line: code spans, `@ref`
 * marking, bold and italic.
 *
 * Code spans are lifted out first and restored last, so nothing inside them is
 * read as emphasis or as a ref — `SELECT * FROM t` keeps its asterisk.
 * Ref marking then runs before emphasis; see markAtRefs for why that order is
 * forced.
 */
function renderInline(escaped: string): string {
  const codeSpans: string[] = [];
  const withoutCode = escaped
    .replace(CODE_SPAN_PLACEHOLDER_RE, "")
    .replace(CODE_SPAN_RE, (_span, content: string) => {
      codeSpans.push(content);
      return CODE_SPAN_PLACEHOLDER;
    });

  const formatted = markAtRefs(withoutCode)
    .replace(STRONG_RE, "<strong>$1</strong>")
    .replace(EMPHASIS_RE, "<em>$1</em>");

  let next = 0;
  return formatted.replace(CODE_SPAN_PLACEHOLDER_RE, () => `<code>${codeSpans[next++]}</code>`);
}

/**
 * Minimal Markdown → HTML converter for Satsuma notes.
 * Handles headings, lists, bold, italic, inline code, and paragraphs, and
 * marks `@ref` tokens so a note that mixes prose, Markdown and refs renders
 * all three (vnm-kisd).
 *
 * Deliberately hand-rolled rather than a Markdown library: the supported
 * subset is small, fixed by what note bodies actually use, and escaping the
 * input here is what keeps note text from becoming an HTML injection vector.
 */
export function renderMarkdown(text: string): string {
  // Escape HTML special chars
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = dedentNoteBody(text).split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;

    // Heading
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const [, hashes, headingText] = hm;
      if (hashes && headingText) {
        const level = hashes.length;
        output.push(`<h${level}>${renderInline(esc(headingText))}</h${level}>`);
      }
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      let cur = lines[i];
      while (i < lines.length && cur !== undefined && /^[-*]\s/.test(cur)) {
        items.push(`<li>${renderInline(esc(cur.replace(/^[-*]\s+/, "")))}</li>`);
        i++;
        cur = lines[i];
      }
      output.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      let cur = lines[i];
      while (i < lines.length && cur !== undefined && /^\d+\.\s/.test(cur)) {
        items.push(`<li>${renderInline(esc(cur.replace(/^\d+\.\s+/, "")))}</li>`);
        i++;
        cur = lines[i];
      }
      output.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Blank line → paragraph break (skip)
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines
    const para: string[] = [];
    let cur = lines[i];
    while (
      i < lines.length &&
      cur !== undefined &&
      cur.trim() !== "" &&
      !/^#{1,3}\s/.test(cur) &&
      !/^[-*]\s/.test(cur) &&
      !/^\d+\.\s/.test(cur)
    ) {
      para.push(renderInline(esc(cur)));
      i++;
      cur = lines[i];
    }
    if (para.length > 0) {
      output.push(`<p>${para.join("<br>")}</p>`);
    }
  }

  return output.join("");
}
