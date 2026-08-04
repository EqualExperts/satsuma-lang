/**
 * model.ts — VizModel type re-exports for the satsuma-viz web component.
 *
 * The canonical type definitions live in @satsuma/viz-model, which is shared
 * between this package and the LSP server. Import types from there directly,
 * or from this module for backwards compatibility within satsuma-viz internals.
 */

export type {
  VizModel,
  NamespaceGroup,
  SchemaCard,
  FieldEntry,
  MappingBlock,
  ArrowEntry,
  TransformInfo,
  ResolvedAtRef,
  EachBlock,
  FlattenBlock,
  NestedArrowBlock,
  MetricCard,
  MetricFieldEntry,
  FragmentCard,
  NoteBlock,
  CommentEntry,
  MetadataEntry,
  SourceBlockInfo,
  SourceLocation,
  AggregateCoverage,
} from "@satsuma/viz-model";

export { CONSTRAINT_TAGS } from "@satsuma/viz-model";
