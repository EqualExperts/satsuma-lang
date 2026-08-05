# Satsuma Agent Skills

This directory contains [Agent Skills](https://agentskills.io) for working with
Satsuma (`.stm`) mapping specs. Each subdirectory is a self-contained skill —
a `SKILL.md` file with YAML frontmatter (name, description, allowed tools) plus
any reference docs, scripts, or templates the skill needs.

## Available skills

| Skill | What it does |
| --- | --- |
| [`satsuma-language`](satsuma-language) | Grammar, conventions, CLI command surface, and workflow patterns for writing or reading Satsuma — a lazy-loading envelope over the same content `satsuma agent-reference` and `AI-AGENT-REFERENCE.md` compose from (Feature 45). |
| [`excel-to-satsuma`](excel-to-satsuma) | Convert Excel mapping spreadsheets into idiomatic Satsuma. Includes a Python helper CLI and a Claude Code slash command. |
| [`satsuma-to-excel`](satsuma-to-excel) | Generate stakeholder-ready Excel workbooks from `.stm` files. |
| [`satsuma-explainer`](satsuma-explainer) | Plain-English walkthroughs, PII audits, coverage checks, and impact analysis of `.stm` files for non-technical stakeholders. |
| [`satsuma-from-dbt`](satsuma-from-dbt) | Reverse-engineer Satsuma mapping specs from an existing dbt project. |
| [`satsuma-to-dbt`](satsuma-to-dbt) | Scaffold an idiomatic dbt project (Kimball stars, Data Vault 2.0, exposures) from `.stm` specs. |
| [`satsuma-sample-data`](satsuma-sample-data) | Generate realistic synthetic test data that respects schema constraints, PII patterns, and referential integrity. |
| [`satsuma-to-openlineage`](satsuma-to-openlineage) | Emit OpenLineage events with column-level lineage for Marquez, DataHub, Atlan, and OpenMetadata. |
| [`adr-draft`](adr-draft) | Internal helper: assess whether a change warrants an ADR and draft one. |
| [`satsuma-diaries`](satsuma-diaries) | Internal helper: write project diary entries in the established style. |

Most skills work best when the [`satsuma` CLI](../tooling/satsuma-cli) is on
your `PATH`, since they call commands like `satsuma summary`, `satsuma lineage`,
and `satsuma validate` to extract structured information from `.stm` files
instead of guessing from raw text.

## Installing a skill

Agent Skills are a portable, file-based standard, but each agent runtime
discovers them in a slightly different way. Pick the section that matches
the tool you're using.

### Claude Code (CLI)

Claude Code auto-discovers skills from a few well-known locations. The
simplest install is to symlink (or copy) the skill folder into your user-level
skills directory so it's available across every project:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)/skills/satsuma-explainer" ~/.claude/skills/satsuma-explainer
```

Repeat for any other skills you want. Restart Claude Code (or run `/skills`)
and the skill should appear in the list. To install a skill for a single
project only, drop it under `.claude/skills/` inside that project instead.

You can also keep this repository checked out anywhere on disk and symlink
individual skills into multiple projects — the skill folder is the unit of
distribution, and a symlink is enough.

### Claude Desktop

Claude Desktop loads skills from your user skills directory the same way
Claude Code does. The exact path depends on your OS:

- **macOS:** `~/Library/Application Support/Claude/skills/`
- **Windows:** `%APPDATA%\Claude\skills\`
- **Linux:** `~/.config/Claude/skills/`

Copy or symlink the skill directory in, then restart Claude Desktop. The
skill becomes available in any conversation; Claude will trigger it
automatically when the user's request matches the skill's `description`.

### GitHub Copilot (VS Code, CLI, coding agent)

GitHub Copilot has [native support](https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/)
for `agentskills.io`-format skills across Copilot in VS Code, the Copilot
CLI, and the Copilot coding agent. The format is identical to the files
in this directory, so installation is just a copy or symlink:

- **Per-project (committed to the repo):** drop the skill into
  `.github/skills/<skill-name>/` so the whole team picks it up.
  ```bash
  mkdir -p .github/skills
  cp -r path/to/satsuma-lang/skills/satsuma-explainer .github/skills/
  ```
- **Personal (across all your projects):** put it under your user-level
  Copilot skills directory instead. See the [VS Code Agent Skills docs](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
  for the exact path on your platform and for the UI to manage skills
  inside VS Code.

Because the format is shared, the *same* skill folder can live in
`.claude/skills/`, `.github/skills/`, and `.codex/skills/` simultaneously —
symlinking from one canonical checkout of this repo is the cleanest setup.
See GitHub's [Creating agent skills for Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills)
guide for the authoring contract Copilot expects (which matches what these
skills already follow).

### OpenAI Codex CLI

Codex CLI also has [native skill support](https://developers.openai.com/codex/skills).
A skill is a directory with a `SKILL.md` plus optional scripts and
references — exactly what's in this folder.

- **Personal install:** copy or symlink the skill into `~/.codex/skills/`.
  ```bash
  mkdir -p ~/.codex/skills
  ln -s "$(pwd)/skills/satsuma-to-dbt" ~/.codex/skills/satsuma-to-dbt
  ```
- **Project install (committed to the repo):** put it under
  `.codex/skills/<skill-name>/` in the project root so everyone using
  Codex on that repo gets it automatically.

Codex loads each skill's metadata up front and only pulls in the full
`SKILL.md` body when it decides to invoke the skill, so there's no
context-window cost to keeping several installed. You can also invoke a
skill explicitly with `$skill-name` inside a Codex session.

### ChatGPT (web) and other plain LLMs

For tools without a native skills loader, the skill files are designed to
be readable as standalone prompts: open the skill's `SKILL.md`, copy the
body (everything after the YAML frontmatter), and paste it as a system or
developer message at the start of a new conversation. Attach any files
from `references/` if the task needs them. The `useful-prompts/` directory
at the repo root contains zero-setup variants of the Excel skills already
tuned for plain web LLMs.

### Other agent runtimes

Anything that follows the [agentskills.io](https://agentskills.io) standard
should be able to load these skills directly — the directory layout, the
`SKILL.md` filename, and the YAML frontmatter (`name`, `description`,
`allowed-tools`) are all standard. Point your runtime's skills loader at
this directory (or at an individual skill subdirectory) and it should
discover them automatically.

## Authoring new skills

If you want to add a new Satsuma skill:

1. Create a new subdirectory under `skills/` named after the skill.
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description`,
   `allowed-tools`) and a body that explains, step by step, how the skill
   should accomplish its task. Be specific about which `satsuma` CLI
   commands to call and in what order.
3. Put any long-form reference material under `references/` inside the
   skill folder so the agent can load it on demand instead of front-loading
   everything into context.
4. Update the table at the top of this README and add a pointer in
   [`HOW-DO-I.md`](../HOW-DO-I.md) so the skill is discoverable.
