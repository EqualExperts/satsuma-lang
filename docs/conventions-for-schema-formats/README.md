# Conventions for Schema Formats

Satsuma is designed to represent schemas from any data format — including legacy, binary, positional, and industry-specific interchange standards. The vocabulary token system means format-specific metadata can be expressed directly in `( )` without language changes.

This directory documents conventions for representing esoteric and non-standard formats in Satsuma. Each subdirectory covers one format family with:

- **Why** the format is difficult to represent in traditional schema languages
- **Metadata conventions** — which vocabulary tokens to use and what they mean
- **How natural language helps** — where `" "` descriptions fill semantic gaps
- **A short valid Satsuma example**

## Format Categories

### Legacy and Positional
| Format | Directory | What it Stresses |
|--------|-----------|-----------------|
| COBOL Copybook | [`cobol-copybook/`](cobol-copybook/) | Positional layout, packed decimals, REDEFINES, OCCURS |
| EDI (EDIFACT / ODETTE / TRADACOMS) | [`edi/`](edi/) | Qualifier-driven segments, implied decimals, positional correlation, `filter` pattern |
| HL7 v2.x | [`hl7/`](hl7/) | Delimiter-based segments, inconsistent real-world feeds |
| X12 / HIPAA | [`x12-hipaa/`](x12-hipaa/) | Loop hierarchies, qualifiers, implementation guide divergence |

### Financial Messaging and Protocols
| Format | Directory | What it Stresses |
|--------|-----------|-----------------|
| ISO 8583 | [`iso8583/`](iso8583/) | Bitmap-driven fields, numeric identifiers, variable-length encoding |
| SWIFT MT | [`swift-mt/`](swift-mt/) | Block/tag structure, semi-structured text fields |
| ISO 20022 | [`iso20022/`](iso20022/) | Verbose XML, structural compression, legacy MT migration |
| FIX Protocol | [`fix-protocol/`](fix-protocol/) | Tag=value encoding, repeating groups, order sensitivity |

### Specialised Technical Formats
| Format | Directory | What it Stresses |
|--------|-----------|-----------------|
| ASN.1 | [`asn1/`](asn1/) | Tag-based encoding, BER/DER, CHOICE/OPTIONAL semantics |
| DICOM | [`dicom/`](dicom/) | Tag dictionaries, value representations, vendor extensions |
| MARC21 | [`marc21/`](marc21/) | Tag/indicator/subfield model, cataloguing semantics |
| iCalendar | [`icalendar/`](icalendar/) | Line folding, recurrence rules, timezone handling |

### Modern Data Formats
| Format | Directory | What it Stresses |
|--------|-----------|-----------------|
| Apache Avro | [`avro/`](avro/) | Union nullability, logical types, schema evolution, Schema Registry coupling |

## General Principles

These conventions apply across all formats:

1. **Preserve the original vocabulary.** Use metadata tokens that mirror the format's own terminology (`pic`, `segment`, `tag`, `block`). Engineers familiar with the format should recognise them immediately.

2. **Separate physical layout from logical meaning.** Tokens like `offset`, `length`, and `encoding` describe the physical representation. The `record`/`list_of record` structure and field names describe the logical model. Keep both.

3. **Use natural language for interpretation rules.** Conditional logic (which REDEFINES variant to use, how to resolve a qualifier, when a field is populated) belongs in `" "` descriptions within mappings, not forced into metadata.

4. **Format goes on the schema.** Declare the wire format in schema-level metadata: `(format copybook, encoding ebcdic)`. Field-level metadata then adds format-specific detail.

5. **Derived fields belong in mappings.** Computed fields (`->`) are a mapping construct. Schema blocks describe structure; interpretation and derivation happen in `mapping` blocks.

## Formats Already Covered by Canonical Examples

The `examples/` directory at the repo root contains full working Satsuma files for several formats:

- **EDIFACT** — `examples/edi-to-json/pipeline.stm` (EDI 856 fixed-length)
- **XML / WSDL** — `examples/xml-to-parquet/pipeline.stm` (namespace-qualified XML)
- **Protobuf** — `examples/protobuf-to-parquet/pipeline.stm` (tagged fields, repeated groups)
- **Avro** — referenced in the spec (JSON-based, unions, schema evolution)
- **OpenAPI** — representable using standard Satsuma metadata (`format`, `enum`, `pii`)
- **COBOL → Avro** — `examples/cobol-to-avro/pipeline.stm` (legacy-to-modern transformation bridge)
- **JSON API** — `examples/json-api-to-parquet/pipeline.stm` (nested JSON with jsonpath extraction)

### Formats with Convention Docs and Canonical Examples

| Format | Convention Doc | Example | What it Stresses |
|--------|---------------|---------|-----------------|
| EDI (EDIFACT / ODETTE / TRADACOMS) | [`edi/`](edi/) | `examples/edi-to-json/pipeline.stm` | Qualifier filters, implied decimals, positional correlation with `each` |
| JSON / JSON API | [`json/`](json/) | `examples/json-api-to-parquet/pipeline.stm` | Deep nesting, array iteration, relative paths, JSON blob preservation |
| Apache Avro | [`avro/`](avro/) | `examples/cobol-to-avro/pipeline.stm` (Avro as target) | Union nullability, logical types, schema evolution, Schema Registry coupling |

The remaining conventions in this directory focus on formats that are **not** yet covered by canonical examples and where Satsuma's mixed-model approach provides the most value.
