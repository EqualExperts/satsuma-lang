#!/usr/bin/env python3
"""
Run the Phase 0.5 probe and record what it cost.

This is the entry point for ticket `sl-x9m1`: run T4 and T5 across arms X-P0,
X-P2, M0, S and S+ at n=2, one model, one harness, then the 1-mapping crossover
cell — recording per episode the input/output/cache-read/cache-write tokens, the
turn count, and for arm S+ every `satsuma` invocation with its flags, exit code
and output size.

It owns sequencing, the budget guard, and the two manifests (per episode and per
run). Treatments live in `probe_matrix.py`, environments in `episode.py`, the
harness in `pi_harness.py`.

Usage:

    # Materialise every episode and print the commands without spending anything
    python3 run_probe.py --dry-run

    # The real run, under the PRD's ~$8 probe budget
    python3 run_probe.py --run-id 2026-08-11a

    # One cell or one arm, e.g. when re-running a failed episode
    python3 run_probe.py --cells full --arms S+ --tasks T4 --repeats 1

Results land under `evals/phase-0.5-probe/runs/<run-id>/` and are committed:
`sl-3yzd` grades them by hand, and a probe whose transcripts were thrown away
cannot be re-graded when a threshold is questioned.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import episode as episode_mod
import pi_harness
from probe_matrix import ARMS, CELLS, TASKS, build_prompt, resolve_arm

#: `evals/phase-0.5-probe/`.
PROBE_DIR = Path(__file__).resolve().parent.parent
#: Repository root, used to find the agent reference and the git sha.
REPO_ROOT = PROBE_DIR.parent.parent
#: The blob arm S carries resident. Feature 45's portable envelope, 6,813
#: tokens (reference/token-costs.md) — charged to arm S on every turn.
AGENT_REFERENCE = REPO_ROOT / "AI-AGENT-REFERENCE.md"

#: PRD §Phase 0.5 sets the probe budget at ~$8. The guard stops the run rather
#: than warning, because an overspend on a deliberately cheap probe is exactly
#: the failure mode "it must not be allowed to grow" is written against.
DEFAULT_BUDGET_USD = 8.0

#: Per-episode wall-clock ceiling. T4 and T5 are short read-and-answer tasks; an
#: episode still running after this is stuck, and a stuck episode burns budget
#: without producing a gradeable answer.
DEFAULT_TIMEOUT_S = 900

#: PRD model matrix, "daily driver" rung. Recorded as a friendly name here; the
#: resolved dated snapshot id comes back from the harness per episode and is
#: what the write-up must quote.
DEFAULT_PROVIDER = "anthropic"
DEFAULT_MODEL = "claude-sonnet-5"

#: Fixed for every arm so that reasoning effort cannot vary between treatments.
#: Recorded in the run manifest as a protocol parameter.
DEFAULT_THINKING = "off"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--run-id", help="Directory name under runs/. Required unless --dry-run."
    )
    parser.add_argument(
        "--cells",
        nargs="+",
        default=list(CELLS),
        choices=list(CELLS),
        help="Which spec-size cells to run (default: both).",
    )
    parser.add_argument(
        "--arms",
        nargs="+",
        default=list(ARMS),
        choices=list(ARMS),
        help="Which arms to run, where the cell includes them (default: all).",
    )
    parser.add_argument(
        "--tasks",
        nargs="+",
        default=list(TASKS),
        choices=list(TASKS),
        help="Which tasks to run (default: T4 and T5).",
    )
    parser.add_argument(
        "--repeats", type=int, default=2, help="Episodes per arm/task/cell (PRD: n=2)."
    )
    parser.add_argument("--provider", default=DEFAULT_PROVIDER)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--thinking", default=DEFAULT_THINKING)
    parser.add_argument(
        "--pi-bin", default=shutil.which("pi") or "pi", help="Harness binary to invoke."
    )
    parser.add_argument(
        "--cli-path",
        default=None,
        help="The real satsuma CLI the arm-S+ shim forwards to. Defaults to the one on PATH.",
    )
    parser.add_argument("--budget-usd", type=float, default=DEFAULT_BUDGET_USD)
    parser.add_argument("--timeout-s", type=int, default=DEFAULT_TIMEOUT_S)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build every episode environment and print its command, spending nothing.",
    )
    return parser.parse_args(argv)


# --- Provenance -------------------------------------------------------------


def _command_output(argv: list[str]) -> str:
    """Run a short provenance command, returning its output or an error marker."""
    try:
        completed = subprocess.run(
            argv, capture_output=True, text=True, timeout=60, check=False
        )
        return (completed.stdout or completed.stderr).strip()
    except (OSError, subprocess.SubprocessError) as error:
        return f"unknown ({error})"


def cli_identity(cli_path: str) -> dict:
    """Identify the satsuma build arm S+ is measured against.

    Recorded rather than assumed because a locally built CLI can report a
    release version it is not (see ticket sl-13p5), and "which CLI was this" is
    the first question anyone re-reading the invocation mix will ask.
    """
    resolved = Path(cli_path).resolve()
    package_json = resolved.parent.parent / "package.json"
    package_version = None
    if package_json.exists():
        try:
            package_version = json.loads(package_json.read_text(encoding="utf-8")).get(
                "version"
            )
        except (json.JSONDecodeError, OSError):
            package_version = None
    return {
        "invoked_as": cli_path,
        "resolved_path": str(resolved),
        "reported_version": _command_output([cli_path, "--version"]),
        "package_json_version": package_version,
    }


def run_provenance(args: argparse.Namespace, cli_path: str) -> dict:
    """Everything needed to say what was measured, recorded once per run."""
    return {
        "git_sha": _command_output(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"]),
        "git_dirty": bool(
            _command_output(["git", "-C", str(REPO_ROOT), "status", "--porcelain"])
        ),
        "harness": "pi",
        "harness_version": pi_harness.harness_version(args.pi_bin),
        "harness_flags": list(pi_harness.HERMETIC_FLAGS),
        "tools": list(pi_harness.TOOLS),
        "provider": args.provider,
        "model_requested": args.model,
        "thinking": args.thinking,
        "repeats": args.repeats,
        "budget_usd": args.budget_usd,
        "satsuma_cli": cli_identity(cli_path),
        "agent_reference_bytes": AGENT_REFERENCE.stat().st_size
        if AGENT_REFERENCE.exists()
        else None,
    }


# --- The run ----------------------------------------------------------------


def episode_plan(args: argparse.Namespace) -> list[tuple[str, str, str, int]]:
    """Every episode to run, as `(cell, arm, task, repeat)`, in run order.

    Ordered cell-major then arm, so a run stopped early by the budget guard
    still leaves whole arms comparable within a cell rather than a ragged
    fragment of every arm.
    """
    plan = []
    for cell_id in args.cells:
        for arm_id in CELLS[cell_id].arms:
            if arm_id not in args.arms:
                continue
            for task_id in args.tasks:
                for repeat in range(1, args.repeats + 1):
                    plan.append((cell_id, arm_id, task_id, repeat))
    return plan


def run(args: argparse.Namespace) -> int:
    if not args.dry_run and not args.run_id:
        print(
            "--run-id is required for a real run (it names the results directory)",
            file=sys.stderr,
        )
        return 2

    cli_path = args.cli_path or shutil.which("satsuma")
    if cli_path is None:
        # Only arm S+ needs it, but a run that silently skips the shipped
        # configuration is worse than one that refuses to start.
        print(
            "no satsuma CLI found; pass --cli-path (arm S+ cannot run without it)",
            file=sys.stderr,
        )
        return 2

    run_root = PROBE_DIR / "runs" / (args.run_id or "dry-run")
    if run_root.exists() and not args.dry_run:
        print(
            f"{run_root} already exists; choose a new --run-id rather than overwriting",
            file=sys.stderr,
        )
        return 2
    if args.dry_run and run_root.exists():
        shutil.rmtree(run_root)
    episodes_root = run_root / "episodes"
    episodes_root.mkdir(parents=True)

    provenance = run_provenance(args, cli_path)
    plan = episode_plan(args)
    print(f"{len(plan)} episodes planned, budget ${args.budget_usd:.2f}")

    records: list[dict] = []
    spent = 0.0
    for cell_id, arm_id, task_id, repeat in plan:
        if spent >= args.budget_usd:
            print(
                f"budget ${args.budget_usd:.2f} reached after ${spent:.2f}; stopping",
                file=sys.stderr,
            )
            break

        arm = resolve_arm(arm_id, cell_id)
        task = TASKS[task_id]
        prompt = build_prompt(arm, task)
        layout = episode_mod.prepare_episode(
            root=episodes_root
            / episode_mod.episode_id(cell_id, arm_id, task_id, repeat),
            arm=arm,
            prompt=prompt,
            probe_dir=PROBE_DIR,
            reference_path=AGENT_REFERENCE,
        )
        if arm.satsuma_on_path:
            episode_mod.install_shim(
                layout.bin_dir, Path(__file__).resolve().parent / "satsuma_shim.py"
            )
        env = episode_mod.build_environment(
            layout=layout, arm=arm, real_cli=str(Path(cli_path).resolve())
        )
        argv = pi_harness.build_argv(
            pi_bin=args.pi_bin,
            provider=args.provider,
            model=args.model,
            thinking=args.thinking,
            prompt=prompt,
            append_system_prompt_file=layout.system_append_path,
        )

        record = {
            "cell": cell_id,
            "arm": arm_id,
            "task": task_id,
            "repeat": repeat,
            "arm_label": arm.label,
            "reference_delivery": arm.reference_delivery,
            "satsuma_withheld": not arm.satsuma_on_path,
            # The assertion passed inside build_environment; recording it makes
            # the enforcement auditable from the results alone.
            "satsuma_absence_asserted": not arm.satsuma_on_path,
            "artifacts": list(arm.artifacts),
            "argv": argv,
            "workspace": str(layout.workspace),
        }

        if args.dry_run:
            record["dry_run"] = True
            print(f"  [dry-run] {layout.root.name}: {' '.join(argv[:-1])} <prompt>")
        else:
            print(f"  running {layout.root.name} …", end="", flush=True)
            try:
                result = pi_harness.run_episode(
                    argv=argv,
                    cwd=layout.workspace,
                    env=env,
                    stream_path=layout.stream_path,
                    stderr_path=layout.stderr_path,
                    timeout_s=args.timeout_s,
                )
            except subprocess.TimeoutExpired:
                record["error"] = f"timed out after {args.timeout_s}s"
                print(" TIMEOUT")
            else:
                record.update(result.to_dict())
                record["satsuma_invocations"] = episode_mod.read_invocations(layout)
                spent += result.usage.cost_usd
                print(
                    f" {result.usage.turns} turns, "
                    f"{result.usage.input + result.usage.output} tokens, "
                    f"${result.usage.cost_usd:.3f} (${spent:.2f} spent)"
                )

        layout.manifest_path.write_text(
            json.dumps(record, indent=2, sort_keys=True), encoding="utf-8"
        )
        records.append(record)

    manifest = {
        "run_id": args.run_id or "dry-run",
        "dry_run": args.dry_run,
        "provenance": provenance,
        "planned_episodes": len(plan),
        "completed_episodes": len(records),
        "total_cost_usd": round(spent, 4),
        "episodes": records,
    }
    (run_root / "run.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8"
    )
    print(
        f"wrote {run_root / 'run.json'} — ${spent:.2f} spent across {len(records)} episodes"
    )
    return 0


def main() -> int:
    return run(parse_args())


if __name__ == "__main__":
    sys.exit(main())
