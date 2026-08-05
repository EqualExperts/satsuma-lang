# Satsuma — AI Agent Reference

## Portable Grammar & Conventions

> Copy this section into any AI agent's system prompt to enable reliable
> Satsuma generation and consumption. No CLI access required.

---

### Grammar (compact EBNF)

This EBNF is intentionally **compact and approximate**. It is a mnemonic for
generation, not a complete formal grammar for every NL-heavy construct.

```ebnf
(* Undefined terminals — implementation-defined:
   TYPE (e.g. INT, STRING, BOOLEAN, UUID, CHAR, VARCHAR, DECIMAL, DATE, TIMESTAMP)
   value, params (comma-separated literals/identifiers)
   NUMBER, ARITH (+, -, *, /), LETTER, DIGIT, ANY, TEXT_TO_EOL *)

file             = { import_stmt | note_block | namespace | schema | fragment | transform | mapping } ;

import_stmt      = "import" "{" name_list "}" "from" STRING ;
name_list        = name_ref {"," name_ref} ;
name_ref         = label | label "::" label ;

note_block       = "note" "{" (STRING | TRIPLESTRING) "}" ;

namespace        = "namespace" label ["(" metadata ")"] "{" namespace_body "}" ;
namespace_body   = { note_block | schema | fragment | transform | mapping } ;

schema           = "schema" label ["(" metadata ")"] "{" schema_body "}" ;
fragment         = "fragment" label "{" schema_body "}" ;
label            = IDENT | BACKTICK_IDENT ;

metadata         = meta_entry {"," meta_entry} ;
meta_entry       = IDENT [value] | IDENT "{" enum_items "}" | "note" (STRING | TRIPLESTRING) ;
enum_items       = value {"," value} ;

schema_body      = { field_decl | spread | note_block | COMMENT } ;
field_decl       = (IDENT | BACKTICK_IDENT) [type_expr] ["(" metadata ")"] ["{" schema_body "}"] ;
type_expr        = TYPE ["(" params ")"] | "record" | "list_of" TYPE ["(" params ")"] | "list_of" "record" ;
spread           = "..." label ;

(* A metric is a schema block decorated with (metric, ...) metadata — not a separate block type. *)
(* metric_entry tags: metric_name STRING | source (name_ref | "{" name_list "}") | grain IDENT  *)
(*                   | slice "{" name_list "}" | filter STRING                                   *)

transform        = "transform" label "{" transform_body "}" ;
transform_body   = spread | pipe_step {"|" pipe_step} ;
(* A bare STRING is a valid pipe_step, so a single NL string is a valid transform body *)

mapping          = "mapping" [label] ["(" metadata ")"] "{" mapping_body "}" ;
mapping_body     = { note_block | source_decl | target_decl | arrow | nested_arrow | each_block | flatten_block | COMMENT } ;
source_decl      = "source" "{" { source_item } "}" ;
source_item      = name_ref ["(" metadata ")"] | STRING ;
target_decl      = "target" "{" name_ref ["(" metadata ")"] "}" ;

arrow            = [source_paths] "->" field_path ["(" metadata ")"] ["{" transform_body "}"] ;
source_paths     = field_path {"," field_path} ;
nested_arrow     = field_path "->" field_path ["(" metadata ")"] "{" mapping_body "}" ;
each_block       = "each" field_path "->" field_path ["(" metadata ")"] "{" mapping_body "}" ;
flatten_block    = "flatten" field_path "->" field_path ["(" metadata ")"] "{" mapping_body "}" ;

pipe_step        = spread | IDENT ["(" params ")"] | ARITH NUMBER | "map" "{" map_entries "}" | STRING ;
map_entries      = { map_key ":" value } ;
map_key          = value | "<" NUMBER | "default" | "_" | "null" ;

field_path       = ["."] [label "::"] segment {"." segment} ;
(* :: is ONLY namespace::schema. Fields use dot: namespace::schema.field.nested *)
segment          = IDENT | BACKTICK_IDENT ;

IDENT            = LETTER {LETTER | DIGIT | "_" | "-"} ;
BACKTICK_IDENT   = "`" {ANY} "`" ;
STRING           = '"' {ANY} '"' ;
TRIPLESTRING     = '"""' {ANY} '"""' ;
COMMENT          = ("//" | "//!" | "//?") TEXT_TO_EOL ;
```

---
