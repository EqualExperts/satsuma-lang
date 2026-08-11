"""
The Pi adapter: how one episode is handed to the harness, and how usage is read
back out of it.

Pi (`@earendil-works/pi-coding-agent`) is the PRD's anchor harness — a sub-1k
system prompt and a JSON event stream, which is the least confounded measurement
surface available. This module owns the argv, the hermeticity flags, and the
parse of `--mode json` output into the numbers `sl-x9m1` must record. It knows
nothing about arms or tasks.

If the probe is ever re-run on a different harness, this is the file that gets a
sibling — nothing else in the runner mentions Pi.

Stream shape (pi docs/json.md, docs/session-format.md): one JSON object per
line; assistant `message_end` events carry `message.usage` with `input`,
`output`, `cacheRead`, `cacheWrite`, `totalTokens` and a `cost` breakdown; each
completed turn emits a `turn_end`.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path

#: Tool names enabled for every arm. Identical across arms by design: the arms
#: differ in their artifact and in whether `satsuma` is reachable, never in what
#: the agent is capable of doing. `bash` is enabled everywhere — arm X needs
#: python3 to open a workbook at all, and withholding it from the other arms
#: would confound "the CLI helped" with "a shell helped".
TOOLS = ("read", "write", "edit", "bash", "grep", "find", "ls")

#: Hermeticity flags. Every one of these removes a way the operator's own
#: machine could leak into an episode — installed extensions, skills, prompt
#: templates, AGENTS.md/CLAUDE.md discovery, a saved session, an update check.
#: An episode must be a function of the artifact and the prompt alone.
HERMETIC_FLAGS = (
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-approve",
    "--no-session",
    "--offline",
)


@dataclass
class Usage:
    """Token and cost totals for one episode.

    Fields mirror pi's `Usage` type so the numbers are the harness's own, not a
    re-derivation. `cost_usd` is Pi's computed figure from its model catalogue;
    the run manifest records the resolved model id alongside it so the price
    basis is auditable.
    """

    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0
    #: Number of completed agent turns — the PRD flags turn count as a candidate
    #: for "the thing that actually moves" if tokens do not separate the arms.
    turns: int = 0

    def add_message_usage(self, usage: dict) -> None:
        """Fold one message's usage into the totals."""
        self.input += usage.get("input", 0)
        self.output += usage.get("output", 0)
        self.cache_read += usage.get("cacheRead", 0)
        self.cache_write += usage.get("cacheWrite", 0)
        self.total_tokens += usage.get("totalTokens", 0)
        cost = usage.get("cost") or {}
        self.cost_usd += cost.get("total", 0.0)


@dataclass
class EpisodeResult:
    """Everything one episode produced, apart from files already on disk."""

    usage: Usage
    #: Resolved dated snapshot ids seen in the stream. The PRD requires the
    #: resolved id, never the friendly name, because hosted ids move under
    #: stable marketing names. More than one entry means the model changed
    #: mid-episode, which invalidates the episode.
    resolved_models: list[str] = field(default_factory=list)
    #: Provider ids seen, same reasoning.
    providers: list[str] = field(default_factory=list)
    #: The agent's final assistant text — what sl-3yzd grades by hand.
    final_text: str = ""
    #: Tool calls in order, as `(tool name, one-line argument summary)`. Used to
    #: cross-check the shim log and to see what the non-CLI arms did instead.
    tool_calls: list[tuple[str, str]] = field(default_factory=list)
    #: pi's exit code. Non-zero means the episode failed and must not be graded.
    exit_code: int = 0

    def to_dict(self) -> dict:
        return {
            "usage": asdict(self.usage),
            "resolved_models": self.resolved_models,
            "providers": self.providers,
            "final_text": self.final_text,
            "tool_calls": [
                {"tool": name, "args": args} for name, args in self.tool_calls
            ],
            "exit_code": self.exit_code,
        }


def build_argv(
    *,
    pi_bin: str,
    provider: str,
    model: str,
    thinking: str,
    prompt: str,
    append_system_prompt_file: Path | None = None,
) -> list[str]:
    """Build the pi command line for one episode.

    `append_system_prompt_file` carries arm S's resident reference blob; every
    other arm passes None. Pi appends the file's contents to its system prompt,
    which is what makes those tokens chargeable to the arm on every turn — the
    honest accounting the PRD demands in §"Satsuma pays for its own reference
    material".
    """
    argv = [
        pi_bin,
        "--print",
        "--mode",
        "json",
        "--provider",
        provider,
        "--model",
        model,
        "--thinking",
        thinking,
        "--tools",
        ",".join(TOOLS),
        *HERMETIC_FLAGS,
    ]
    if append_system_prompt_file is not None:
        argv += ["--append-system-prompt", str(append_system_prompt_file)]
    argv.append(prompt)
    return argv


def _summarise_args(args: object) -> str:
    """One-line, log-safe rendering of a tool call's arguments."""
    if isinstance(args, dict):
        # `command` (bash) and `path`/`pattern` (read/grep) are the fields worth
        # seeing; anything else is rendered compactly rather than dropped.
        for key in ("command", "path", "file_path", "pattern", "query"):
            if key in args:
                return str(args[key])
    return json.dumps(args, sort_keys=True)[:400]


def parse_stream(lines: list[str]) -> EpisodeResult:
    """Fold a pi `--mode json` event stream into an EpisodeResult.

    Tolerant by design: unparseable lines are skipped rather than raising, so a
    single malformed line cannot destroy an episode that cost real money. The
    raw stream is always written to disk alongside, so nothing is lost.
    """
    result = EpisodeResult(usage=Usage())
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue

        event_type = event.get("type")

        if event_type == "turn_end":
            result.usage.turns += 1

        elif event_type == "message_end":
            message = event.get("message") or {}
            if message.get("role") != "assistant":
                continue
            usage = message.get("usage")
            if isinstance(usage, dict):
                result.usage.add_message_usage(usage)
            model = message.get("model")
            if model and model not in result.resolved_models:
                result.resolved_models.append(model)
            provider = message.get("provider")
            if provider and provider not in result.providers:
                result.providers.append(provider)
            text = _assistant_text(message)
            if text:
                result.final_text = text

        elif event_type == "tool_execution_start":
            result.tool_calls.append(
                (str(event.get("toolName", "?")), _summarise_args(event.get("args")))
            )

    return result


def _assistant_text(message: dict) -> str:
    """Concatenate the text content blocks of one assistant message."""
    blocks = message.get("content") or []
    if not isinstance(blocks, list):
        return ""
    return "".join(
        block.get("text", "")
        for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
    )


def run_episode(
    *,
    argv: list[str],
    cwd: Path,
    env: dict[str, str],
    stream_path: Path,
    stderr_path: Path,
    timeout_s: int,
) -> EpisodeResult:
    """Run one episode to completion, persisting the raw stream before parsing.

    The stream is written to disk first and parsed from the file, so the record
    on disk is exactly what the harness emitted — a parse bug can be re-run
    against it without paying for the episode again.
    """
    completed = subprocess.run(
        argv,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout_s,
        # A non-zero exit is data, not an exception: the episode manifest
        # records it so a failed arm is visible rather than absent.
        check=False,
    )
    stream_path.write_text(completed.stdout, encoding="utf-8")
    stderr_path.write_text(completed.stderr, encoding="utf-8")

    result = parse_stream(completed.stdout.splitlines())
    result.exit_code = completed.returncode
    return result


def harness_version(pi_bin: str) -> str:
    """The harness version string, recorded in the run manifest."""
    try:
        completed = subprocess.run(
            [pi_bin, "--version"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        return completed.stdout.strip() or completed.stderr.strip()
    except (OSError, subprocess.SubprocessError) as error:
        return f"unknown ({error})"
