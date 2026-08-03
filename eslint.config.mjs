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
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
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
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["tooling/tree-sitter-satsuma/grammar.js"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // TypeScript test files and the viz harness package (satsuma-cli tests, viz-harness
  // source + tests) — baseline TypeScript rules without type-info (no tsconfig needed).
  // Other TS packages (core, lsp, viz-backend, viz, vscode-satsuma) are linted
  // incrementally as they are migrated to include test files in their tsconfigs
  // (PRD 39 R7).
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["tooling/satsuma-cli/test/**/*.ts", "tooling/satsuma-viz-harness/**/*.ts"],
  })),
  {
    files: ["tooling/satsuma-cli/test/**/*.ts", "tooling/satsuma-viz-harness/**/*.ts"],
    rules: {
      // Align with the JS convention used throughout the repo
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  // satsuma-viz-model source files: first package landed under the PRD 39 R7
  // rollout. The package has no CST dependency, so it needs no CST-narrowing
  // rules (no-unnecessary-condition, switch-exhaustiveness-check — those apply
  // only to packages migrated to the generated CST type in R2). Its one test
  // file is plain JS, so unlike satsuma-cli this block needs no test-file
  // carve-out.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["tooling/satsuma-viz-model/src/**/*.ts"],
  })),
  {
    files: ["tooling/satsuma-viz-model/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  // satsuma-core source files (PRD 39 R7): the package R2 migrated to the
  // generated CST type (tcc-e35f), so on top of the base type-aware preset it
  // also gets no-unnecessary-condition and switch-exhaustiveness-check. The
  // switch rule is scoped to domain discriminated unions (e.g. MetaEntry) —
  // requiring every switch over the ~100-value SatsumaGrammarSymbol/CstType
  // union to be exhaustive would fight the many intentionally partial CST
  // walkers, so those switches keep a default/fallthrough branch rather than
  // enumerating every symbol.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["tooling/satsuma-core/src/**/*.ts"],
  })),
  {
    files: ["tooling/satsuma-core/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          // A switch over the CST symbol union is allowed to stay partial —
          // completeness there is a semantic, construct-specific property
          // (PRD 39, "Out of Scope"), not something the linter should force.
          considerDefaultExhaustiveForUnions: true,
        },
      ],
    },
  },
  // satsuma-lsp source files (PRD 39 R7): the package R2 migrated to the
  // generated CST type (tcc-yb3z), so it gets the same CST-narrowing rules as
  // satsuma-core — see that block's comment for the switch-exhaustiveness
  // rationale.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["tooling/satsuma-lsp/src/**/*.ts"],
  })),
  {
    files: ["tooling/satsuma-lsp/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
];
