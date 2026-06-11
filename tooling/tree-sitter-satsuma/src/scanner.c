/**
 * scanner.c — External scanner for Satsuma v2 grammar
 *
 * Defines one external token:
 *
 *   CONTINUATION_WORD
 *     Matches an identifier that continues a multi-word spread label on the
 *     SAME LINE as the preceding identifier.  A newline (or EOF) between the
 *     previous token and the candidate identifier makes this token fail, so
 *     the parser falls back to ending the spread and starting a new schema-
 *     body item.
 *
 * This allows `...audit columns` (same line) to remain a 2-word spread, while
 * `...f\nextra x` (next line) correctly parses as spread "f" + field "extra".
 */

#include "tree_sitter/parser.h"

enum TokenType {
  CONTINUATION_WORD,
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

bool tree_sitter_satsuma_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  (void)payload;

  if (!valid_symbols[CONTINUATION_WORD]) return false;

  /* Skip horizontal whitespace only (space, tab, form-feed). */
  while (!lexer->eof(lexer) &&
         (lexer->lookahead == ' '  ||
          lexer->lookahead == '\t' ||
          lexer->lookahead == '\f')) {
    lexer->advance(lexer, true);
  }

  /* A newline or EOF terminates the spread — no continuation on the next
   * line.  \r counts as a line terminator too, so both \r\n and classic-Mac
   * CR-only line endings end the line (sl-2gle: treating \r as horizontal
   * whitespace silently merged the next line's field into the spread).     */
  if (lexer->eof(lexer) ||
      lexer->lookahead == '\n' ||
      lexer->lookahead == '\r') return false;

  /* Must start with a letter or underscore (identifier start character). */
  int32_t c = lexer->lookahead;
  if (!((c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        c == '_')) {
    return false;
  }

  /* Consume the full identifier: letters, digits, underscores, hyphens. */
  while (!lexer->eof(lexer)) {
    c = lexer->lookahead;
    if ((c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '_' || c == '-') {
      lexer->advance(lexer, false);
    } else {
      break;
    }
  }

  lexer->result_symbol = CONTINUATION_WORD;
  return true;
}
