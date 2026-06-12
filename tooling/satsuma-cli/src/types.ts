/**
 * types.ts — Core type definitions for the Satsuma CLI
 *
 * Central home for interfaces shared across modules. Leaf modules and
 * extractors import from here rather than re-declaring shapes ad hoc.
 */

// ── Tree-sitter primitives ──────────────────────────────────────────────────

export interface SyntaxNode {
  type: string;
  text: string;
  isNamed: boolean;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  childCount: number;
  child(index: number): SyntaxNode | null;
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

export interface Parser {
  setLanguage(lang: unknown): void;
  parse(source: string): Tree;
}

// ── Extracted record types ──────────────────────────────────────────────────

export interface FieldDecl {
  name: string;
  type: string;
  children?: FieldDecl[];
  isList?: boolean;
  metadata?: import("@satsuma/core").MetaEntry[];
  hasSpreads?: boolean;
  spreads?: string[];
}

export interface SchemaRecord {
  name: string;
  note: string | null;
  fields: FieldDecl[];
  hasSpreads: boolean;
  spreads: string[];
  file: string;
  row: number;
  namespace?: string;
  blockMetadata?: import("@satsuma/core").MetaEntry[];
}

export interface MetricRecord {
  name: string;
  displayName: string | null;
  sources: string[];
  grain: string | null;
  slices: string[];
  fields: FieldDecl[];
  file: string;
  row: number;
  namespace?: string;
}

export interface MappingRecord {
  name: string | null;
  sources: string[];
  targets: string[];
  arrowCount: number;
  file: string;
  row: number;
  namespace?: string;
}

export interface FragmentRecord {
  name: string;
  fields: FieldDecl[];
  hasSpreads: boolean;
  spreads: string[];
  file: string;
  row: number;
  namespace?: string;
}

export interface TransformRecord {
  name: string;
  /** Raw pipe-chain source text, preserving the author's layout. */
  body: string | null;
  /** Layout-independent chain serialization — what diff compares (sl-dxjh). */
  canonicalBody: string | null;
  file: string;
  row: number;
  namespace?: string;
}

export interface NoteRecord {
  text: string;
  parent: string | null; // null for top-level notes; schema/metric/fragment name otherwise
  file: string;
  row: number;
  namespace: string | null;
}

export interface PipeStep {
  type: string;
  text: string;
}

/**
 * Arrow transform classification.
 *
 * After Feature 28 all pipe steps are NL — bare tokens, quoted strings, and map
 * literals are human/LLM-interpreted. The only axis that matters is presence:
 *
 * - "none"       — direct copy arrow (no transform body)
 * - "nl"         — any transform body (all content is NL)
 * - "nl-derived" — synthetic edge inferred from NL @-ref resolution
 */
export type Classification = "none" | "nl" | "nl-derived";

export interface ArrowRecord {
  mapping: string | null;
  namespace: string | null;
  sources: string[];
  target: string | null;
  transform_raw: string;
  steps: PipeStep[];
  classification: Classification;
  derived: boolean;
  line: number;
  file: string;
  metadata?: import("@satsuma/core").MetaEntry[];
}

export interface WarningRecord {
  text: string;
  file: string;
  row: number;
  parent: string | null;
  parentType: string | null;
}

export interface QuestionRecord {
  text: string;
  file: string;
  row: number;
  parent: string | null;
  parentType: string | null;
}

export interface NLRefData {
  text: string;
  mapping: string;
  namespace: string | null;
  targetField: string | null;
  /** Set to "source_block" when the NL text comes from a join condition or
   * filter expression in a source block. These refs must not generate
   * NL-derived arrows — they describe relationships between sources, not
   * data flow. */
  context?: "source_block";
  line: number;
  column: number;
  file: string;
}

export interface DuplicateRecord {
  kind: string;
  name: string;
  file: string;
  row: number;
  previousKind: string;
  previousFile: string;
  previousRow: number;
  tag?: string;
  value?: string;
  previousValue?: string;
}

// ── Workspace index ─────────────────────────────────────────────────────────

export interface ReferenceGraph {
  usedByMappings: Map<string, string[]>;
  fragmentsUsedIn: Map<string, string[]>;
  metricsReferences: Map<string, string[]>;
}

export interface ExtractedWorkspace {
  schemas: Map<string, SchemaRecord>;
  metrics: Map<string, MetricRecord>;
  mappings: Map<string, MappingRecord>;
  fragments: Map<string, FragmentRecord>;
  transforms: Map<string, TransformRecord>;
  notes: NoteRecord[];
  warnings: WarningRecord[];
  questions: QuestionRecord[];
  fieldArrows: Map<string, ArrowRecord[]>;
  referenceGraph: ReferenceGraph;
  namespaceNames: Set<string>;
  nlRefData: NLRefData[];
  duplicates: DuplicateRecord[];
  totalErrors: number;
  /** Per-file resolved import declarations for import-scope validation (ADR-022). */
  fileImports: Map<string, import("@satsuma/core").ResolvedFileImport[]>;
}

// ── Parsed file ─────────────────────────────────────────────────────────────

export interface ParsedFile {
  filePath: string;
  src: string;
  tree: Tree;
  errorCount: number;
}

// ── Lint types ──────────────────────────────────────────────────────────────

export interface LintFix {
  file: string;
  rule: string;
  description: string;
  apply: (source: string) => string;
}

export interface LintDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  rule: string;
  message: string;
  fixable: boolean;
  fix?: LintFix;
}

export interface LintRule {
  id: string;
  description: string;
  check: (index: ExtractedWorkspace) => LintDiagnostic[];
}

export type RegisterFn = (rule: LintRule) => void;

// ── Diff types ──────────────────────────────────────────────────────────────

export interface SchemaChange {
  kind: "field-removed" | "field-added" | "type-changed" | "metadata-changed" | "source-changed" | "grain-changed" | "slices-changed" | "note-changed" | "note-added" | "note-removed";
  field: string;
  from?: string;
  to?: string;
}

export interface MappingChange {
  kind: "arrow-count-changed" | "sources-changed" | "targets-changed" | "arrow-added" | "arrow-removed" | "arrow-transform-changed" | "note-added" | "note-removed";
  from?: unknown;
  to?: unknown;
  arrow?: string;
}

export interface BlockDelta<C> {
  added: string[];
  removed: string[];
  changed: Array<{ name: string; changes: C[] }>;
}

export interface NoteDelta {
  added: string[];
  removed: string[];
}

export interface TransformChange {
  kind: "body-changed";
  from: string;
  to: string;
}

export interface Delta {
  schemas: BlockDelta<SchemaChange>;
  mappings: BlockDelta<MappingChange>;
  metrics: BlockDelta<SchemaChange>;
  fragments: BlockDelta<SchemaChange>;
  transforms: BlockDelta<TransformChange>;
  notes: NoteDelta;
}

// ── Field match types ───────────────────────────────────────────────────────

export interface FieldMatch {
  source: string;
  target: string;
  normalized: string;
}

export interface MatchResult {
  matched: FieldMatch[];
  sourceOnly: string[];
  targetOnly: string[];
}
