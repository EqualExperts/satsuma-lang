/**
 * measure-agent-reference-tokens.test.mjs — unit coverage for the MCP-schema
 * builder that scripts/measure-agent-reference-tokens.mjs uses for its
 * comparison point.
 *
 * These tests exercise buildToolSchema directly against hand-built command
 * descriptions rather than the real CLI's built dist/ output, so they run
 * without requiring `npm run build:all` first — the full script's own
 * describeRegisteredCommand step (which does need the real build) is
 * exercised by running the script itself, not by this fast unit suite.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildToolSchema } from "./measure-agent-reference-tokens.mjs";

test("a flag that takes a value becomes a string property, a bare flag becomes a boolean", () => {
  // The distinction matters for measurement: a value-taking flag like
  // --profile <profile> costs more JSON-schema tokens (a string type plus
  // whatever description) than a bare boolean switch like --list, and the
  // schema must reflect which is which rather than treating every flag alike.
  const schema = buildToolSchema({
    name: "agent-reference",
    description: "Print the AI Agent Reference",
    args: [],
    options: [
      { key: "profile", takesValue: true, description: "task profile" },
      { key: "list", takesValue: false, description: "list sections" },
    ],
  });

  assert.deepEqual(schema.input_schema.properties.profile, {
    type: "string",
    description: "task profile",
  });
  assert.deepEqual(schema.input_schema.properties.list, {
    type: "boolean",
    description: "list sections",
  });
});

test("a required positional argument is listed in the schema's required array", () => {
  // Commander distinguishes `<path>` (required) from `[path]` (optional);
  // the MCP-style schema must preserve that distinction rather than
  // reporting every command as callable with no arguments at all.
  const schema = buildToolSchema({
    name: "summary",
    description: "Summarise a Satsuma file",
    args: [{ name: "path", required: true, description: undefined }],
    options: [],
  });

  assert.deepEqual(schema.input_schema.required, ["path"]);
  assert.deepEqual(schema.input_schema.properties.path, { type: "string" });
});

test("an optional positional argument is described but not marked required", () => {
  const schema = buildToolSchema({
    name: "summary",
    description: "Summarise a Satsuma file",
    args: [{ name: "path", required: false, description: undefined }],
    options: [],
  });

  assert.equal(schema.input_schema.required, undefined);
});

test("a command name with non-alphanumeric characters is sanitized into the tool name", () => {
  // Command names in this CLI (e.g. "where-used") contain a hyphen; tool-use
  // schemas commonly restrict names to [a-zA-Z0-9_], so the comparison must
  // sanitize the same way a real MCP server integration would.
  const schema = buildToolSchema({
    name: "where-used",
    description: "Find usages",
    args: [],
    options: [],
  });

  assert.equal(schema.name, "satsuma_where_used");
});
