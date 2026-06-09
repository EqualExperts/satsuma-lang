const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  vizThemeForKind,
  loadFullLineageModel,
  loadExpandedModels,
  buildFieldLineagePath,
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

describe("buildFieldLineagePath", () => {
  it("builds the schema.field path emitted from a viz field-lineage action", () => {
    assert.equal(buildFieldLineagePath("customers", "email"), "customers.email");
  });
});
