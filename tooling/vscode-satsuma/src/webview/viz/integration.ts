/**
 * integration.ts — host-side Viz request orchestration for the VS Code webview.
 *
 * Keeps the VS Code panel thin by isolating the LSP request names, theme
 * mapping, and expanded-lineage fetch sequence in one host-only module. The
 * browser webview remains a generic renderer shell that only consumes messages.
 */

import type { LanguageClient } from "vscode-languageclient/node";

const VIZ_MODEL_REQUEST = "satsuma/vizModel";
const VIZ_FULL_LINEAGE_REQUEST = "satsuma/vizFullLineage";
const VIZ_LINKED_FILES_REQUEST = "satsuma/vizLinkedFiles";

export type ThemeKind = number;

/**
 * Renderer theme accepted by the `<satsuma-viz>` `theme` attribute. The
 * component defines exactly two palettes (light, dark); high-contrast VS Code
 * themes fold into the nearest of the two until a dedicated HC palette exists.
 */
export type VizTheme = "light" | "dark";

// VS Code `ColorThemeKind` numeric values (stable since VS Code 1.56). We mirror
// them as named constants rather than importing the enum so this host-only
// module stays free of the `vscode` namespace and remains unit-testable in Node.
const LIGHT_THEME_KIND = 1;
const DARK_THEME_KIND = 2;
const HIGH_CONTRAST_THEME_KIND = 3;
const HIGH_CONTRAST_LIGHT_THEME_KIND = 4;

export interface VizModelEnvelope<TModel> {
  /** Serialized VizModel payload returned by the LSP. */
  payload: TModel;
  /** Renderer theme the webview should apply for this model. */
  theme: VizTheme;
}

export interface ExpandedModelsEnvelope<TModel> {
  /** Schema whose expansion triggered the fetch. */
  schemaId: string;
  /** Additional VizModels from linked files, filtered to non-null results. */
  models: TModel[];
  /** Renderer theme the webview should apply for these models. */
  theme: VizTheme;
}

/**
 * Map an active VS Code `ColorThemeKind` to a renderer theme.
 *
 * | ColorThemeKind        | value | renderer theme |
 * |-----------------------|-------|----------------|
 * | Light                 | 1     | light          |
 * | Dark                  | 2     | dark           |
 * | HighContrast          | 3     | dark           |
 * | HighContrastLight     | 4     | light          |
 *
 * High-contrast kinds fold into the nearest base palette (a dedicated HC
 * palette is explicit future work, per the feature's non-goals). Unknown
 * kinds default to dark, matching the historical fallback.
 */
export function vizThemeForKind(kind: ThemeKind): VizTheme {
  switch (kind) {
    case LIGHT_THEME_KIND:
    case HIGH_CONTRAST_LIGHT_THEME_KIND:
      return "light";
    case DARK_THEME_KIND:
    case HIGH_CONTRAST_THEME_KIND:
      return "dark";
    default:
      return "dark";
  }
}

/**
 * Load the full-lineage VizModel for a file through the LSP request boundary.
 */
export async function loadFullLineageModel<TModel>(
  client: Pick<LanguageClient, "sendRequest">,
  uri: string,
  themeKind: ThemeKind,
): Promise<VizModelEnvelope<TModel> | null> {
  const model = await client.sendRequest<TModel | null>(VIZ_FULL_LINEAGE_REQUEST, { uri });
  if (!model) return null;
  return {
    payload: model,
    theme: vizThemeForKind(themeKind),
  };
}

/**
 * Load linked-file VizModels for a schema expansion through the LSP boundary.
 */
export async function loadExpandedModels<TModel>(
  client: Pick<LanguageClient, "sendRequest">,
  schemaId: string,
  currentUri: string,
  themeKind: ThemeKind,
): Promise<ExpandedModelsEnvelope<TModel>> {
  const linkedUris = await client.sendRequest<string[]>(VIZ_LINKED_FILES_REQUEST, {
    schemaId,
    currentUri,
  });

  if (linkedUris.length === 0) {
    return {
      schemaId,
      models: [],
      theme: vizThemeForKind(themeKind),
    };
  }

  const models = await Promise.all(
    linkedUris.map((uri) => client.sendRequest<TModel | null>(VIZ_MODEL_REQUEST, { uri })),
  );
  const resolvedModels: TModel[] = [];
  for (const model of models) {
    if (model) resolvedModels.push(model);
  }

  return {
    schemaId,
    models: resolvedModels,
    theme: vizThemeForKind(themeKind),
  };
}

/**
 * Build the field-lineage path emitted from a schema-card field interaction.
 */
export function buildFieldLineagePath(schemaId: string, fieldName: string): string {
  return `${schemaId}.${fieldName}`;
}
