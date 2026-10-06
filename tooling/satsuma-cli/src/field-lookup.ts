/**
 * field-lookup.ts — find a declared field from a `schema.field` argument
 *
 * The field-scoped commands (`arrows`, `field-lineage`, `nl`, `meta`) all
 * start by asking whether the field a user named exists, and the last two then
 * read its declaration for notes and metadata. A field can reach a schema
 * through a fragment spread at any depth — at schema level, inside a record,
 * or inside a record a fragment itself supplies — so both questions are
 * answered against the spread-expanded tree core's `expandDeclaredFields`
 * builds, never against the fields written in the schema body alone
 * (bsw-ep0m: each command used to build its own, partial, tree).
 *
 * Owns: the lookup rule shared by those commands, and finding the CST
 *       `field_decl` that declares a match, in whichever block wrote it.
 * Does not own: spread expansion (core) or splitting the user's argument
 *       into segments (each command, until a CST-backed splitter replaces
 *       `split(".")` there).
 */

import type { ExpandedField, SatsumaGrammarSymbol, SpreadEntity } from "@satsuma/core";
import { findBlockNode, findFieldDeclByPath } from "./cst-query.js";
import { expandDeclaredFields } from "./spread-expand.js";
import type { ExtractedWorkspace, FieldDecl, ParsedFile, SyntaxNode } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** An entity whose fields can be looked up: a schema, fragment or metric record. */
export type FieldOwner = SpreadEntity & { namespace?: string };

/** One declared field the lookup found. */
export interface DeclaredFieldMatch {
  /** The field as it appears in the expanded tree. */
  field: FieldDecl;
  /** Field names from the entity root down to the field. */
  path: string[];
  /**
   * The fragment whose body writes the field, or null when the entity's own
   * body does. Notes and metadata live on that declaration, so this is where
   * `nl` and `meta` must read the CST.
   */
  fragmentKey: string | null;
  /** The field's path inside the block that writes it (the fragment, when there is one). */
  pathInDeclaration: string[];
}

// ── Lookup ────────────────────────────────────────────────────────────────────

/**
 * Every declared field the segments name in `entity`, spreads included.
 *
 * Rule: an exact path wins, and yields one match. Otherwise, the segments
 * rejoined are taken as a bare field name and every field of that name, at any
 * depth, matches in declaration order — the long-standing shorthand that lets
 * `schema.street` reach `schema.address.street` (sl-xj4p). A dotted path that
 * does not resolve exactly matches nothing: `customer.zzz.street` must not fall
 * back to some other `street`.
 */
export function findDeclaredFields(
  entity: FieldOwner,
  segments: readonly string[],
  index: ExtractedWorkspace,
): DeclaredFieldMatch[] {
  const tree = expandDeclaredFields(entity, entity.namespace ?? null, index);
  const exact = matchPath(tree, segments);
  if (exact) return [exact];
  const name = segments.join(".");
  return collectByName(tree, name, [], null);
}

/** Walk `segments` down the tree, remembering the nearest fragment that wrote each step. */
function matchPath(tree: FieldDecl[], segments: readonly string[]): DeclaredFieldMatch | null {
  let level = tree;
  let found: FieldDecl | null = null;
  let fragmentKey: string | null = null;
  let fragmentDepth = 0;
  for (const [depth, segment] of segments.entries()) {
    found = level.find((f) => f.name === segment) ?? null;
    if (!found) return null;
    const from = (found as ExpandedField).fromFragment;
    if (from) {
      fragmentKey = from;
      fragmentDepth = depth;
    }
    level = found.children ?? [];
  }
  if (!found) return null;
  return {
    field: found,
    path: [...segments],
    fragmentKey,
    pathInDeclaration: segments.slice(fragmentDepth),
  };
}

/** Every field called `name` anywhere in the tree, depth-first in declaration order. */
function collectByName(
  fields: FieldDecl[],
  name: string,
  prefix: string[],
  inherited: { key: string; depth: number } | null,
): DeclaredFieldMatch[] {
  const matches: DeclaredFieldMatch[] = [];
  for (const field of fields) {
    const path = [...prefix, field.name];
    const from = (field as ExpandedField).fromFragment;
    const origin = from ? { key: from, depth: prefix.length } : inherited;
    if (field.name === name) {
      matches.push({
        field,
        path,
        fragmentKey: origin?.key ?? null,
        pathInDeclaration: path.slice(origin?.depth ?? 0),
      });
    }
    if (field.children) matches.push(...collectByName(field.children, name, path, origin));
  }
  return matches;
}

// ── Declaration lookup ────────────────────────────────────────────────────────

/** The block a looked-up entity was found in, so its own declarations can be read. */
export interface FieldOwnerBlock {
  /** Canonical index key of the entity. */
  key: string;
  /** Its CST block type: `schema_block` (schemas and metrics) or `fragment_block`. */
  blockType: SatsumaGrammarSymbol;
  /** File that declares the entity. */
  file: string;
}

/**
 * The CST `field_decl` that writes a matched field, and the file it is in.
 * A spread-supplied field is read from its fragment's body, not the schema's,
 * because that is where its notes and metadata are written. Returns null when
 * the declaring block or file is not among the parsed files.
 */
export function findFieldDeclaration(
  match: DeclaredFieldMatch,
  owner: FieldOwnerBlock,
  index: ExtractedWorkspace,
  parsedFiles: ParsedFile[],
): { node: SyntaxNode; file: string } | null {
  const fragment = match.fragmentKey ? index.fragments.get(match.fragmentKey) : null;
  const block: FieldOwnerBlock | null = match.fragmentKey
    ? fragment
      ? { key: match.fragmentKey, blockType: "fragment_block", file: fragment.file }
      : null
    : owner;
  if (!block) return null;
  const parsed = parsedFiles.find((p) => p.filePath === block.file);
  const blockNode = parsed ? findBlockNode(parsed.tree.rootNode, block.blockType, block.key) : null;
  const node = blockNode ? findFieldDeclByPath(blockNode, match.pathInDeclaration) : null;
  return node ? { node, file: block.file } : null;
}
