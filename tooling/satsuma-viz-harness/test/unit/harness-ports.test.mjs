/**
 * harness-ports.test.mjs — the port contract the harness servers and the
 * Playwright config share (scripts/harness-ports.cjs).
 *
 * Fixed ports made two Playwright runs on one machine collide; these cases
 * pin the two halves of the fix: an explicit port is honoured exactly, and
 * the free-port finder hands out ports that can actually be bound.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import harnessPorts from "../../scripts/harness-ports.cjs";

const { portFromEnv, findFreePortsSync } = harnessPorts;

describe("portFromEnv", () => {
  it("uses the fallback when the variable is unset or empty, so `npm run dev` keeps its URL", () => {
    assert.equal(portFromEnv("PORT_X", 3333, {}), 3333);
    assert.equal(portFromEnv("PORT_X", 3333, { PORT_X: "" }), 3333);
  });

  it("honours a port set in the environment over the fallback", () => {
    assert.equal(portFromEnv("PORT_X", 3333, { PORT_X: "41234" }), 41234);
  });

  it("rejects a value that is not a valid port instead of binding somewhere unexpected", () => {
    for (const bad of ["abc", "0", "70000", "33.5", "-1"]) {
      assert.throws(() => portFromEnv("PORT_X", 3333, { PORT_X: bad }), /PORT_X must be a port/);
    }
  });
});

describe("findFreePortsSync", () => {
  it("returns distinct ports that a server can then bind on loopback", async () => {
    // Distinctness matters because the harness and playground servers each
    // need their own; bindability is the property the whole change exists for.
    const ports = findFreePortsSync(2);
    assert.equal(ports.length, 2);
    assert.notEqual(ports[0], ports[1]);
    for (const port of ports) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      assert.equal(server.address().port, port);
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
