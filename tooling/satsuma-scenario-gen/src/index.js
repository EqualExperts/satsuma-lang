/**
 * index.js — public surface of `@satsuma/scenario-gen`.
 *
 * A test-only package: it generates semantic Satsuma scenarios, renders them to
 * source text, and states the ground truth that follows from a scenario by
 * construction. Every package's property suites import from here, which is the
 * point of it existing — the generator used to live under
 * `satsuma-core/test/support/`, where no other package could reach it (sl-puky).
 *
 * **It must never depend on `@satsuma/core`.** Core's own tests depend on this
 * package, so a dependency back on core would make core's test run need this
 * package's output while this package's build needed core's `dist/` — a cycle.
 * That constraint costs nothing because rendering is pure string building. The
 * adapters that *do* drive the production pipeline (parse, extract, compute
 * coverage, build a graph) live in each consuming package's test tree, beside
 * the pipeline they drive. Keeping pipeline code out of this package is what
 * stops it becoming a second production implementation of Satsuma's semantics.
 *
 * Exported type names carry a `Scenario` prefix on purpose: core's `validate.ts`
 * already exports `SemanticMapping`, `SemanticArrow` and `SemanticSchema` for
 * the unrelated semantic-validation model, and the collision would mislead.
 */

export {
  MAX_GENERATED_LEAVES,
  fieldTreeForPath,
  leafNames,
  listRecordField,
  mappingScenario,
  nestFields,
  nestedPath,
  recordField,
  scalarField,
  semanticLeafPaths,
} from "./model.js";

export { renderDeclaration, renderEntity, renderMapping, renderScenario } from "./render.js";

// ── Workspace-shaped scenarios (sl-dqyu) ───────────────────────────────────

export {
  canonicalEndpoint,
  canonicalEntityRef,
  computedArrow,
  eachBlock,
  endpoint,
  entityRef,
  flattenArrows,
  flattenBlock,
  mapArrow,
  mappingDecl,
  nlTransform,
  scenarioFile,
  scenarioWorkspace,
  schemaDecl,
  workspaceMappings,
  workspaceSchemas,
} from "./workspace-model.js";

export { renderWorkspace, renderWorkspaceFile } from "./workspace-render.js";

export {
  scenarioAncestorsWithin,
  scenarioDeclaredFieldPaths,
  scenarioDeclaredLeafPaths,
  scenarioDescendantsWithin,
  scenarioFieldEdges,
  scenarioReachableWithin,
  scenarioSchemaEdges,
  scenarioSchemaProjection,
} from "./ground-truth.js";

export {
  chainWorkspaceArbitrary,
  computedArrowWorkspaceArbitrary,
  containerWorkspaceArbitrary,
  cyclicWorkspaceArbitrary,
  diamondWorkspaceArbitrary,
  kitchenSinkWorkspace,
  metricWorkspaceArbitrary,
  multiFileWorkspaceArbitrary,
  multiSourceWorkspaceArbitrary,
  namespacedWorkspaceArbitrary,
  nlRefWorkspaceArbitrary,
  permutationArbitrary,
  permuteWorkspaceDeclarations,
  schemaRootContainerWorkspaceArbitrary,
  spreadWorkspaceArbitrary,
  splitWorkspaceAcrossFiles,
  workspacePermutationsArbitrary,
  workspaceScenarioArbitrary,
} from "./workspace-arbitraries.js";

export {
  GENERATED_PROPERTY_PARAMETERS,
  coverageEndpointScenarioArbitrary,
  differentialCoverageScenarioArbitrary,
  dottedPathArbitrary,
  dottedPathsArbitrary,
  monotonicScenarioArbitrary,
  nonContainerSourceScenarioArbitrary,
  renestingScenarioArbitrary,
  repeatedNameScenarioArbitrary,
  schemaLocalRefScenarioArbitrary,
  semanticScenarioArbitrary,
  spreadRedeclarationScenarioArbitrary,
  wholeStructureScenarioArbitrary,
} from "./arbitraries.js";

/**
 * @typedef {import("./model.js").ScenarioScalarField} ScenarioScalarField
 * @typedef {import("./model.js").ScenarioRecordField} ScenarioRecordField
 * @typedef {import("./model.js").ScenarioField} ScenarioField
 * @typedef {import("./model.js").ScenarioEntity} ScenarioEntity
 * @typedef {import("./model.js").ScenarioArrow} ScenarioArrow
 * @typedef {import("./model.js").ScenarioMapping} ScenarioMapping
 * @typedef {import("./model.js").Scenario} Scenario
 * @typedef {import("./workspace-model.js").ScenarioEndpoint} ScenarioEndpoint
 * @typedef {import("./workspace-model.js").ScenarioEntityRef} ScenarioEntityRef
 * @typedef {import("./workspace-model.js").ScenarioTransform} ScenarioTransform
 * @typedef {import("./workspace-model.js").ScenarioWorkspaceArrow} ScenarioWorkspaceArrow
 * @typedef {import("./workspace-model.js").ScenarioSchemaDecl} ScenarioSchemaDecl
 * @typedef {import("./workspace-model.js").ScenarioMappingDecl} ScenarioMappingDecl
 * @typedef {import("./workspace-model.js").ScenarioFile} ScenarioFile
 * @typedef {import("./workspace-model.js").ScenarioWorkspace} ScenarioWorkspace
 * @typedef {import("./ground-truth.js").ScenarioFieldEdge} ScenarioFieldEdge
 * @typedef {import("./ground-truth.js").ScenarioSchemaEdge} ScenarioSchemaEdge
 */
