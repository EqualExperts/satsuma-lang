/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * Satsuma v2 Grammar — Phase 8: Unified field syntax
 *
 * Replaces keyword-first record/list blocks with name-first unified fields:
 *   NAME record (metadata)? { schema_body }
 *   NAME list_of record (metadata)? { schema_body }
 *   NAME list_of TYPE (metadata)?
 *
 * Adds each/flatten blocks in mapping bodies:
 *   each src -> tgt (metadata)? { arrow_decl* }
 *   flatten src -> tgt (metadata)? { arrow_decl* }
 *
 * Removes [] from all field paths — iteration context is established by
 * each/flatten blocks or is implicit from the schema structure.
 *
 * GLR conflicts declared:
 *   - map_arrow vs nested_arrow (both start with src_path -> tgt_path)
 *   - namespaced_path vs field_path (both start with identifier; :: vs .)
 *   - namespace_block vs field_path/namespaced_path (identifier followed by
 *     :: or { could be a namespace block or a path — resolved by context)
 *   - field_decl ambiguity: identifier can start a field_decl (name) or a
 *     type_expr / spread — resolved by GLR + prec
 */

module.exports = grammar({
  name: "satsuma",

  extras: ($) => [
    /[ \t\f\r\n]+/,
    $.warning_comment,
    $.question_comment,
    $.comment,
  ],

  word: ($) => $.identifier,

  externals: ($) => [
    // CONTINUATION_WORD matches an identifier that follows on the SAME LINE as
    // the preceding token (only horizontal whitespace between them).  Used in
    // _spread_words so that multi-word spreads like `...audit columns` keep
    // working while `...f\nextra x` is correctly parsed as spread "f" + field.
    $.continuation_word,
    // INLINE_TYPE is the field type token (identifier shape plus optional
    // attached parens), restricted to the SAME LINE as the field name.
    // Without the line restriction, adjacent bare-name fields silently merge
    // into one field_decl with the second name as the type (sl-hjx1).
    // Aliased to $.type_expr at the use sites so the CST shape is unchanged.
    $.inline_type,
    // VALUE_WORD is a bare word inside a metadata tag value (value_text),
    // restricted to the SAME LINE as the tag and excluding structural
    // metadata keywords and spec-7.1 constraint flags. Without it, a missing
    // comma between metadata entries let value_text silently swallow the
    // following flags (`(pk note "x")`, `(owner finance\npk)`) — sl-vnty.
    // Aliased to $.identifier at the use site so the CST shape is unchanged.
    $.value_word,
  ],

  conflicts: (_) => [],

  rules: {
    // ── Top-level ─────────────────────────────────────────────────────────

    source_file: ($) => repeat($._top_level_item),

    _top_level_item: ($) =>
      choice(
        $.import_decl,
        $.note_block,
        $.namespace_block,
        $.schema_block,
        $.fragment_block,
        $.transform_block,
        $.mapping_block,
      ),

    // ── Namespace block ──────────────────────────────────────────────────
    // Flat (non-nestable) namespace: namespace <name> (<metadata>)? { <defs> }

    namespace_block: ($) =>
      seq(
        "namespace",
        field("name", $.identifier),
        optional($.metadata_block),
        "{",
        repeat($._namespace_item),
        "}",
      ),

    _namespace_item: ($) =>
      choice(
        $.note_block,
        $.schema_block,
        $.fragment_block,
        $.transform_block,
        $.mapping_block,
      ),

    // ── Import ────────────────────────────────────────────────────────────

    import_decl: ($) =>
      seq(
        "import",
        "{",
        // Trailing comma allowed, consistent with every other comma-separated
        // list construct (see "Comma policy" in the spec, sl-0nvt).
        commaSep1($.import_name),
        optional(","),
        "}",
        "from",
        $.import_path,
      ),

    import_name: ($) => choice($.qualified_name, $.backtick_name, $.identifier),

    // ns::identifier — used in imports
    qualified_name: ($) => seq($.identifier, "::", $.identifier),

    import_path: ($) => $.nl_string,

    // ── Schema block ──────────────────────────────────────────────────────

    schema_block: ($) =>
      seq(
        "schema",
        $.block_label,
        optional($.metadata_block),
        "{",
        optional($.schema_body),
        "}",
      ),

    // ── Fragment block ────────────────────────────────────────────────────
    // Metadata is accepted on every definition block (spec 2.1 describes
    // metadata generically); fragment/transform parity with schema/mapping.

    fragment_block: ($) =>
      seq(
        "fragment",
        $.block_label,
        optional($.metadata_block),
        "{",
        optional($.schema_body),
        "}",
      ),

    // ── Transform block ───────────────────────────────────────────────────

    transform_block: ($) =>
      seq(
        "transform",
        $.block_label,
        optional($.metadata_block),
        "{",
        optional($.pipe_chain),
        "}",
      ),

    // ── Mapping block ───────────────────────────────────────────────────

    mapping_block: ($) =>
      seq(
        "mapping",
        optional($.block_label),
        optional($.metadata_block),
        "{",
        // Optional so `mapping m { }` parses like empty schema/transform
        // bodies do — an empty mapping is a valid skeleton while authoring.
        optional($.mapping_body),
        "}",
      ),

    mapping_body: ($) =>
      repeat1($._mapping_body_item),

    _mapping_body_item: ($) =>
      choice(
        $.note_block,
        $.source_block,
        $.target_block,
        $.each_block,
        $.flatten_block,
        $._arrow_decl,
      ),

    // source { ref1, ref2 } or source { ref1 ref2 } or source { "join ..." }
    source_block: ($) =>
      seq(
        "source",
        "{",
        repeat1(seq($._source_entry, optional(","))),
        "}",
      ),

    _source_entry: ($) => $.source_ref,

    source_ref: ($) =>
      seq(
        choice($.qualified_name, $.backtick_name, $.identifier, $.nl_string),
        optional($.metadata_block),
      ),

    // target { ref } — single entry; trailing comma allowed for consistency
    // with source blocks (see "Comma policy" in the spec, sl-0nvt).
    target_block: ($) =>
      seq(
        "target",
        "{",
        $._source_entry,
        optional(","),
        "}",
      ),

    // ── each/flatten blocks ─────────────────────────────────────────────
    // each src_path -> tgt_path (metadata)? { nested_block_item* }
    // flatten src_path -> tgt_path (metadata)? { nested_block_item* }
    //
    // The body allows nested each/flatten per spec section 4.4. Source/target
    // blocks and note blocks are mapping-level constructs and are not permitted
    // inside nested blocks.

    each_block: ($) =>
      seq(
        "each",
        $.src_path,
        "->",
        $.tgt_path,
        optional($.metadata_block),
        "{",
        repeat($._nested_block_item),
        "}",
      ),

    flatten_block: ($) =>
      seq(
        "flatten",
        $.src_path,
        "->",
        $.tgt_path,
        optional($.metadata_block),
        "{",
        repeat($._nested_block_item),
        "}",
      ),

    // Shared body item for each/flatten blocks: arrow declarations plus nested
    // each/flatten sub-blocks. Does not include source/target/note, which are
    // mapping-level constructs.
    _nested_block_item: ($) =>
      choice(
        $._arrow_decl,
        $.each_block,
        $.flatten_block,
      ),

    // ── Note block ────────────────────────────────────────────────────────

    note_block: ($) =>
      seq(
        "note",
        "{",
        choice($.multiline_string, repeat1($.nl_string)),
        "}",
      ),

    // ── Schema body ───────────────────────────────────────────────────────

    schema_body: ($) => repeat1($._schema_body_item),

    _schema_body_item: ($) =>
      choice(
        $.field_decl,
        $.fragment_spread,
        $.note_block,
      ),

    // ── Field declaration (unified syntax) ──────────────────────────────
    // All fields follow: NAME [TYPE] [(metadata)] [{schema_body}]
    //
    // TYPE can be:
    //   - a scalar type: STRING, DECIMAL(12,2), etc. (type_expr token)
    //   - record: single nested structure
    //   - list_of record: list of structured elements
    //   - list_of TYPE: scalar list (list_of STRING, list_of INT, etc.)

    field_decl: ($) =>
      choice(
        // NAME record (metadata)? { schema_body }
        $._record_field,
        // NAME list_of record (metadata)? { schema_body }
        $._list_of_record_field,
        // NAME list_of TYPE (metadata)?
        $._list_of_scalar_field,
        // NAME TYPE (metadata)?  — original scalar field
        $._scalar_field,
        // NAME (metadata)  — typeless field (type omitted, metadata required to disambiguate)
        $._typeless_field,
      ),

    _scalar_field: ($) =>
      seq(
        $.field_name,
        // The type must sit on the same line as the field name (sl-hjx1);
        // inline_type is the external, line-aware spelling of type_expr.
        alias($.inline_type, $.type_expr),
        optional($.metadata_block),
      ),

    _typeless_field: ($) =>
      seq(
        $.field_name,
        $.metadata_block,
      ),

    _record_field: ($) =>
      seq(
        $.field_name,
        "record",
        optional($.metadata_block),
        "{",
        optional($.schema_body),
        "}",
      ),

    _list_of_record_field: ($) =>
      seq(
        $.field_name,
        "list_of",
        "record",
        optional($.metadata_block),
        "{",
        optional($.schema_body),
        "}",
      ),

    _list_of_scalar_field: ($) =>
      seq(
        $.field_name,
        "list_of",
        alias($.inline_type, $.type_expr),
        optional($.metadata_block),
      ),

    field_name: ($) => choice($.identifier, $.backtick_name),

    // type_expr is produced by the external scanner (INLINE_TYPE, aliased at
    // the use sites above): an identifier-shaped word — hyphens allowed
    // inside, not at the end (sl-csd2) — plus optional immediately-attached
    // parenthesized arguments, restricted to the same line as the field name
    // (sl-hjx1). See src/scanner.c.

    // ── Fragment spread ───────────────────────────────────────────────────

    fragment_spread: ($) => seq("...", $.spread_label),

    // Multi-word spreads: ...audit fields, ...to utc date
    // Qualified spreads: ...ns::fragment_name
    // The spread consumes as many identifiers as appear on the SAME LINE.
    // continuation_word is an external token that only matches when no newline
    // appears between the previous token and the candidate identifier, so
    // `...f\nextra x` correctly parses as spread "f" + field "extra x".
    spread_label: ($) =>
      choice($.qualified_name, $.backtick_name, $._spread_words),

    _spread_words: ($) => seq($.identifier, repeat($.continuation_word)),

    // ── Arrow declarations ────────────────────────────────────────────────
    // Three arrow types share src_path -> tgt_path prefix.
    // computed_arrow omits src_path (starts directly with ->).
    // nested_arrow body contains arrow_decls; map_arrow body contains pipe_chain.

    _arrow_decl: ($) =>
      choice(
        $.computed_arrow,
        $.nested_arrow,
        $.map_arrow,
      ),

    // -> tgt_path (metadata)? { pipe_chain }?
    computed_arrow: ($) =>
      seq(
        "->",
        $.tgt_path,
        optional($.metadata_block),
        optional($._arrow_transform_body),
      ),

    // src_path -> tgt_path (metadata)? { arrow_decl* }
    nested_arrow: ($) =>
      seq(
        $.src_path,
        "->",
        $.tgt_path,
        optional($.metadata_block),
        "{",
        repeat($._arrow_decl),
        "}",
      ),

    // src_path(, src_path)* -> tgt_path (metadata)? { pipe_chain }?
    map_arrow: ($) =>
      seq(
        commaSep1($.src_path),
        "->",
        $.tgt_path,
        optional($.metadata_block),
        optional($._arrow_transform_body),
      ),

    // { pipe_chain } transform body on an arrow
    _arrow_transform_body: ($) => seq("{", $.pipe_chain, "}"),

    // ── Arrow paths ───────────────────────────────────────────────────────
    // src_path and tgt_path are named wrapper nodes.
    // [] is removed from all paths — iteration is expressed via each/flatten.

    src_path: ($) => $._path_expr,
    tgt_path: ($) => $._path_expr,

    _path_expr: ($) =>
      choice(
        $.namespaced_path,
        $.backtick_path,
        $.relative_field_path,
        $.field_path,
      ),

    // ns::identifier or ns::identifier.field...
    // token.immediate(".") ensures continuation dots must be adjacent (no
    // newlines) so multi-line bare arrows are not merged into one path.
    namespaced_path: ($) =>
      prec.right(seq(
        $.identifier,
        "::",
        $._path_seg,
        repeat(seq(token.immediate("."), $._path_seg)),
      )),

    // `BacktickRef` or `BacktickRef`.field...
    backtick_path: ($) =>
      prec.right(seq(
        $.backtick_name,
        repeat(seq(token.immediate("."), $._path_seg)),
      )),

    // .field or .field.nested...
    relative_field_path: ($) =>
      prec.right(seq(
        ".",
        $._path_seg,
        repeat(seq(token.immediate("."), $._path_seg)),
      )),

    // field or field.nested...
    field_path: ($) =>
      prec.right(seq(
        $.identifier,
        repeat(seq(token.immediate("."), $._path_seg)),
      )),

    _path_seg: ($) => choice($.identifier, $.backtick_name),

    // ── Pipe chain (transform, arrow bodies) ─────────────────────────────

    pipe_chain: ($) => seq($.pipe_step, repeat(seq("|", $.pipe_step))),

    pipe_step: ($) =>
      choice(
        $.fragment_spread,
        $.map_literal,
        $.pipe_text,
      ),

    // pipe_text: greedy repeat of NL-compatible tokens.
    //
    // Every sequence of tokens between pipe delimiters (or between { and } / |)
    // is a single NL step. Bare identifiers like `trim`, numbers, quoted
    // strings, dotted names, arithmetic operators, and parenthesised text such
    // as `round(2)` are all treated as plain NL for downstream interpretation.
    // The only structured pipe-step forms are fragment spreads (`...name`) and
    // value maps (`map { ... }`), which are parsed by sibling rules above.
    //
    // | and } naturally terminate it (not in the choice set).
    pipe_text: ($) =>
      repeat1(
        choice(
          $._pipe_text_atom,
          $._parenthesized_pipe_text,
        ),
      ),

    _pipe_text_atom: ($) =>
      choice(
        $.at_ref,
        $.nl_string,
        $.multiline_string,
        $.backtick_name,
        $.dotted_name,
        $.number_literal,
        $.identifier,
        $._comparison_op,
        $._arithmetic_op,
      ),

    _parenthesized_pipe_text: ($) =>
      seq(
        "(",
        repeat(
          choice(
            $._pipe_text_atom,
            $._parenthesized_pipe_text,
            ",",
          ),
        ),
        ")",
      ),

    // ── Map literal ───────────────────────────────────────────────────────

    map_literal: ($) =>
      seq("map", "{", repeat(seq($.map_entry, optional(","))), "}"),

    map_entry: ($) => seq($.map_key, ":", $.map_value),

    // map_key: greedy tokens until `:`. Covers identifiers, strings,
    // numbers, wildcards (_), null, default, and comparison expressions.
    map_key: ($) =>
      repeat1(
        choice(
          $.nl_string,
          $.identifier,
          $.number_literal,
          $._comparison_op,
          // Arithmetic ops let keys express signed numbers (`< -5: "low"`).
          $._arithmetic_op,
          "_",
          "null",
          "default",
        ),
      ),

    // `=` is included so NL pipe text like `rate = 0.5` lexes; `==` wins by
    // maximal munch where both could match.
    _comparison_op: (_) =>
      token(choice(">=", "<=", ">", "<", "!=", "==", "=")),

    _arithmetic_op: (_) => token(choice("*", "/", "+", "-", "%")),

    // map_value: greedy tokens until `,` or `}`.
    map_value: ($) =>
      prec.left(
        repeat1(
          choice(
            $.nl_string,
            $.multiline_string,
            $.identifier,
            $.number_literal,
            "null",
          ),
        ),
      ),

    // ── Block label ───────────────────────────────────────────────────────

    block_label: ($) => choice($.identifier, $.backtick_name),

    // ── Metadata block ────────────────────────────────────────────────────

    // `()` (empty) is allowed; a trailing comma is allowed only after at
    // least one entry, so `(,)` is a parse error rather than silently empty.
    metadata_block: ($) =>
      seq(
        "(",
        optional(seq(commaSep1($._metadata_entry), optional(","))),
        ")",
      ),

    _metadata_entry: ($) =>
      choice(
        $.enum_body,
        $.slice_body,
        $.note_tag,
        $.tag_with_value,
        $.tag_token,
      ),

    enum_body: ($) =>
      seq(
        "enum",
        "{",
        commaSep1(choice($.identifier, $.nl_string, $.number_literal)),
        optional(","),
        "}",
      ),

    slice_body: ($) =>
      seq(
        "slice",
        "{",
        commaSep1($.identifier),
        optional(","),
        "}",
      ),


    note_tag: ($) =>
      seq(
        "note",
        choice($.multiline_string, $.nl_string),
      ),

    // tag_with_value: identifier followed by greedy value tokens
    tag_with_value: ($) => seq($.identifier, $.value_text),

    // value_text: greedy repeat of basic token types.
    // Commas and ) naturally terminate it (not in the choice set).
    //
    // Bare words use the external value_word token (aliased to identifier):
    // same line as the tag, and never a structural metadata keyword or a
    // spec-7.1 constraint flag. A missing comma before a flag or note entry
    // is therefore a loud parse error instead of silent absorption into the
    // previous entry's value (sl-vnty). Dotted/qualified refs still lex via
    // the internal rules — the scanner defers when '.' or ':' follows.
    value_text: ($) =>
      repeat1(
        choice(
          $.at_ref,
          $.nl_string,
          $.multiline_string,
          $.backtick_name,
          $.qualified_dotted_name,
          $.dotted_name,
          $.qualified_name,
          $.number_literal,
          $.boolean_literal,
          alias($.value_word, $.identifier),
          $._comparison_op,
          seq(
            "{",
            commaSep1(choice($.qualified_name, $.identifier)),
            optional(","),
            "}",
          ),
        ),
      ),

    // ns::identifier.field... — namespace-qualified dotted ref path
    qualified_dotted_name: ($) =>
      seq($.qualified_name, repeat1(seq(".", $.identifier))),

    dotted_name: ($) =>
      prec.left(seq($.identifier, repeat1(seq(".", choice($.identifier, $.number_literal))))),

    number_literal: (_) => /[0-9]+(\.[0-9]+)?/,

    boolean_literal: (_) => choice("true", "false"),

    tag_token: ($) => $.identifier,

    // ── @ref — structural cross-reference ────────────────────────────────
    // @identifier, @schema.field, @ns::schema.field, @`backtick-name`.field
    // Used in pipe_text and value_text for structural references.
    at_ref: ($) =>
      seq(
        "@",
        choice(
          seq($.identifier, "::", $.identifier, repeat(seq(".", $._path_seg))),
          seq($.backtick_name, repeat(seq(".", $._path_seg))),
          seq($.identifier, repeat(seq(".", $._path_seg))),
        ),
      ),

    // ── Lexical tokens ────────────────────────────────────────────────────

    // Hyphens are allowed inside an identifier but not at its end. A trailing
    // hyphen would let maximal munch lex `Id->tgt` as identifier "Id-" + ">",
    // breaking no-space arrows (sl-csd2). With this shape, `a->b` lexes as
    // "a", "->", "b" — whitespace around arrows is never required.
    identifier: (_) => /[a-zA-Z_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?/,

    backtick_name: (_) => /`(?:[^`\\]|\\.)+`/,

    // Content is any run without three consecutive quotes; the optional
    // `"?"?` before the closing delimiter lets content END in one or two
    // quotes (sl-xb85: `"""He said "hi""""`). Content cannot end in three
    // or more quotes — that is indistinguishable from the terminator.
    multiline_string: (_) => token(prec(1, /"""([^"]|"[^"]|""[^"])*"?"?"""/)),

    nl_string: (_) => /"(?:[^"\\]|\\.)*"/,

    warning_comment: (_) => token(prec(3, /\/\/!.*/)),
    question_comment: (_) => token(prec(2, /\/\/\?.*/)),
    comment: (_) => token(prec(1, /\/\/.*/)),
  },
});

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}
