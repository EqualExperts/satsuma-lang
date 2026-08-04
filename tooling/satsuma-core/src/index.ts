export { capitalize, normalizeName } from "./string-utils.js";
export {
  SATSUMA_NAMED_KINDS,
  SATSUMA_ANONYMOUS_TOKENS,
  SATSUMA_GRAMMAR_SYMBOLS,
  SATSUMA_RECOVERY_TYPE,
  SATSUMA_CST_TYPES,
} from "./generated/cst-types.js";
export type {
  SatsumaNamedKind,
  SatsumaAnonymousToken,
  SatsumaGrammarSymbol,
  SatsumaCstType,
} from "./generated/cst-types.js";
export { SATSUMA_FILE_EXTENSIONS, SATSUMA_FILE_GLOB, isSatsumaFilePath } from "./source-files.js";
export {
  canonicalizeEntityRef,
  createAuthoredEntityRef,
  createAuthoredFieldRef,
  createCanonicalEntityRef,
  createCanonicalFieldEndpoint,
  createContainerQualifiedFieldRef,
  createSchemaLocalPath,
  fieldEndpointOf,
  fieldEndpointPath,
  fieldEndpointSchema,
  qualifyContainerFieldRef,
} from "./reference-stages.js";
export type {
  AuthoredEntityRef,
  AuthoredFieldRef,
  CanonicalEntityRef,
  CanonicalFieldEndpoint,
  ContainerQualifiedFieldRef,
  SchemaLocalPath,
} from "./reference-stages.js";
export { findFieldByPath, collectFieldNames } from "./field-utils.js";
export type { FieldTreeNode } from "./field-utils.js";
export { collectSemanticDiagnostics, validateSemanticWorkspace } from "./validate.js";
export { computeImportReachability, computeSymbolDependencies } from "./import-reachability.js";
export type { ResolvedFileImport, ImportReachability } from "./import-reachability.js";
export type {
  SemanticDiagnostic,
  SemanticIndex,
  SemanticSchema,
  SemanticFragment,
  SemanticMapping,
  SemanticMetric,
  SemanticArrow,
  SemanticNLRef,
  SemanticDuplicate,
  SemanticValidationOptions,
  ImportScopeDiagnosticPolicy,
  ImportScopeViolation,
} from "./validate.js";
export { initParser, getParser, getLanguage, createQuery } from "./parser.js";
export type {
  ParserInitOptions,
  ParsedSatsumaNode,
  ParsedSatsumaTree,
  SatsumaParser,
} from "./parser.js";
export { collectParseErrors } from "./parse-errors.js";
export type { ParseErrorEntry } from "./parse-errors.js";
export {
  computeMappingCoverage,
  declaredFieldKind,
  declaresRecordBody,
  uncoveredFieldCoverage,
} from "./coverage.js";
export type {
  CoverageTier,
  FieldCoverageState,
  FieldCoverageEntry,
  SchemaCoverageResult,
  MappingCoverageResult,
  CoverageField,
  CoverageSchemaDefinition,
  CoverageSchemaResolver,
  MappingSelector,
  MappingTarget,
} from "./coverage.js";
export {
  buildCoveredFieldPaths,
  isCoveredPath,
  schemaLocalFieldPath,
  schemaRefPrefixes,
} from "./coverage-paths.js";
export type { CoveredFieldPaths } from "./coverage-paths.js";
export {
  aggregateCoverage,
  unionFieldCoverage,
  summarizeFieldCoverage,
  leafFieldEntries,
  countContainerStates,
  coveragePercentage,
} from "./coverage-rollup.js";
export type {
  MappingCoverageInput,
  CoverageTotals,
  ContainerStateCounts,
  AggregateSchemaCoverage,
  RoleTotals,
  NamespaceCoverage,
  AggregateCoverage,
} from "./coverage-rollup.js";
export { format } from "./format.js";
export type {
  SyntaxNode,
  Tree,
  Classification,
  PipeStep,
  MetaEntry,
  MetaEntryTag,
  MetaEntryKV,
  MetaEntryEnum,
  MetaEntryNote,
  MetaEntrySlice,
  ScalarTypeExpression,
  FieldDeclBase,
  ScalarFieldDecl,
  RecordFieldDecl,
  ScalarListFieldDecl,
  RecordListFieldDecl,
  FieldDecl,
} from "./types.js";
export {
  createScalarTypeExpression,
  classifyFieldDecl,
  fieldDeclFromRenderedType,
  renderFieldDeclType,
} from "./field-decl.js";
export type { ClassifiedFieldDecl, RenderedFieldDeclInput } from "./field-decl.js";
export { assertNever } from "./assert-never.js";
export {
  child,
  children,
  allDescendants,
  labelText,
  stringText,
  entryText,
  qualifiedNameText,
  sourceRefText,
  sourceRefStructuralText,
  fieldNameText,
  walkDescendants,
} from "./cst-utils.js";
export { classifyTransform, classifyArrow } from "./classify.js";
export type { LintFinding } from "./lint-findings.js";
export { TYPE_MISMATCH_RULE_ID, detectTypeMismatches } from "./lint-type-mismatch.js";
export type {
  DeclaredTypeField,
  DeclaredTypeSchema,
  DeclaredTypeSchemaResolver,
  TypeMismatchArrow,
  TypeMismatchInput,
  TypeMismatchMapping,
} from "./lint-type-mismatch.js";
export { LINEAGE_CYCLE_RULE_ID, detectLineageCycles } from "./lint-lineage-cycle.js";
export type {
  LineageCycleInput,
  LineageCycleMapping,
  LineageSchemaIdResolver,
} from "./lint-lineage-cycle.js";
export {
  canonicalRef,
  canonicalEntityName,
  resolveFieldEndpoint,
  resolveScopedEntityRef,
} from "./canonical-ref.js";
export type { FieldEndpointResolution } from "./canonical-ref.js";
export { extractMetadata } from "./meta-extract.js";
export {
  extractFieldTree,
  extractNamespaces,
  extractSchemas,
  extractMetrics,
  isMetricSchema,
  extractMappings,
  extractFragments,
  extractTransforms,
  extractNotes,
  extractWarnings,
  extractQuestions,
  extractImports,
  extractArrowRecords,
  extractMappingArrowRecords,
  qualifyChildArrowPath,
  canonicalPipeChainText,
} from "./extract.js";
export {
  collectFieldPaths,
  expandSpreads,
  expandDeclaredFields,
  expandEntityFields,
  expandNestedSpreads,
  makeEntityRefResolver,
} from "./spread-expand.js";
export {
  AT_REF_PATTERN,
  createAtRefRegex,
  extractAtRefs,
  computeNLRefPosition,
  classifyRef,
  resolveRef,
  extractNLRefData,
  resolveAllNLRefs,
  isSchemaInMappingSources,
  stripNLRefScopePrefix,
} from "./nl-ref.js";
export type {
  AtRef,
  RefClassification,
  Resolution,
  MappingSourcesTargets,
  DefinitionLookup,
  NLRefDataItem,
  NLRefDataItemNoFile,
  ResolvedNLRef,
} from "./nl-ref.js";
export type {
  SpreadEntity,
  ExpandedField,
  SpreadDiagnostic,
  EntityRefResolver,
  SpreadEntityLookup,
} from "./spread-expand.js";
export type {
  ExtractedNamespace,
  ExtractedSchema,
  ExtractedMetric,
  ExtractedMapping,
  ExtractedFragment,
  ExtractedTransform,
  ExtractedNote,
  ExtractedWarning,
  ExtractedQuestion,
  ExtractedImport,
  ExtractedArrow,
  ArrowDeclarationKind,
} from "./extract.js";
