/**
 * Contract tests for reference/compose.mjs — the composer every AI Agent
 * Reference envelope (CLI, portable blob, skill) is required to use instead
 * of hand-restating section content or ordering.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PROFILES, SECTIONS } from "../reference/manifest.mjs";
import {
  composeFull,
  composeProfile,
  composeSection,
  loadSections,
} from "../reference/compose.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("composing every section in canonical order reproduces AI-AGENT-REFERENCE.md byte-for-byte", () => {
  // This is the load-bearing guarantee behind Feature 45's back-compat promise:
  // bare `satsuma agent-reference` must keep printing exactly what it prints
  // today, even though the content now lives in reference/*.md instead of one
  // hand-maintained file. If a section is cut on the wrong line boundary, or
  // sections are reordered, this is where it shows up.
  const sections = loadSections();
  const composed = composeFull(sections);
  const current = fs.readFileSync(path.join(repoRoot, "AI-AGENT-REFERENCE.md"), "utf8");

  assert.equal(composed, current);
});

test("no canonical section is orphaned from every task profile", () => {
  // A section that belongs to neither profile would still ship in the full
  // document but never in a --profile slice — silently defeating the point
  // of profiling. Every section must claim at least one profile.
  for (const section of SECTIONS) {
    assert.ok(
      section.profiles.length > 0,
      `section "${section.id}" is not assigned to any profile`,
    );
    for (const profile of section.profiles) {
      assert.ok(
        PROFILES.includes(profile),
        `section "${section.id}" claims unknown profile "${profile}"`,
      );
    }
  }
});

test("composeProfile returns only the sections that profile claims, in canonical order", () => {
  // Regression guard for the filter+join itself: wrong order or a leaked
  // section from the other profile would hand an agent the wrong slice.
  const sections = loadSections();

  const write = composeProfile(sections, "write");
  const writeIds = SECTIONS.filter((s) => s.profiles.includes("write")).map((s) => s.id);
  assert.deepEqual(sectionIdsIn(write, sections), writeIds);

  const read = composeProfile(sections, "read");
  const readIds = SECTIONS.filter((s) => s.profiles.includes("read")).map((s) => s.id);
  assert.deepEqual(sectionIdsIn(read, sections), readIds);
});

test("composeProfile rejects a profile name absent from the manifest", () => {
  // Guards against a typo'd --profile flag silently returning an empty slice.
  const sections = loadSections();
  assert.throws(
    () => composeProfile(sections, "review"),
    /Unknown agent-reference profile "review"/,
  );
});

test("composeSection returns exactly the named section's content", () => {
  const sections = loadSections();
  assert.equal(
    composeSection(sections, "grammar"),
    sections.find((s) => s.id === "grammar").content,
  );
});

test("composeSection rejects a section id absent from the manifest", () => {
  const sections = loadSections();
  assert.throws(
    () => composeSection(sections, "glossary"),
    /Unknown agent-reference section "glossary"/,
  );
});

/** Recovers which sections (in order) a composed string was built from, by content identity. */
function sectionIdsIn(composed, sections) {
  const ids = [];
  let rest = composed;
  for (const section of sections) {
    if (rest.startsWith(section.content)) {
      ids.push(section.id);
      rest = rest.slice(section.content.length);
    }
  }
  return ids;
}
