/**
 * reference/compose.mjs — reads canonical sections and composes envelopes.
 *
 * `loadSections()` reads the `reference/*.md` files named in manifest.mjs
 * from disk. The `compose*` helpers then concatenate that data into whatever
 * an envelope needs: the full document, one task profile's slice, or a
 * single named section. Every envelope in the repo — the CLI's baked
 * generated module, the regenerated `AI-AGENT-REFERENCE.md`, and the
 * `satsuma-language` skill body — calls one of these rather than
 * re-implementing the join.
 *
 * `composeFull` performs a plain concatenation with no inserted separator.
 * That is deliberate, not an oversight: each section file already carries
 * its own leading/trailing blank lines and `---` dividers, sliced verbatim
 * from the original monolithic document, so concatenating them in order
 * reproduces that document byte-for-byte (see the "no orphan sections" test
 * in tooling/satsuma-cli's test suite for the proof).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILES, SECTIONS } from "./manifest.mjs";

const REFERENCE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Reads every section named in the manifest from `reference/*.md`.
 * Returns the manifest entries with a `content` field attached.
 */
export function loadSections() {
  return SECTIONS.map((section) => ({
    ...section,
    content: readFileSync(join(REFERENCE_DIR, section.file), "utf8"),
  }));
}

/** Concatenates every section in canonical order — the full document. */
export function composeFull(sections) {
  return sections.map((section) => section.content).join("");
}

/**
 * Concatenates the sections a given task profile needs, in canonical order.
 * Throws if `profile` is not one of PROFILES, so a typo fails loudly.
 */
export function composeProfile(sections, profile) {
  if (!PROFILES.includes(profile)) {
    throw new Error(
      `Unknown agent-reference profile "${profile}". Known profiles: ${PROFILES.join(", ")}`,
    );
  }
  return sections
    .filter((section) => section.profiles.includes(profile))
    .map((section) => section.content)
    .join("");
}

/** Returns one named section's content. Throws if `id` does not resolve. */
export function composeSection(sections, id) {
  const section = sections.find((candidate) => candidate.id === id);
  if (!section) {
    const known = sections.map((candidate) => candidate.id).join(", ");
    throw new Error(`Unknown agent-reference section "${id}". Known sections: ${known}`);
  }
  return section.content;
}
