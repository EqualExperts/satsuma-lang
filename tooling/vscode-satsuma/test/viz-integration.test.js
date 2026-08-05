const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  vizThemeForKind,
  loadFullLineageModel,
  loadExpandedModels,
  buildFieldLineagePath,
  loadFieldChain,
} = require("../dist/client/webview/viz/integration.js");

const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
};

describe("vizThemeForKind", () => {
  it("maps Light and HighContrastLight to the light renderer theme", () => {
    // Both light-family kinds must resolve to the warm cream/orange light
    // palette. HighContrastLight is the case that used to fall through to light
    // only because the old boolean check didn't match it — the mapping is now
    // intentional and documented.
    assert.equal(vizThemeForKind(ColorThemeKind.Light), "light");
    assert.equal(vizThemeForKind(ColorThemeKind.HighContrastLight), "light");
  });

  it("maps Dark and HighContrast to the dark renderer theme", () => {
    // Both dark-family kinds fold into the dark palette until a dedicated
    // high-contrast palette exists (feature non-goal).
    assert.equal(vizThemeForKind(ColorThemeKind.Dark), "dark");
    assert.equal(vizThemeForKind(ColorThemeKind.HighContrast), "dark");
  });

  it("defaults unknown kinds to dark", () => {
    // A future or unrecognized ColorThemeKind must not crash the webview; it
    // falls back to dark, matching the historical default.
    assert.equal(vizThemeForKind(99), "dark");
  });
});

describe("loadFullLineageModel", () => {
  it("wraps the LSP full-lineage request result for the webview", async () => {
    const calls = [];
    const client = {
      async sendRequest(method, params) {
        calls.push({ method, params });
        return { uri: params.uri, namespaces: [] };
      },
    };

    const envelope = await loadFullLineageModel(
      client,
      "file:///platform.stm",
      ColorThemeKind.Dark,
    );

    assert.deepEqual(calls, [
      {
        method: "satsuma/vizFullLineage",
        params: { uri: "file:///platform.stm" },
      },
    ]);
    assert.deepEqual(envelope, {
      payload: { uri: "file:///platform.stm", namespaces: [] },
      theme: "dark",
    });
  });

  it("returns null when the LSP has no VizModel for the file", async () => {
    const client = {
      async sendRequest() {
        return null;
      },
    };

    const envelope = await loadFullLineageModel(
      client,
      "file:///missing.stm",
      ColorThemeKind.Light,
    );

    assert.equal(envelope, null);
  });
});

describe("loadExpandedModels", () => {
  it("loads linked file models through the shared LSP viz requests", async () => {
    const calls = [];
    const client = {
      async sendRequest(method, params) {
        calls.push({ method, params });
        if (method === "satsuma/vizLinkedFiles") {
          return ["file:///crm.stm", "file:///warehouse.stm"];
        }
        if (method === "satsuma/vizModel" && params.uri === "file:///crm.stm") {
          return { uri: "file:///crm.stm" };
        }
        if (method === "satsuma/vizModel" && params.uri === "file:///warehouse.stm") {
          return null;
        }
        throw new Error(`Unexpected request: ${method}`);
      },
    };

    const envelope = await loadExpandedModels(
      client,
      "customers",
      "file:///platform.stm",
      ColorThemeKind.Light,
    );

    assert.deepEqual(calls, [
      {
        method: "satsuma/vizLinkedFiles",
        params: { schemaId: "customers", currentUri: "file:///platform.stm" },
      },
      {
        method: "satsuma/vizModel",
        params: { uri: "file:///crm.stm" },
      },
      {
        method: "satsuma/vizModel",
        params: { uri: "file:///warehouse.stm" },
      },
    ]);
    assert.deepEqual(envelope, {
      schemaId: "customers",
      models: [{ uri: "file:///crm.stm" }],
      theme: "light",
    });
  });

  it("returns an empty expansion payload when no linked files exist", async () => {
    const client = {
      async sendRequest(method) {
        assert.equal(method, "satsuma/vizLinkedFiles");
        return [];
      },
    };

    const envelope = await loadExpandedModels(
      client,
      "customers",
      "file:///platform.stm",
      ColorThemeKind.Dark,
    );

    assert.deepEqual(envelope, {
      schemaId: "customers",
      models: [],
      theme: "dark",
    });
  });
});

describe("loadFieldChain", () => {
  it("requests the LSP field-chain traversal for the entry uri and field path", async () => {
    const calls = [];
    const client = {
      async sendRequest(method, params) {
        calls.push({ method, params });
        return { field: "::b.id", maxDepth: 10, upstream: [], downstream: [] };
      },
    };

    const model = await loadFieldChain(client, "file:///platform.stm", "b.id");

    assert.deepEqual(calls, [
      {
        method: "satsuma/fieldChain",
        params: { uri: "file:///platform.stm", fieldPath: "b.id", depth: undefined },
      },
    ]);
    assert.deepEqual(model, { field: "::b.id", maxDepth: 10, upstream: [], downstream: [] });
  });

  it("forwards an explicit depth override to the request", async () => {
    // The chain view's depth-limit affordance needs the server to echo the
    // caller's own limit (see field-chain.test.js in the LSP package), so the
    // host boundary must not silently drop it.
    const calls = [];
    const client = {
      async sendRequest(_method, params) {
        calls.push(params);
        return { field: "::b.id", maxDepth: 2, upstream: [], downstream: [] };
      },
    };

    await loadFieldChain(client, "file:///platform.stm", "b.id", 2);

    assert.deepEqual(calls, [{ uri: "file:///platform.stm", fieldPath: "b.id", depth: 2 }]);
  });
});

describe("buildFieldLineagePath", () => {
  it("preserves namespace and nesting in the path emitted by a viz field-lineage action", () => {
    // The VS Code panel passes this value directly to `satsuma field-lineage`.
    // Dropping either part would make a valid nested field resolve to a phantom
    // global schema or a same-named leaf elsewhere in the workspace.
    assert.equal(
      buildFieldLineagePath("science::colony_observations", "observations.rings.identifier"),
      "science::colony_observations.observations.rings.identifier",
    );
  });
});
