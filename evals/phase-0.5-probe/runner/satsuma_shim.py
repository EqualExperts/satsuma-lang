#!/usr/bin/env python3
"""
The `satsuma` the arm-S+ agent actually invokes.

The runner installs this script as `<episode>/bin/satsuma`, first on the agent's
PATH, so every CLI call the agent makes passes through here on its way to the
real binary. It exists because of a finding the PRD records as decisive:

    "Arm S+'s token result is a property of the agent's invocation choices, not
    of the CLI. An agent that reaches for `graph --json` makes Satsuma+CLI lose
    outright. The runner must therefore record every `satsuma` invocation with
    its flags, exit code and output size per episode."
    — features/44-token-and-task-eval/PRD.md, §"Arm S+ is a behavioural
      distribution, not a fixed treatment"

Without this record an S+ number is uninterpretable, so the shim is part of the
measurement rather than a debugging aid.

It owns three things and nothing else: appending one JSON line per invocation to
the episode's log, refusing the one excluded subcommand, and passing everything
else through byte-for-byte with the real exit code. It never rewrites arguments,
never caches, and never inspects output beyond measuring its size.

Two environment variables configure it, both set by `episode.py`:
    SATSUMA_SHIM_LOG  — absolute path of the JSONL invocation log to append to
    SATSUMA_SHIM_REAL — absolute path of the real CLI entry point to exec
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

#: The one subcommand excluded from arm S+. PRD §"Arm S+ is a behavioural
#: distribution": `satsuma context` is the CLI's only heuristic, keyword-ranked
#: command, and leaving it in turns the experiment into "our retrieval heuristic
#: vs. grep" rather than "semantic structure vs. plain text". Attempts are
#: recorded as a protocol observation rather than silently ignored, because
#: whether the agent reaches for it at all is itself a result.
EXCLUDED_SUBCOMMAND = "context"

#: Exit code returned for the excluded subcommand. Distinct from the CLI's own
#: usage-error code (1) so the log can never confuse "we blocked this" with "the
#: CLI rejected this".
EXCLUDED_EXIT_CODE = 69


def _log_path() -> str:
    path = os.environ.get("SATSUMA_SHIM_LOG")
    if not path:
        sys.exit("satsuma shim: SATSUMA_SHIM_LOG is not set; the runner must set it")
    return path


def _real_cli() -> str:
    path = os.environ.get("SATSUMA_SHIM_REAL")
    if not path:
        sys.exit("satsuma shim: SATSUMA_SHIM_REAL is not set; the runner must set it")
    return path


def record(entry: dict) -> None:
    """Append one invocation record to the episode log.

    Opened per call in append mode rather than held open, so a crashed or killed
    episode still leaves every completed invocation on disk.
    """
    with open(_log_path(), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True) + "\n")


def main(argv: list[str]) -> int:
    """Run one intercepted invocation. Returns the exit code to exit with."""
    args = argv[1:]
    started = time.time()

    # The excluded subcommand: record the attempt, tell the agent plainly that
    # it is unavailable here, and do not call the real CLI.
    if args and args[0] == EXCLUDED_SUBCOMMAND:
        record(
            {
                "argv": args,
                "subcommand": EXCLUDED_SUBCOMMAND,
                "excluded": True,
                "exit_code": EXCLUDED_EXIT_CODE,
                "stdout_bytes": 0,
                "stderr_bytes": 0,
                "duration_ms": 0,
            }
        )
        print(
            f"satsuma: '{EXCLUDED_SUBCOMMAND}' is not available in this environment.",
            file=sys.stderr,
        )
        return EXCLUDED_EXIT_CODE

    completed = subprocess.run(
        [_real_cli(), *args],
        capture_output=True,
        # The real CLI's exit code is part of the record and is propagated
        # verbatim; raising here would hide a failed query from the agent.
        check=False,
    )
    sys.stdout.buffer.write(completed.stdout)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(completed.stderr)
    sys.stderr.buffer.flush()

    record(
        {
            "argv": args,
            # The first non-flag argument, which is what the invocation-mix
            # table in the write-up is grouped by.
            "subcommand": next((a for a in args if not a.startswith("-")), None),
            "excluded": False,
            "exit_code": completed.returncode,
            # Output size is the whole point of the record: the PRD's finding is
            # that --json on aggregate commands costs more than reading the
            # source files, and only measured bytes can show that happening.
            "stdout_bytes": len(completed.stdout),
            "stderr_bytes": len(completed.stderr),
            "duration_ms": round((time.time() - started) * 1000),
        }
    )
    return completed.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv))
