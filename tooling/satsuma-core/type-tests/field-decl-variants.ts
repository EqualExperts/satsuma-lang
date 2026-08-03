/**
 * field-decl-variants.ts — Compile-time checks for valid extracted field shapes.
 *
 * Field declarations keep their existing serializable properties, while the
 * public source contract rejects combinations the Satsuma grammar cannot emit.
 */

import { createScalarTypeExpression } from "../src/index.js";
import type {
  FieldDecl,
  RecordFieldDecl,
  RecordListFieldDecl,
  ScalarFieldDecl,
  ScalarListFieldDecl,
} from "../src/index.js";

const scalar: ScalarFieldDecl = {
  name: "customer_id",
  type: createScalarTypeExpression("UUID"),
};

const record: RecordFieldDecl = {
  name: "address",
  type: "record",
  children: [scalar],
};

const scalarList: ScalarListFieldDecl = {
  name: "tags",
  type: createScalarTypeExpression("STRING"),
  isList: true,
};

const recordList: RecordListFieldDecl = {
  name: "line_items",
  type: "record",
  isList: true,
  children: [],
};

const validFields: FieldDecl[] = [scalar, record, scalarList, recordList];

// A scalar cannot expose a record body.
const scalarWithChildren: ScalarFieldDecl = {
  name: "invalid",
  type: createScalarTypeExpression("STRING"),
  // @ts-expect-error Scalar fields never carry children.
  children: [],
};

// A scalar cannot carry record-body spread state either.
const scalarWithSpreads: ScalarFieldDecl = {
  name: "invalid",
  type: createScalarTypeExpression("STRING"),
  // @ts-expect-error Scalar fields never own fragment-spread state.
  hasSpreads: true,
  // @ts-expect-error Scalar fields never name fragments from a record body.
  spreads: ["common"],
};

// The scalar type constructor is the boundary that prevents the record keyword
// from masquerading as a primitive element type.
// @ts-expect-error The record keyword denotes a record body, not a scalar type.
createScalarTypeExpression("record");

// A record list without a body previously matched the scalar-list bag shape.
// @ts-expect-error Record-list declarations always carry their record body.
const recordListWithoutBody: FieldDecl = {
  name: "invalid",
  type: "record",
  isList: true,
};

void validFields;
void scalarWithChildren;
void scalarWithSpreads;
void recordListWithoutBody;
