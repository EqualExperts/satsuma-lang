/**
 * cst-query.ts — Namespace-aware CST lookup helpers: find a named block, and a
 * field declaration inside one.
 */

import { fieldNameText, labelText } from "@satsuma/core";
import type { SatsumaGrammarSymbol } from "@satsuma/core";
import type { SyntaxNode } from "./types.js";

interface QualifiedName {
  namespace: string | null;
  localName: string;
}

function splitQualifiedName(name: string): QualifiedName {
  if (!name || !name.includes("::")) return { namespace: null, localName: name };
  const idx = name.indexOf("::");
  return {
    namespace: name.slice(0, idx),
    localName: name.slice(idx + 2),
  };
}

export function findBlockNode(
  rootNode: SyntaxNode,
  nodeType: SatsumaGrammarSymbol,
  qualifiedName: string,
): SyntaxNode | null {
  // Handle anonymous blocks keyed by <anon>@file:row
  const anonMatch = qualifiedName.match(/^<anon>@.*:(\d+)$/);
  if (anonMatch) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: regex capture group 1 always matches when anonMatch succeeds
    const targetRow = parseInt(anonMatch[1]!, 10); // keys use 0-based row from startPosition
    return findBlockByRow(rootNode, nodeType, targetRow);
  }

  const { namespace, localName } = splitQualifiedName(qualifiedName);

  for (const c of rootNode.namedChildren) {
    if (c.type === "namespace_block") {
      const nsNode = c.namedChildren.find((x) => x.type === "identifier");
      const nsName = nsNode?.text ?? null;
      if (namespace && nsName !== namespace) continue;
      const result = findBlockNodeInContainer(c, nodeType, localName);
      if (result) return result;
      continue;
    }

    if (namespace) continue;
    if (c.type === nodeType && labelText(c) === localName) return c;
  }

  return null;
}

function findBlockByRow(
  rootNode: SyntaxNode,
  nodeType: SatsumaGrammarSymbol,
  targetRow: number,
): SyntaxNode | null {
  for (const c of rootNode.namedChildren) {
    if (c.type === nodeType && c.startPosition.row === targetRow) return c;
    if (c.type === "namespace_block") {
      for (const inner of c.namedChildren) {
        if (inner.type === nodeType && inner.startPosition.row === targetRow) return inner;
      }
    }
  }
  return null;
}

function findBlockNodeInContainer(
  containerNode: SyntaxNode,
  nodeType: SatsumaGrammarSymbol,
  localName: string,
): SyntaxNode | null {
  for (const c of containerNode.namedChildren) {
    if (c.type === nodeType && labelText(c) === localName) return c;
  }
  return null;
}

/**
 * The `field_decl` at `path` inside a schema or fragment block, following each
 * segment through the nested record body it names. Exact: a segment that does
 * not name a field at its own level yields null rather than a same-named field
 * elsewhere. Spreads are not followed — a spread-supplied field is declared in
 * its fragment's block, so look it up there.
 */
export function findFieldDeclByPath(
  blockNode: SyntaxNode,
  path: readonly string[],
): SyntaxNode | null {
  let body = blockNode.namedChildren.find((c) => c.type === "schema_body");
  let decl: SyntaxNode | null = null;
  for (const segment of path) {
    if (!body) return null;
    decl =
      body.namedChildren.find(
        (c) =>
          c.type === "field_decl" &&
          fieldNameText(c.namedChildren.find((x) => x.type === "field_name")) === segment,
      ) ?? null;
    if (!decl) return null;
    body = decl.namedChildren.find((c) => c.type === "schema_body");
  }
  return decl;
}
