/**
 * @satsuma/viz-backend — shared workspace indexing and VizModel assembly.
 *
 * Owns the reusable backend logic that turns parsed Satsuma files into
 * browser-ready VizModel payloads. Consumers such as the LSP server and future
 * browser harnesses should depend on this package rather than reimplementing
 * viz assembly or importing LSP-internal modules.
 */

export * from "./workspace-index";
export * from "./viz-model";
export * from "./model-from-sources";
