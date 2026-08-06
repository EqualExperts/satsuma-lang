/**
 * static-compactness-render.mjs — arms Y and J: the same facts as YAML and JSON.
 *
 * This module implements the serialisation defined in
 * `evals/static-compactness/SERIALISATION-DESIGN.md`. Read that document first:
 * it states the design, why each choice was made, and — critically — the
 * savings that were *declined* and what they would have been worth. This file
 * is the mechanical consequence of those decisions, not the place they are
 * argued.
 *
 * Three properties of the design drive everything here:
 *
 *   1. **Collections are keyed by name**, not lists of `- name:` records. That
 *      is worth ~14% of the arm and is safe because `validate.ts` already makes
 *      a duplicate schema name an error.
 *   2. **Any key that is not reserved is a Satsuma vocabulary token, spelled
 *      verbatim.** Satsuma's vocabulary is open-ended (spec §2.7), so a fixed
 *      key list could never be total.
 *   3. **No anchors, aliases or merge keys**, which is what lets the JSON arm be
 *      a pure mechanical lowering of the same tree rather than a second design.
 *
 * The emitter is hand-written rather than delegated to a YAML library because
 * the design specifies flow-versus-block style per construct, and that choice is
 * worth real tokens. Every rendering is round-tripped back through a real YAML
 * parser and diffed against the tree it came from ({@link assertRoundTrips}), so
 * a hand-rolled quoting bug fails the measurement instead of silently changing
 * what the arm says.
 */

import { parse as parseYaml } from "yaml";
import { assertTotality, REQUIRED_CONSTRUCTS } from "./static-compactness-model.mjs";

/** Construct keys this renderer emits. Anything else must fail totality. */
const RENDERED_CONSTRUCTS = REQUIRED_CONSTRUCTS;

/**
 * Keys whose values are always prose and therefore always quoted (rule Q1).
 * Unquoted plain scalars truncate silently at " #" and fail hard on ": ", "{",
 * "[" and a leading "@" — every one of which occurs in `examples/`.
 */
const PROSE_KEYS = new Set(["note", "doc", "rule", "nl", "filter", "!", "?"]);

/**
 * Keys whose presence forces a mapping into block style. Everything else is
 * emitted in flow style, which measured 1-4 tokens cheaper per construct.
 */
const BLOCK_FORCING_KEYS = new Set(["fields", "arrows", "values"]);

/** Plain scalars YAML would resolve to a non-string type, so they need quoting. */
const NON_STRING_PLAIN =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|y|Y|n|N|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|[-+]?\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN))$/;

/** Characters that begin a YAML indicator and so force quoting at scalar start. */
const LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

// ── Ordered tree construction ──────────────────────────────────────────────

/**
 * Builds an ordered map. Maps are used rather than plain objects because a
 * spec's field and arrow order is a fact, and a plain object reorders
 * integer-like keys — a field named `2024` would silently move.
 */
function ordered(entries) {
  return new Map(entries.filter(([, value]) => value !== undefined));
}

/**
 * Renders one metadata entry as a vocabulary-token key/value pair, following
 * the open rule: the value's shape mirrors the token's Satsuma argument shape.
 */
function metadataEntry(entry) {
  switch (entry.kind) {
    case "tag":
      return [entry.tag, true];
    case "kv":
      return [entry.key, entry.value];
    case "enum":
      return ["enum", entry.values];
    case "slice":
      return ["slice", entry.values];
    case "note":
      return ["note", entry.text];
    default:
      throw new Error(
        `static-compactness: unhandled metadata kind "${entry.kind}". Every authored ` +
          `fact must appear in every arm — add a rendering rather than dropping it.`,
      );
  }
}

/** Appends each metadata entry to `entries`, collapsing repeats into a sequence. */
function appendMetadata(entries, metadata = []) {
  for (const entry of metadata) {
    const [key, value] = metadataEntry(entry);
    const existing = entries.find(([k]) => k === key);
    if (!existing) entries.push([key, value]);
    else if (Array.isArray(existing[1]) && existing[1].repeated) existing[1].push(value);
    else {
      const seq = [existing[1], value];
      seq.repeated = true;
      existing[1] = seq;
    }
  }
}

/**
 * Reconstructs the verbatim type expression. The projection keeps `type` and
 * `isList` apart because the parser does; the design keeps them together in one
 * key so there is no punning between a record and a list of records.
 */
function typeExpression(field) {
  if (!field.type) return undefined;
  return field.isList ? `list_of ${field.type}` : field.type;
}

/**
 * Renders one field. A field carrying nothing but a type collapses to the
 * scalar shorthand (`Amount: CURRENCY(18,2)`) — the single largest saving in
 * the design, and the shape a real author would write.
 */
function buildField(field, attachments) {
  const entries = [];
  const type = typeExpression(field);
  if (type) entries.push(["type", type]);
  appendMetadata(entries, field.metadata);
  if (field.spreads?.length) entries.push(["...", field.spreads]);
  for (const [key, value] of attachments.for(field.name)) entries.push([key, value]);
  if (field.children?.length) {
    entries.push([
      "fields",
      ordered(field.children.map((c) => [c.name, buildField(c, attachments)])),
    ]);
  }
  if (entries.length === 1 && entries[0][0] === "type") return type;
  return ordered(entries);
}

/**
 * Decomposes an arrow's pipe chain into the design's `rule`, `steps` and
 * `values` keys.
 *
 * A leading quoted step is prose and becomes `rule:`; a `map { }` literal
 * becomes `values:`; everything else is a mechanical step emitted verbatim.
 * The distinction is lexical in Satsuma — bare `trim` is a vocabulary token and
 * `"trim"` is prose — so it must become structural here, because YAML quoting
 * carries no meaning.
 */
function decomposeSteps(steps = []) {
  let rule;
  let values;
  const mechanical = [];
  for (const step of steps) {
    const text = step.text ?? "";
    if (isQuotedProse(text)) {
      const prose = unquoteProse(text);
      if (rule === undefined && mechanical.length === 0) rule = prose;
      else mechanical.push(ordered([["nl", prose]]));
    } else if (text.startsWith("map")) {
      values = parseValueMap(text);
    } else if (text.length > 0) {
      mechanical.push(text);
    }
  }
  return { rule, values, steps: mechanical };
}

/**
 * Parses a `map { a: "b", _: "c" }` literal into an ordered map.
 *
 * The parser hands transforms back as raw text, so the value map is re-read
 * here. It is a flat, comma-or-newline separated list of `key: value` pairs
 * with optional quoting on either side — no nesting, so a full parser is not
 * warranted, but every case must survive including the `_` wildcard.
 */
function parseValueMap(text) {
  const body = text.slice(text.indexOf("{") + 1, text.lastIndexOf("}"));
  const entries = [];
  for (const pair of body.split(/[,\n]/)) {
    const trimmed = pair.trim();
    if (trimmed.length === 0) continue;
    const split = trimmed.indexOf(":");
    if (split === -1) continue;
    entries.push([
      unquote(trimmed.slice(0, split).trim()),
      unquote(trimmed.slice(split + 1).trim()),
    ]);
  }
  return ordered(entries);
}

/**
 * True when a pipe step is authored prose rather than a mechanical vocabulary
 * token. In Satsuma the distinction is lexical — bare `trim` is a token and
 * `"trim"` is prose — and both spellings arrive here as the same `pipe_text`
 * node, so the quoting is the only signal. Satsuma has two prose spellings:
 * `"…"` and the multi-line `""" … """` (spec §2.2).
 */
function isQuotedProse(text) {
  if (text.startsWith('"""')) return text.endsWith('"""') && text.length >= 6;
  return text.startsWith('"') && text.endsWith('"') && text.length >= 2;
}

/** Strips whichever prose delimiter {@link isQuotedProse} matched. */
function unquoteProse(text) {
  return text.startsWith('"""') ? text.slice(3, -3) : text.slice(1, -1);
}

/** Strips one layer of surrounding double quotes, which YAML will re-add if needed. */
function unquote(text) {
  return text.startsWith('"') && text.endsWith('"') && text.length >= 2 ? text.slice(1, -1) : text;
}

/**
 * Renders one arrow, keyed by its target path. An arrow that is nothing but a
 * source path collapses to the scalar shorthand (`opp_key: Id`).
 */
function buildArrow(arrow, attachments) {
  const entries = [];
  // An `each`/`flatten` arrow iterates a source list, and the keyword is the
  // fact that says so — without it the YAML would describe a scalar mapping.
  // The source rides on that key rather than on `from`, so it is stated once.
  const iterates = arrow.kind === "each" || arrow.kind === "flatten";
  const sourceKey = iterates ? arrow.kind : "from";
  if (arrow.sources?.length === 1) entries.push([sourceKey, arrow.sources[0]]);
  else if (arrow.sources?.length > 1) entries.push([sourceKey, arrow.sources]);
  else if (iterates) entries.push([sourceKey, true]);
  if (arrow.enumeratesChildren) entries.push(["enumerates", true]);

  const { rule, values, steps } = decomposeSteps(arrow.steps);
  if (rule !== undefined) entries.push(["rule", rule]);
  if (steps.length === 1) entries.push(["steps", steps[0]]);
  else if (steps.length > 1) entries.push(["steps", steps]);
  if (values !== undefined) entries.push(["values", values]);
  if (arrow.derived) entries.push(["derived", true]);
  for (const [key, value] of attachments.for(arrow.target)) entries.push([key, value]);

  if (entries.length === 1 && entries[0][0] === "from") return entries[0][1];
  return ordered(entries);
}

/**
 * Indexes free-standing `//!` and `//?` comments by the block they were written
 * inside, so each lands on the construct it annotates rather than in a detached
 * list. A path that collects nothing yields no keys and therefore costs nothing.
 */
function attachmentIndex(model) {
  const byParent = new Map();
  const add = (parent, key, text) => {
    const owner = parent ?? null;
    if (!byParent.has(owner)) byParent.set(owner, []);
    byParent.get(owner).push([key, text]);
  };
  // A note written inside a schema or mapping body belongs to that block. Only
  // an unparented note is the file's own `note { }`, handled in buildDocument.
  for (const note of model.notes ?? []) if (note.parent) add(note.parent, "doc", note.text);
  for (const warning of model.warnings ?? []) add(warning.parent, "!", warning.text);
  for (const question of model.questions ?? []) add(question.parent, "?", question.text);
  for (const [owner, entries] of byParent) byParent.set(owner, collapseRepeats(entries));
  return { for: (name) => byParent.get(name ?? null) ?? [] };
}

/**
 * Applies the design's escape rule: a key that would appear more than once in
 * one mapping takes a sequence of the values it would otherwise hold.
 *
 * Without this, several `//!` comments inside one schema would collide on the
 * `"!"` key and all but the last would vanish — silently shrinking the YAML and
 * JSON arms, which is exactly the bias this measurement must not have.
 */
function collapseRepeats(entries) {
  const byKey = new Map();
  for (const [key, value] of entries) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(value);
  }
  return [...byKey].map(([key, values]) => [key, values.length === 1 ? values[0] : values]);
}

/** Renders a schema, fragment or metric body. */
function buildSchema(schema, attachments) {
  const entries = [];
  // `ExtractedSchema.note` and the `note` entry inside `blockMetadata` are the
  // same authored `(note "…")`, surfaced twice by the extractor for callers'
  // convenience. Emitting both would charge the YAML arm twice for one fact.
  const metadataCarriesNote = (schema.metadata ?? []).some((m) => m.kind === "note");
  if (schema.note && !metadataCarriesNote) entries.push(["note", schema.note]);
  // Which namespace a block belongs to changes how every bare reference to it
  // resolves, so it is a fact the YAML arm has to carry.
  if (schema.namespace) entries.push(["namespace", schema.namespace]);
  appendMetadata(entries, schema.metadata);
  for (const [key, value] of attachments.for(schema.name)) entries.push([key, value]);
  if (schema.spreads?.length) entries.push(["...", schema.spreads]);
  // A schema whose body is nothing but a spread has no fields of its own; an
  // empty `fields: {}` would be bytes for a fact that is not there.
  if (schema.fields?.length) {
    entries.push([
      "fields",
      ordered(schema.fields.map((f) => [f.name, buildField(f, attachments)])),
    ]);
  }
  return ordered(entries);
}

/** Renders a mapping body. An anonymous mapping is keyed by the empty string. */
function buildMapping(mapping, attachments) {
  const entries = [];
  if (mapping.namespace) entries.push(["namespace", mapping.namespace]);
  if (mapping.sources?.length === 1) entries.push(["source", mapping.sources[0]]);
  else if (mapping.sources?.length) entries.push(["source", mapping.sources]);
  if (mapping.targets?.length === 1) entries.push(["target", mapping.targets[0]]);
  else if (mapping.targets?.length) entries.push(["target", mapping.targets]);
  for (const [key, value] of attachments.for(mapping.name)) entries.push([key, value]);
  if (mapping.arrows?.length) {
    entries.push([
      "arrows",
      ordered(mapping.arrows.map((a) => [a.target, buildArrow(a, attachments)])),
    ]);
  }
  return ordered(entries);
}

/**
 * Builds the ordered tree for one projected spec. This tree is what both arms
 * serialise — YAML by {@link emitYaml}, JSON by `JSON.stringify` — which is why
 * the JSON arm is a lowering rather than a second design.
 *
 * @param model - a `projectSpec` result
 * @returns an ordered Map ready for either emitter
 */
export function buildDocument(model) {
  assertTotality(model, RENDERED_CONSTRUCTS);
  const attachments = attachmentIndex(model);
  const entries = [];

  if (model.imports?.length) {
    const byPath = new Map();
    for (const imported of model.imports) {
      // Several `import { … } from "x"` lines against one path merge into one
      // key, which is what an author writing YAML directly would do.
      const existing = byPath.get(imported.path) ?? [];
      byPath.set(imported.path, [...existing, ...imported.names]);
    }
    entries.push(["imports", byPath]);
  }

  // A note with no parent is the file's own `note { }` block; parented notes
  // belong to their schema or mapping and are attached there.
  const documentNotes = (model.notes ?? []).filter((n) => !n.parent);
  if (documentNotes.length === 1) entries.push(["doc", documentNotes[0].text]);
  else if (documentNotes.length > 1) entries.push(["doc", documentNotes.map((n) => n.text)]);

  for (const [key, value] of attachments.for(null)) entries.push([key, value]);

  const named = (items, build) => ordered(items.map((i) => [i.name ?? "", build(i, attachments)]));
  if (model.schemas?.length || model.metrics?.length) {
    entries.push([
      "schemas",
      named([...(model.schemas ?? []), ...(model.metrics ?? [])], buildSchema),
    ]);
  }
  if (model.fragments?.length) entries.push(["fragments", named(model.fragments, buildSchema)]);
  if (model.transforms?.length) {
    entries.push([
      "transforms",
      ordered(model.transforms.map((t) => [t.name, t.body ?? t.transform_raw ?? ""])),
    ]);
  }
  if (model.mappings?.length) entries.push(["mappings", named(model.mappings, buildMapping)]);

  return ordered(entries);
}

// ── YAML emission ──────────────────────────────────────────────────────────

/**
 * Renders one scalar under the design's two quoting rules.
 *
 * @param value - the scalar to render
 * @param prose - true when rule Q1 applies (the value is authored prose)
 * @param flow - true when the scalar sits inside `{ }` or `[ ]`, where a comma
 *   would otherwise terminate it
 */
function scalar(value, { prose = false, flow = false } = {}) {
  if (value === true) return "true";
  if (typeof value === "number") return String(value);
  const text = String(value);
  const mustQuote =
    prose ||
    text.length === 0 ||
    text.includes("@") ||
    text.includes(": ") ||
    text.includes(" #") ||
    text.includes("\n") ||
    LEADING_INDICATOR.test(text) ||
    NON_STRING_PLAIN.test(text) ||
    (flow && /[,[\]{}]/.test(text));
  if (!mustQuote) return text;
  return JSON.stringify(text);
}

/** True when `value` is a container the emitter must recurse into. */
function isContainer(value) {
  return value instanceof Map || Array.isArray(value);
}

/** Renders a mapping or sequence inline, e.g. `{type: ID, pk: true}`. */
function emitFlow(value, keyIsProse = false) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => (isContainer(v) ? emitFlow(v) : scalar(v, { flow: true, prose: keyIsProse }))).join(", ")}]`;
  }
  const parts = [];
  for (const [key, inner] of value) {
    const rendered = isContainer(inner)
      ? emitFlow(inner, PROSE_KEYS.has(key))
      : scalar(inner, { flow: true, prose: PROSE_KEYS.has(key) });
    parts.push(`${scalar(key, { flow: true })}: ${rendered}`);
  }
  return `{${parts.join(", ")}}`;
}

/** True when a mapping must be emitted in block style rather than inline. */
function needsBlock(value) {
  if (!(value instanceof Map)) return false;
  for (const key of value.keys()) if (BLOCK_FORCING_KEYS.has(key)) return true;
  return false;
}

/**
 * Emits a multi-line block scalar, preserving the interior indentation the
 * Satsuma spec says a `""" """` note keeps as-is (§2.2). Indenting the block
 * one level deeper than its content puts YAML's auto-detected indentation
 * exactly where the source's was, at no token cost.
 */
function emitBlockScalar(text, indent) {
  const pad = " ".repeat(indent);
  return `|-\n${text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : ""))
    .join("\n")}`;
}

/**
 * How the entries of each named collection are rendered.
 *
 * `block` means every entry gets its own indented block, because its value is a
 * substantial construct a reviewer reads down (a schema, a mapping). `auto`
 * means an entry is inlined unless it contains a {@link BLOCK_FORCING_KEYS}
 * key, which is what keeps one field or one arrow on one line — the shape the
 * design is built around, and the shape a real author writes.
 */
const COLLECTION_ENTRY_STYLE = new Map([
  ["schemas", "block"],
  ["fragments", "block"],
  ["mappings", "block"],
  ["namespaces", "block"],
  ["fields", "auto"],
  ["arrows", "auto"],
  ["imports", "auto"],
  ["transforms", "auto"],
]);

/**
 * Recursively emits `value` in block style at `indent` spaces.
 *
 * @param entryStyle - how to render this map's own entries when they are
 *   containers: `block` gives each its own indented block, `auto` inlines it
 *   unless it contains a block-forcing key
 */
function emitBlock(value, indent, entryStyle = "auto") {
  const pad = " ".repeat(indent);
  const lines = [];
  for (const [key, inner] of value) {
    const keyText = `${pad}${scalar(key)}:`;
    if (inner instanceof Map && inner.size === 0) continue;

    if (isContainer(inner)) {
      // A collection key names how its own entries render; anything else is an
      // entry of the collection we are already inside.
      const childStyle = COLLECTION_ENTRY_STYLE.get(key);
      const renderAsBlock =
        inner instanceof Map &&
        (childStyle !== undefined || entryStyle === "block" || needsBlock(inner));
      if (renderAsBlock) lines.push(keyText, emitBlock(inner, indent + 2, childStyle ?? "auto"));
      else lines.push(`${keyText} ${emitFlow(inner, PROSE_KEYS.has(key))}`);
    } else if (typeof inner === "string" && inner.includes("\n")) {
      lines.push(`${keyText} ${emitBlockScalar(inner, indent + 2)}`);
    } else {
      lines.push(`${keyText} ${scalar(inner, { prose: PROSE_KEYS.has(key) })}`);
    }
  }
  return lines.join("\n");
}

/**
 * Serialises one projected spec as YAML.
 *
 * @param model - a `projectSpec` result
 * @returns YAML text carrying every fact the `.stm` carried
 */
export function emitYaml(model) {
  return emitBlock(buildDocument(model), 0) + "\n";
}

// ── Round-trip verification ────────────────────────────────────────────────

/** Converts the ordered tree into plain data, for comparison after a round trip. */
function toPlain(value) {
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [k, toPlain(v)]));
  if (Array.isArray(value)) return value.map(toPlain);
  return value;
}

/**
 * Throws unless the emitted YAML parses back to the tree it was built from.
 *
 * The emitter is hand-written so it can control flow-versus-block style, which
 * is worth real tokens — but a hand-rolled quoter can silently change what a
 * document *says*, and a measurement of a document that says the wrong thing is
 * worse than no measurement. This check makes that failure loud.
 */
export function assertRoundTrips(model, yamlText) {
  const expected = toPlain(buildDocument(model));
  let actual;
  try {
    actual = parseYaml(yamlText);
  } catch (error) {
    throw new Error(`static-compactness: emitted YAML does not parse — ${error.message}`, {
      cause: error,
    });
  }
  const expectedJson = JSON.stringify(expected);
  const actualJson = JSON.stringify(actual);
  if (expectedJson !== actualJson) {
    throw new Error(
      "static-compactness: emitted YAML did not round-trip to the tree it was built " +
        `from, so the YAML arm no longer says what the .stm says.\n  expected: ${expectedJson.slice(0, 400)}\n  actual:   ${actualJson.slice(0, 400)}`,
    );
  }
}

/**
 * Keys whose values are structural discriminators rather than authored facts,
 * and so are encoded by the *shape* of the YAML rather than as a literal value.
 *
 *   - `kind`     — `computed` is the absence of a source key; `each`/`flatten`
 *                  become the key the source rides on.
 *   - `type` on a step — always the string `pipe_text`; the parser's node name.
 *   - `transform`— the raw transform text, emitted decomposed into `rule`,
 *                  `steps` and `values`. Emitting both would charge twice.
 *   - `parentType` — which block kind a comment hangs off, visible from where
 *                  the `"!"` key lands.
 */
const STRUCTURAL_KEYS = new Set(["kind", "transform", "parentType"]);

/** Collects every key and scalar value reachable in a parsed YAML tree. */
function reachableStrings(node, into = new Set()) {
  if (typeof node === "string") into.add(node);
  else if (Array.isArray(node)) node.forEach((child) => reachableStrings(child, into));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      into.add(key);
      reachableStrings(value, into);
    }
  }
  return into;
}

/**
 * Walks the projection, yielding `[key, parentKey, value]` for every string
 * leaf. The parent key is needed because the same key name means different
 * things in different places — a `text` under `steps` is raw transform source
 * that gets emitted decomposed, while a `text` under `notes` is authored prose
 * that must survive verbatim.
 */
function projectedStrings(node, path = [], out = []) {
  if (typeof node === "string") out.push([path.at(-1), path.at(-2), node]);
  else if (Array.isArray(node)) node.forEach((child) => projectedStrings(child, path, out));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) projectedStrings(value, [...path, key], out);
  }
  return out;
}

/**
 * True for a leaf that is part of a pipe step's raw representation. A step
 * carries both the parser's node `type` and its verbatim `text`; the renderer
 * emits the *decomposition* of that text into `rule`, `steps` and `values`, so
 * requiring the raw form as well would demand the arm state one fact twice.
 */
function isRawStepFragment(key, parentKey) {
  return parentKey === "steps" && (key === "type" || key === "text");
}

/**
 * Throws if any authored fact in `model` is absent from `yamlText`.
 *
 * {@link assertRoundTrips} proves the YAML says what the *renderer built*;
 * this proves the renderer built everything the *projection found*. The two
 * catch opposite failures, and this is the one that matters for the published
 * number: a fact the renderer forgets makes the YAML arm smaller and Satsuma's
 * advantage larger, which is precisely the bias this measurement must not have.
 *
 * Every gap this found when first written — dropped namespaces, metrics
 * rendered twice and losing their metadata, several `//!` comments on one
 * schema colliding on a single key, `each`/`flatten` becoming plain arrows —
 * moved the measured ratio in Satsuma's favour.
 */
export function assertFactsPreserved(model, yamlText) {
  const present = reachableStrings(parseYaml(yamlText));
  const missing = [];
  for (const [key, parentKey, value] of projectedStrings(model)) {
    if (value.length === 0 || STRUCTURAL_KEYS.has(key)) continue;
    if (isRawStepFragment(key, parentKey)) continue;
    // A list field's type is carried as the whole expression, `list_of STRING`.
    if (key === "type" && (present.has(value) || present.has(`list_of ${value}`))) continue;
    if (!present.has(value)) missing.push(`${key}: ${JSON.stringify(value.slice(0, 60))}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `static-compactness: ${missing.length} authored fact(s) are missing from the YAML ` +
        `arm, which would make it artificially small and overstate Satsuma's advantage:\n  ` +
        missing.slice(0, 8).join("\n  "),
    );
  }
}

// ── Arm entry points ───────────────────────────────────────────────────────

/**
 * Renders arm Y: every document in one spec, as YAML.
 *
 * @param documents - `{ path, model }` records, one per `.stm` file in the spec
 */
export function renderYaml(documents) {
  return documents
    .map(({ model }) => {
      const text = emitYaml(model);
      assertRoundTrips(model, text);
      assertFactsPreserved(model, text);
      return text;
    })
    .join("\n");
}

/**
 * Renders arm J: the same tree, lowered to JSON.
 *
 * Two-space indentation is used rather than minified output because the arm
 * must be an artifact a team would actually maintain and review. Print style
 * alone moves this arm by about 50% with no change of information, which is the
 * clearest evidence in the whole exercise that serialisation choice — not
 * format — decides the answer if you let it. The choice is stated in the design
 * document and its cost is reported there.
 */
export function renderJson(documents) {
  return documents
    .map(({ model }) => JSON.stringify(toPlain(buildDocument(model)), null, 2))
    .join("\n");
}
