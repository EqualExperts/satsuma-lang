/**
 * field-lookup.test.ts — field-scoped commands find spread-supplied fields.
 *
 * bsw-ep0m: `arrows`, `field-lineage`, `nl` and `meta` each built their own
 * field tree and saw through a spread only at schema level (or, for `nl`, not
 * at all), so a field a fragment put inside a record was "not found" though
 * `fields` listed it and `validate` accepted arrows to it. They now share
 * `findDeclaredFields`; these cases drive each command through the CLI, one
 * spread shape apiece, against `fixtures/spread-field-lookup.stm`.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run as _run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const FIXTURE = resolve(__dirname, "fixtures/spread-field-lookup.stm");

const run = (...args: string[]) => _run(CLI, ...args, FIXTURE);

describe("field-scoped commands see through fragment spreads (bsw-ep0m)", () => {
  it("arrows finds a field a fragment supplies inside a record, through a second fragment", async () => {
    // `orders` spreads `line`, which spreads `audit`: two hops, both inside a
    // record. The arrow written against it must be reported.
    const { stdout, code } = await run("arrows", "src.orders.created_by");
    assert.equal(code, 0);
    assert.match(stdout, /orders\.created_by -> rows\.a/);
  });

  it("arrows finds a field inside a record that a fragment itself supplies", async () => {
    // `ship` spreads `shipping`, whose own `addr` record spreads `geo`. The
    // copied `addr` must be expanded too, or `city` is invisible.
    const { stdout, code } = await run("arrows", "src.ship.addr.city");
    assert.equal(code, 0);
    assert.match(stdout, /ship\.addr\.city -> city/);
  });

  it("arrows finds a field a fragment's record spreads from a fragment spread beside it", async () => {
    // `src` spreads `audit` and `envelope`, and `envelope`'s `inner` record
    // spreads `audit` again. That is not a cycle, but the guard once counted
    // every sibling spread as enclosing and dropped `inner`'s `...audit`.
    const { stdout, code } = await run("arrows", "src.inner.created_by");
    assert.equal(code, 0);
    assert.match(stdout, /inner\.created_by -> inner_who/);
  });

  it("field-lineage traces a field a fragment supplies inside a record", async () => {
    const { stdout, code } = await run("field-lineage", "src.orders.qty");
    assert.equal(code, 0);
    assert.match(stdout, /::tgt\.rows\.c/);
  });

  it("nl reports the note on a schema-level spread field, read from the fragment", async () => {
    // `nl` ignored spreads entirely, even at the top level, and read notes
    // only from the schema's own body, where this field is not written.
    const { stdout, code } = await run("nl", "src.created_by");
    assert.equal(code, 0);
    assert.match(stdout, /who created it/);
  });

  it("nl reports the note of a field two fragments deep inside nested records", async () => {
    const { stdout, code } = await run("nl", "src.ship.addr.city");
    assert.equal(code, 0);
    assert.match(stdout, /delivery city/);
  });

  it("nl reports the notes of every field a bare name reaches, not just the top-level one", async () => {
    // `nl schema.name` has always meant every field of that name at any depth.
    // An exact top-level match must not hide a nested namesake's note.
    const { stdout, code } = await run("nl", "namesakes.city");
    assert.equal(code, 0);
    assert.match(stdout, /top city/);
    assert.match(stdout, /addr city/);
  });

  it("meta reads type and note from the fragment that writes a nested field", async () => {
    // The note lives in `line`'s body, at that fragment's top level, though the
    // field sits one record deep in `src`.
    const { stdout, code } = await run("meta", "src.orders.qty");
    assert.equal(code, 0);
    assert.match(stdout, /type: INT/);
    assert.match(stdout, /note: units ordered/);
  });

  it("meta rejects a dotted path whose record does not exist instead of matching the leaf elsewhere", async () => {
    // The old lookup fell back to any field named like the last segment, so
    // `src.zzz.created_by` reported `created_by`'s metadata.
    const { stderr, code } = await run("meta", "src.zzz.created_by");
    assert.equal(code, 1);
    assert.match(stderr, /Field 'zzz\.created_by' not found/);
  });

  it("still reports a field missing from an expanded record as not found", async () => {
    // Expansion widens what exists; it must not make every name exist.
    const { stderr, code } = await run("arrows", "src.orders.nonexistent");
    assert.equal(code, 1);
    assert.match(stderr, /Field 'orders\.nonexistent' not found/);
  });
});
