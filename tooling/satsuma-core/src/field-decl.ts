/**
 * field-decl.ts — Construction and classification boundaries for FieldDecl.
 *
 * The public union stays JSON-compatible with the historic object shape. This
 * module supplies the runtime checks and temporary discriminator needed when a
 * consumer intentionally handles all four structural variants.
 */

import type {
  FieldDecl,
  FieldDeclBase,
  RecordFieldDecl,
  RecordListFieldDecl,
  ScalarFieldDecl,
  ScalarListFieldDecl,
  ScalarTypeExpression,
} from "./types.js";

/** The reserved type keyword that denotes a nested record rather than a scalar. */
const RECORD_TYPE_KEYWORD = "record";

/**
 * Validate a string crossing into a scalar FieldDecl variant.
 *
 * Literal `record` calls fail at compile time, while the runtime guard protects
 * dynamic strings from JSON, LSP, or other protocol boundaries.
 */
export function createScalarTypeExpression<const Type extends string>(
  type: Type extends typeof RECORD_TYPE_KEYWORD ? never : Type,
): ScalarTypeExpression {
  if (type === RECORD_TYPE_KEYWORD) {
    throw new TypeError("The reserved 'record' keyword is not a scalar type expression");
  }
  // The runtime guard above is the sole audited transition from a protocol
  // string to the branded scalar domain.
  return type as unknown as ScalarTypeExpression;
}

/** A transient discriminated view over the JSON-compatible FieldDecl union. */
export type ClassifiedFieldDecl =
  | { kind: "scalar"; field: ScalarFieldDecl }
  | { kind: "record"; field: RecordFieldDecl }
  | { kind: "scalar-list"; field: ScalarListFieldDecl }
  | { kind: "record-list"; field: RecordListFieldDecl };

/**
 * Classify a validated FieldDecl without adding a discriminator to its runtime
 * or serialized representation.
 */
export function classifyFieldDecl(field: FieldDecl): ClassifiedFieldDecl {
  if (field.children !== undefined) {
    return field.isList ? { kind: "record-list", field } : { kind: "record", field };
  }
  return field.isList ? { kind: "scalar-list", field } : { kind: "scalar", field };
}

/**
 * Input accepted when an LSP or visualization model stores `list_of` in the
 * rendered type string instead of core's separate `isList` property.
 */
export interface RenderedFieldDeclInput extends FieldDeclBase {
  /** Rendered type spelling, including an optional `list_of ` prefix. */
  type: string | null;
  /** Recursively normalized children supplied for record-bearing fields. */
  children?: FieldDecl[];
  /** Fragment names spread directly into a record body. */
  spreads?: string[];
}

/**
 * Normalize a consumer's rendered field spelling into the strict core union.
 *
 * This is the shared protocol boundary for the LSP and viz backend. It rejects
 * children or spreads attached to a scalar spelling instead of guessing that
 * malformed consumer data denotes a record.
 */
export function fieldDeclFromRenderedType(input: RenderedFieldDeclInput): FieldDecl {
  const { type: renderedType, children = [], spreads = [], ...base } = input;
  const type = renderedType ?? "";

  if (type === "record" || type === "list_of record") {
    const recordState: Omit<RecordFieldDecl, "isList"> = {
      ...base,
      type: RECORD_TYPE_KEYWORD,
      children,
      ...(spreads.length > 0 ? { hasSpreads: true, spreads } : {}),
    };
    return type === "list_of record" ? { ...recordState, isList: true } : recordState;
  }

  if (children.length > 0 || spreads.length > 0) {
    throw new TypeError(`Scalar field '${input.name}' cannot carry a record body or spreads`);
  }

  if (type === "list_of" || type.startsWith("list_of ")) {
    const elementType = type === "list_of" ? "" : type.slice("list_of ".length);
    return {
      ...base,
      type: createScalarTypeExpression(elementType),
      isList: true,
    };
  }

  return { ...base, type: createScalarTypeExpression(type) };
}

/** Render core's structural list marker back into the established public spelling. */
export function renderFieldDeclType(field: FieldDecl): string {
  const classified = classifyFieldDecl(field);
  switch (classified.kind) {
    case "scalar":
    case "record":
      return classified.field.type;
    case "scalar-list":
      return classified.field.type ? `list_of ${classified.field.type}` : "list_of";
    case "record-list":
      return "list_of record";
  }
}
