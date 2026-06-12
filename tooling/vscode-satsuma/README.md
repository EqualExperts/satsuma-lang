# VS Code Satsuma Extension

Full language support for the Satsuma data mapping language: syntax highlighting, an LSP server with navigation and completions, and interactive workspace visualization.

## Install

### From GitHub Release (recommended)

Download `vscode-satsuma-latest.vsix` from the [latest release](https://github.com/EqualExperts/satsuma-lang/releases/tag/latest), then install it either from the VS Code UI or the command line:

- **VS Code UI:** open the Extensions view, click the `···` (Views and More Actions) menu, choose **Install from VSIX…**, and select the downloaded file. (Or run **Extensions: Install from VSIX…** from the Command Palette.)
- **Command line:**

  ```bash
  code --install-extension vscode-satsuma-latest.vsix
  ```

### From Source

```bash
cd tooling/vscode-satsuma
npm install
cd server && npm install && cd ..
npm run build
npx @vscode/vsce package --no-dependencies -o vscode-satsuma.vsix
code --install-extension vscode-satsuma.vsix
```

### Extension Development Host

1. Open the repo root in VS Code.
2. Press **F5** to launch the Extension Development Host.
3. Open any `.stm` file — the extension activates automatically.

## Prerequisites

- **VS Code** 1.85+
- **Node.js** 20+ (for building from source)
- **`satsuma` CLI** on PATH (for validation diagnostics, commands, and webviews). Install from the [latest release](https://github.com/EqualExperts/satsuma-lang/releases/tag/latest).

## Features

### Syntax Highlighting

TextMate grammar for all Satsuma constructs (keywords, types, metadata, strings, comments, operators). Works immediately with no dependencies.

Semantic tokens from the LSP server override TextMate scopes for context-sensitive constructs (`source`/`target` as keyword vs. field name, `map` as keyword vs. identifier, vocabulary tokens, etc.).

### Import-Scoped Symbol Resolution

The extension respects Satsuma's explicit import semantics. A symbol (schema, fragment, mapping, transform, metric) is **only in scope in a file if it was explicitly imported** into that file (directly or transitively).

All navigation and IntelliSense features are scoped to the **import graph rooted at the active file**:

- Go-to-Definition only resolves symbols reachable from the current file's imports.
- Completions only suggest symbols from reachable files.
- Find References and Rename are scoped to the import-reachable file set.
- The Workspace Graph and Field Lineage views show only the symbols and data flows reachable from the current file.

If you reference a schema that exists in the workspace but has not been imported, the editor emits a `missing-import` error with the exact `import` statement needed to fix it:

```
'orders' is not imported. Add: import { orders } from "./orders.stm"
```

This mirrors how Satsuma the language works: unlike some IDEs that treat all files in a folder as globally visible, Satsuma requires explicit imports and the extension enforces this boundary.

### Diagnostics

- **Parse errors** — red squiggles in real time as you type (tree-sitter ERROR/MISSING nodes).
- **Missing import errors** — red squiggles when a schema/fragment/mapping is referenced but not reachable via `import` from the current file. Includes the exact import statement to add.
- **Semantic warnings** — yellow squiggles on save via `satsuma validate` (undefined schemas, duplicate names, broken imports).
- **Warning comments** (`//!`) — appear as warnings in the Problems panel.
- **Question comments** (`//?`) — appear as information in the Problems panel.

### Navigation

- **Go-to-Definition** (Ctrl+Click / F12) — jump from schema name in `source`/`target` to its definition, fragment spread to fragment block, import name to imported definition, import path to file. Scoped to import-reachable symbols.
- **Find References** (Shift+F12) — find all usages of a schema, fragment, or transform across the import-reachable file set.
- **Rename Symbol** (F2) — rename a schema, fragment, transform, or mapping across all import-reachable files. Refuses duplicate names. Handles namespace-qualified references.

### IntelliSense

- **Completions** — context-aware suggestions scoped to the import-reachable file set:
  - Schema names inside `source { }` / `target { }` (only imported schemas appear)
  - Fragment and transform names after `...`
  - Field names from source/target schemas in arrow paths
  - Metadata vocabulary tokens inside `( )` (pk, pii, scd, required, etc.)
  - Transform functions in pipe chains (trim, lowercase, coalesce, etc.)
  - Block names in `import { }` declarations

### Document Structure

- **Outline Panel** — schemas, mappings, fragments, transforms, metrics, namespaces, and notes with nested fields and children.
- **Breadcrumbs** — automatic from document symbols.
- **Code Folding** — all block types foldable (schema, mapping, fragment, transform, metric, note, namespace, each, flatten, map literal, metadata, nested arrow).
- **Hover** — contextual markdown info for blocks, fields, tags, spreads, arrow paths, and pipeline functions.

### CodeLens

Inline annotations above blocks:

- **Schema actions** — `Lineage from` and `Lineage to`
- **Schema** — `N fields | used in M mappings`
- **Mapping** — `source → target | N arrows`
- **Fragment** — `spread in N places`
- **Transform** — `used in N places`
- **Metric** — `sources: schema1, schema2`

### Command Palette

Seven commands available via `Ctrl+Shift+P`:

| Command | Description |
|---|---|
| **Satsuma: Validate Workspace** | Run `satsuma validate` and populate the Problems panel |
| **Satsuma: Show Lineage From...** | Pick a schema and trace its downstream lineage |
| **Satsuma: Show Warnings** | Show all `//!` warnings in the Problems panel |
| **Satsuma: Show Workspace Summary** | Display workspace statistics |
| **Satsuma: Overview Visualization** | Open the interactive workspace overview (also the eye icon in the editor title bar and the editor/Explorer context menus) |
| **Satsuma: Show Field Lineage** | Open field-level lineage webview |
| **Satsuma: Show Mapping Coverage** | Show mapped/unmapped fields with gutter markers |

### Workspace Graph

`Satsuma: Show Workspace Graph` opens an interactive SVG diagram of your workspace:

- **Nodes** by block type: schemas (rectangles), mappings (diamonds), metrics (circles), fragments (rounded rectangles)
- **Edges** show data flow between schemas and mappings
- **Click** a node to jump to its definition
- **Namespace filter** dropdown to focus on a single namespace
- **Auto-refreshes** on file save

### Field-Level Lineage

`Satsuma: Trace Field Lineage` traces a field through the entire data pipeline:

- Cursor-aware field inference for arrow paths and schema fields
- Multi-hop chain tracing via `satsuma arrows`
- Horizontal flow: `source.field → [transform] → target.field`
- NL transforms displayed with distinct styling
- Click any node to navigate to the definition

### Mapping Coverage

`Satsuma: Show Mapping Coverage` shows which target fields are mapped:

- Green gutter markers for mapped fields
- Red gutter markers for unmapped fields
- Status bar shows coverage percentage
- Works from cursor position inside any mapping block

## Configuration

| Setting | Default | Description |
|---|---|---|
| `satsuma.cliPath` | `"satsuma"` | Path to the `satsuma` CLI executable |

## Running Tests

```bash
cd tooling/vscode-satsuma

# All tests (TextMate + LSP)
npm run check

# TextMate grammar tests only
npm test

# LSP server tests only (142 tests)
npm run test:lsp

# Build .vsix locally
npm run package
```

## Architecture

```
tooling/vscode-satsuma/
  src/
    extension.ts              Client: LSP lifecycle, commands, webview panels
    commands/                 Command handlers (CLI integration)
    webview/graph/            Workspace graph webview (SVG + D3-free layout)
    webview/lineage/          Field lineage webview (horizontal chain)
  server/
    src/
      server.ts               LSP server: connection, capabilities, handlers
      workspace-index.ts      Cross-file symbol table
      definition.ts           Go-to-definition
      references.ts           Find references
      completion.ts           Context-aware completions
      codelens.ts             Inline annotations
      rename.ts               Workspace-wide rename
      diagnostics.ts          Parse error diagnostics
      validate-diagnostics.ts Semantic diagnostics (CLI integration)
      symbols.ts              Document symbols / outline
      folding.ts              Code folding
      semantic-tokens.ts      Parser-backed semantic highlighting
      hover.ts                Contextual hover information
      parser-utils.ts         Tree-sitter helpers
  syntaxes/
    satsuma.tmLanguage.json   TextMate grammar
```
