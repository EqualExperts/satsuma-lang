/**
 * reference-stages.ts — Compile-time regression checks for opaque ref stages.
 *
 * Runtime strings remain serializable, but values can advance through semantic
 * transitions only in the order described by Feature 39 R5.
 */

import {
  buildCoveredFieldPaths,
  canonicalizeEntityRef,
  createAuthoredEntityRef,
  createAuthoredFieldRef,
  createCanonicalEntityRef,
  createCanonicalFieldEndpoint,
  createContainerQualifiedFieldRef,
  createSchemaLocalPath,
  declaredFieldKind,
  fieldEndpointOf,
  fieldEndpointPath,
  fieldEndpointSchema,
  isCoveredPath,
  qualifyContainerFieldRef,
  resolveFieldEndpoint,
  schemaLocalFieldPath,
} from "../src/index.js";
import type {
  AuthoredEntityRef,
  AuthoredFieldRef,
  CanonicalEntityRef,
  CanonicalFieldEndpoint,
  ContainerQualifiedFieldRef,
  SchemaLocalPath,
} from "../src/index.js";

const authoredField: AuthoredFieldRef = createAuthoredFieldRef(".city");
const container: ContainerQualifiedFieldRef = createContainerQualifiedFieldRef("address");
const qualified: ContainerQualifiedFieldRef = qualifyContainerFieldRef(authoredField, container);
const local: SchemaLocalPath = createSchemaLocalPath("address.city");
const authoredEntity: AuthoredEntityRef = createAuthoredEntityRef("customers");
const canonicalEntity: CanonicalEntityRef = createCanonicalEntityRef("::customers");

canonicalizeEntityRef(authoredEntity, null, new Map([["customers", {}]]));

const schemaLocal = schemaLocalFieldPath(
  createContainerQualifiedFieldRef("customers.address.city"),
  authoredEntity,
  canonicalEntity,
  [],
);
if (schemaLocal !== null) {
  const covered = buildCoveredFieldPaths([schemaLocal]);
  isCoveredPath(schemaLocal, covered);
  declaredFieldKind(schemaLocal, []);
}

// Raw boundary strings have not been validated and cannot acquire a stage.
// @ts-expect-error Raw strings are not authored field references.
qualifyContainerFieldRef(".city", container);

// A qualified value cannot be sent backwards through the authored transition.
// @ts-expect-error Container-qualified refs are not authored refs.
qualifyContainerFieldRef(qualified, container);

// Field-stage values and entity-stage values are intentionally unrelated.
// @ts-expect-error A schema-local field path is not an authored entity ref.
canonicalizeEntityRef(local, null, new Map());

// Authored and canonical entity identity are separate stages.
// @ts-expect-error A canonical entity id is not an authored entity ref.
canonicalizeEntityRef(canonicalEntity, null, new Map());

// Coverage accepts only paths that have completed schema localization.
// @ts-expect-error Raw strings are not schema-local paths.
buildCoveredFieldPaths(["address.city"]);

// @ts-expect-error Authored field refs have not completed schema localization.
buildCoveredFieldPaths([authoredField]);

// @ts-expect-error Coverage probes require a schema-local path.
isCoveredPath("address.city", buildCoveredFieldPaths([local]));

// @ts-expect-error Declared-field probes require a schema-local path.
declaredFieldKind("address.city", []);

// Localization requires a container-qualified field reference.
// @ts-expect-error Authored field refs have not completed container qualification.
schemaLocalFieldPath(authoredField, authoredEntity, canonicalEntity, []);

// Authored and canonical schema identity occupy different localization inputs.
// @ts-expect-error The canonical identity cannot be replaced with an authored ref.
schemaLocalFieldPath(qualified, authoredEntity, authoredEntity, []);

// ── Arrow endpoints ──────────────────────────────────────────────────────────

const endpoint: CanonicalFieldEndpoint = fieldEndpointOf(canonicalEntity, local);
fieldEndpointSchema(endpoint);
fieldEndpointPath(endpoint);

// Resolution reports the ambiguous case in its type, so a caller that only
// destructures `endpoint` does not compile — the fork has to be acknowledged.
const resolution = resolveFieldEndpoint(authoredField, ["customers"]);
// @ts-expect-error `endpoint` exists only on the unambiguous variant.
void resolution.endpoint;
if (resolution.kind === "field") {
  const resolved: CanonicalFieldEndpoint = resolution.endpoint;
  void resolved;
}

// Resolution consumes authored text only; a value that has already advanced
// cannot be sent back through qualification.
// @ts-expect-error Raw strings are not authored field references.
resolveFieldEndpoint("city", ["customers"]);

// @ts-expect-error An endpoint has completed qualification and cannot re-enter it.
resolveFieldEndpoint(endpoint, ["customers"]);

// Endpoint accessors require the endpoint stage, not an earlier field stage.
// @ts-expect-error Authored field refs name no owning schema yet.
fieldEndpointSchema(authoredField);

// @ts-expect-error A schema-local path is relative and has no owner to report.
fieldEndpointSchema(local);

// @ts-expect-error Raw strings from a serialized payload must be validated first.
fieldEndpointPath("::customers.city");

// An entity id and an endpoint are different stages even though a schema-root
// endpoint spells identically to one.
// @ts-expect-error A canonical entity id is not an endpoint.
fieldEndpointPath(canonicalEntity);

// @ts-expect-error An endpoint may carry a field path and is not entity identity.
fieldEndpointOf(endpoint, local);

void createCanonicalFieldEndpoint("::customers.city");
void qualified;
void local;
void canonicalEntity;
