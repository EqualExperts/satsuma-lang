export { capitalize, normalizeName } from "./string-utils.js";
export {
  SATSUMA_FILE_EXTENSIONS,
  SATSUMA_FILE_GLOB,
  isSatsumaFilePath,
} from "./source-files.js";
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
export type { ParserInitOptions } from "./parser.js";
export { collectParseErrors } from "./parse-errors.js";
export type { ParseErrorEntry } from "./parse-errors.js";
export { addPathAndPrefixes } from "./coverage.js";
export type { FieldCoverageEntry, SchemaCoverageResult, MappingCoverageResult } from "./coverage.js";
export { buildCoveredFieldSet, isCoveredFieldPath } from "./coverage-paths.js";
export { format } from "./format.js";
export type { SyntaxNode, Tree, Classification, PipeStep, MetaEntry, MetaEntryTag, MetaEntryKV, MetaEntryEnum, MetaEntryNote, MetaEntrySlice, FieldDecl } from "./types.js";
export { child, children, allDescendants, labelText, stringText, entryText, qualifiedNameText, sourceRefText, sourceRefStructuralText, fieldNameText, walkDescendants } from "./cst-utils.js";
export { classifyTransform, classifyArrow } from "./classify.js";
export { canonicalRef, canonicalEntityName, qualifyField, resolveScopedEntityRef } from "./canonical-ref.js";
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
  canonicalPipeChainText,
} from "./extract.js";
export {
  collectFieldPaths,
  expandSpreads,
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
} from "./extract.js";
