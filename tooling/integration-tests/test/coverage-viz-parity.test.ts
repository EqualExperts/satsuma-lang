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
 * Lives in this package rather than either consumer's own test tree for the
 * same reason both parity sweeps do: it is not a CLI test or a viz-backend
 * test, it is a claim about the two of them agreeing, and needs both reachable
 * in one process without inverting either package's real dependency graph
 * (`@satsuma/viz-backend` is deliberately Node-independent and cannot depend on
 * the CLI; the CLI must not carry test-only devDependencies that exist only to
 * make it importable by something it doesn't otherwise need to know about).
 * `@satsuma/viz-backend` assembles the model the webview receives,
 * `coverageForWorkspace` (via `satsuma-cli`'s `./testing` export) produces what
 * the command prints, and both are compared per mapping, schema and role —
 * counts, denominators and percentages alike.
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
import { loadWorkspace, coverageForWorkspace, resolveAllNLRefs } from "satsuma-cli/testing";

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

/** What the viz side reports for one file: figures, plus what it could not report. */
interface VizFigures {
  /** Per {@link figureKey}, the figures the card would show. */
  figures: Map<string, Figures>;
  /**
   * Mapping ids whose `MappingBlock.coverage` is absent.
   *
   * Reported rather than skipped: absent coverage is a legitimate state for a
   * mapping the CLI also cannot report on (an anonymous block, which `coverage`
   * skips by design), and a defect for any mapping it can. The assertion below
   * draws that line — the sweep is otherwise blind to a whole class of
   * regression, since a mapping with no coverage produces no keys to compare.
   */
  uncomputed: string[];
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
function vizFigures(entryPath: string, corpus: string[]): VizFigures {
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
  if (!entryTree) return { figures: new Map(), uncomputed: [] };
  const scoped = createScopedIndex(index, getImportReachableUris(entryUri, index));
  const model = buildVizModel(entryUri, entryTree, scoped);

  const figures = new Map<string, Figures>();
  const uncomputed: string[] = [];
  for (const ns of model.namespaces) {
    for (const mapping of ns.mappings) {
      const mappingId = ns.name ? `${ns.name}::${mapping.id}` : mapping.id;
      // Tracked separately, because a mapping with no coverage contributes no
      // keys and would be *invisible* to a comparison that only walks entries.
      // That blind spot is why an anonymous mapping silently losing its coverage
      // survived a corpus-wide sweep.
      if (!mapping.coverage) {
        uncomputed.push(mappingId);
        continue;
      }
      for (const schema of mapping.coverage.schemas) {
        const { covered, total, pct } = summarizeFieldCoverage(schema.fields);
        figures.set(figureKey(mappingId, schema.schemaId, schema.role), { covered, total, pct });
      }
    }
  }
  return { figures, uncomputed };
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
      const { figures: viz, uncomputed } = vizFigures(file, corpus);
      const relative = file.slice(EXAMPLES.length + 1);

      // A mapping the CLI reports on must have coverage on the viz side. The
      // converse is fine: `coverage` skips anonymous mappings by design, so one
      // the CLI never mentions may legitimately be absent here.
      const cliMappings = new Set([...cli.keys()].map((k) => k.split("|")[0]));
      for (const mappingId of uncomputed) {
        if (cliMappings.has(mappingId)) {
          disagreements.push(
            `${relative} ${mappingId}: no coverage attached, but the CLI reports on it`,
          );
        }
      }

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
