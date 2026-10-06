/**
 * stdio-client.js — a minimal JSON-RPC client that drives the built language
 * server (dist/server.js) over stdio, the way an editor does.
 *
 * Most LSP tests call a provider function directly. That proves what a
 * function returns, not what the server sends: which documents it republishes
 * after an edit is decided by the lifecycle handlers in server.ts, and only a
 * running server shows it (bsw-r1wl). This client exists for those tests.
 *
 * It owns framing (Content-Length headers), request/response pairing and a
 * per-URI log of `textDocument/publishDiagnostics` notifications. It does not
 * own any assertion; tests wait on the log with `waitForDiagnostics`.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

/** The server entry point both `build` and `compile` emit. */
const SERVER_PATH = path.resolve(__dirname, "../../dist/server.js");

/** Header that separates a message's Content-Length line from its body. */
const HEADER_END = "\r\n\r\n";

/**
 * How long a test waits for an expected publish before failing. Generous
 * against the server's own refresh delay (DEPENDENT_REFRESH_DELAY_MS) so a
 * slow CI machine does not flake.
 */
const DEFAULT_WAIT_MS = 5000;

/**
 * Start the server with `rootPath` as its only workspace folder and complete
 * the initialize handshake. Resolves to a client; call `stop()` when done.
 */
async function startServer(rootPath) {
  const child = spawn(process.execPath, [SERVER_PATH, "--stdio"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const client = new StdioClient(child);
  const rootUri = require("node:url").pathToFileURL(rootPath).toString();
  await client.request("initialize", {
    processId: process.pid,
    rootUri,
    capabilities: {},
    workspaceFolders: [{ uri: rootUri, name: "test" }],
  });
  client.notify("initialized", {});
  return client;
}

class StdioClient {
  constructor(child) {
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.nextId = 0;
    this.pending = new Map();
    /** Every publishDiagnostics received, per URI, oldest first. */
    this.published = new Map();
    /** Callbacks re-checked whenever a publish arrives. */
    this.waiters = new Set();
    child.stdout.on("data", (chunk) => this.receive(chunk));
  }

  /** Send a request and resolve with its result. */
  request(method, params) {
    const id = ++this.nextId;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ id, method, params });
    });
  }

  /** Send a notification (no response expected). */
  notify(method, params) {
    this.send({ method, params });
  }

  /** Open a document with full text, as an editor does when a tab opens. */
  open(uri, text) {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "satsuma", version: 1, text },
    });
  }

  /** Replace a document's whole text, as full-sync didChange does. */
  change(uri, version, text) {
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  /** How many diagnostics publishes `uri` has received so far. */
  publishCount(uri) {
    return (this.published.get(uri) ?? []).length;
  }

  /**
   * Resolve with the first publish for `uri`, after the first `after` ones,
   * whose diagnostics satisfy `predicate`. Rejects after `timeoutMs`, naming
   * the last diagnostics seen so a failure says what the server sent instead.
   */
  waitForDiagnostics(uri, after, predicate, timeoutMs = DEFAULT_WAIT_MS) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const list = this.published.get(uri) ?? [];
        const match = list.slice(after).find(predicate);
        if (!match) return false;
        this.waiters.delete(check);
        clearTimeout(timer);
        resolve(match);
        return true;
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        const last = (this.published.get(uri) ?? []).at(-1);
        reject(
          new Error(
            `no matching publish for ${uri} within ${timeoutMs}ms; ` +
              `last: ${JSON.stringify(last?.map((d) => d.code) ?? null)}`,
          ),
        );
      }, timeoutMs);
      if (!check()) this.waiters.add(check);
    });
  }

  /** Shut the server down and wait for the process to exit. */
  async stop() {
    await this.request("shutdown", null);
    this.notify("exit", null);
    await new Promise((resolve) => {
      if (this.child.exitCode !== null) resolve();
      else this.child.once("exit", resolve);
    });
  }

  send(message) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}${HEADER_END}${body}`);
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END);
      if (headerEnd < 0) return;
      const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, headerEnd))[1]);
      const bodyStart = headerEnd + HEADER_END.length;
      if (this.buffer.length < bodyStart + length) return;
      const message = JSON.parse(this.buffer.subarray(bodyStart, bodyStart + length).toString());
      this.buffer = this.buffer.subarray(bodyStart + length);
      this.dispatch(message);
    }
  }

  dispatch(message) {
    if (message.id !== undefined && this.pending.has(message.id)) {
      this.pending.get(message.id)(message.result);
      this.pending.delete(message.id);
    } else if (message.method === "textDocument/publishDiagnostics") {
      const { uri, diagnostics } = message.params;
      if (!this.published.has(uri)) this.published.set(uri, []);
      this.published.get(uri).push(diagnostics);
      for (const check of [...this.waiters]) check();
    } else if (message.id !== undefined && message.method) {
      // A server-to-client request (e.g. client/registerCapability): accept it.
      this.send({ id: message.id, result: null });
    }
  }
}

module.exports = { startServer };
