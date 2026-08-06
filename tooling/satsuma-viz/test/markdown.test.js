/**
 * Unit coverage for the note text → HTML converter (vnm-kisd, vnm-bak4).
 *
 * These cases pin the STRING TRANSFORM only: given note source, what HTML does
 * the renderer emit. Whether a reader actually sees that HTML painted in a
 * field row, an arrow row or a notes section is a different property that only
 * a rendered browser can observe — see the "Note rendering" suite in
 * tooling/satsuma-viz-harness/test/harness.test.ts.
 */

// The bundle registers custom elements on import, so the DOM shim must load
// first even though these cases only exercise pure string functions.
import "./dom-shim.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { renderMarkdown, highlightAtRefs } = await import("../dist/satsuma-viz.js");

describe("renderMarkdown", () => {
  it("renders the bulleted-list note shape the spec documents on a field", () => {
    // SATSUMA-V2-SPEC.md:225 shows a PHONE_NBR field whose note body is a
    // Markdown list with bold and inline code. That exact shape rendering as
    // literal source text is the defect vnm-kisd was filed against, so this is
    // the case that must not regress.
    const html = renderMarkdown("- **42%** `(555) 123-4567` — US\n- **31%** `555.123.4567` — dots");

    assert.match(html, /<ul>/);
    assert.equal(html.match(/<li>/g).length, 2);
    assert.match(html, /<strong>42%<\/strong>/);
    assert.match(html, /<code>\(555\) 123-4567<\/code>/);
    // The Markdown punctuation must not survive into the output as text.
    assert.ok(!html.includes("**"), "bold markers should be consumed, not printed");
  });

  it("renders an indented list, as every note written inside a schema arrives", () => {
    // Note bodies keep their source indentation by design (spec:43), so this
    // is the SHAPE REAL NOTES HAVE — examples/db-to-db/pipeline.stm's PHONE_NBR
    // note is indented four spaces. Block rules anchor at line start, so
    // without dedenting, Markdown rendering alone still leaves the note as one
    // flat paragraph.
    const html = renderMarkdown(
      "\n    Formats seen:\n    - **42%** parens\n    - **31%** dots\n    ",
    );

    assert.match(html, /<p>Formats seen:<\/p>/);
    assert.equal(html.match(/<li>/g).length, 2);
  });

  it("dedents a body whose first line opens on the delimiter line", () => {
    // `note "Mapping assumptions:` puts content on the delimiter's own line, so
    // that line has no indentation while the continuation lines do. Measuring
    // it would find a common indent of zero and dedent nothing —
    // examples/db-to-db/pipeline.stm's mapping note is exactly this shape.
    const html = renderMarkdown(
      "Assumptions:\n     - timestamps are US Eastern\n     - NULLs kept",
    );

    assert.match(html, /<p>Assumptions:<\/p>/);
    assert.equal(html.match(/<li>/g).length, 2);
  });

  it("preserves relative indentation when dedenting, so nesting is not flattened", () => {
    // Only the COMMON prefix is removed. A deliberately deeper line must stay
    // deeper, or dedenting would destroy structure while fixing alignment.
    const html = renderMarkdown("\n  top\n      deeper\n");
    assert.match(html, /top<br> {4}deeper/);
  });

  it("renders headings, ordered lists and paragraphs as block elements", () => {
    const html = renderMarkdown("# Title\n\nFirst para\n\n1. one\n2. two");

    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<p>First para<\/p>/);
    assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  });

  it("keeps a multi-line paragraph's line structure with <br>", () => {
    // A `"""` note's line breaks are content — collapsing them into one run was
    // half of what made field notes unreadable.
    const html = renderMarkdown("line one\nline two");
    assert.match(html, /<p>line one<br>line two<\/p>/);
  });

  it("marks @ref tokens inside a note body so refs read as refs", () => {
    // Arrow notes already highlighted refs via highlightAtRefs; routing note
    // bodies through renderMarkdown instead had to keep that, not trade
    // Markdown for refs (vnm-bak4).
    const html = renderMarkdown("Correlate to @POReferences by position.");
    assert.match(html, /<span class="at-ref">@POReferences<\/span>/);
  });

  it("marks an @ref that opens a list item, where the line start is the boundary", () => {
    // The shared @ref pattern only matches after a line start or an opening
    // character. Marking refs per inline run (not over the assembled HTML) is
    // what keeps this case working — over full HTML the preceding character
    // would be ">" and the ref would be missed.
    const html = renderMarkdown("- @orders.id feeds the key");
    assert.match(html, /<li><span class="at-ref">@orders\.id<\/span> feeds the key<\/li>/);
  });

  it("leaves an @ref inside inline code unmarked", () => {
    // A ref shown as code is being quoted, not referenced — the backtick is
    // not one of the pattern's opening characters, so this falls out of the
    // shared pattern rather than needing a special case.
    const html = renderMarkdown("write `@foo` to name it");
    assert.match(html, /<code>@foo<\/code>/);
    assert.ok(!html.includes('class="at-ref"'), "a quoted ref should not be highlighted");
  });

  it("escapes HTML in note text so a note body cannot inject markup", () => {
    // Note text is author-supplied and rendered through unsafeHTML; escaping
    // here is the only thing standing between a note and script injection.
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    assert.ok(!html.includes("<img"), "raw tag must not survive");
    assert.match(html, /&lt;img/);
  });

  it("escapes HTML inside a heading and a list item too, not just paragraphs", () => {
    // Each block branch escapes independently, so each needs proving — an
    // unescaped heading would be just as exploitable as an unescaped paragraph.
    const html = renderMarkdown("# <b>h</b>\n- <b>li</b>");
    assert.ok(!html.includes("<b>"), "raw tag must not survive in any block type");
    assert.match(html, /<h1>&lt;b&gt;h&lt;\/b&gt;<\/h1>/);
  });
});

describe("highlightAtRefs", () => {
  it("still escapes then marks refs, unchanged by the Markdown composition", () => {
    // The inline-only path is used for NL transform text, join descriptions
    // and filters. Refactoring it to share markAtRefs with renderMarkdown must
    // not have altered what it emits.
    const html = highlightAtRefs("join on @orders.id <script>");
    assert.match(html, /<span class="at-ref">@orders\.id<\/span>/);
    assert.match(html, /&lt;script&gt;/);
  });

  it("does not apply Markdown formatting", () => {
    // Inline NL text is not a note body: asterisks in a transform description
    // are literal, and turning them into emphasis would change meaning.
    assert.match(highlightAtRefs("multiply by **2**"), /\*\*2\*\*/);
  });
});
