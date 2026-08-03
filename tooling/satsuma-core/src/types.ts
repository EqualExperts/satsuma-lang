/**
 * types.ts — Shared type definitions for satsuma-core
 *
 * Defines both the tree-sitter primitives and the extracted record shapes
 * produced by the satsuma-core extraction functions.
 */

import type { SatsumaCstType } from "./generated/cst-types.js";

// ── Tree-sitter primitives ──────────────────────────────────────────────────

export interface SyntaxNode {
  /** Grammar symbol or the explicit ERROR recovery-node type. */
  type: SatsumaCstType;
  text: string;
  isNamed: boolean;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  childCount: number;
  child(index: number): SyntaxNode | null;
  childForFieldName?(name: string): SyntaxNode | null;
  parent: SyntaxNode | null;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  isMissing: boolean;
}

export interface Tree {
  rootNode: SyntaxNode;
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Arrow transform classification.
 *
 * Every pipe step in a transform body is natural language — bare tokens like
 * `trim`, quoted strings, and `map { }` literals are all NL. The classification
 * axis has three values:
 *
 * - "nl"          — the arrow has a transform body (any non-empty pipe chain).
 *                   All step content is treated as NL for interpretation purposes.
 * - "none"        — bare arrow with no transform body (`src -> tgt`). Direct copy.
 * - "nl-derived"  — a synthetic arrow inferred from an `@ref` mention inside an NL
 *                   transform string. Not declared explicitly in the source; created
 *                   by the graph builder to represent implicit field lineage.
 */
export type Classification = "nl" | "none" | "nl-derived";

export interface PipeStep {
  type: string;
  text: string;
}

// ── Metadata entry types ────────────────────────────────────────────────────

export interface MetaEntryTag {
  kind: "tag";
  tag: string;
}

export interface MetaEntryKV {
  kind: "kv";
  key: string;
  value: string;
}

export interface MetaEntryEnum {
  kind: "enum";
  values: string[];
}

export interface MetaEntryNote {
  kind: "note";
  text: string;
}

/**
 * A `slice { dim1, dim2 }` metadata entry on a metric block.
 *
 * Specifies the dimension schema names by which the metric can be sliced or
 * grouped in reporting tools. Unlike MetaEntryEnum (which lists allowed field
 * values), the `values` here are schema references — names of dimension schemas
 * that define the slicing axes.
 *
 * Created by the metric extractor when it encounters `slice { ... }` in metric
 * metadata. Consumed by the metric command and diff engine.
 */
export interface MetaEntrySlice {
  kind: "slice";
  /** Dimension schema names that define the valid slicing axes for this metric. */
  values: string[];
}

export type MetaEntry = MetaEntryTag | MetaEntryKV | MetaEntryEnum | MetaEntryNote | MetaEntrySlice;

// ── Extracted field shapes ──────────────────────────────────────────────────

declare const scalarTypeExpressionBrand: unique symbol;

/**
 * A scalar type expression such as `INT`, `VARCHAR(MAX)`, or the empty string
 * used for a metadata-only field declaration.
 *
 * The brand keeps the reserved `record` keyword out of scalar variants without
 * changing the string stored at runtime. Construct values through
 * `createScalarTypeExpression` at parser or protocol boundaries.
 */
export type ScalarTypeExpression = string & {
  readonly [scalarTypeExpressionBrand]: "ScalarTypeExpression";
};

/** Properties shared by every field declaration variant. */
export interface FieldDeclBase {
  /** The field name as written in source (backtick quoting stripped). */
  name: string;
  /** Metadata entries from an inline metadata block on this field. */
  metadata?: MetaEntry[];
  /**
   * 0-indexed row of the field_decl node's start position in the source file.
   * Sourced from `node.startPosition.row` in the CST. Present when the field
   * was extracted from a parsed CST (always set by extractFieldTree).
   */
  startRow?: number;
  /**
   * 0-indexed column of the field_decl node's start position in the source file.
   * Sourced from `node.startPosition.column` in the CST. Present when the field
   * was extracted from a parsed CST (always set by extractFieldTree).
   */
  startColumn?: number;
}

/** A single primitive value, including metadata-only fields with an empty type. */
export interface ScalarFieldDecl extends FieldDeclBase {
  /** Scalar type expression exactly as authored; never the reserved `record` keyword. */
  type: ScalarTypeExpression;
  /** Scalar fields are not lists; explicit false is accepted at compatibility boundaries. */
  isList?: false;
  /** Scalar fields cannot own a nested record body. */
  children?: never;
  /** Scalar fields cannot contain fragment spreads. */
  hasSpreads?: never;
  /** Scalar fields cannot name fragments from a record body. */
  spreads?: never;
}

/** A nested record value with an explicit, possibly empty, field body. */
export interface RecordFieldDecl extends FieldDeclBase {
  /** The stable runtime spelling for a record-bearing field. */
  type: "record";
  /** A non-list record may retain an explicit false from the extractor. */
  isList?: false;
  /** Fields declared inside the record body. */
  children: FieldDecl[];
  /** True when the authored body contains at least one fragment spread. */
  hasSpreads?: boolean;
  /** Fragment names spread directly into this record body. */
  spreads?: string[];
}

/** A list whose elements are primitive scalar values. */
export interface ScalarListFieldDecl extends FieldDeclBase {
  /** Type expression of each scalar list element. */
  type: ScalarTypeExpression;
  /** The list marker separates this shape from a scalar field. */
  isList: true;
  /** Scalar-list elements cannot own a nested record body. */
  children?: never;
  /** Scalar-list elements cannot contain fragment spreads. */
  hasSpreads?: never;
  /** Scalar-list elements cannot name fragments from a record body. */
  spreads?: never;
}

/** A list whose elements are records with an explicit, possibly empty, body. */
export interface RecordListFieldDecl extends FieldDeclBase {
  /** The stable runtime spelling for each record element. */
  type: "record";
  /** The list marker distinguishes this shape from a single record. */
  isList: true;
  /** Fields declared inside the record element body. */
  children: FieldDecl[];
  /** True when the authored body contains at least one fragment spread. */
  hasSpreads?: boolean;
  /** Fragment names spread directly into this record element body. */
  spreads?: string[];
}

/**
 * A field declaration in one of the four shapes the grammar can emit.
 *
 * The union deliberately uses the existing `type`, `isList`, and `children`
 * properties, so tightening the TypeScript contract does not add a serialized
 * discriminator or change CLI/LSP/VizModel payloads.
 */
export type FieldDecl =
  ScalarFieldDecl | RecordFieldDecl | ScalarListFieldDecl | RecordListFieldDecl;
