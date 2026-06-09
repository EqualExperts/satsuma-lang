import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const treeSitterDslGlobals = {
  grammar: "readonly",
  seq: "readonly",
  choice: "readonly",
  repeat: "readonly",
  optional: "readonly",
  token: "readonly",
  prec: "readonly",
  alias: "readonly",
  field: "readonly",
  repeat1: "readonly",
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.worktrees/**",
      "**/.claude/**",
      "**/.tickets/**",
      "**/src/grammar.json",
      "**/bindings/**",
      "**/build/**",
      "**/dist/**",
      "**/*.min.js",
      "site/js/tailwind.js",
      "site/_site/**",
      "site/playground/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["tooling/tree-sitter-satsuma/grammar.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: treeSitterDslGlobals,
    },
  },
  {
    // .js and .mjs Node scripts (e.g. the harness build scripts). .mjs is used
    // for ESM build scripts inside CommonJS packages, so it shares this config.
    files: ["**/*.js", "**/*.mjs"],
    ignores: ["tooling/tree-sitter-satsuma/grammar.js", "site/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
  {
    files: ["site/.eleventy.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["site/**/*.js"],
    ignores: ["site/.eleventy.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
  {
    files: ["tooling/tree-sitter-satsuma/grammar.js"],
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
  // TypeScript test files and the viz harness package (satsuma-cli tests, viz-harness
  // source + tests) — baseline TypeScript rules without type-info (no tsconfig needed).
  // Other TS packages (core, lsp, viz, vscode-satsuma) are linted incrementally as
  // they are migrated to include test files in their tsconfigs.
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: [
      "tooling/satsuma-cli/test/**/*.ts",
      "tooling/satsuma-viz-harness/**/*.ts",
    ],
  })),
  {
    files: [
      "tooling/satsuma-cli/test/**/*.ts",
      "tooling/satsuma-viz-harness/**/*.ts",
    ],
    rules: {
      // Align with the JS convention used throughout the repo
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      // Non-null assertions require targeted inline suppression with a safety justification
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  // Test files — relax rules that are impractical to enforce in test code:
  //   - no-explicit-any: test assertions commonly cast parsed output shapes to any
  //     rather than defining full types for every intermediate result
  //   - no-non-null-assertion: array accesses after expect(arr.length).toBe(N) are safe
  //     but non-null assertions are the idiomatic way to narrow type in test code
  {
    files: ["tooling/satsuma-cli/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  // satsuma-cli source files additionally get type-aware linting because the package
  // has a tsconfig with strict settings that supports projectService inference.
  // Test files are intentionally excluded here — they use import.meta.dirname (Node 22+)
  // which requires module: "node22" or higher, while the current tsconfig targets node16.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["tooling/satsuma-cli/src/**/*.ts"],
  })),
  {
    files: ["tooling/satsuma-cli/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
];
