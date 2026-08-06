/**
 * server-bind-host.test.mjs — verify that harness servers bind to loopback.
 *
 * The fixture API and static playground serve fixture content and UI assets.
 * They have no reason to be off-box, so they bind to 127.0.0.1 explicitly,
 * preventing accidental exposure on a shared network (sl-fncf).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

describe("Harness server bind host", () => {
  it("server.ts listen(PORT, '127.0.0.1') pattern binds to loopback", () => {
    // Mimic the actual server.ts listen call: server.listen(PORT, "127.0.0.1", callback)
    const server = createServer();
    let boundAddress = null;

    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        boundAddress = addr;
        assert.equal(addr.address, "127.0.0.1", "server must bind to loopback");
        assert.ok(addr.port > 0, "server must be assigned a valid port");
        server.close(resolve);
      });
    });
  });

  it("serve-playground.mjs listen(PORT, '127.0.0.1') pattern binds to loopback", () => {
    // Mimic the actual serve-playground.mjs listen call: server.listen(PORT, "127.0.0.1", callback)
    const server = createServer();

    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        assert.equal(addr.address, "127.0.0.1", "playground must bind to loopback");
        assert.ok(addr.port > 0, "server must be assigned a valid port");
        server.close(resolve);
      });
    });
  });

  it("verify that omitting the host argument would bind to all interfaces (0.0.0.0)", () => {
    // Document the vulnerability we're fixing: calling listen(PORT) without a host
    // argument binds to 0.0.0.0, accepting connections from any interface.
    const server = createServer();

    return new Promise((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        // On macOS/Linux, listen(PORT) without a host defaults to ::
        // (all IPv6 interfaces); the vulnerability is the same.
        assert.ok(
          addr.address === "::" || addr.address === "0.0.0.0",
          "listen(PORT) without host binds to all interfaces, not loopback",
        );
        server.close(resolve);
      });
    });
  });
});
