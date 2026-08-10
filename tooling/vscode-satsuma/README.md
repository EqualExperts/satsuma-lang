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
npm install                                     # repo root — npm workspaces, one lockfile
npx turbo run build --filter=vscode-satsuma     # builds this package and everything it needs
npm --prefix tooling/vscode-satsuma run package # produces vscode-satsuma.vsix
code --install-extension tooling/vscode-satsuma/vscode-satsuma.vsix
```

The package shown in VS Code's Extensions view is `X.Y.Z` at the exact release
tag and `X.Y.Z-dev.<short-sha>` everywhere else. Packaging applies that version
only to a temporary staging manifest; the tracked `package.json` remains clean.

There is no `server/` package to install into: the language server is
`tooling/satsuma-lsp`, a workspace package this one declares, and the build
bundles it into `server/dist/`.

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

Nine commands available via `Ctrl+Shift+P`:

| Command | Description |
|---|---|
| **Satsuma: Validate Workspace** | Run `satsuma validate` and populate the Problems panel |
| **Satsuma: Show Lineage From...** | Pick a schema and trace its downstream lineage |
| **Satsuma: Show Warnings** | Show all `//!` warnings in the Problems panel |
| **Satsuma: Show Workspace Summary** | Display workspace statistics |
| **Satsuma: Overview Visualization** | Open the interactive workspace overview (also the eye icon in the editor title bar and the editor/Explorer context menus) |
| **Satsuma: Show Field Lineage** | Trace a field's chain in the visualization panel's chain view |
| **Satsuma: Show Coverage Overlay** | Open the visualization panel with the coverage overlay switched on |
| **Satsuma: Show Mapping Coverage** | Show mapped/unmapped fields with gutter markers |
| **Satsuma: Clear Mapping Coverage** | Remove the gutter markers and status bar item |

### Workspace Graph

`Satsuma: Overview Visualization` opens an interactive SVG diagram of your workspace:

- **Nodes** by block type: schemas (rectangles), mappings (diamonds), metrics (circles), fragments (rounded rectangles)
- **Edges** show data flow between schemas and mappings
- **Click** a node to jump to its definition
- **Namespace filter** dropdown to focus on a single namespace
- **Auto-refreshes** on file save

### Field-Level Lineage

`Satsuma: Show Field Lineage` traces a field's full upstream and downstream
chain in the visualization panel's chain view — the same panel `Satsuma:
Overview Visualization` opens, switched into its chain-view mode:

- Cursor-aware field inference; falls back to a QuickPick when the cursor
  isn't on a field
- Left-to-right rail: upstream sources → focus field → downstream consumers,
  one card per hop
- Multi-hop chains computed by the language server (`@satsuma/core`'s field
  lineage traversal) — no separate CLI process
- NL-derived hops (implicit dependencies referenced in prose) rendered with
  distinct styling
- Click a hop to re-focus the chain on that field, or a mapping label to open
  its detail view

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
# This package's tests: unit, plus TextMate fixture and golden checks
npx turbo run test --filter=vscode-satsuma

# The language server's own suite — a separate package
npx turbo run test --filter=@satsuma/lsp

# Manifest and grammar validation, plus this package's tests
npm --prefix tooling/vscode-satsuma run check

# Build .vsix locally
npm --prefix tooling/vscode-satsuma run package
```

`check` does **not** run the language server's tests. It used to, via a `test:lsp`
script that did `cd ../satsuma-lsp && npm test`; reaching into a sibling package
like that is what Turborepo replaced, so `turbo run test` now covers both in
dependency order (feature 42).

## Architecture

```
tooling/vscode-satsuma/
  src/
    extension.ts              Client: LSP lifecycle, commands, webview panels
    commands/                 Command handlers (CLI integration)
    webview/graph/            Workspace graph webview (SVG + D3-free layout)
    webview/lineage/          Field lineage webview (horizontal chain)
  server/
    dist/                     Bundled language server, built from ../satsuma-lsp
  syntaxes/
    satsuma.tmLanguage.json   TextMate grammar
```
