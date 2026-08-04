/**
 * field-endpoints.ts — the endpoint spelling `graph` and `lineage` emit
 *
 * Owns the one qualification decision core deliberately refuses to make. Core's
 * `resolveFieldEndpoint` reports when an authored arrow token reads either as a
 * schema root or as a same-named field, instead of guessing; this module records
 * which reading today's output takes — in one place, so the pending decision on
 * `r0-7w76` has a single site to change rather than three emitters to find.
 *
 * Does NOT own qualification itself (core's `resolveFieldEndpoint`) or edge
 * assembly (`commands/graph-builder.ts`, `commands/field-lineage.ts`,
 * `nl-ref-extract.ts`), all of which call in here for their endpoints.
 */

import {
  assertNever,
  createAuthoredFieldRef,
  createCanonicalFieldEndpoint,
  resolveFieldEndpoint,
} from "@satsuma/core";
import type { CanonicalFieldEndpoint } from "@satsuma/core";
import { canonicalKey } from "./index-builder.js";

/**
 * Canonical identity of one authored arrow field, given the schemas declared on
 * that side of its mapping.
 *
 * `authored` is arrow or NL-ref extraction output. Extraction never produces an
 * empty field expression — an arrow with no endpoint does not parse as one — so
 * an empty value here is a defect upstream and core's constructor throws rather
 * than emitting an edge whose endpoint names nothing.
 *
 * `schemas` are index keys in declaration order; see `resolveFieldEndpoint` for
 * why the order is significant.
 */
export function arrowEndpoint(
  authored: string,
  schemas: readonly string[],
): CanonicalFieldEndpoint {
  const resolution = resolveFieldEndpoint(createAuthoredFieldRef(authored), schemas);

  switch (resolution.kind) {
    case "field":
      return resolution.endpoint;

    case "schema-root-or-field":
      // RULE (pending `r0-7w76`, undecided): read the token as a field.
      //
      // `flatten observations -> species_fact` names the target schema's root,
      // but graph and lineage have always read that bare token as a field of the
      // mapping's primary schema and emitted `::species_fact.species_fact` — a
      // field the workspace does not declare. Keeping the reading here preserves
      // today's output exactly while making the guess visible and singular;
      // `resolution.schemaRoot` is the other answer, one line away, for whenever
      // the ticket decides which is right.
      return resolution.asField;

    case "unqualifiable":
      // The mapping declares no schema on this side, so the authored text is the
      // whole identity available. It is still canonicalized, because every other
      // endpoint in the same output carries the namespace separator and a
      // consumer matching endpoints across commands needs one spelling per
      // entity.
      return createCanonicalFieldEndpoint(canonicalKey(resolution.authored));

    default:
      return assertNever(resolution, "Unhandled field endpoint resolution");
  }
}
