Excellent question — we should absolutely check this before investing further. Let me do a thorough survey.Now I have a comprehensive picture. Here's my honest assessment:

## The honest answer: Satsuma is NOT redundant, but it should learn from several existing languages

There is no existing standard that does what Satsuma is trying to do. However, there are several languages that overlap with *parts* of Satsuma's scope, and understanding exactly where they overlap (and don't) is critical for positioning this project correctly.

### The competitive landscape, ranked by relevance

**1. FHIR Mapping Language (FML) — The closest thing that exists**

FML is a QVT-based transformation language. Conceptually, it's similar to XSLT. It has a concrete text syntax with `source -> target` rules, nested mapping groups, conditional logic (`where` clauses), concept map translation, and variable binding. The mapping language describes how one set of Directed Acyclic Graphs is transformed to another set of directed acyclic graphs.

FML is genuinely impressive and covers much of what we're building. But here's why it doesn't kill Satsuma:

- **It's healthcare-coupled.** FML is deeply embedded in the FHIR specification and assumes FHIR StructureDefinitions as the type system. Approaches with high expressivity, such as CQL, FML, and Whistle, require significant implementation effort and specialised knowledge. Using it for a database-to-database migration or an EDI-to-JSON transformation would be fighting the tool.
- **It's an execution language, not a specification format.** FML is designed to *run* — it transforms instances at runtime. Satsuma is designed to *document* — it describes the intent so humans review it, AI generates code from it, and linters validate it. These are fundamentally different goals.
- **It separates schema from mapping but not as cleanly.** FML schemas live in StructureDefinition resources (separate JSON/XML files), and the mapping rules reference them. Satsuma co-locates schemas and mappings in a single readable file.
- **Readability for non-technical reviewers.** FML's syntax is developer-readable, not BA-readable. Compare FML's `src.aa as s_aa -> tgt.aa as t_aa then { s_aa.ab as ab -> t_aa.ab = ab; }` to Satsuma's `aa.ab -> aa.ab`. Satsuma is deliberately optimized for non-developers to review.

**Verdict:** FML is the strongest prior art. We should study it carefully and potentially cite it as inspiration. But its healthcare coupling and execution-focus make it a different tool for a different audience.

**2. JSONata — Elegant but wrong layer**

JSONata is a JSON query and transformation language inspired by XPath 3.1, invented by Andrew Coleman at IBM in 2016. It's beautiful, concise, and powerful for runtime JSON transformations. But it's a *programming language* for transforming data, not a *specification language* for documenting mappings. There's no concept of source/target schema declarations, no notes, no PII annotations, no data quality documentation. It would be like comparing SQL to an ER diagram — both describe data, but for completely different purposes.

**3. Jolt — Structural but limited**

Jolt focuses on transforming the structure of JSON data, not manipulating specific values. The idea is to use Jolt to get most of the structure right, then write code to fix values. It's JSON-spec-in, JSON-out — a runtime tool, not a mapping specification. No schema declarations, no documentation support, no multi-format support.

**4. XSLT — Mature but hostile**

XSLT is the granddaddy of transformation languages, extremely powerful, with decades of tooling. But it's XML-only, notoriously verbose, and famously difficult for humans to read. Nobody has ever looked at an XSLT stylesheet and said "this is a great mapping document I can share with my business analyst."

**5. Whistle (Google) — Powerful but niche**

Whistle is a general-purpose data transformation language written by Google for use within the healthcare domain, providing powerful data path expressions and various merge modes. Like FML, it's healthcare-adjacent and execution-focused rather than specification-focused.

**6. dbt — Great for SQL, wrong abstraction**

dbt describes SQL transformations beautifully but only works within the SQL world. It has no concept of EDI, XML, CSV, or API schemas. It also describes *implementation* (the actual SQL) rather than *intent* (the mapping specification that precedes implementation).

**7. ATL / QVT — Academic, not practical**

These are model-driven engineering standards from OMG. They're theoretically sound and very powerful, but they never achieved real-world adoption outside academia. No business analyst has ever written or read an ATL transformation.

### What doesn't exist (and this is the gap Satsuma fills)

Here's the key insight from all this research: there are plenty of **transformation execution languages** (FML, JSONata, Jolt, XSLT, Whistle, jq, dbt) and plenty of **informal specification formats** (Excel spreadsheets, Confluence wikis, Word docs). But there is **nothing** that sits in the middle — a formal, parseable, human-readable specification language for mapping intent that is:

- Format-agnostic (not just JSON, not just XML, not just SQL)
- Separate from execution (describes *what*, not *how to run it*)
- BA-readable (not just developer-readable)
- Readable and writable by AI tools as well as people
- Self-documenting (notes, PII tags, quality rules built in)
- Versionable (lives in Git, not SharePoint)

Source to target mapping involves understanding the domain, naming and processes in old and new systems, defining data transformation rules or logic, and establishing what mapping objects you have. Today, all of this lives in Excel or Confluence. That's the actual competitor — not FML, not JSONata, not XSLT.

### What Satsuma should steal from the competition

| From | Steal |
|---|---|
| **FML** | The `where` clause on mapping rules for conditional logic. Satsuma covers this with `map { }` blocks and conditional entries. FML's `translate()` using ConceptMaps remains strong inspiration for Satsuma's future terminology translation support. |
| **FML** | The `group` concept — reusable mapping rule groups. We have fragments for schemas and named transforms for pipelines. |
| **JSONata** | The elegance of path expressions. Our `.field` relative paths in nested mappings are similar in spirit. |
| **Jolt** | The separation of structural transforms (shift, default, remove, sort, cardinality) as distinct operations. |
| **dbt** | The idea of tests alongside transformations. Future "test fixtures" support should be prioritized. |
| **XSLT** | Nothing about the syntax, but the lesson that a mature transformation language needs a standard function library. Our vocabulary token conventions are a good start. |

### Recommendation

**This project is not redundant.** The gap is real, the need is documented across every industry survey we've seen, and no existing standard fills it. The closest competitor (FML) validates the *approach* — declarative text-based mapping rules are the right idea — but serves a different audience with different constraints.

What we should do:

1. **Acknowledge FML explicitly in the spec** as prior art and inspiration, particularly for conditional mapping rules and concept translation
2. **Consider adopting FML's `group` concept** for reusable mapping rule sets (not just schema fragments)
3. **Position Satsuma clearly** as a *specification* language, not a *transformation execution* language — this is the key differentiator from everything else in the market
4. **Add a "Comparison" section** to PROJECT-OVERVIEW.md that honestly explains where Satsuma sits relative to FML, JSONata, XSLT, dbt, and Excel

The tagline should be: *"Satsuma is to data mapping what OpenAPI is to APIs — a specification format, not an implementation."* OpenAPI doesn't execute HTTP requests; it describes them. Satsuma doesn't execute transforms; it describes them.
