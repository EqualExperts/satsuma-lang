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
 * All word tokens share the identifier shape enforced by the grammar: hyphens
 * allowed inside a word, never at its end (sl-csd2), so `a->b` always lexes
 * as an arrow.
 */

#include "tree_sitter/parser.h"
#include <string.h>

enum TokenType {
  CONTINUATION_WORD,
  INLINE_TYPE,
};

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

/* ── Scanner entry point ────────────────────────────────────────────────── */

bool tree_sitter_satsuma_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  (void)payload;

  if (!valid_symbols[CONTINUATION_WORD] && !valid_symbols[INLINE_TYPE]) return false;

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

  if (!is_ident_start(lexer->lookahead)) return false;

  char word[WORD_BUF_CAP];
  word[0] = (char)lexer->lookahead;
  bool comparable = false;
  scan_word(lexer, word, &comparable);

  /* CONTINUATION_WORD accepts any word — spread labels are free vocabulary.
   * Checked first: spread continuation and type positions never overlap, and
   * an open spread must keep extending (existing behaviour). */
  if (valid_symbols[CONTINUATION_WORD]) {
    lexer->result_symbol = CONTINUATION_WORD;
    return true;
  }

  /* INLINE_TYPE: reject structural keywords that introduce non-scalar field
   * forms; the internal lexer must see them. */
  if (comparable &&
      (strcmp(word, "record") == 0 ||
       strcmp(word, "list_of") == 0 ||
       strcmp(word, "note") == 0)) {
    return false;
  }

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
