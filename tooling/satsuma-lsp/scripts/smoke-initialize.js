#!/usr/bin/env node
/**
 * smoke-initialize.js — drive a real LSP initialize round-trip over stdio.
 *
 * Spawns the server command given on the command line (defaulting to this
 * package's bin entry), sends an `initialize` request framed per the LSP
 * base protocol, and asserts the response carries server capabilities. This
 * is the end-to-end check that a fresh install can actually start: the server
 * loads its WASM assets inside onInitialize, so a broken package (sl-vwpr)
 * passes `npm install` but fails exactly here.
 *
 * Usage:
 *   node scripts/smoke-initialize.js [command [args...]]
 *   node scripts/smoke-initialize.js "$(command -v satsuma-lsp)" --stdio
 *
 * Exits 0 on success, 1 on failure or after a 30s timeout.
 */

const { spawn } = require("child_process");
const path = require("path");

// Allow generous startup time on slow CI runners; WASM compile dominates.
const TIMEOUT_MS = 30_000;

const [command, ...commandArgs] =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [process.execPath, path.join(__dirname, "..", "bin", "satsuma-lsp.js"), "--stdio"];

const server = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "inherit"] });

const fail = (message) => {
  console.error(`smoke-initialize: FAIL — ${message}`);
  server.kill();
  process.exit(1);
};

const timer = setTimeout(
  () => fail(`no initialize response within ${TIMEOUT_MS / 1000}s`),
  TIMEOUT_MS,
);

server.on("error", (err) => fail(`could not spawn ${command}: ${err.message}`));
server.on("exit", (code) => fail(`server exited prematurely (code ${code})`));

// --- Send the initialize request (LSP base-protocol framing) ----------------

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { processId: process.pid, rootUri: null, capabilities: {} },
});
server.stdin.write(`Content-Length: ${Buffer.byteLength(initialize)}\r\n\r\n${initialize}`);

// --- Read framed messages until the id:1 response arrives -------------------

let buffer = Buffer.alloc(0);

server.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  // Drain every complete Content-Length-framed message currently buffered.
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const lengthMatch = header.match(/Content-Length: (\d+)/i);
    if (!lengthMatch) return fail(`malformed header: ${JSON.stringify(header)}`);

    const bodyStart = headerEnd + 4;
    const bodyLength = Number(lengthMatch[1]);
    if (buffer.length < bodyStart + bodyLength) return; // body not yet complete

    const body = buffer.subarray(bodyStart, bodyStart + bodyLength).toString("utf8");
    buffer = buffer.subarray(bodyStart + bodyLength);

    const message = JSON.parse(body);
    if (message.id !== 1) continue; // server-initiated notification — skip

    if (message.error) return fail(`initialize error: ${JSON.stringify(message.error)}`);
    if (!message.result?.capabilities) {
      return fail(`response has no capabilities: ${body}`);
    }

    clearTimeout(timer);
    server.removeAllListeners("exit");
    console.log("smoke-initialize: OK — server initialized with capabilities");
    server.kill();
    process.exit(0);
  }
});
