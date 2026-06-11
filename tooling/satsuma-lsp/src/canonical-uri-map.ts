/**
 * canonical-uri-map.ts — a Map that keys entries by canonical file URIs.
 *
 * LSP clients may spell the same file's URI differently between requests:
 * VS Code on Windows sends `file:///c%3A/proj/x.stm` while Node's
 * `pathToFileURL` produces `file:///C:/proj/x.stm`. The workspace index
 * canonicalizes its keys (sl-akz6), but server caches keyed by the raw
 * client URI missed lookups whenever the spelling differed: vizFullLineage
 * skipped open files, on-save diagnostics for sibling files never published,
 * and the watched-file "is it open?" skip never matched (sl-ku3c).
 *
 * Every key is canonicalized on the way in, so all spellings of one file
 * address the same entry. Iteration yields canonical keys. Non-file URIs
 * pass through canonicalizeFileUri unchanged.
 */

import { canonicalizeFileUri } from "./workspace-index";

export class CanonicalUriMap<V> extends Map<string, V> {
  override get(uri: string): V | undefined {
    return super.get(canonicalizeFileUri(uri));
  }

  override set(uri: string, value: V): this {
    return super.set(canonicalizeFileUri(uri), value);
  }

  override has(uri: string): boolean {
    return super.has(canonicalizeFileUri(uri));
  }

  override delete(uri: string): boolean {
    return super.delete(canonicalizeFileUri(uri));
  }
}
