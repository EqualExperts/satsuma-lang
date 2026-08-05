---
name: viz-dev
description: >
  Build the satsuma-viz-harness dev server and its dependencies, then start it
  locally so the user can open the current viz UI in a browser. Use whenever
  the user asks to "run the viz", "see the current UI", "preview the viz
  component", "start the viz dev server", or similar — this is for a live,
  interactive look at the component, not the Playwright test harness (that
  workflow is documented separately in AGENTS.md).
---

# Run the viz dev server

Builds `@satsuma/viz-harness` and its dependencies (`@satsuma/core`,
`@satsuma/viz-model`, `@satsuma/viz-backend`, `@satsuma/viz`, the tree-sitter
grammar WASM) via Turborepo, then starts the harness's own Node HTTP server so
the user can open the production `<satsuma-viz>` component — with the fixture
picker over the `examples/**` corpus — in a real browser.

This is distinct from the Playwright sentinel workflow in AGENTS.md
("Viz harness Playwright tests"): that workflow drives an automated headless
browser for regression tests. This command starts a plain dev server for a
human to look at in their own browser — no Playwright, no sentinel file.

## Steps

1. **Set turbo's sandbox env vars** (harmless if already set, required in the
   agent sandbox — see AGENTS.md "Running Turborepo in the agent sandbox"):

   ```bash
   export TURBO_CONFIG_DIR_PATH="$SCRATCHPAD/turbo-config"
   export VERCEL_CONFIG_DIR_PATH="$SCRATCHPAD/vercel-config"
   ```

2. **Free port 3333** if a stale server is already listening on it:

   ```bash
   kill "$(lsof -ti:3333)" 2>/dev/null || true
   ```

3. **Build the harness and every dependency it needs**, in dependency order:

   ```bash
   npx turbo run build --filter=@satsuma/viz-harness
   ```

4. **Start the server in the background** (it must keep running for the user
   to browse it — do not run it in the foreground):

   ```bash
   node tooling/satsuma-viz-harness/dist/server.js > "$SCRATCHPAD/viz-dev-server.log" 2>&1 &
   disown
   ```

5. **Confirm it came up**, then hand the URL to the user:

   ```bash
   sleep 1
   curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3333/
   ```

   If the curl fails, read `$SCRATCHPAD/viz-dev-server.log` for the error
   (most likely a stale build — re-run step 3) rather than guessing.

6. Tell the user to open **http://localhost:3333** in their browser. Do not
   try to open a browser yourself — the agent sandbox cannot launch one; the
   user opens the URL manually.

## Notes

- The server only serves static assets and a small fixtures API — all model
  building happens client-side in the browser (feature 33; see the harness
  README's "The playground" section). There is nothing further to configure.
- If the user edits `satsuma-viz`, `viz-backend`, `viz-model`, or `core`
  source while the server is running, re-run this command (steps 3–5) to
  rebuild and restart — the server does not hot-reload.
- To stop the server later: `kill "$(lsof -ti:3333)"`.
