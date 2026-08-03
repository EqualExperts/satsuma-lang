/**
 * @satsuma/viz-model — shared VizModel protocol contract.
 *
 * This package is the single source of truth for the JSON payload that the
 * Satsuma LSP server produces and the satsuma-viz web component consumes.
 * Both packages depend on this one; neither defines these types locally.
 *
 * The type hierarchy mirrors the structure of a Satsuma source file:
 *   VizModel
 *     └─ NamespaceGroup[]         (one per namespace block, plus one for the global scope)
 *           ├─ SchemaCard[]       (one per schema or inline schema)
 *           ├─ MappingBlock[]     (one per mapping block)
 *           ├─ MetricCard[]       (one per metric block)
 *           └─ FragmentCard[]     (one per fragment block)
 *
 * Field coverage travels *in* this payload rather than being derived from it —
 * see {@link MappingBlock.coverage}. That is why this otherwise self-contained
 * contract package depends on `@satsuma/core`: the coverage types it carries are
 * core's, verbatim, so a consumer reading them cannot be reading a re-derivation.
 */

import type { MappingCoverageResult } from "@satsuma/core";

// Coverage types are part of this contract, so a consumer needs no second
// import to read the payload it just received.
export type {
  MappingCoverageResult,
  SchemaCoverageResult,
  FieldCoverageEntry,
  FieldCoverageState,
  CoverageTier,
} from "@satsuma/core";

// ---------- Top-level document model ----------

/** The root serialised payload emitted by the LSP server. */
export interface VizModel {
  /** File URI of the .stm source that was rendered. */
  uri: string;
  /** Top-level note blocks declared before any namespace or entity block. */
  fileNotes: NoteBlock[];
  /** Namespace groups; the global (unnamed) scope is always first when present. */
  namespaces: NamespaceGroup[];
}

/** All entities declared inside a single namespace block (or the global scope). */
export interface NamespaceGroup {
  /** Namespace name, or null for the global (unqualified) scope. */
  name: string | null;
  schemas: SchemaCard[];
  mappings: MappingBlock[];
  metrics: MetricCard[];
  fragments: FragmentCard[];
}

// ---------- Schema ----------

/** Rendered representation of a schema or inline-schema definition. */
export interface SchemaCard {
  /** Unqualified schema name. */
  id: string;
  /** Fully qualified name, e.g. "crm::customers". Equal to id when no namespace. */
  qualifiedId: string;
  /** "schema" for standalone schemas; "inline" for schemas declared inside a mapping. */
  kind: "schema" | "inline";
  /** Display label from the schema's @label metadata, or null if absent. */
  label: string | null;
  fields: FieldEntry[];
  notes: NoteBlock[];
  comments: CommentEntry[];
  metadata: MetadataEntry[];
  location: SourceLocation;
  /** True when the schema is referenced as a source or target in an import block. */
  hasExternalLineage: boolean;
  /** True for placeholder cards injected for imported schemas whose defining
   *  file is not part of the model (no label, metadata, notes, or field
   *  constraints). Multi-file merges replace stubs with the full definition
   *  when the defining file is present (sl-ak00). Absent means false. */
  isStub?: boolean;
  /** Names of fragments spread into this schema (resolved before sending to the client). */
  spreads: string[];
}

/** A single field within a schema, fragment, or record-type field. */
export interface FieldEntry {
  name: string;
  /** Declared type string, e.g. "VARCHAR", "INT", "record". */
  type: string;
  /** Metadata tag values that are recognised constraint tags (pk, required, pii, …). */
  constraints: string[];
  /** ALL metadata entries on the field declaration, including key-value tags
   *  like `sensitivity internal` that are not constraint tags. Rendered as
   *  pills next to the constraint badges so no authored metadata is hidden
   *  (sl-6x1o). Constraint tags also appear here; renderers dedupe. */
  metadata: MetadataEntry[];
  notes: NoteBlock[];
  comments: CommentEntry[];
  /** Non-empty when the field has record type; contains the nested field declarations. */
  children: FieldEntry[];
  /**
   * Fragments spread into this field's record body (`address record {
   * ...address_fields }`), as authored.
   *
   * Present only while the model is being built: `buildVizModel` resolves
   * spreads and replaces them with the fields they materialise, so a model
   * handed to the component has this only for spreads that could not be
   * resolved. A consumer rendering fields should not need it — it exists so the
   * expansion pass can see a nested spread at all, which it could not before
   * sl-5nsv, leaving `address` as a childless record on the card while the CLI
   * reported its three leaves.
   */
  spreads?: string[];
  location: SourceLocation;
}

// ---------- Mapping ----------

/** Rendered representation of a mapping block and all its arrows. */
export interface MappingBlock {
  /** Unqualified mapping name. */
  id: string;
  /** Schema IDs listed in the source block. */
  sourceRefs: string[];
  /** Schema ID listed in the target block. */
  targetRef: string;
  arrows: ArrowEntry[];
  eachBlocks: EachBlock[];
  flattenBlocks: FlattenBlock[];
  /** nested_arrow blocks declared directly in the mapping body (svdfe-s6we). */
  nestedArrows: NestedArrowBlock[];
  /** Structured source-block info (multi-schema joins, filters). */
  sourceBlock: SourceBlockInfo | null;
  /** Metadata entries on the mapping declaration itself, e.g.
   *  `mapping m (airflow, note "...") { ... }`. Rendered in the detail
   *  view's mapping header alongside source/target/join (sl-6x1o). */
  metadata: MetadataEntry[];
  notes: NoteBlock[];
  comments: CommentEntry[];
  location: SourceLocation;
  /**
   * Per-field coverage for this mapping, one entry per schema its `source {}`
   * and `target {}` blocks name — computed by core's `computeMappingCoverage`
   * when the model was assembled.
   *
   * **The client must render these verdicts, never re-derive them.** Deriving
   * covered paths from `arrows`/`eachBlocks` on the client looks equivalent and
   * is not: it silently omits every coverage rule that is not visible in an
   * arrow's endpoints — the resolved NL `@ref` tier (ADR-036) and
   * whole-structure conferral (ADR-037), which need the ref resolver and the
   * arrow's declaration kind respectively. The viz did derive its own set until
   * sl-46wr / sl-csrs, and disagreed with `satsuma coverage` on twelve of the
   * shipped examples. Counting is core's too: `summarizeFieldCoverage` and
   * `countContainerStates` over these entries (ADR-034).
   *
   * Optional because a model may be assembled without a workspace index to
   * resolve schemas against, and because a payload cached by an older host will
   * not carry it. Absent means "not computed" — it is not the same as "nothing
   * is covered", and a consumer must not render 0% for it.
   */
  coverage?: MappingCoverageResult;
}

/** A single arrow within a mapping, each_block, or flatten_block. */
export interface ArrowEntry {
  /** Source field paths (may be multiple for multi-source arrows). */
  sourceFields: string[];
  /** Target field path. */
  targetField: string;
  /** Transform expression, or null for bare-copy arrows. */
  transform: TransformInfo | null;
  metadata: MetadataEntry[];
  comments: CommentEntry[];
  location: SourceLocation;
}

/**
 * Parsed transform attached to an arrow.
 *
 * After Feature 28, all pipe steps are NL — bare tokens, quoted strings,
 * and map literals are all interpreted by a human or LLM. The kind axis
 * has two values:
 *
 * - "nl"  — any pipe chain (bare tokens, quoted strings, spreads)
 * - "map" — a standalone map { } literal (discrete value mapping)
 *
 * The "pipeline" and "mixed" variants are removed.
 */
export interface TransformInfo {
  /** Broad category of the transform expression. */
  kind: "nl" | "map";
  /** Raw source text of the transform expression. */
  text: string;
  /** Individual step texts extracted from the pipe chain. */
  steps: string[];
  /**
   * @-refs resolved from the transform text (present for nl kind).
   * Absent when the arrow has no NL segment or the refs have not been resolved.
   */
  atRefs?: ResolvedAtRef[];
}

/** A resolved @-reference extracted from a natural-language transform segment. */
export interface ResolvedAtRef {
  /** The @ref token text as it appears in source, e.g. "@customers". */
  ref: string;
  /** How the ref was classified by the resolver. */
  classification: string;
  /** True when the ref resolved to at least one known definition. */
  resolved: boolean;
  /** The first resolved definition, or null when unresolved. */
  resolvedTo: { kind: string; name: string } | null;
}

/**
 * An each_block — iterates over a list field and maps its children.
 *
 * `each` and `flatten` may interleave to any depth: the grammar's
 * `_nested_block_item` permits either inside either, and
 * `examples/nested-iteration/pipeline.stm:100` puts a `flatten` inside an
 * `each`. Both nesting collections must therefore be walked by any consumer
 * counting or resolving arrows (sl-vu22).
 */
export interface EachBlock {
  /** Source list field being iterated. */
  sourceField: string;
  /** Target list field being populated. */
  targetField: string;
  arrows: ArrowEntry[];
  /** Nested each_blocks declared inside this one. */
  nestedEach: EachBlock[];
  /** Nested flatten_blocks declared inside this one. */
  nestedFlatten: FlattenBlock[];
  /** Nested nested_arrow blocks declared inside this one (svdfe-s6we). */
  nestedArrows: NestedArrowBlock[];
  location: SourceLocation;
}

/**
 * A flatten_block — iterates a source list and emits flat target arrows.
 *
 * Nests exactly as `each` does; see {@link EachBlock}.
 */
export interface FlattenBlock {
  /** Source list field being flattened. */
  sourceField: string;
  /**
   * Target the block writes into, as authored.
   *
   * Spec §4.6 gives this two readings and the authored text distinguishes them:
   * written plainly (`flatten contacts -> tgt`) it names the target *schema* and
   * the block unnests into schema-root fields; written relative
   * (`flatten parcels.contents -> .packed_items` inside an `each`) it names a
   * list field on the current element. Empty when the block declares no target.
   */
  targetField: string;
  arrows: ArrowEntry[];
  /** Nested each_blocks declared inside this one. */
  nestedEach: EachBlock[];
  /** Nested flatten_blocks declared inside this one. */
  nestedFlatten: FlattenBlock[];
  /** Nested nested_arrow blocks declared inside this one (svdfe-s6we). */
  nestedArrows: NestedArrowBlock[];
  location: SourceLocation;
}

/**
 * A nested_arrow block — the braced `src -> tgt { .a -> .b }` form that maps a
 * record's fields as a group (grammar.js `nested_arrow`).
 *
 * A consumer enumerating only each/flatten dropped these blocks and every arrow
 * inside them from the model, undercounting each affected mapping's arrows on
 * every viz surface (svdfe-s6we) — the same defect class as flatten-inside-each
 * (sl-vu22) and the core coverage walk (sl-qzy3).
 *
 * The grammar's nested_arrow body accepts arrow declarations only — including
 * further nested_arrows, but not each/flatten. The each/flatten collections are
 * still carried (always empty today) so all four block containers share one
 * shape and one walker; if the grammar ever admits iteration inside a
 * nested_arrow, the model and its consumers are already correct.
 */
export interface NestedArrowBlock {
  /** Source record path, as authored (relative `.addr` inside a container). */
  sourceField: string;
  /** Target record path, as authored. */
  targetField: string;
  arrows: ArrowEntry[];
  /** Always empty today — see the interface comment. */
  nestedEach: EachBlock[];
  /** Always empty today — see the interface comment. */
  nestedFlatten: FlattenBlock[];
  /** Further nested_arrow blocks declared inside this one. */
  nestedArrows: NestedArrowBlock[];
  location: SourceLocation;
}

/** Structured representation of a multi-schema source block. */
export interface SourceBlockInfo {
  /** Schema IDs listed in the source block. */
  schemas: string[];
  /** Prose description of the join strategy, or null if absent. */
  joinDescription: string | null;
  /** Filter expressions declared in the source block. */
  filters: string[];
}

// ---------- Metric ----------

/** Rendered representation of a metric definition. */
export interface MetricCard {
  id: string;
  qualifiedId: string;
  label: string | null;
  /** Source schema IDs this metric aggregates over. */
  source: string[];
  /** Declared grain (e.g. "monthly", "daily"), or null. */
  grain: string | null;
  /** Slice dimension names. */
  slices: string[];
  /** Filter expression, or null. */
  filter: string | null;
  fields: MetricFieldEntry[];
  notes: NoteBlock[];
  comments: CommentEntry[];
  location: SourceLocation;
}

/** A single measure field declared inside a metric block. */
export interface MetricFieldEntry {
  name: string;
  type: string;
  /** Additive behaviour of the measure; null when not declared. */
  measure: "additive" | "non_additive" | "semi_additive" | null;
  notes: NoteBlock[];
  location: SourceLocation;
}

// ---------- Fragment ----------

/** Rendered representation of a fragment definition (reusable field group). */
export interface FragmentCard {
  id: string;
  fields: FieldEntry[];
  /** Fragment names spread into this fragment (resolved before sending to the client). */
  spreads: string[];
  notes: NoteBlock[];
  /** Warning/question comments (//! and //?) attached to the fragment block. */
  comments: CommentEntry[];
  location: SourceLocation;
}

// ---------- Shared leaf types ----------

/** An inline or block note attached to an entity or field. */
export interface NoteBlock {
  text: string;
  isMultiline: boolean;
  location: SourceLocation;
}

/** A warning or question annotation in source (! or ? comment prefix). */
export interface CommentEntry {
  kind: "warning" | "question";
  text: string;
  location: SourceLocation;
}

/** A key–value metadata pair from @key value annotations. */
export interface MetadataEntry {
  key: string;
  value: string;
}

/** File position of an entity or field declaration in a .stm source file. */
export interface SourceLocation {
  /** File URI of the source file. */
  uri: string;
  /** 0-indexed line number. */
  line: number;
  /** 0-indexed character offset. */
  character: number;
}

// ---------- Known constraint tags ----------

/**
 * Metadata tags that are recognised as field constraints.
 * Constraints are rendered as badges in the viz component; arbitrary tags are not.
 * Source: Satsuma v2 spec §4.2 (field metadata).
 */
export const CONSTRAINT_TAGS = new Set(["pk", "required", "pii", "indexed", "unique", "encrypt"]);
