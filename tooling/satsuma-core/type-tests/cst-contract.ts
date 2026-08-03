/**
 * cst-contract.ts — Compile-time regression checks for generated CST symbols.
 *
 * These assertions make stale or invented grammar symbols fail the core build
 * while demonstrating that partial walkers need not exhaustively handle every
 * symbol added to the grammar.
 */

import { child } from "../src/cst-utils.js";
import type {
  ParsedSatsumaTree,
  SatsumaCstType,
  SatsumaGrammarSymbol,
  SyntaxNode,
} from "../src/index.js";

declare const node: SyntaxNode;
declare const parsedTree: ParsedSatsumaTree;

const declaredSymbol: SatsumaGrammarSymbol = "schema_block";
child(node, declaredSymbol);

// A partial walker intentionally recognizes only the construct it owns. Adding
// another generated symbol must not impose an exhaustive-switch requirement.
export function isSchemaBlock(type: SatsumaCstType): boolean {
  return type === "schema_block";
}

// The concrete parser result keeps the recursive generated-symbol contract.
const childType: SatsumaCstType | undefined = parsedTree.rootNode.child(0)?.type;
const parentType: SatsumaCstType | undefined = parsedTree.rootNode.parent?.type;

// Invalid and removed symbols must be rejected both as values and helper keys.
// @ts-expect-error "schema_declaration" is not emitted by the Satsuma grammar.
const staleSymbol: SatsumaGrammarSymbol = "schema_declaration";

// @ts-expect-error Symbol-selecting helpers accept generated grammar symbols only.
child(node, "schema_declaration");

// @ts-expect-error Direct comparisons cannot silently name a stale CST symbol.
isSchemaBlock("schema_declaration");

void staleSymbol;
void childType;
void parentType;
