"""
Building the world one episode runs in.

An episode's environment is as much a part of the treatment as its prompt, and
two of the PRD's protocol requirements live entirely here:

  * **Arm S's withholding is enforced, not requested.** "An agent instructed not
    to use a binary that is on PATH will use it. Arm S runs with the CLI absent
    from PATH, and the runner asserts absence before the episode starts."
  * **Arm S+'s invocations are recorded**, via the shim installed as the only
    reachable `satsuma`.

This module owns the episode directory layout, the artifact copy, the PATH
construction and those assertions. It does not choose arms (`probe_matrix.py`),
talk to the harness (`pi_harness.py`), or decide what to run (`run_probe.py`).

Directory layout, one per episode:

    <run>/episodes/<cell>__<arm>__<task>__r<n>/
        workspace/              the agent's cwd — artifacts only, nothing else
        bin/                    PATH prefix: the node toolchain, plus the
                                satsuma shim on arm S+ only
        prompt.txt              the exact prompt sent
        system-append.md        arm S's resident reference blob, when used
        stream.jsonl            raw harness event stream
        stderr.log              harness stderr
        satsuma-invocations.jsonl   the shim's record (arm S+)
        episode.json            manifest, assertions, usage, tool calls
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import sys
from dataclasses import dataclass
from pathlib import Path

from probe_matrix import REFERENCE_RESIDENT_BLOB, Arm, workspace_path

#: Executables symlinked into every episode's bin directory.
#:
#: The node toolchain has to stay reachable because the real CLI is a node
#: program; symlinking it explicitly is what lets the PATH sanitiser below drop
#: the directory that *also* provides `satsuma` without taking node with it.
#:
#: `python3` is here for arm X, which cannot open a workbook without it. It is
#: pinned to the interpreter the *runner* resolved rather than left to the
#: agent's PATH, because macOS ships a `/usr/bin/python3` stub that fails unless
#: the Xcode command line tools are readable — and the anchor arm silently
#: losing its only way to read the artifact would look like a result.
_TOOLCHAIN_BINARIES = ("node", "npm", "npx", "python3")

#: Name the shim is installed under. It shadows nothing — the sanitised PATH
#: contains no other `satsuma` — so this is the only one an agent can reach.
_SHIM_NAME = "satsuma"


@dataclass
class EpisodeLayout:
    """Paths inside one episode directory. Created by `prepare_episode`."""

    root: Path
    workspace: Path
    bin_dir: Path
    prompt_path: Path
    system_append_path: Path | None
    stream_path: Path
    stderr_path: Path
    invocation_log: Path
    manifest_path: Path


def episode_id(cell_id: str, arm_id: str, task_id: str, repeat: int) -> str:
    """Stable, sortable directory name for one episode.

    `+` is legal in a path but reads badly in shell globs, so arm `S+` becomes
    `S-plus`. The manifest inside carries the real arm id.
    """
    safe_arm = arm_id.replace("+", "-plus")
    return f"{cell_id}__{safe_arm}__{task_id}__r{repeat}"


# --- PATH construction ------------------------------------------------------


def directories_providing_satsuma(path_value: str) -> list[str]:
    """Every PATH entry that contains an executable named `satsuma`.

    Split out from `sanitised_path` so the assertion and the sanitiser cannot
    disagree about what "provides satsuma" means.
    """
    providers = []
    for entry in path_value.split(os.pathsep):
        if not entry:
            continue
        candidate = Path(entry) / _SHIM_NAME
        try:
            provides = candidate.exists() and os.access(candidate, os.X_OK)
        except OSError:
            # A PATH entry we cannot stat (a sandboxed or unreadable directory)
            # cannot be shown to provide the CLI. Treating it as a provider
            # would drop working directories from the agent's PATH; treating it
            # as unreadable is safe because `assert_satsuma_absent` re-checks
            # the final PATH with `shutil.which`, which is the authority.
            provides = False
        if provides:
            providers.append(entry)
    return providers


def sanitised_path(path_value: str, bin_dir: Path) -> str:
    """The PATH an episode's agent gets.

    Every directory providing a `satsuma` binary is removed, and the episode's
    own bin directory is prepended. The removal applies to **every arm**, arm S+
    included: S+ reaches the CLI only through the shim in `bin_dir`, so "the
    real binary is unreachable directly" is a constant across the whole probe
    rather than an arm-varying condition.
    """
    providers = set(directories_providing_satsuma(path_value))
    kept = [
        entry
        for entry in path_value.split(os.pathsep)
        if entry and entry not in providers
    ]
    return os.pathsep.join([str(bin_dir), *kept])


def assert_satsuma_absent(env_path: str) -> None:
    """Fail loudly if a `satsuma` binary is reachable on the given PATH.

    Called for every arm whose treatment says the CLI is withheld, *before* the
    episode starts and after the environment is fully built — so what is checked
    is the environment the agent will actually get, not an intention about it.
    """
    found = shutil.which(_SHIM_NAME, path=env_path)
    if found is not None:
        raise RuntimeError(
            f"arm withholds the satsuma CLI, but it is reachable at {found} on the "
            f"episode PATH. Refusing to run: an unenforced withholding invalidates "
            f"the S vs S+ contrast."
        )


def assert_shim_reachable(env_path: str, bin_dir: Path) -> None:
    """Fail if arm S+'s agent would reach anything other than our shim."""
    found = shutil.which(_SHIM_NAME, path=env_path)
    expected = str(bin_dir / _SHIM_NAME)
    if found != expected:
        raise RuntimeError(
            f"arm S+ must reach the logging shim at {expected}, but PATH resolves "
            f"satsuma to {found!r}. Refusing to run: an unrecorded invocation mix "
            f"makes the S+ result uninterpretable."
        )


# --- Episode construction ---------------------------------------------------


def prepare_episode(
    *,
    root: Path,
    arm: Arm,
    prompt: str,
    probe_dir: Path,
    reference_path: Path,
) -> EpisodeLayout:
    """Materialise one episode directory and return its layout.

    Args:
        root: The episode directory to create. Must not already exist — a rerun
            writes a new run id rather than overwriting a paid-for episode.
        arm: The arm as resolved for this cell.
        prompt: The exact prompt text to send.
        probe_dir: `evals/phase-0.5-probe/`, which `arm.artifacts` are relative to.
        reference_path: `AI-AGENT-REFERENCE.md`, copied in only for arms whose
            reference delivery is the resident blob.
    """
    root.mkdir(parents=True, exist_ok=False)
    workspace = root / "workspace"
    workspace.mkdir()
    bin_dir = root / "bin"
    bin_dir.mkdir()

    _copy_artifacts(arm, probe_dir, workspace)
    _link_toolchain(bin_dir)

    prompt_path = root / "prompt.txt"
    prompt_path.write_text(prompt, encoding="utf-8")

    system_append_path: Path | None = None
    if arm.reference_delivery == REFERENCE_RESIDENT_BLOB:
        system_append_path = root / "system-append.md"
        shutil.copyfile(reference_path, system_append_path)

    return EpisodeLayout(
        root=root,
        workspace=workspace,
        bin_dir=bin_dir,
        prompt_path=prompt_path,
        system_append_path=system_append_path,
        stream_path=root / "stream.jsonl",
        stderr_path=root / "stderr.log",
        invocation_log=root / "satsuma-invocations.jsonl",
        manifest_path=root / "episode.json",
    )


def _copy_artifacts(arm: Arm, probe_dir: Path, workspace: Path) -> None:
    """Copy an arm's artifacts into the workspace at their `workspace_path`.

    The destination layout comes from `probe_matrix.workspace_path`, the same
    function the prompt uses to name the files — so an artifact the prompt names
    and an artifact the workspace holds cannot drift apart.
    """
    for artifact in arm.artifacts:
        destination = workspace / workspace_path(artifact)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(probe_dir / artifact, destination)


def _link_toolchain(bin_dir: Path) -> None:
    """Symlink the node toolchain into the episode bin directory.

    Only what is present on the host is linked; a missing `npx` is not worth
    failing an episode over, and the manifest records what the agent actually
    had.
    """
    for name in _TOOLCHAIN_BINARIES:
        source = shutil.which(name)
        if source:
            (bin_dir / name).symlink_to(source)


def install_shim(
    bin_dir: Path, shim_source: Path, interpreter: str | None = None
) -> Path:
    """Install the invocation-logging shim as the episode's `satsuma`.

    The shebang is rewritten to an absolute interpreter path — by default the
    one running the runner. The shim's own shebang is `/usr/bin/env python3`,
    which would resolve against the *agent's* PATH at invocation time; on macOS
    that can select the `/usr/bin/python3` stub, and every CLI call in arm S+
    would then fail with an error about the Xcode tools rather than doing
    anything. Pinning it keeps the shim independent of the environment it is
    there to measure.
    """
    destination = bin_dir / _SHIM_NAME
    source_lines = shim_source.read_text(encoding="utf-8").splitlines(keepends=True)
    source_lines[0] = f"#!{interpreter or sys.executable}\n"
    destination.write_text("".join(source_lines), encoding="utf-8")
    destination.chmod(
        destination.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
    )
    return destination


def build_environment(
    *,
    layout: EpisodeLayout,
    arm: Arm,
    real_cli: str,
    base_env: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build the child environment for one episode, then assert it is correct.

    The assertions run here rather than in the caller so that no code path can
    construct an environment and skip the check.
    """
    env = dict(base_env if base_env is not None else os.environ)
    env["PATH"] = sanitised_path(env.get("PATH", ""), layout.bin_dir)
    # Pi's startup network operations are noise in a measurement and a failure
    # mode on a flaky connection.
    env["PI_OFFLINE"] = "1"
    env["PI_SKIP_VERSION_CHECK"] = "1"

    if arm.satsuma_on_path:
        env["SATSUMA_SHIM_LOG"] = str(layout.invocation_log)
        env["SATSUMA_SHIM_REAL"] = real_cli
        assert_shim_reachable(env["PATH"], layout.bin_dir)
    else:
        # Withheld arms must not even carry the shim's configuration.
        env.pop("SATSUMA_SHIM_LOG", None)
        env.pop("SATSUMA_SHIM_REAL", None)
        assert_satsuma_absent(env["PATH"])

    return env


def read_invocations(layout: EpisodeLayout) -> list[dict]:
    """Read the shim's invocation log, or an empty list if nothing was invoked."""
    if not layout.invocation_log.exists():
        return []
    records = []
    for raw_line in layout.invocation_log.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records
