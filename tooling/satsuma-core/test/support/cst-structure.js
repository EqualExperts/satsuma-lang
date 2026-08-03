/**
 * cst-structure.js — Layout-independent CST serialization for formatter tests.
 *
 * The formatter's structural contract is shared by the canonical corpus and
 * generated inputs. Keeping its serializer here prevents the two suites from
 * drifting into subtly different definitions of "same parse tree".
 */

/**
 * Serialize named structure and named leaf text while ignoring anonymous
 * punctuation. Formatting may move punctuation and whitespace, but it must not
 * change the named grammar structure or authored semantic tokens.
 */
export function cstStructure(node) {
  if (node.childCount === 0) {
    if (node.isNamed) return `${node.type}=${JSON.stringify(node.text)}`;
    return null;
  }

  const children = [];
  for (const child of node.children) {
    const structure = cstStructure(child);
    if (structure !== null) children.push(structure);
  }
  return `${node.type}(${children.join(",")})`;
}
