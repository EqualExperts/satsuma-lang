/**
 * Compile-time regression checks for the CLI's shared CST contract.
 *
 * This file is included by `test:typecheck` but deliberately does not match the
 * runtime test glob. It proves a grammar-symbol rename breaks CLI selectors at
 * compile time while real parser output flows into them without a use-site cast.
 */

import { findBlockNode } from "#src/cst-query.js";
import { parseSource } from "#src/parser.js";

const parsed = parseSource("schema customer {}");
findBlockNode(parsed.tree.rootNode, "schema_block", "customer");

// A removed or misspelled generated symbol must never reach a CLI CST selector.
// @ts-expect-error "schema_declaration" is not a generated Satsuma grammar symbol.
findBlockNode(parsed.tree.rootNode, "schema_declaration", "customer");
