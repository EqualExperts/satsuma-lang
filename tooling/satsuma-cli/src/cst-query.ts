/**
 * cst-query.ts — Namespace-aware CST lookup helpers.
 */

import { labelText } from "@satsuma/core";
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
  nodeType: string,
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
  nodeType: string,
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
  nodeType: string,
  localName: string,
): SyntaxNode | null {
  for (const c of containerNode.namedChildren) {
    if (c.type === nodeType && labelText(c) === localName) return c;
  }
  return null;
}
