/**
 * scanner.c — External scanner for Satsuma v2 grammar
 *
 * Satsuma's internal lexer treats newlines as plain whitespace (extras), but
 * several constructs are line-sensitive: a multi-word fragment spread ends at
 * the end of its line, and a field's type must sit on the same line as the
 * field name. Tree-sitter's regex tokens cannot see line boundaries, so these
 * tokens are produced here instead.
 *
 * Tokens:
 *
 *   CONTINUATION_WORD
 *     An identifier that continues a multi-word spread label on the SAME LINE
 *     as the preceding identifier. A newline (or EOF) between the previous
 *     token and the candidate identifier makes this token fail, so the parser
 *     falls back to ending the spread and starting a new schema-body item.
 *     `...audit columns` stays a 2-word spread; `...f\nextra x` parses as
 *     spread "f" + field "extra".
 *
 *   INLINE_TYPE
 *     A field type expression — identifier-shaped word plus optional
 *     immediately-attached parenthesized arguments (`DECIMAL(12,2)`) — that
 *     must appear on the SAME LINE as the field name (sl-hjx1). Without the
 *     line restriction, two adjacent bare-name fields
 *     (`customer_id\nemail`) silently merged into one field_decl with the
 *     second name as the first one's type. The structural keywords `record`
 *     and `list_of` are never an INLINE_TYPE (they introduce nested-field
 *     forms), and neither is `note` (better recovery when a bare field name
 *     precedes a note block).
 *
 *   MAP_VALUE_WORD
 *     A bare word continuing a map value (`R: retail customer`) on the SAME
 *     LINE as its key. A newline ends the value, so the next line's words
 *     start a new map_entry instead of being folded into its key (sl-zzaj).
 *     Unlike the other word tokens it may start with a digit and contain
 *     interior dots, since bare map values are free prose ("tier 2.5").
 *
 *   VALUE_WORD
 *     A bare word inside a metadata tag value (value_text), on the SAME LINE
 *     as the tag. Refuses structural metadata keywords (note/enum/slice) and
 *     the spec-7.1 constraint flags (pk/required/unique/indexed/pii/encrypt)
 *     so that a missing comma between metadata entries errors loudly instead
 *     of silently absorbing the next entry into the value (sl-vnty). Defers
 *     to the internal lexer when '.' or ':' follows the word, so dotted and
 *     namespace-qualified refs (`ref addresses.id`, `crm::orders`) keep
 *     lexing through the internal dotted_name/qualified_name rules.
 *
 * All word tokens share the identifier shape enforced by the grammar: hyphens
 * allowed inside a word, never at its end (sl-csd2), so `a->b` always lexes
 * as an arrow.
 */

#include "tree_sitter/parser.h"
#include <string.h>

enum TokenType {
  CONTINUATION_WORD,
  INLINE_TYPE,
  VALUE_WORD,
  MAP_VALUE_WORD,
};

/* ── Keyword tables ─────────────────────────────────────────────────────── */

/* Structural field forms that must reach the internal lexer from a type
 * position (sl-hjx1); `note` is included for better recovery when a bare
 * field name precedes a note block. */
static const char *const TYPE_BLOCKLIST[] = { "record", "list_of", "note", NULL };

/* Words that terminate a metadata tag value (sl-vnty): structural metadata
 * entry keywords plus the spec-7.1 constraint flag tokens. A bare flag after
 * a value almost always means a missing comma; absorbing it silently made
 * extraction misreport constraints. Constraint flags used as a tag's value
 * must be quoted instead (spec 7.1). */
static const char *const VALUE_BLOCKLIST[] = {
  "note", "enum", "slice",
  "pk", "required", "unique", "indexed", "pii", "encrypt",
  NULL,
};

static bool in_word_list(const char *word, const char *const *list) {
  for (; *list; list++) {
    if (strcmp(word, *list) == 0) return true;
  }
  return false;
}

void *tree_sitter_satsuma_external_scanner_create() { return NULL; }

void tree_sitter_satsuma_external_scanner_destroy(void *payload) { (void)payload; }

unsigned tree_sitter_satsuma_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

void tree_sitter_satsuma_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

/* ── Character classes ──────────────────────────────────────────────────── */

static bool is_ident_start(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
}

/* Identifier continuation characters except '-', which needs lookahead (a
 * word must not end with a hyphen). */
static bool is_word_char(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
         (c >= '0' && c <= '9') || c == '_';
}

/* ── Word scanning ──────────────────────────────────────────────────────── */

/* Longest blocklist word is "list_of" (7 chars); anything longer cannot
 * match a keyword, so the capture buffer only needs to distinguish "short
 * enough to compare" from "definitely not a keyword". */
#define WORD_BUF_CAP 16

/**
 * Consume an identifier-shaped word (hyphens allowed inside, not at the end)
 * and capture its spelling for keyword comparison.
 *
 * The caller has validated the start character and stored it in buf[0]; this
 * function consumes it and the rest of the word. mark_end pins the token end
 * after each non-hyphen character; a hyphen run is only included once a
 * following word character confirms it is interior (sl-csd2 — a word never
 * ends with a hyphen, so `a->b` lexes as an arrow).
 *
 * Returns the word length. Sets *comparable to true only when the full word
 * fits the buffer and contains no hyphens — i.e. when a strcmp against a
 * structural keyword is meaningful.
 */
static unsigned scan_word(TSLexer *lexer, char *buf, bool *comparable) {
  unsigned len = 1; /* buf[0] was filled by the caller */
  bool has_hyphen = false;
  lexer->advance(lexer, false); /* consume the validated start character */
  lexer->mark_end(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (is_word_char(c)) {
      if (len < WORD_BUF_CAP - 1) buf[len] = (char)c;
      len++;
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
    } else if (c == '-') {
      /* Tentatively consume the hyphen run; the token end is only extended
       * (by the mark_end above) once a word character follows. */
      while (!lexer->eof(lexer) && lexer->lookahead == '-') {
        lexer->advance(lexer, false);
        len++;
        has_hyphen = true;
      }
      if (lexer->eof(lexer) || !is_word_char(lexer->lookahead)) {
        break; /* trailing hyphen(s): token ends before them */
      }
    } else {
      break;
    }
  }
  *comparable = !has_hyphen && len < WORD_BUF_CAP - 1;
  buf[len < WORD_BUF_CAP - 1 ? len : WORD_BUF_CAP - 1] = '\0';
  return len;
}

/**
 * Consume a bare map-value word: letters, digits, or underscore to start,
 * with interior hyphens and dots ("tier-2", "v1.2.3"). Map values are free
 * prose, so no keyword capture is needed. A hyphen or dot is only included
 * once a following word character confirms it is interior — the token never
 * ends with either, so `,`-less prose still terminates cleanly before
 * punctuation.
 */
static bool scan_map_value_word(TSLexer *lexer) {
  if (!is_word_char(lexer->lookahead)) return false;
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (is_word_char(c)) {
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
    } else if (c == '-' || c == '.') {
      /* Tentatively consume the punctuation run; the token end is only
       * extended once a word character follows. */
      while (!lexer->eof(lexer) &&
             (lexer->lookahead == '-' || lexer->lookahead == '.')) {
        lexer->advance(lexer, false);
      }
      if (lexer->eof(lexer) || !is_word_char(lexer->lookahead)) break;
    } else {
      break;
    }
  }
  lexer->result_symbol = MAP_VALUE_WORD;
  return true;
}

/* ── Scanner entry point ────────────────────────────────────────────────── */

bool tree_sitter_satsuma_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  (void)payload;

  if (!valid_symbols[CONTINUATION_WORD] &&
      !valid_symbols[INLINE_TYPE] &&
      !valid_symbols[VALUE_WORD] &&
      !valid_symbols[MAP_VALUE_WORD]) return false;

  /* Skip horizontal whitespace only (space, tab, form-feed). */
  while (!lexer->eof(lexer) &&
         (lexer->lookahead == ' '  ||
          lexer->lookahead == '\t' ||
          lexer->lookahead == '\f')) {
    lexer->advance(lexer, true);
  }

  /* Every token this scanner produces is same-line: a newline or EOF before
   * the word means the construct (spread, field) ended on the previous line.
   * \r counts as a line terminator too, so both \r\n and classic-Mac CR-only
   * line endings end the line (sl-2gle). */
  if (lexer->eof(lexer) ||
      lexer->lookahead == '\n' ||
      lexer->lookahead == '\r') return false;

  /* Dispatch: the identifier-shaped tokens share scan_word; MAP_VALUE_WORD
   * has its own scan (digit start, interior dots). The token groups are
   * valid in disjoint parser states, so the order below only matters during
   * error recovery, where every symbol is marked valid. */
  bool ident_token_valid = valid_symbols[CONTINUATION_WORD] ||
                           valid_symbols[INLINE_TYPE] ||
                           valid_symbols[VALUE_WORD];
  if (!ident_token_valid || !is_ident_start(lexer->lookahead)) {
    if (valid_symbols[MAP_VALUE_WORD]) return scan_map_value_word(lexer);
    return false;
  }

  char word[WORD_BUF_CAP];
  word[0] = (char)lexer->lookahead;
  bool comparable = false;
  scan_word(lexer, word, &comparable);

  /* CONTINUATION_WORD accepts any word — spread labels are free vocabulary.
   * Checked first: spread continuation never overlaps the other word-token
   * positions, and an open spread must keep extending (existing behaviour). */
  if (valid_symbols[CONTINUATION_WORD]) {
    lexer->result_symbol = CONTINUATION_WORD;
    return true;
  }

  if (valid_symbols[INLINE_TYPE]) {
    /* Reject structural keywords that introduce non-scalar field forms; the
     * internal lexer must see them. */
    if (comparable && in_word_list(word, TYPE_BLOCKLIST)) return false;

    /* Optional immediately-attached parenthesized arguments: `DECIMAL(12,2)`.
     * Mirrors the previous internal token's `[^)]*` content rule (newlines
     * allowed inside the parens). A space before `(` means the parens are a
     * metadata block, not type arguments (spec 3.2, sl-vryu). */
    if (lexer->lookahead == '(') {
      lexer->advance(lexer, false);
      while (!lexer->eof(lexer) && lexer->lookahead != ')') {
        lexer->advance(lexer, false);
      }
      if (!lexer->eof(lexer)) {
        lexer->advance(lexer, false); /* consume ')' */
        lexer->mark_end(lexer);
      }
      /* EOF before ')': unterminated args — token ends after the bare word. */
    }

    lexer->result_symbol = INLINE_TYPE;
    return true;
  }

  /* VALUE_WORD: bare word continuing a metadata tag value. */

  /* Defer dotted and namespace-qualified refs to the internal
   * dotted_name/qualified_name rules. Nothing has been marked beyond the
   * word, so returning false re-lexes from the token start. */
  if (lexer->lookahead == '.' || lexer->lookahead == ':') return false;

  /* Defer booleans to the internal lexer so `(default false)` keeps its
   * boolean_literal node — value_text consumers rely on the distinction. */
  if (comparable &&
      (strcmp(word, "true") == 0 || strcmp(word, "false") == 0)) {
    return false;
  }

  /* A structural keyword or constraint flag here means the previous entry's
   * value ended and a comma is missing — fail so the parse errors loudly. */
  if (comparable && in_word_list(word, VALUE_BLOCKLIST)) return false;

  lexer->result_symbol = VALUE_WORD;
  return true;
}
