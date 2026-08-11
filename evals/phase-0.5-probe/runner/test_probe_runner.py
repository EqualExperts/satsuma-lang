"""
Tests for the Phase 0.5 probe runner.

The runner spends real money and produces numbers a go/no-go decision rests on,
so what is tested here is the set of properties whose silent failure would make
a *completed, green-looking* run worthless:

  * the task the agent is asked is the task the answer key grades,
  * the arms differ only where the design says they differ,
  * arm S's withholding is enforced rather than intended,
  * arm S+'s invocation record is actually written, including for the excluded
    subcommand,
  * usage is aggregated from the harness's own numbers, not re-derived.

Run directly (`python3 -m unittest`) or via `npm run test:scripts`, which drives
this file through `scripts/probe-runner.test.mjs` so it runs in the pre-commit
checks like everything else.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import ClassVar

sys.path.insert(0, str(Path(__file__).resolve().parent))

import episode as episode_mod
import pi_harness
import probe_matrix

PROBE_DIR = Path(__file__).resolve().parent.parent
ANSWER_KEYS = PROBE_DIR / "answer-keys"


class TaskPromptsMatchTheAnswerKeys(unittest.TestCase):
    """The keys were authored before any episode ran and are authoritative.

    If a question is reworded in `probe_matrix` but not in the key, the episodes
    answer one question and the grader marks another — and nothing else in the
    system would notice, because both files stay individually valid.
    """

    #: The keys state the task under a `## The task given to the agent` heading,
    #: as a blockquote. This extracts that blockquote.
    _QUESTION_BLOCK = re.compile(
        r"## The task given to the agent\s*\n\s*((?:>.*\n)+)", re.MULTILINE
    )

    def _question_from_key(self, filename: str) -> str:
        text = (ANSWER_KEYS / filename).read_text(encoding="utf-8")
        match = self._QUESTION_BLOCK.search(text)
        assert match, f"{filename} has no 'task given to the agent' blockquote"
        lines = [line.lstrip("> ").rstrip() for line in match.group(1).splitlines()]
        return " ".join(line for line in lines if line)

    def test_t4_question_is_the_answer_keys_question(self):
        self.assertEqual(
            probe_matrix.TASKS["T4"].question,
            self._question_from_key("T4-impact-analysis.md"),
        )

    def test_t5_question_is_the_answer_keys_question(self):
        self.assertEqual(
            probe_matrix.TASKS["T5"].question,
            self._question_from_key("T5-ambiguity-detection.md"),
        )


class ArmsDifferOnlyWhereTheDesignSaysTheyDo(unittest.TestCase):
    """The pairing invariant: a token gap between arms must come from the
    artifact, not from a prompt one arm happened to get more of."""

    def test_prompts_differ_only_in_the_artifact_clause_and_cli_sentence(self):
        prompts = {
            arm_id: probe_matrix.build_prompt(
                probe_matrix.resolve_arm(arm_id, "full"), probe_matrix.TASKS["T4"]
            )
            for arm_id in probe_matrix.CELLS["full"].arms
        }
        # Drop each arm's own artifact paragraph and the S+ CLI paragraph; the
        # paragraphs that remain must be identical across all five arms.
        remainders = set()
        for arm_id, prompt in prompts.items():
            arm = probe_matrix.resolve_arm(arm_id, "full")
            arm_specific = {arm.artifact_description, probe_matrix._CLI_AVAILABILITY}
            remainders.add(
                tuple(
                    paragraph
                    for paragraph in prompt.split("\n\n")
                    if paragraph.strip() and paragraph.strip() not in arm_specific
                )
            )
        self.assertEqual(
            len(remainders), 1, "arms received structurally different prompts"
        )

    def test_only_the_cli_arm_is_told_the_cli_exists(self):
        told = {
            arm_id
            for arm_id in probe_matrix.ARMS
            if "satsuma` CLI is installed"
            in probe_matrix.build_prompt(
                probe_matrix.ARMS[arm_id], probe_matrix.TASKS["T5"]
            )
        }
        self.assertEqual(told, {"S+"})

    def test_prompt_names_a_path_the_workspace_actually_holds(self):
        """The prompt's path and the copier's destination come from one function;
        this pins that they agree for every arm in every cell."""
        for cell_id, cell in probe_matrix.CELLS.items():
            for arm_id in cell.arms:
                arm = probe_matrix.resolve_arm(arm_id, cell_id)
                named = probe_matrix.workspace_path(arm.artifacts[0])
                self.assertIn(
                    f"`{named}`",
                    arm.artifact_description,
                    f"{cell_id}/{arm_id} prompt does not name its own artifact path",
                )

    def test_satsuma_arms_carry_the_imported_lookup_in_every_cell(self):
        """The spec imports `../lookups/claims_fx.stm`; an arm missing it would
        hand the agent a spec that does not resolve — silently, as a parse error
        the agent would have to work around."""
        for cell_id, cell in probe_matrix.CELLS.items():
            for arm_id in ("S", "S+"):
                if arm_id not in cell.arms:
                    continue
                arm = probe_matrix.resolve_arm(arm_id, cell_id)
                self.assertIn(
                    "lookups/claims_fx.stm", arm.artifacts, f"{cell_id}/{arm_id}"
                )

    def test_crossover_cell_excludes_the_arm_it_has_no_rendering_for(self):
        with self.assertRaises(KeyError):
            probe_matrix.resolve_arm("X-P2", "1-mapping")


class SatsumaWithholdingIsEnforced(unittest.TestCase):
    """PRD: "An agent instructed not to use a binary that is on PATH will use
    it." These tests fail if the enforcement is ever downgraded to a request."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.fake_bin = self.tmp / "fake-bin"
        self.fake_bin.mkdir()
        fake = self.fake_bin / "satsuma"
        fake.write_text("#!/bin/sh\necho fake\n", encoding="utf-8")
        fake.chmod(0o755)

    def test_a_directory_providing_satsuma_is_detected(self):
        path = os.pathsep.join([str(self.fake_bin), "/usr/bin"])
        self.assertEqual(
            episode_mod.directories_providing_satsuma(path), [str(self.fake_bin)]
        )

    def test_sanitised_path_drops_every_provider_and_prepends_the_episode_bin(self):
        episode_bin = self.tmp / "bin"
        episode_bin.mkdir()
        path = os.pathsep.join([str(self.fake_bin), "/usr/bin"])
        sanitised = episode_mod.sanitised_path(path, episode_bin)
        self.assertEqual(sanitised.split(os.pathsep)[0], str(episode_bin))
        self.assertNotIn(str(self.fake_bin), sanitised.split(os.pathsep))

    def test_absence_assertion_raises_when_the_cli_is_reachable(self):
        """The mutation this pins: if the sanitiser ever stops removing a
        provider, the assertion — not a code review — is what stops the run."""
        with self.assertRaises(RuntimeError):
            episode_mod.assert_satsuma_absent(str(self.fake_bin))

    def test_absence_assertion_passes_on_a_sanitised_path(self):
        episode_bin = self.tmp / "bin"
        episode_bin.mkdir()
        sanitised = episode_mod.sanitised_path(
            os.pathsep.join([str(self.fake_bin), "/usr/bin"]), episode_bin
        )
        episode_mod.assert_satsuma_absent(sanitised)

    def test_shim_reachability_assertion_rejects_a_foreign_satsuma(self):
        """Arm S+ measuring an unlogged CLI would produce an S+ number with no
        invocation mix behind it — the PRD's definition of uninterpretable."""
        episode_bin = self.tmp / "bin"
        episode_bin.mkdir()
        path = os.pathsep.join([str(self.fake_bin), str(episode_bin)])
        with self.assertRaises(RuntimeError):
            episode_mod.assert_shim_reachable(path, episode_bin)


class EpisodeEnvironment(unittest.TestCase):
    """What the agent is handed: the right files, in the right places, with the
    right binaries reachable."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _prepare(self, arm_id: str, cell_id: str = "full"):
        arm = probe_matrix.resolve_arm(arm_id, cell_id)
        return arm, episode_mod.prepare_episode(
            root=self.tmp / f"{cell_id}-{arm_id}",
            arm=arm,
            prompt=probe_matrix.build_prompt(arm, probe_matrix.TASKS["T4"]),
            probe_dir=PROBE_DIR,
            reference_path=PROBE_DIR.parent.parent / "AI-AGENT-REFERENCE.md",
        )

    def test_satsuma_arm_workspace_resolves_its_own_import(self):
        """The layout exists for exactly one reason: `../lookups/claims_fx.stm`
        must resolve from where the spec sits. This walks the import the way the
        parser would."""
        arm, layout = self._prepare("S")
        spec = layout.workspace / probe_matrix.workspace_path(arm.artifacts[0])
        imported = (spec.parent / "../lookups/claims_fx.stm").resolve()
        self.assertTrue(
            imported.is_file(), f"import target {imported} missing from workspace"
        )

    def test_only_the_resident_blob_arm_gets_the_reference_copied_in(self):
        """Charging arm S for the reference is the PRD's honesty requirement;
        charging arm M for it would be a silent 6.8k-token handicap."""
        _, s_layout = self._prepare("S")
        _, m_layout = self._prepare("M0")
        self.assertIsNotNone(s_layout.system_append_path)
        self.assertTrue(s_layout.system_append_path.is_file())
        self.assertIsNone(m_layout.system_append_path)

    def test_workspace_holds_the_arms_artifacts_and_nothing_else(self):
        """A stray file in the workspace is a treatment the design never
        specified — most damagingly, another arm's rendering of the same spec."""
        arm, layout = self._prepare("X-P0")
        present = sorted(
            p.relative_to(layout.workspace).as_posix()
            for p in layout.workspace.rglob("*")
            if p.is_file()
        )
        self.assertEqual(
            present, [probe_matrix.workspace_path(a) for a in arm.artifacts]
        )

    def test_installed_shim_runs_without_depending_on_the_agents_python(self):
        """Pins a defect found in the first end-to-end check: the shim source
        carries `#!/usr/bin/env python3`, which resolves against the *agent's*
        PATH. On macOS that can select the /usr/bin/python3 stub, and every arm-
        S+ CLI call fails with an Xcode error instead of running — an arm that
        looks like it chose not to use the CLI when in fact it could not."""
        _, layout = self._prepare("S+")
        shim = episode_mod.install_shim(
            layout.bin_dir, Path(episode_mod.__file__).parent / "satsuma_shim.py"
        )
        shebang = shim.read_text(encoding="utf-8").splitlines()[0]
        self.assertTrue(shebang.startswith("#!/"), shebang)
        self.assertNotIn("/usr/bin/env", shebang)
        self.assertTrue(
            Path(shebang[2:]).is_file(), f"shebang interpreter missing: {shebang}"
        )

    def test_every_arm_can_reach_a_working_python3(self):
        """Arm X cannot open its workbook without one, and a broken interpreter
        would read as an Excel-arm failure rather than an environment bug."""
        arm, layout = self._prepare("X-P0")
        env = episode_mod.build_environment(
            layout=layout,
            arm=arm,
            real_cli="/nonexistent/satsuma",
            base_env=dict(os.environ),
        )
        python = shutil.which("python3", path=env["PATH"])
        self.assertIsNotNone(python)
        completed = subprocess.run(
            [python, "-c", "print(1 + 1)"],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(completed.stdout.strip(), "2", completed.stderr)

    def test_withheld_arm_environment_carries_no_shim_configuration(self):
        arm, layout = self._prepare("M0")
        env = episode_mod.build_environment(
            layout=layout,
            arm=arm,
            real_cli="/nonexistent/satsuma",
            base_env=dict(os.environ),
        )
        self.assertNotIn("SATSUMA_SHIM_LOG", env)
        self.assertIsNone(shutil.which("satsuma", path=env["PATH"]))


class ShimRecordsWhatArmSPlusDid(unittest.TestCase):
    """The invocation record is a measurement, not a debug log: the PRD's whole
    `--json`-on-aggregates finding is only visible through output sizes."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.log = self.tmp / "invocations.jsonl"
        # A stand-in for the real CLI: prints a known number of bytes and exits
        # with a known code, so the assertions below are exact rather than
        # approximate.
        self.fake_cli = self.tmp / "fake-cli.py"
        self.fake_cli.write_text(
            "#!/usr/bin/env python3\n"
            "import sys\n"
            "sys.stdout.write('x' * 42)\n"
            "sys.exit(3 if '--fail' in sys.argv else 0)\n",
            encoding="utf-8",
        )
        self.fake_cli.chmod(0o755)
        self.shim = Path(__file__).resolve().parent / "satsuma_shim.py"

    def _run_shim(self, args: list[str]):
        env = dict(os.environ)
        env["SATSUMA_SHIM_LOG"] = str(self.log)
        env["SATSUMA_SHIM_REAL"] = str(self.fake_cli)
        return subprocess.run(
            [sys.executable, str(self.shim), *args],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )

    def _records(self) -> list[dict]:
        return [
            json.loads(line)
            for line in self.log.read_text(encoding="utf-8").splitlines()
            if line
        ]

    def test_forwards_output_and_records_flags_exit_code_and_output_size(self):
        completed = self._run_shim(["graph", "--json"])
        self.assertEqual(completed.stdout, "x" * 42)
        self.assertEqual(completed.returncode, 0)
        record = self._records()[0]
        self.assertEqual(record["argv"], ["graph", "--json"])
        self.assertEqual(record["subcommand"], "graph")
        self.assertEqual(record["stdout_bytes"], 42)
        self.assertEqual(record["exit_code"], 0)

    def test_propagates_a_failing_exit_code_rather_than_masking_it(self):
        completed = self._run_shim(["validate", "--fail"])
        self.assertEqual(completed.returncode, 3)
        self.assertEqual(self._records()[0]["exit_code"], 3)

    def test_excluded_subcommand_is_blocked_and_recorded_without_reaching_the_cli(self):
        """`satsuma context` is excluded by design (it would turn the experiment
        into "our retrieval heuristic vs. grep"), and an attempt to call it is a
        protocol observation the write-up reports."""
        completed = self._run_shim(["context", "loss_amount"])
        self.assertEqual(completed.returncode, 69)
        self.assertEqual(
            completed.stdout, "", "the excluded command must not reach the real CLI"
        )
        record = self._records()[0]
        self.assertTrue(record["excluded"])
        self.assertEqual(record["subcommand"], "context")

    def test_every_invocation_appends_rather_than_overwriting(self):
        self._run_shim(["summary"])
        self._run_shim(["arrows", "loss_amount"])
        self.assertEqual(
            [r["subcommand"] for r in self._records()], ["summary", "arrows"]
        )


class UsageComesFromTheHarnessNumbers(unittest.TestCase):
    """Token accounting is the deliverable of sl-x9m1; a re-derivation would be
    a second, unvalidated tokenizer in the loop."""

    #: A two-turn episode with a malformed line in the middle, standing in for
    #: the shape pi emits: usage on each assistant `message_end`, one `turn_end`
    #: per completed turn.
    STREAM: ClassVar[list[str]] = [
        json.dumps({"type": "session", "id": "abc"}),
        json.dumps({"type": "turn_start"}),
        json.dumps(
            {
                "type": "tool_execution_start",
                "toolName": "bash",
                "args": {"command": "satsuma graph --compact"},
            }
        ),
        json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "model": "claude-sonnet-5-20260114",
                    "provider": "anthropic",
                    "content": [{"type": "text", "text": "first"}],
                    "usage": {
                        "input": 100,
                        "output": 10,
                        "cacheRead": 5,
                        "cacheWrite": 2,
                        "totalTokens": 117,
                        "cost": {"total": 0.01},
                    },
                },
            }
        ),
        json.dumps({"type": "turn_end"}),
        "not json at all",
        json.dumps({"type": "turn_start"}),
        json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "model": "claude-sonnet-5-20260114",
                    "provider": "anthropic",
                    "content": [{"type": "text", "text": "final answer"}],
                    "usage": {
                        "input": 200,
                        "output": 20,
                        "cacheRead": 1,
                        "cacheWrite": 0,
                        "totalTokens": 221,
                        "cost": {"total": 0.02},
                    },
                },
            }
        ),
        json.dumps({"type": "turn_end"}),
    ]

    def test_totals_sum_every_assistant_message(self):
        result = pi_harness.parse_stream(self.STREAM)
        self.assertEqual(result.usage.input, 300)
        self.assertEqual(result.usage.output, 30)
        self.assertEqual(result.usage.cache_read, 6)
        self.assertEqual(result.usage.cache_write, 2)
        self.assertAlmostEqual(result.usage.cost_usd, 0.03)

    def test_turn_count_is_the_completed_turns(self):
        self.assertEqual(pi_harness.parse_stream(self.STREAM).usage.turns, 2)

    def test_resolved_dated_model_id_is_captured_not_the_friendly_name(self):
        """The PRD requires the resolved snapshot id, because hosted ids move
        under stable marketing names."""
        self.assertEqual(
            pi_harness.parse_stream(self.STREAM).resolved_models,
            ["claude-sonnet-5-20260114"],
        )

    def test_final_text_is_the_last_assistant_message(self):
        self.assertEqual(
            pi_harness.parse_stream(self.STREAM).final_text, "final answer"
        )

    def test_tool_calls_are_recorded_for_cross_checking_the_shim_log(self):
        self.assertEqual(
            pi_harness.parse_stream(self.STREAM).tool_calls,
            [("bash", "satsuma graph --compact")],
        )

    def test_a_malformed_line_does_not_discard_a_paid_for_episode(self):
        """The stream is written to disk before parsing; a parse that threw
        would strand an episode that already cost money."""
        self.assertEqual(pi_harness.parse_stream(["{oops"]).usage.total_tokens, 0)


class HarnessInvocation(unittest.TestCase):
    """The flags are the hermeticity guarantee — an episode must be a function
    of the artifact and the prompt, not of the operator's pi install."""

    def _argv(self, **overrides):
        kwargs = dict(
            pi_bin="pi",
            provider="anthropic",
            model="claude-sonnet-5",
            thinking="off",
            prompt="do the thing",
        )
        kwargs.update(overrides)
        return pi_harness.build_argv(**kwargs)

    def test_every_hermeticity_flag_is_passed(self):
        argv = self._argv()
        for flag in pi_harness.HERMETIC_FLAGS:
            self.assertIn(flag, argv)

    def test_resident_reference_is_appended_to_the_system_prompt_only_when_given(self):
        self.assertNotIn("--append-system-prompt", self._argv())
        argv = self._argv(append_system_prompt_file=Path("/tmp/ref.md"))
        self.assertEqual(argv[argv.index("--append-system-prompt") + 1], "/tmp/ref.md")

    def test_prompt_is_the_final_argument(self):
        self.assertEqual(self._argv()[-1], "do the thing")


if __name__ == "__main__":
    unittest.main()
