import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(workspaceRoot, "src");
const tokensPath = path.join(srcRoot, "tokens.css");

const COLOR_VALUE_RE = /#(?:[0-9a-fA-F]{3,8})\b|rgba?\(|hsla?\(|linear-gradient\(|drop-shadow\(/;
const COLOR_LITERAL_RE = /#(?:[0-9a-fA-F]{3,8})\b|rgba?\(/g;

function parseTokenBlockTokens(blockText) {
  const tokenMap = new Map();
  const tokenRegex = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  for (const match of blockText.matchAll(tokenRegex)) {
    tokenMap.set(`--${match[1]}`, match[2].trim());
  }
  return tokenMap;
}

function getTokensByBlock() {
  const css = fs.readFileSync(tokensPath, "utf8");
  const lightMatch = css.match(/:host\s*\{([\s\S]*?)\n\}/);
  const darkMatch = css.match(/:host\(\[theme="dark"\]\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(lightMatch, "Expected to find :host token block in tokens.css");
  assert.ok(darkMatch, "Expected to find :host([theme=\"dark\"]) token block in tokens.css");

  return {
    light: parseTokenBlockTokens(lightMatch[1]),
    dark: parseTokenBlockTokens(darkMatch[1]),
  };
}

function listTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function collectCssTemplateBlocks(fileText) {
  const blocks = [];
  const cssBlockRegex = /\bcss`([\s\S]*?)`;/g;
  for (const match of fileText.matchAll(cssBlockRegex)) {
    blocks.push(match[1]);
  }
  return blocks;
}

describe("theme token parity", () => {
  it("defines dark overrides for every light color-bearing token", () => {
    const { light, dark } = getTokensByBlock();

    const requiredDarkTokens = [...light.entries()]
      .filter(([, value]) => COLOR_VALUE_RE.test(value))
      .map(([name]) => name)
      .sort();

    const missing = requiredDarkTokens.filter((tokenName) => !dark.has(tokenName));

    assert.deepEqual(
      missing,
      [],
      `Missing dark token overrides: ${missing.join(", ")}`,
    );
  });
});

describe("satsuma-viz theme property", () => {
  it("defaults to the light theme", async () => {
    // The warm cream/orange :host token defaults ARE the light palette, so the
    // component must default to "light" — a consumer that never sets a theme
    // (e.g. a bare embed) still renders a coherent, fully-styled light viz.
    const mod = await import("../dist/satsuma-viz.js");
    const el = new mod.SatsumaViz();
    assert.equal(el.theme, "light");
  });

  it("reflects theme to the `theme` attribute so :host([theme=\"dark\"]) engages", async () => {
    // Reflection is the ONLY palette-switching mechanism: assigning theme must
    // write the `theme` attribute on the host so the tokens.css
    // `:host([theme="dark"])` override block applies. If reflect were dropped,
    // dark mode would silently keep the light palette.
    const mod = await import("../dist/satsuma-viz.js");
    const options = mod.SatsumaViz.elementProperties.get("theme");
    assert.ok(options, "theme must be a declared reactive property");
    assert.equal(options.reflect, true, "theme must reflect to an attribute");
    // Lit derives the attribute name from the property name (lowercased) unless
    // overridden; the dark selector keys off exactly `theme`, so the derived
    // attribute must not be disabled or renamed.
    assert.notEqual(options.attribute, false);
    assert.ok(
      options.attribute === undefined || options.attribute === "theme",
      `theme must reflect to the "theme" attribute, got ${String(options.attribute)}`,
    );
  });
});

describe("component style color literals", () => {
  it("does not use raw hex/rgba literals in css template blocks outside tokens.css", () => {
    const files = listTsFiles(srcRoot);
    const violations = [];

    for (const filePath of files) {
      if (filePath === tokensPath) continue;
      const source = fs.readFileSync(filePath, "utf8");
      const cssBlocks = collectCssTemplateBlocks(source);

      for (const block of cssBlocks) {
        const literals = [...block.matchAll(COLOR_LITERAL_RE)].map((m) => m[0]);
        if (literals.length === 0) continue;

        const relPath = path.relative(workspaceRoot, filePath);
        violations.push(`${relPath}: ${[...new Set(literals)].join(", ")}`);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Raw color literals found in component styles:\n${violations.join("\n")}`,
    );
  });
});
