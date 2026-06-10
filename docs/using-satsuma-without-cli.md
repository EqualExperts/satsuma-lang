# Using Satsuma Without the CLI

The best way to work with Satsuma is with the full toolchain. The
[VS Code extension](../tooling/vscode-satsuma/) makes `.stm` files a pleasure to
read and write — syntax highlighting picks out keywords, types, metadata, and
natural-language blocks at a glance; go-to-definition and find-references let you
navigate large mapping inventories as fluidly as a codebase; hover shows context
without leaving your cursor; rename propagates safely across files; and live
diagnostics catch mistakes as you type. The CLI adds deterministic structural
extraction, validation, lineage tracing, and diff on top of that.

But neither the extension nor the CLI is a prerequisite. If you cannot install
them (InfoSec restrictions, locked-down environments, shared machines) or you are
working through a web LLM interface like ChatGPT, Gemini, or Claude.ai rather
than a coding agent, Satsuma still delivers significant value.

## Try it Live in the browser (zero install)

The fastest zero-install path is the
[**"Try it Live!" playground**](https://equalexperts.github.io/satsuma-lang/playground/):
a live editor in your browser with syntax highlighting and an interactive
lineage visualization that re-renders as you type. You can explore the bundled
example corpus, open a local `.stm` file, and save your buffer back to disk.

Everything runs client-side — parsing, rendering, and persistence happen in
your browser and **your source is never uploaded** — so it is safe to use with
proprietary mapping specs even in restricted environments. The rest of this
guide covers working with Satsuma through an LLM when you want help *writing*
specs, not just visualizing them.

## Why Satsuma works without tooling

Satsuma was designed to be readable by humans and parseable by machines — in that
order. The language itself is the artifact, not the tooling around it.

What you keep without the CLI:

- **Token efficiency.** Satsuma specs are 3–8x more compact than equivalent
  spreadsheets, YAML, or free-form docs. That means LLMs can consume and reason
  about larger mapping inventories within their context windows.
- **Version control.** `.stm` files are plain text. They diff cleanly, merge
  naturally, and integrate with any Git workflow.
- **Unambiguous structure.** Schemas, mappings, arrows, metadata, and
  natural-language blocks have clear syntactic boundaries. An LLM can parse the
  intent without guessing where one section ends and another begins.
- **Shared vocabulary.** Teams align on a common notation. Whether a human or an
  AI reads the file, the meaning is the same.

What you lose without the CLI:

- **Deterministic extraction.** Commands like `satsuma schema`, `satsuma arrows`,
  and `satsuma lineage` extract structural facts with zero ambiguity. Without
  them, you ask the LLM to read the file directly — which it can do, but with
  a small chance of misreading complex nesting.
- **Validation.** `satsuma validate` catches undefined schema references,
  duplicate names, and broken imports. Without it, you rely on careful review.
- **Cross-file analysis.** The CLI resolves imports and traces lineage across
  files. Without it, you need to paste related files into the same conversation.

The trade-off is real but manageable. Most of the value is in writing good specs,
and you can do that with any text editor and any LLM.

## Setting up your LLM

Paste the compact grammar from
[AI-AGENT-REFERENCE.md](../AI-AGENT-REFERENCE.md) into your system prompt or as
the first message. The portable grammar and conventions section is small enough
for any model's context window. This gives the LLM the full syntax so it can
generate and interpret Satsuma correctly.

If you are using a web LLM with file upload, you can upload
`AI-AGENT-REFERENCE.md` directly instead of pasting.

## Example workflows

### 1. Draft a mapping spec from a requirements document

**You:** Upload or paste a requirements document (business rules, field lists,
or a screenshot of a spreadsheet), then ask:

> Here is our source-to-target mapping requirement. Convert it to a Satsuma
> `.stm` file. Use the grammar I provided. Include metadata (types, pk, pii,
> required) where the source material implies it. Use natural-language transforms
> for any logic that is not a simple rename or type cast.

**The LLM** produces a `.stm` file. Save it, commit it, review it in a PR like
any other code.

### 2. Explain an existing spec to a new team member

**You:** Paste a `.stm` file (or upload it), then ask:

> Walk me through this mapping file. For each mapping block, explain what the
> source and target systems are, what each arrow does, and flag anything that
> looks unusual or risky (e.g., PII fields without explicit handling, lossy
> type conversions).

**The LLM** can follow the structure reliably because schemas, arrows, and
metadata are syntactically distinct — it does not have to guess what is a field
name vs. a comment vs. a business rule.

### 3. Impact analysis without `satsuma lineage`

When you cannot run `satsuma lineage --from crm .`, you can still do impact
analysis by giving the LLM the relevant files:

**You:** Paste the files that participate in the data flow, then ask:

> The `crm.email` field is being renamed to `crm.email_address`. Trace every
> mapping that reads from this field across these files. For each one, tell me
> what target field it writes to and whether the transform logic needs to change.

This works because Satsuma's arrow syntax (`email -> email_address`) makes
field-level data flow explicit. The LLM does not need to reverse-engineer SQL
joins or ETL configurations.

### 4. Review a proposed change

**You:** Paste the diff (or the before/after `.stm` files), then ask:

> Review this change to our Satsuma mapping spec. Check for:
> - fields that were removed from a source schema but are still referenced in arrows
> - new arrows that reference fields not present in the source or target schema
> - natural-language transforms that became stale because the field they reference changed
> - any PII metadata that should have been added to new fields

The structured format makes this kind of review far more reliable than reviewing
a spreadsheet diff or a free-form document change.

### 5. Generate implementation scaffolding

**You:** Paste a `.stm` file, then ask:

> Generate a Python (or SQL, or dbt) implementation skeleton from this mapping.
> For each arrow, generate the transformation code. For natural-language
> transforms, add a TODO comment with the NL text so a developer knows what to
> implement.

Satsuma's arrows, pipe chains, and value maps translate directly to code
patterns. The NL transforms become clearly marked gaps rather than hidden
ambiguity.

### 6. Convert from Excel (no CLI needed)

The repository includes a self-contained conversion prompt at
[useful-prompts/excel-to-stm-prompt.md](../useful-prompts/excel-to-stm-prompt.md).
Copy it into a web LLM session, upload your spreadsheet, and the model will
produce idiomatic `.stm` output. No installation required.

## Tips for effective use without the CLI

1. **Paste the grammar first.** Always start a conversation with the compact
   grammar from `AI-AGENT-REFERENCE.md`. Without it, models may invent syntax.

2. **Keep files focused.** Without cross-file tooling, it is easier to work with
   self-contained files. Use one file per integration or per domain rather than
   splitting heavily across imports.

3. **Paste related files together.** If your mapping imports from a shared
   fragment library, paste both files in the same message so the LLM can
   resolve references.

4. **Ask the LLM to validate.** You can prompt: *"Check this .stm file for
   syntax errors, undefined schema references, and fields used in arrows that
   don't exist in the declared schemas."* It is not as reliable as
   `satsuma validate`, but it catches most issues.

5. **Use version control anyway.** Even without the CLI, `.stm` files should
   live in Git. The clean text format gives you meaningful diffs, blame, and
   history — none of which work well with spreadsheets.

6. **Graduate to the CLI when you can.** If your environment eventually allows
   installation, the CLI slots in without changing your files. Everything you
   wrote without it remains valid.
