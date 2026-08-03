/**
 * coverage-viz-parity.test.ts — `satsuma coverage` and the viz card agree on
 * every file in the example corpus.
 *
 * Feature 38's epic acceptance criterion is that the CLI, the VS Code status bar
 * and the viz card report identical figures for the same workspace. It held on
 * two fixtures (sl-5nsv) and failed on twelve shipped examples, because the viz
 * derived its own covered-path set from the model's arrows and so could not see
 * the resolved NL `@ref` tier (sl-46wr, ADR-036) or whole-structure conferral
 * (sl-csrs, ADR-037). Named-rule cases live in satsuma-viz's coverage-parity
 * suite; this file is the sweep that would have caught both without anyone
 * knowing to look for them.
 *
 * This is the one place both consumer paths are reachable in one process, which
 * is why the sweep lives here: `@satsuma/viz-backend` assembles the model the
 * webview receives, `coverageForWorkspace` produces what the command prints, and
 * both are compared per mapping, schema and role — counts, denominators and
 * percentages alike.
 *
 * **Scope differs by design and is accounted for, not ignored.** `coverage` reads
 * the whole workspace (entry file plus transitive imports); a VizModel is one
 * file. So the comparison iterates the *viz* side: every mapping the card can
 * render must match the CLI, and a mapping declared only in an imported file is
 * absent from the model without being a disagreement. A viz mapping with no CLI
 * counterpart is still a failure — that direction would mean the card is
 * reporting on something the CLI does not.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getParser, summarizeFieldCoverage } from "@satsuma/core";
import {
  createWorkspaceIndex,
  indexFile,
  getImportReachableUris,
  createScopedIndex,
} from "@satsuma/viz-backend/workspace-index";
import { buildVizModel } from "@satsuma/viz-backend/viz-model";
import { loadWorkspace } from "#src/load-workspace.js";
import { coverageForWorkspace } from "#src/coverage-workspace.js";
import { resolveAllNLRefs } from "#src/nl-ref-extract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(__dirname, "../../../examples");

/** Every `.stm` file under `examples/`, sorted for a stable report order. */
function corpusFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) corpusFiles(path, out);
    else if (name.endsWith(".stm")) out.push(path);
  }
  return out;
}

/** Covered/total/pct, the three figures a reviewer reads off either surface. */
interface Figures {
  covered: number;
  total: number;
  pct: number;
}

/**
 * A `mapping|schema|role` key naming one reported figure on both sides.
 *
 * File-scope ids are written `::name` by the CLI's index and bare in a VizModel,
 * so the empty namespace is stripped to make the two comparable. A *named*
 * namespace is kept — `crm::orders` and `billing::orders` are different schemas.
 */
function figureKey(mapping: string, schema: string, role: string): string {
  const bare = (id: string) => (id.startsWith("::") ? id.slice(2) : id);
  return `${bare(mapping)}|${bare(schema)}|${role}`;
}

/** What `satsuma coverage` reports for `entryPath`, keyed by {@link figureKey}. */
async function cliFigures(entryPath: string): Promise<Map<string, Figures>> {
  const { files, index } = await loadWorkspace(entryPath);
  const { mappings } = coverageForWorkspace(index, files, resolveAllNLRefs(index));

  const figures = new Map<string, Figures>();
  for (const mapping of mappings) {
    for (const schema of mapping.result.schemas) {
      const { covered, total, pct } = summarizeFieldCoverage(schema.fields);
      figures.set(figureKey(mapping.mappingId, schema.schemaId, schema.role), {
        covered,
        total,
        pct,
      });
    }
  }
  return figures;
}

/**
 * What the viz card reports for `entryPath`, keyed by {@link figureKey}.
 *
 * Built the way a host builds it: index the whole corpus so cross-file imports
 * resolve, scope the model to the entry's own import graph, then read
 * `MappingBlock.coverage` — the payload the card is handed.
 */
function vizFigures(entryPath: string, corpus: string[]): Map<string, Figures> {
  const parser = getParser();
  const index = createWorkspaceIndex();
  const trees = new Map<string, ReturnType<typeof parser.parse>>();
  for (const path of corpus) {
    const tree = parser.parse(readFileSync(path, "utf8"));
    if (!tree) continue;
    trees.set(`file://${path}`, tree);
    indexFile(index, `file://${path}`, tree);
  }

  const entryUri = `file://${entryPath}`;
  const entryTree = trees.get(entryUri);
  if (!entryTree) return new Map();
  const scoped = createScopedIndex(index, getImportReachableUris(entryUri, index));
  const model = buildVizModel(entryUri, entryTree, scoped);

  const figures = new Map<string, Figures>();
  for (const ns of model.namespaces) {
    for (const mapping of ns.mappings) {
      const mappingId = ns.name ? `${ns.name}::${mapping.id}` : mapping.id;
      for (const schema of mapping.coverage?.schemas ?? []) {
        const { covered, total, pct } = summarizeFieldCoverage(schema.fields);
        figures.set(figureKey(mappingId, schema.schemaId, schema.role), { covered, total, pct });
      }
    }
  }
  return figures;
}

describe("viz coverage equals satsuma coverage across the example corpus (sl-46wr, sl-csrs)", () => {
  let corpus: string[];

  before(() => {
    corpus = corpusFiles(EXAMPLES);
    // A sweep that silently swept nothing would pass forever. The corpus is
    // dozens of files; a single digit means the walk broke, not that the repo
    // shrank.
    assert.ok(corpus.length > 20, `expected a corpus to sweep, found ${corpus.length} files`);
  });

  it("reports the same covered count, denominator and percentage for every mapping it renders", async () => {
    // The assertion the epic turns on. Reported as a list of disagreements
    // rather than failing on the first, so a rule that shifts many files shows
    // its whole footprint in one run instead of one file per fix-and-rerun.
    const disagreements: string[] = [];
    let compared = 0;

    for (const file of corpus) {
      const cli = await cliFigures(file);
      const viz = vizFigures(file, corpus);
      const relative = file.slice(EXAMPLES.length + 1);

      for (const [key, vizFigure] of viz) {
        const cliFigure = cli.get(key);
        if (!cliFigure) {
          disagreements.push(`${relative} ${key}: viz reports on a mapping the CLI does not`);
          continue;
        }
        compared++;
        const shown = (f: Figures) => `${f.covered}/${f.total} ${f.pct}%`;
        if (
          vizFigure.covered !== cliFigure.covered ||
          vizFigure.total !== cliFigure.total ||
          vizFigure.pct !== cliFigure.pct
        ) {
          disagreements.push(
            `${relative} ${key}: viz ${shown(vizFigure)}, cli ${shown(cliFigure)}`,
          );
        }
      }
    }

    assert.deepEqual(disagreements, []);
    // Guards the guard: if the viz stopped attaching coverage entirely, every
    // key would vanish and the loop above would compare nothing at all.
    assert.ok(compared > 50, `expected the sweep to compare real figures, compared ${compared}`);
  });
});
