/**
 * harness-ports.cjs — which ports the harness's two local servers listen on.
 *
 * The fixture server (src/server.ts) and the static playground server
 * (scripts/serve-playground.mjs) used to hardcode 3333 and 3334. Every
 * Playwright run therefore claimed the same two ports, so two runs on one
 * machine — two worktrees, or two agents committing at once — failed with
 * "port already in use" rather than running side by side.
 *
 * Each server now reads its port from an environment variable and falls back
 * to the familiar default, so `npm run dev` still serves on 3333. The
 * Playwright config sets both variables to free ports before it starts the
 * servers (see findFreePortsSync).
 *
 * CommonJS so all three consumers can load it as-is: esbuild bundles it into
 * dist/server.js, the ESM playground script imports it, and Playwright loads
 * it from its TypeScript config.
 */

const { execFileSync } = require("node:child_process");
const process = require("node:process");

/** Environment variable naming the fixture server's port. */
const HARNESS_PORT_ENV = "SATSUMA_HARNESS_PORT";

/** Environment variable naming the static playground server's port. */
const PLAYGROUND_PORT_ENV = "SATSUMA_PLAYGROUND_PORT";

/** Fixture server port when none is configured — the URL the docs and /viz-dev give. */
const DEFAULT_HARNESS_PORT = 3333;

/** Playground server port when none is configured; distinct from the fixture server's. */
const DEFAULT_PLAYGROUND_PORT = 3334;

/** Highest valid TCP port number. */
const MAX_PORT = 65535;

/**
 * The port named by environment variable `name`, or `fallback` when it is
 * unset or empty. Throws on anything that is not a whole number from 1 to
 * 65535, so a typo fails loudly instead of binding somewhere unexpected.
 *
 * @param {string} name
 * @param {number} fallback
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
function portFromEnv(name, fallback, env = process.env) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`${name} must be a port number from 1 to ${MAX_PORT}, got "${raw}"`);
  }
  return port;
}

/**
 * Script run in a child process to find free ports: it binds `count` servers
 * to port 0 at once (so the OS hands out distinct ports), prints them, and
 * releases them.
 */
const FIND_FREE_PORTS_SCRIPT = `
const net = require("node:net");
const count = Number(process.argv[1]);
const servers = Array.from({ length: count }, () => net.createServer());
Promise.all(servers.map((s) => new Promise((ok) => s.listen(0, "127.0.0.1", ok)))).then(() => {
  process.stdout.write(servers.map((s) => s.address().port).join(" "));
  servers.forEach((s) => s.close());
});
`;

/**
 * `count` distinct loopback ports that were free a moment ago.
 *
 * Synchronous because the Playwright config is evaluated synchronously, and
 * the ports must be known before it declares its web servers. Another process
 * could take a port between this call and the server binding it; the window
 * is milliseconds, and the run then fails as loudly as before rather than
 * silently testing the wrong server.
 *
 * @param {number} count
 * @returns {number[]}
 */
function findFreePortsSync(count) {
  const output = execFileSync(process.execPath, ["-e", FIND_FREE_PORTS_SCRIPT, String(count)], {
    encoding: "utf8",
  });
  return output.trim().split(" ").map(Number);
}

module.exports = {
  HARNESS_PORT_ENV,
  PLAYGROUND_PORT_ENV,
  DEFAULT_HARNESS_PORT,
  DEFAULT_PLAYGROUND_PORT,
  portFromEnv,
  findFreePortsSync,
};
