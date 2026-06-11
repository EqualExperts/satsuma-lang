const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const {
  createWorkspaceIndex,
  indexFile,
  removeFile,
  resolveDefinition,
  findReferences,
  allBlockNames,
  getFields,
  getImportReachableUris,
  createScopedIndex,
} = require("../dist/workspace-index");

before(async () => { await initTestParser(); });

/** Build an index from a map of { uri: source }. */
function buildIndex(files) {
  const idx = createWorkspaceIndex();
  for (const [uri, source] of Object.entries(files)) {
    indexFile(idx, uri, parse(source));
  }
  return idx;
}

describe("createWorkspaceIndex", () => {
  it("returns an empty index", () => {
    const idx = createWorkspaceIndex();
    assert.equal(idx.definitions.size, 0);
    assert.equal(idx.references.size, 0);
    assert.equal(idx.imports.size, 0);
    assert.equal(idx.indexedFiles.size, 0);
  });
});

describe("indexFile", () => {
  it("indexes schema definitions", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID (pk)\n  name VARCHAR\n}",
    });
    const defs = idx.definitions.get("customers");
    assert.ok(defs);
    assert.equal(defs.length, 1);
    assert.equal(defs[0].kind, "schema");
    assert.equal(defs[0].namespace, null);
    assert.equal(defs[0].uri, "file:///a.stm");
  });

  it("indexes fragment definitions", () => {
    const idx = buildIndex({
      "file:///a.stm": "fragment `audit fields` {\n  created_at TIMESTAMP\n  updated_at TIMESTAMP\n}",
    });
    const defs = idx.definitions.get("audit fields");
    assert.ok(defs);
    assert.equal(defs[0].kind, "fragment");
  });

  it("indexes transform definitions", () => {
    const idx = buildIndex({
      "file:///a.stm": "transform `clean email` {\n  trim | lowercase\n}",
    });
    const defs = idx.definitions.get("clean email");
    assert.ok(defs);
    assert.equal(defs[0].kind, "transform");
  });

  it("indexes mapping definitions", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping \`customer migration\` {
  source { customers }
  target { dim_customers }
  id -> id
}`,
    });
    const defs = idx.definitions.get("customer migration");
    assert.ok(defs);
    assert.equal(defs[0].kind, "mapping");
  });

  it("indexes metric definitions", () => {
    // Metrics are now schema blocks decorated with (metric, ...) metadata.
    const idx = buildIndex({
      "file:///a.stm": `schema monthly_revenue (\n  metric,\n  metric_name "MRR",\n  source orders,\n) {\n  amount DECIMAL\n}`,
    });
    const defs = idx.definitions.get("monthly_revenue");
    assert.ok(defs);
    assert.equal(defs[0].kind, "metric");
  });

  it("indexes namespace definitions with qualified children", () => {
    const idx = buildIndex({
      "file:///a.stm": `namespace warehouse {
  schema hub_store {
    store_id UUID (pk)
  }
  fragment common_fields {
    updated_at TIMESTAMP
  }
}`,
    });
    // Namespace itself
    const nsDefs = idx.definitions.get("warehouse");
    assert.ok(nsDefs);
    assert.equal(nsDefs[0].kind, "namespace");

    // Qualified schema
    const schemaDefs = idx.definitions.get("warehouse::hub_store");
    assert.ok(schemaDefs);
    assert.equal(schemaDefs[0].kind, "schema");
    assert.equal(schemaDefs[0].namespace, "warehouse");

    // Qualified fragment
    const fragDefs = idx.definitions.get("warehouse::common_fields");
    assert.ok(fragDefs);
    assert.equal(fragDefs[0].kind, "fragment");
  });

  it("extracts fields for schema blocks", () => {
    const idx = buildIndex({
      "file:///a.stm": `schema customers {
  id UUID (pk)
  name VARCHAR(200)
  address record {
    street VARCHAR
    city VARCHAR
  }
}`,
    });
    const defs = idx.definitions.get("customers");
    assert.ok(defs);
    const fields = defs[0].fields;
    assert.equal(fields.length, 3);
    assert.equal(fields[0].name, "id");
    assert.equal(fields[0].type, "UUID");
    assert.equal(fields[1].name, "name");
    assert.equal(fields[2].name, "address");
    assert.equal(fields[2].type, "record");
    assert.equal(fields[2].children.length, 2);
    assert.equal(fields[2].children[0].name, "street");
  });

  it("extracts fields with list_of types", () => {
    const idx = buildIndex({
      "file:///a.stm": `schema orders {
  id UUID (pk)
  tags list_of VARCHAR
  items list_of record {
    sku VARCHAR
    qty INT
  }
}`,
    });
    const fields = idx.definitions.get("orders")[0].fields;
    assert.equal(fields.length, 3);
    assert.equal(fields[1].name, "tags");
    assert.equal(fields[1].type, "list_of VARCHAR");
    assert.equal(fields[2].name, "items");
    assert.equal(fields[2].type, "list_of record");
    assert.equal(fields[2].children.length, 2);
  });

  it("indexes source/target references from mappings", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping \`migrate\` {
  source { customers }
  target { dim_customers }
  id -> id
}`,
    });
    const srcRefs = idx.references.get("customers");
    assert.ok(srcRefs);
    assert.equal(srcRefs.length, 1);
    assert.equal(srcRefs[0].context, "source");

    const tgtRefs = idx.references.get("dim_customers");
    assert.ok(tgtRefs);
    assert.equal(tgtRefs[0].context, "target");
  });

  it("indexes backtick source references", () => {
    const idx = buildIndex({
      "file:///a.stm": "mapping `test` {\n  source { `raw_customers` }\n  target { dim_customers }\n  id -> id\n}",
    });
    const refs = idx.references.get("raw_customers");
    assert.ok(refs);
    assert.equal(refs[0].context, "source");
  });

  it("indexes qualified name source references", () => {
    const idx = buildIndex({
      "file:///a.stm": "mapping `test` {\n  source { crm::customers }\n  target { dim_customers }\n  id -> id\n}",
    });
    const refs = idx.references.get("crm::customers");
    assert.ok(refs);
    assert.equal(refs[0].context, "source");
  });

  it("does not index quoted join descriptions as source references", () => {
    const idx = buildIndex({
      "file:///a.stm": `schema a { id INT }
schema b { id INT }
schema t { id INT }
mapping \`test\` {
  source {
    a
    b
    "Join on a.id = b.id"
  }
  target { t }
  a.id -> id
}`,
    });
    assert.equal(idx.references.get("Join on a.id = b.id"), undefined);
    const srcRefs = idx.references.get("a") ?? [];
    assert.equal(srcRefs.filter((ref) => ref.context === "source").length, 1);
  });

  it("indexes fragment spread references from schemas", () => {
    const idx = buildIndex({
      "file:///a.stm": `schema customers {
  id UUID (pk)
  ...audit_fields
}`,
    });
    const refs = idx.references.get("audit_fields");
    assert.ok(refs);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].context, "spread");
  });

  it("indexes import declarations", () => {
    const idx = buildIndex({
      "file:///a.stm": 'import { customers, crm::orders } from "lib/common.stm"',
    });
    const imports = idx.imports.get("file:///a.stm");
    assert.ok(imports);
    assert.equal(imports.length, 1);
    assert.deepEqual(imports[0].names, ["customers", "crm::orders"]);
    assert.equal(imports[0].pathText, "lib/common.stm");

    // Import names registered as references
    const custRefs = idx.references.get("customers");
    assert.ok(custRefs);
    assert.equal(custRefs[0].context, "import");

    const orderRefs = idx.references.get("crm::orders");
    assert.ok(orderRefs);
    assert.equal(orderRefs[0].context, "import");
  });

  it("tracks indexed files", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema a { id UUID }",
      "file:///b.stm": "schema b { id UUID }",
    });
    assert.equal(idx.indexedFiles.size, 2);
    assert.ok(idx.indexedFiles.has("file:///a.stm"));
    assert.ok(idx.indexedFiles.has("file:///b.stm"));
  });
});

describe("removeFile", () => {
  it("removes definitions for a file", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
      "file:///b.stm": "schema orders { id UUID }",
    });
    assert.ok(idx.definitions.get("customers"));
    removeFile(idx, "file:///a.stm");
    assert.equal(idx.definitions.get("customers"), undefined);
    assert.ok(idx.definitions.get("orders"));
  });

  it("removes references for a file", () => {
    const idx = buildIndex({
      "file:///a.stm": "mapping `test` {\n  source { customers }\n  target { dim }\n  id -> id\n}",
    });
    assert.ok(idx.references.get("customers"));
    removeFile(idx, "file:///a.stm");
    assert.equal(idx.references.get("customers"), undefined);
  });

  it("removes from indexedFiles set", () => {
    const idx = buildIndex({ "file:///a.stm": "schema a { id UUID }" });
    assert.ok(idx.indexedFiles.has("file:///a.stm"));
    removeFile(idx, "file:///a.stm");
    assert.ok(!idx.indexedFiles.has("file:///a.stm"));
  });
});

describe("resolveDefinition", () => {
  it("resolves bare name in global scope", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
    });
    const defs = resolveDefinition(idx, "customers", null);
    assert.equal(defs.length, 1);
    assert.equal(defs[0].kind, "schema");
  });

  it("resolves qualified name directly", () => {
    const idx = buildIndex({
      "file:///a.stm": "namespace crm {\n  schema customers { id UUID }\n}",
    });
    const defs = resolveDefinition(idx, "crm::customers", null);
    assert.equal(defs.length, 1);
    assert.equal(defs[0].kind, "schema");
  });

  it("prefers namespace-scoped over global when in namespace context", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
      "file:///b.stm": "namespace crm {\n  schema customers { id UUID }\n}",
    });
    const defs = resolveDefinition(idx, "customers", "crm");
    assert.equal(defs.length, 1);
    assert.equal(defs[0].namespace, "crm");
  });

  it("falls back to global when namespace-scoped not found", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
    });
    const defs = resolveDefinition(idx, "customers", "crm");
    assert.equal(defs.length, 1);
    assert.equal(defs[0].namespace, null);
  });

  it("returns empty for unknown name", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
    });
    const defs = resolveDefinition(idx, "nonexistent", null);
    assert.equal(defs.length, 0);
  });
});

describe("findReferences", () => {
  it("finds direct references", () => {
    const idx = buildIndex({
      "file:///a.stm": "mapping `test` {\n  source { customers }\n  target { dim }\n  id -> id\n}",
    });
    const refs = findReferences(idx, "customers");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].context, "source");
  });

  it("finds references across multiple files", () => {
    const idx = buildIndex({
      "file:///a.stm": "mapping `a` {\n  source { customers }\n  target { dim }\n  id -> id\n}",
      "file:///b.stm": "mapping `b` {\n  source { customers }\n  target { fact }\n  id -> id\n}",
    });
    const refs = findReferences(idx, "customers");
    assert.equal(refs.length, 2);
  });

  it("returns empty for unreferenced name", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
    });
    const refs = findReferences(idx, "customers");
    assert.equal(refs.length, 0);
  });
});

describe("allBlockNames", () => {
  it("returns all block names", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }\nfragment audit { ts TIMESTAMP }",
    });
    const names = allBlockNames(idx);
    assert.ok(names.length >= 2);
    assert.ok(names.some((n) => n.name === "customers"));
    assert.ok(names.some((n) => n.name === "audit"));
  });

  it("filters by kind", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }\nfragment audit { ts TIMESTAMP }",
    });
    const schemas = allBlockNames(idx, "schema");
    assert.equal(schemas.length, 1);
    assert.equal(schemas[0].name, "customers");
  });
});

describe("getFields", () => {
  it("returns fields for a schema", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID (pk)\n  name VARCHAR\n}",
    });
    const fields = getFields(idx, "customers", null);
    assert.equal(fields.length, 2);
    assert.equal(fields[0].name, "id");
    assert.equal(fields[1].name, "name");
  });

  it("returns nested fields", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers {\n  address record {\n    street VARCHAR\n    city VARCHAR\n  }\n}",
    });
    const fields = getFields(idx, "customers", null);
    assert.equal(fields[0].name, "address");
    assert.equal(fields[0].children.length, 2);
  });

  it("resolves namespaced schema fields", () => {
    const idx = buildIndex({
      "file:///a.stm": "namespace crm {\n  schema customers {\n    id UUID\n  }\n}",
    });
    const fields = getFields(idx, "customers", "crm");
    assert.equal(fields.length, 1);
    assert.equal(fields[0].name, "id");
  });

  it("returns empty for unknown schema", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
    });
    const fields = getFields(idx, "nonexistent", null);
    assert.equal(fields.length, 0);
  });
});

describe("arrow field path indexing", () => {
  it("indexes src_path field names from map_arrow", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping test {
  source { customers }
  target { dim_customers }
  email -> contact_email
}`,
    });
    const srcRefs = idx.references.get("email");
    assert.ok(srcRefs);
    const arrowRefs = srcRefs.filter((r) => r.context === "arrow");
    assert.ok(arrowRefs.length >= 1, "expected at least one arrow ref for email");
  });

  it("indexes tgt_path field names from map_arrow", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping test {
  source { customers }
  target { dim_customers }
  email -> contact_email
}`,
    });
    const tgtRefs = idx.references.get("contact_email");
    assert.ok(tgtRefs);
    const arrowRefs = tgtRefs.filter((r) => r.context === "arrow");
    assert.ok(arrowRefs.length >= 1, "expected at least one arrow ref for contact_email");
  });

  it("indexes field names from computed_arrow (no source)", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping test {
  source { customers }
  target { dim_customers }
  -> display_name { "Concat first + last" }
}`,
    });
    const refs = idx.references.get("display_name");
    assert.ok(refs);
    const arrowRefs = refs.filter((r) => r.context === "arrow");
    assert.ok(arrowRefs.length >= 1, "expected arrow ref for display_name");
  });

  it("indexes field names from nested_arrow children", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping test {
  source { orders }
  target { dim_orders }
  items -> line_items {
    sku -> product_sku
    qty -> quantity
  }
}`,
    });
    const skuRefs = (idx.references.get("sku") || []).filter((r) => r.context === "arrow");
    assert.ok(skuRefs.length >= 1, "expected arrow ref for sku");
    const qtyRefs = (idx.references.get("qty") || []).filter((r) => r.context === "arrow");
    assert.ok(qtyRefs.length >= 1, "expected arrow ref for qty");
    // Also the outer arrow fields
    const itemsRefs = (idx.references.get("items") || []).filter((r) => r.context === "arrow");
    assert.ok(itemsRefs.length >= 1, "expected arrow ref for items");
  });

  it("indexes field names from each_block", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping test {
  source { orders }
  target { dim_orders }
  each items -> line_items {
    sku -> product_sku
  }
}`,
    });
    const itemsRefs = (idx.references.get("items") || []).filter((r) => r.context === "arrow");
    assert.ok(itemsRefs.length >= 1, "expected arrow ref for items in each_block");
    const skuRefs = (idx.references.get("sku") || []).filter((r) => r.context === "arrow");
    assert.ok(skuRefs.length >= 1, "expected arrow ref for sku in each_block");
  });

  it("indexes field names from flatten_block", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping test {
  source { orders }
  target { flat_items }
  flatten items -> line_items {
    sku -> product_sku
  }
}`,
    });
    const itemsRefs = (idx.references.get("items") || []).filter((r) => r.context === "arrow");
    assert.ok(itemsRefs.length >= 1, "expected arrow ref for items in flatten_block");
  });
});

describe("reference range precision (sl-xf3f)", () => {
  // Rename replaces a reference's stored range verbatim, so every range must
  // cover exactly the text keyed under the reference name — a wider range
  // makes rename destroy neighbouring text. These tests pin the exact spans.

  /** Slice the source text covered by a single-line range. */
  function textAt(source, range) {
    assert.equal(range.start.line, range.end.line, "expected single-line range");
    const line = source.split("\n")[range.start.line];
    return line.slice(range.start.character, range.end.character);
  }

  it("bare first-segment reference covers only the first path segment, not the dotted tail", () => {
    const source = `mapping test {
  source { customers }
  target { dim }
  address.street -> s
}`;
    const idx = buildIndex({ "file:///a.stm": source });
    const refs = (idx.references.get("address") || []).filter((r) => r.context === "arrow");
    assert.equal(refs.length, 1);
    // A whole-path range here would turn "address.street" into "<newName>"
    // on rename, silently deleting ".street".
    assert.equal(textAt(source, refs[0].range), "address");
  });

  it("full-path reference covers the dotted path without the ns:: prefix", () => {
    const source = `mapping test {
  source { customers }
  target { dim }
  crm::address.street -> s
}`;
    const idx = buildIndex({ "file:///a.stm": source });
    // First-segment entry skips the namespace qualifier entirely
    const bareRefs = (idx.references.get("address") || []).filter((r) => r.context === "arrow");
    assert.equal(bareRefs.length, 1);
    assert.equal(textAt(source, bareRefs[0].range), "address");
    // Full-path entry is keyed without the ns:: prefix, so its range must
    // exclude the prefix too.
    const pathRefs = (idx.references.get("address.street") || []).filter((r) => r.context === "arrow");
    assert.equal(pathRefs.length, 1);
    assert.equal(textAt(source, pathRefs[0].range), "address.street");
  });

  it("relative-path reference excludes the leading dot from the stored range", () => {
    const source = `mapping test {
  source { orders }
  target { dim }
  items -> line_items {
    .sku -> product_sku
  }
}`;
    const idx = buildIndex({ "file:///a.stm": source });
    const refs = (idx.references.get("sku") || []).filter((r) => r.context === "arrow");
    assert.equal(refs.length, 1);
    // The dot is path syntax, not part of the field name — a range including
    // it would leave "<newName>" glued to the arrow with no dot after rename.
    assert.equal(textAt(source, refs[0].range), "sku");
  });

  it("NL @ref reference range excludes the @ sigil", () => {
    const source = `mapping test {
  source { customers }
  target { dim }
  -> name { "see @customers here" }
}`;
    const idx = buildIndex({ "file:///a.stm": source });
    const refs = (idx.references.get("customers") || []).filter((r) => r.context === "arrow");
    assert.equal(refs.length, 1);
    // A range including the @ deletes the sigil on rename, breaking the ref.
    assert.equal(textAt(source, refs[0].range), "customers");
  });

  it("source ref range covers only the name, not its metadata block", () => {
    // sl-kf1r: source_ref = name + optional metadata_block. A range spanning
    // the whole source_ref deletes the metadata on rename.
    const source = `mapping test {
  source { customers (note "refreshed daily") }
  target { dim }
  id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": source });
    const refs = (idx.references.get("customers") || []).filter((r) => r.context === "source");
    assert.equal(refs.length, 1);
    assert.equal(textAt(source, refs[0].range), "customers");
  });

  it("fragment spread range covers only the label, not the ... sigil", () => {
    // sl-kf1r: fragment_spread = "..." + spread_label. A range including the
    // sigil deletes it on rename, leaving an invalid declaration. Covers both
    // indexing sites: schema bodies and mapping arrow bodies.
    const source = `fragment audit_fields {
  ts TIMESTAMP
}
schema customers {
  id UUID
  ...audit_fields
}
mapping test {
  source { customers }
  target { dim }
  id -> id { ...audit_fields }
}`;
    const idx = buildIndex({ "file:///a.stm": source });
    const refs = (idx.references.get("audit_fields") || []).filter((r) => r.context === "spread");
    assert.equal(refs.length, 2);
    for (const ref of refs) {
      assert.equal(textAt(source, ref.range), "audit_fields");
    }
  });
});

describe("NL string reference indexing", () => {
  it("indexes @refs in NL strings", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping test {
  source { customers }
  target { dim }
  -> display_name { "Use @FIRST_NM and @LAST_NM" }
}`,
    });
    const firstRefs = (idx.references.get("FIRST_NM") || []).filter((r) => r.context === "arrow");
    assert.ok(firstRefs.length >= 1, "expected arrow ref for @FIRST_NM");
    const lastRefs = (idx.references.get("LAST_NM") || []).filter((r) => r.context === "arrow");
    assert.ok(lastRefs.length >= 1, "expected arrow ref for @LAST_NM");
  });

  it("indexes @refs with backtick-delimited names", () => {
    const idx = buildIndex({
      "file:///a.stm": "mapping test {\n  source { customers }\n  target { dim }\n  -> name { \"Use @`first name` here\" }\n}",
    });
    const refs = (idx.references.get("first name") || []).filter((r) => r.context === "arrow");
    assert.ok(refs.length >= 1, "expected arrow ref for @`first name`");
  });

  it("indexes @refs in multiline NL strings", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping test {
  source { customers }
  target { dim }
  -> address_id {
    """
    Create a record using @ADDR_LINE_1 and @CITY.
    Normalize @STATE_PROV to 2-char code.
    """
  }
}`,
    });
    const addrRefs = (idx.references.get("ADDR_LINE_1") || []).filter((r) => r.context === "arrow");
    assert.ok(addrRefs.length >= 1, "expected arrow ref for @ADDR_LINE_1");
    const stateRefs = (idx.references.get("STATE_PROV") || []).filter((r) => r.context === "arrow");
    assert.ok(stateRefs.length >= 1, "expected arrow ref for @STATE_PROV");
  });

});

describe("transform spread indexing in arrows", () => {
  it("indexes transform spread references in arrows", () => {
    const idx = buildIndex({
      "file:///a.stm": "transform `clean email` {\n  trim | lowercase\n}\nmapping test {\n  source { customers }\n  target { dim }\n  email -> email { ...`clean email` }\n}",
    });
    const refs = idx.references.get("clean email");
    assert.ok(refs);
    const spreadRefs = refs.filter((r) => r.context === "spread");
    assert.ok(spreadRefs.length >= 1, "expected spread ref for transform in arrow");
  });
});

describe("re-indexing", () => {
  it("replaces old entries when re-indexing a file", () => {
    const idx = createWorkspaceIndex();
    indexFile(idx, "file:///a.stm", parse("schema old_name { id UUID }"));
    assert.ok(idx.definitions.get("old_name"));

    // Re-index with different content
    indexFile(idx, "file:///a.stm", parse("schema new_name { id UUID }"));
    assert.equal(idx.definitions.get("old_name"), undefined);
    assert.ok(idx.definitions.get("new_name"));
  });
});

// ---------------------------------------------------------------------------
// getImportReachableUris
// ---------------------------------------------------------------------------

describe("getImportReachableUris", () => {
  it("returns only the entry URI when the file has no imports", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
      "file:///b.stm": "schema orders { id UUID }",
    });
    const reachable = getImportReachableUris("file:///a.stm", idx);
    assert.equal(reachable.size, 1);
    assert.ok(reachable.has("file:///a.stm"));
    assert.ok(!reachable.has("file:///b.stm"));
  });

  it("follows a direct import to include the imported file", () => {
    const idx = buildIndex({
      "file:///a.stm": `import { customers } from "b.stm"\nschema orders { id UUID }`,
      "file:///b.stm": "schema customers { id UUID }",
    });
    const reachable = getImportReachableUris("file:///a.stm", idx);
    assert.equal(reachable.size, 2);
    assert.ok(reachable.has("file:///a.stm"));
    assert.ok(reachable.has("file:///b.stm"));
  });

  it("follows transitive imports", () => {
    const idx = buildIndex({
      "file:///a.stm": `import { customers } from "b.stm"`,
      "file:///b.stm": `import { addresses } from "c.stm"\nschema customers { id UUID }`,
      "file:///c.stm": "schema addresses { street VARCHAR }",
    });
    const reachable = getImportReachableUris("file:///a.stm", idx);
    assert.equal(reachable.size, 3);
    assert.ok(reachable.has("file:///a.stm"));
    assert.ok(reachable.has("file:///b.stm"));
    assert.ok(reachable.has("file:///c.stm"));
  });

  it("handles import cycles without hanging", () => {
    const idx = buildIndex({
      "file:///a.stm": `import { b_thing } from "b.stm"`,
      "file:///b.stm": `import { a_thing } from "a.stm"\nschema b_thing { id UUID }`,
    });
    const reachable = getImportReachableUris("file:///a.stm", idx);
    assert.equal(reachable.size, 2);
    assert.ok(reachable.has("file:///a.stm"));
    assert.ok(reachable.has("file:///b.stm"));
  });

  it("does not include files that exist in the index but are not imported", () => {
    const idx = buildIndex({
      "file:///a.stm": `import { customers } from "b.stm"`,
      "file:///b.stm": "schema customers { id UUID }",
      "file:///c.stm": "schema invoices { id UUID }",
    });
    const reachable = getImportReachableUris("file:///a.stm", idx);
    assert.ok(!reachable.has("file:///c.stm"));
  });

  it("silently skips imports to files not present in the index", () => {
    const idx = buildIndex({
      "file:///a.stm": `import { missing } from "does-not-exist.stm"`,
    });
    // Should not throw, just return the entry file
    const reachable = getImportReachableUris("file:///a.stm", idx);
    assert.equal(reachable.size, 1);
    assert.ok(reachable.has("file:///a.stm"));
  });

  it("resolves relative paths with subdirectory components", () => {
    const idx = buildIndex({
      "file:///project/pipelines/a.stm": `import { customers } from "../lib/common.stm"`,
      "file:///project/lib/common.stm": "schema customers { id UUID }",
    });
    const reachable = getImportReachableUris("file:///project/pipelines/a.stm", idx);
    assert.equal(reachable.size, 2);
    assert.ok(reachable.has("file:///project/pipelines/a.stm"));
    assert.ok(reachable.has("file:///project/lib/common.stm"));
  });
});

// ---------------------------------------------------------------------------
// createScopedIndex
// ---------------------------------------------------------------------------

describe("createScopedIndex", () => {
  it("scoped index contains only definitions from reachable files", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
      "file:///b.stm": "schema orders { id UUID }",
    });
    const scoped = createScopedIndex(idx, new Set(["file:///a.stm"]));
    assert.ok(scoped.definitions.has("customers"));
    assert.ok(!scoped.definitions.has("orders"));
  });

  it("scoped index contains only references from reachable files", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping m { source { customers } target { dim_customers } id -> id }`,
      "file:///b.stm": `mapping n { source { invoices } target { dim_invoices } id -> id }`,
    });
    const scoped = createScopedIndex(idx, new Set(["file:///a.stm"]));
    const custRefs = scoped.references.get("customers");
    assert.ok(custRefs && custRefs.length > 0);
    const invRefs = scoped.references.get("invoices");
    assert.ok(!invRefs || invRefs.length === 0);
  });

  it("scoped index correctly tracks indexedFiles", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
      "file:///b.stm": "schema orders { id UUID }",
    });
    const scoped = createScopedIndex(idx, new Set(["file:///a.stm"]));
    assert.ok(scoped.indexedFiles.has("file:///a.stm"));
    assert.ok(!scoped.indexedFiles.has("file:///b.stm"));
  });

  it("scoped index with all files equals the original index definitions", () => {
    const idx = buildIndex({
      "file:///a.stm": "schema customers { id UUID }",
      "file:///b.stm": "schema orders { id UUID }",
    });
    const allUris = new Set(["file:///a.stm", "file:///b.stm"]);
    const scoped = createScopedIndex(idx, allUris);
    assert.ok(scoped.definitions.has("customers"));
    assert.ok(scoped.definitions.has("orders"));
  });

  it("completions from a scoped index exclude symbols from non-imported files", () => {
    // Simulates: a.stm imports b.stm but not c.stm.
    // Completions for a.stm should see customers and orders, but not invoices.
    const idx = buildIndex({
      "file:///a.stm": `import { customers } from "b.stm"\nschema orders { id UUID }`,
      "file:///b.stm": "schema customers { id UUID }",
      "file:///c.stm": "schema invoices { id UUID }",
    });
    const reachable = getImportReachableUris("file:///a.stm", idx);
    const scoped = createScopedIndex(idx, reachable);
    assert.ok(scoped.definitions.has("customers"));
    assert.ok(scoped.definitions.has("orders"));
    assert.ok(!scoped.definitions.has("invoices"));
  });
});
