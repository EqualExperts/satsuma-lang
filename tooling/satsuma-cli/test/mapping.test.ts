/**
 * mapping.test.ts — behaviour of `satsuma mapping` across its output modes.
 *
 * Every case runs the built CLI against a minimal Satsuma snippet, so the
 * assertions cover the real CST walk rather than a copy of it. Broader
 * smoke-level coverage against the example corpus lives in
 * integration.test.ts; this file pins the arrow shapes that are easy to get
 * wrong: multi-source arrows (bsw-fbd8) and list blocks nested inside list
 * blocks (bsw-an3y).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { run as runCli } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const EXAMPLES = resolve(__dirname, "../../../examples");

const run = (...args: string[]) => runCli(CLI, ...args);

/** Temporary directory holding this file's snippet fixtures; removed after the run. */
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "mapping-cmd-"));
after(() => rmSync(FIXTURE_DIR, { recursive: true, force: true }));

/** Write a snippet to its own file and return the path. */
function fixture(name: string, source: string): string {
  const file = join(FIXTURE_DIR, `${name}.stm`);
  writeFileSync(file, `${source}\n`);
  return file;
}

// ── Multi-source arrows (bsw-fbd8) ───────────────────────────────────────────

const MULTI_SOURCE = fixture(
  "multi-source",
  `schema s { a INT  b INT  d INT }
schema t { c INT  e INT  f INT }
mapping m {
  source { s }
  target { t }
  a, b -> c { "sum" }
  d -> e
  -> f { "constant" }
}`,
);

describe("satsuma mapping: multi-source arrows (bsw-fbd8)", () => {
  it("text output lists every source of a multi-source arrow", async () => {
    // The text view is a reconstruction of the mapping; dropping `b` makes it
    // claim that `c` depends on `a` alone.
    const { stdout, code } = await run("mapping", "m", MULTI_SOURCE);
    assert.equal(code, 0);
    assert.match(stdout, /^ {2}a, b -> c \{ "sum" \}$/m);
  });

  it("--arrows-only lists every source of a multi-source arrow", async () => {
    // The arrow table is the quickest way to see what feeds a target, so a
    // missing input there is a silent lineage gap.
    const { stdout, code } = await run("mapping", "m", "--arrows-only", MULTI_SOURCE);
    assert.equal(code, 0);
    assert.match(stdout, /^a, b\s+-> c$/m);
  });

  it("--json lists every source in srcs and keeps src as the first source", async () => {
    // The explainer, dbt and OpenLineage skills read this JSON; `srcs` gives
    // them every input while `src` keeps its old meaning for existing readers.
    const { stdout, code } = await run("mapping", "m", "--json", MULTI_SOURCE);
    assert.equal(code, 0);
    const [multi, single, computed] = JSON.parse(stdout).arrows;
    assert.deepEqual(multi.srcs, ["a", "b"]);
    assert.equal(multi.src, "a");
    assert.deepEqual(single.srcs, ["d"]);
    assert.equal(single.src, "d");
    assert.deepEqual(computed.srcs, []);
    assert.equal(computed.src, null);
  });

  it("shows both sources of the canonical ancestor-escape example", async () => {
    // The corpus example the bug was reported against, inside a flatten block.
    const file = resolve(EXAMPLES, "ancestor-escape/pipeline.stm");
    const { stdout, code } = await run("mapping", "sighting rows with ancestor refs", file);
    assert.equal(code, 0);
    assert.match(stdout, /\.adults, \.chicks -> total_birds/);
  });
});

// ── Nested each/flatten blocks (bsw-an3y) ────────────────────────────────────

const NESTED_LISTS = fixture(
  "nested-lists",
  `schema s {
  orders list_of record {
    id INT
    lines list_of record {
      sku STRING
      parts list_of record { code STRING }
    }
  }
}
schema t {
  out list_of record {
    id INT
    rows list_of record {
      sku STRING
      codes list_of record { code STRING }
    }
  }
}
mapping m {
  source { s }
  target { t }
  each orders -> out {
    .id -> .id
    each lines -> .rows {
      .sku -> .sku { trim }
      flatten parts -> .codes {
        .code -> .code
      }
    }
  }
}`,
);

describe("satsuma mapping: nested each/flatten blocks (bsw-an3y)", () => {
  it("text output prints list blocks nested at any depth, with their arrows", async () => {
    // Before the fix the inner `each` and the `flatten` below it vanished,
    // leaving an outer block that looked as if it mapped only `.id`.
    const { stdout, code } = await run("mapping", "m", NESTED_LISTS);
    assert.equal(code, 0);
    const expected = [
      "  each orders -> out {",
      "    .id -> .id",
      "    each lines -> .rows {",
      "      .sku -> .sku { trim }",
      "      flatten parts -> .codes {",
      "        .code -> .code",
      "      }",
      "    }",
      "  }",
    ].join("\n");
    assert.ok(stdout.includes(expected), `expected nested blocks in:\n${stdout}`);
  });

  it("--compact keeps nested list blocks but drops their transform bodies", async () => {
    // Compact mode trims bodies, not structure.
    const { stdout, code } = await run("mapping", "m", "--compact", NESTED_LISTS);
    assert.equal(code, 0);
    assert.match(stdout, /^ {6}\.sku -> \.sku$/m);
    assert.match(stdout, /^ {6}flatten parts -> \.codes \{$/m);
  });

  it("prints the nested each and flatten blocks of the nested-iteration example", async () => {
    // The corpus example the bug was reported against.
    const file = resolve(EXAMPLES, "nested-iteration/pipeline.stm");
    const { stdout, code } = await run("mapping", "dispatch manifest", file);
    assert.equal(code, 0);
    assert.match(stdout, /^ {4}each lines -> \.lines \{$/m);
    assert.match(stdout, /^ {6}\.quantity -> \.qty$/m);
    assert.match(stdout, /^ {4}flatten parcels\.contents -> \.packed_items \{$/m);
    assert.match(stdout, /^ {6}\.units -> \.units$/m);
  });
});
