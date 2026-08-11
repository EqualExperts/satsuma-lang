"""
The Phase 0.5 probe matrix: which arms exist, what each one shows the agent,
and the two task prompts.

This module owns the *treatment definitions* and nothing else. It does not run
episodes (`run_probe.py`), build agent environments (`episode.py`), or talk to
the harness (`pi_harness.py`). Keeping the treatments in one declarative file is
deliberate: an arm's definition is the experiment's independent variable, and a
reader auditing the probe should be able to see every difference between arms in
a single screen.

The invariant that makes the arms comparable — stated here because it is easy to
break by accident when adding an arm:

    Arms differ in exactly three things: the artifact files placed in the
    workspace, whether the `satsuma` CLI is reachable, and how that arm's
    reference material is delivered. Tooling, model, harness, thinking level,
    prompt scaffolding and answer format are identical across every arm.

See `features/44-token-and-task-eval/PRD.md` §"Phase 0.5" for the design, and
`../answer-keys/` for the graded ground truth. The task questions below are
quoted verbatim from those answer keys; if they ever diverge, the answer key is
authoritative and this file is the bug.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# --- Reference delivery -----------------------------------------------------
#
# Feature 45 shipped the agent reference as three envelopes with very different
# resident costs (reference/token-costs.md): the portable blob (6,813 tokens
# resident), the CLI (0 resident, pay per --section/--profile slice), and the
# skill (164 resident, 7,062 loaded). Each Satsuma arm gets the envelope that
# arm would actually ship with, which is why S and S+ differ in reference
# delivery as well as in CLI access. That is a deliberate pairing choice, not an
# oversight — see runner/README.md §"Two protocol decisions this runner makes".

#: No reference material at all. The artifact is expected to be self-describing
#: (Excel, markdown).
REFERENCE_NONE = "none"

#: The whole `AI-AGENT-REFERENCE.md` blob is resident in the system prompt from
#: turn one, and every token of it is charged to the arm. This is how arm S must
#: work: with no CLI there is no other delivery mechanism.
REFERENCE_RESIDENT_BLOB = "resident-blob"

#: Nothing resident. The agent is told the CLI can print reference sections on
#: demand and pays only for the slices it asks for. This is the shipped CLI
#: envelope, and arm S+ measures whether an agent actually uses it.
REFERENCE_CLI_ON_DEMAND = "cli-on-demand"


@dataclass(frozen=True)
class Arm:
    """One treatment.

    Attributes:
        id: Stable identifier used in episode directory names and results.
        label: One-line description for the run manifest and the write-up.
        artifacts: Paths relative to `evals/phase-0.5-probe/`, copied into the
            episode workspace preserving their relative layout. The first entry
            is the spec the prompt names; the rest are files it depends on.
        satsuma_on_path: Whether the `satsuma` shim is installed in the
            episode's bin directory. False means the runner asserts the binary
            is unreachable before the episode starts (PRD: arm S's withholding
            is *enforced*, not requested).
        reference_delivery: One of the REFERENCE_* constants above.
        artifact_description: The clause the prompt uses to name the artifact.
            Phrasings are kept structurally parallel across arms so that no arm
            is given a stronger hint than another.
    """

    id: str
    label: str
    artifacts: tuple[str, ...]
    satsuma_on_path: bool
    reference_delivery: str
    artifact_description: str


# --- The five behavioural arms of the full-size cell ------------------------

# --- Workspace layout -------------------------------------------------------
#
# One definition, used both to copy artifacts in and to name them in the prompt,
# so the prompt can never point at a path the workspace does not have.
#
# The Satsuma spec imports `"../lookups/claims_fx.stm"`, which only resolves if
# the spec sits one directory below the lookup's parent. So every arm's spec
# lives in `spec/` and the lookup in `lookups/` — a layout that is identical
# across arms (no arm gets a structural hint the others lack) and neutral in its
# naming (nothing in the workspace says "eval", which an agent could read as a
# cue to behave differently).

#: Directory the artifact the prompt names is placed in.
SPEC_DIR = "spec"
#: Directory imported lookup files keep, because the import path depends on it.
LOOKUP_DIR = "lookups"


def workspace_path(artifact: str) -> str:
    """Where an artifact, given relative to `evals/phase-0.5-probe/`, lands in the workspace."""
    name = artifact.rsplit("/", 1)[-1]
    if artifact.startswith(f"{LOOKUP_DIR}/"):
        return f"{LOOKUP_DIR}/{name}"
    return f"{SPEC_DIR}/{name}"


def _describe(artifact: str, kind: str, imports: str | None = None) -> str:
    """The prompt clause naming an arm's artifact.

    Structurally parallel across arms by construction: same sentence, same
    ordering, only the noun and the path differ. `imports` is appended for the
    Satsuma arms, which are the only ones whose spec is more than one file — and
    stating that is a fact about the artifact, not a hint about how to use it.
    """
    clause = f"The mapping specification is the {kind} `{workspace_path(artifact)}`."
    if imports:
        clause += f" It imports `{workspace_path(imports)}`."
    return clause


#: The two Satsuma arms need the imported lookup file as well as the spec: the
#: probe README records that arm S/S+ token accounting covers both files.
_LOOKUP = "lookups/claims_fx.stm"
_FULL_STM = "scenario/meridian-claims.stm"
_SATSUMA_ARTIFACTS = (_FULL_STM, _LOOKUP)

ARMS: dict[str, Arm] = {
    "X-P0": Arm(
        id="X-P0",
        label="Excel, profile P0 — tidy, adversarially favourable to Excel. The anchor arm.",
        artifacts=("scenario/meridian-claims-P0.xlsx",),
        satsuma_on_path=False,
        reference_delivery=REFERENCE_NONE,
        artifact_description=_describe(
            "scenario/meridian-claims-P0.xlsx", "Excel workbook"
        ),
    ),
    "X-P2": Arm(
        id="X-P2",
        label="Excel, profile P2 — the realism check: free-text notes, merged headers, "
        "semantics in fill colour, a stale Archived tab.",
        artifacts=("scenario/meridian-claims-P2.xlsx",),
        satsuma_on_path=False,
        reference_delivery=REFERENCE_NONE,
        artifact_description=_describe(
            "scenario/meridian-claims-P2.xlsx", "Excel workbook"
        ),
    ),
    "M0": Arm(
        id="M0",
        label="Markdown, profile M0 — a tidy field-level table. The sceptic's substitute.",
        artifacts=("scenario/meridian-claims.md",),
        satsuma_on_path=False,
        reference_delivery=REFERENCE_NONE,
        artifact_description=_describe(
            "scenario/meridian-claims.md", "markdown document"
        ),
    ),
    "S": Arm(
        id="S",
        label="Satsuma source alone — no CLI, reference resident in context.",
        artifacts=_SATSUMA_ARTIFACTS,
        satsuma_on_path=False,
        reference_delivery=REFERENCE_RESIDENT_BLOB,
        artifact_description=_describe(_FULL_STM, "Satsuma spec", imports=_LOOKUP),
    ),
    "S+": Arm(
        id="S+",
        label="Satsuma source plus the CLI — the configuration actually shipped.",
        artifacts=_SATSUMA_ARTIFACTS,
        satsuma_on_path=True,
        reference_delivery=REFERENCE_CLI_ON_DEMAND,
        artifact_description=_describe(_FULL_STM, "Satsuma spec", imports=_LOOKUP),
    ),
}


# --- The 1-mapping crossover cell -------------------------------------------
#
# PRD §Phase 0.5, "Include a cell designed to lose": at one mapping the agent
# reference and the per-call CLI round-trips are unamortised, so S+ should lose
# outright. Confirming the crossover exists is the most credible thing the
# write-up can contain, so the cell is not optional.
#
# X-P2 has no 1-mapping rendering — the messiness primitives need a workbook
# with several tabs to be meaningful — so the crossover cell runs four arms.

_ONE_MAPPING_XLSX = "scenario/meridian-claims-1-mapping-P0.xlsx"
_ONE_MAPPING_MD = "scenario/meridian-claims-1-mapping.md"
_ONE_MAPPING_STM = "scenario/meridian-claims-1-mapping.stm"

#: The 1-mapping spec imports the same lookup as the full one, so the Satsuma
#: arms carry both files here too.
_ONE_MAPPING_ARTIFACTS: dict[str, tuple[str, ...]] = {
    "X-P0": (_ONE_MAPPING_XLSX,),
    "M0": (_ONE_MAPPING_MD,),
    "S": (_ONE_MAPPING_STM, _LOOKUP),
    "S+": (_ONE_MAPPING_STM, _LOOKUP),
}

_ONE_MAPPING_DESCRIPTIONS: dict[str, str] = {
    "X-P0": _describe(_ONE_MAPPING_XLSX, "Excel workbook"),
    "M0": _describe(_ONE_MAPPING_MD, "markdown document"),
    "S": _describe(_ONE_MAPPING_STM, "Satsuma spec", imports=_LOOKUP),
    "S+": _describe(_ONE_MAPPING_STM, "Satsuma spec", imports=_LOOKUP),
}


@dataclass(frozen=True)
class Cell:
    """A spec size the whole arm set is run at.

    The probe runs two cells: the full ten-mapping scenario, and the 1-mapping
    crossover cell that S+ is predicted to lose.
    """

    id: str
    label: str
    #: Arm ids taking part, in run order.
    arms: tuple[str, ...]
    #: Per-arm artifact overrides; an arm absent here uses `Arm.artifacts`.
    artifact_overrides: dict[str, tuple[str, ...]] = field(default_factory=dict)
    #: Per-arm prompt-clause overrides, keyed the same way.
    description_overrides: dict[str, str] = field(default_factory=dict)


CELLS: dict[str, Cell] = {
    "full": Cell(
        id="full",
        label="The full hand-authored scenario — six mappings, thirty-one leaf arrow targets.",
        arms=("X-P0", "X-P2", "M0", "S", "S+"),
    ),
    "1-mapping": Cell(
        id="1-mapping",
        label="The crossover cell — one mapping, where S+ is predicted to lose outright.",
        arms=("X-P0", "M0", "S", "S+"),
        artifact_overrides=_ONE_MAPPING_ARTIFACTS,
        description_overrides=_ONE_MAPPING_DESCRIPTIONS,
    ),
}


def resolve_arm(arm_id: str, cell_id: str) -> Arm:
    """Return the arm as it runs *in this cell*, with any per-cell overrides applied.

    Raises KeyError if the arm does not take part in the cell, which is the
    intended failure for a mistyped `--arms` value.
    """
    cell = CELLS[cell_id]
    if arm_id not in cell.arms:
        raise KeyError(f"arm {arm_id!r} does not run in cell {cell_id!r}")
    arm = ARMS[arm_id]
    return Arm(
        id=arm.id,
        label=arm.label,
        artifacts=cell.artifact_overrides.get(arm_id, arm.artifacts),
        satsuma_on_path=arm.satsuma_on_path,
        reference_delivery=arm.reference_delivery,
        artifact_description=cell.description_overrides.get(
            arm_id, arm.artifact_description
        ),
    )


# --- Tasks ------------------------------------------------------------------


@dataclass(frozen=True)
class Task:
    """One graded question, identical in wording across every arm.

    Attributes:
        id: `T4` or `T5`, matching the PRD's task numbering.
        question: Quoted verbatim from the answer key. Never reworded per arm —
            a reworded question is a different experiment.
        answer_format: How the agent must present its final answer, so that
            hand-grading (sl-3yzd) reads one unambiguous set per episode. Also
            identical across arms.
    """

    id: str
    question: str
    answer_format: str


TASKS: dict[str, Task] = {
    "T4": Task(
        id="T4",
        question=(
            "If the type of `claim_header.loss_amount` changes from `DECIMAL(14,2)` to a "
            "`STRING`, which downstream target fields are affected and would need to be "
            "reviewed?"
        ),
        answer_format=(
            "Finish your reply with a fenced code block labelled `answer`, containing one "
            "affected target field per line and nothing else. Qualify each field as "
            "`<target_schema>.<field>`."
        ),
    ),
    "T5": Task(
        id="T5",
        question=(
            "List every field in this spec where the transformation is ambiguous or "
            "underspecified, and flag it rather than guess. For each, say what is "
            "underspecified."
        ),
        answer_format=(
            "Finish your reply with a fenced code block labelled `answer`, containing one "
            "field per line and nothing else, in the form "
            "`<qualified field> - <what is underspecified>`. Qualify each field enough to "
            "identify which mapping's target it is."
        ),
    ),
}


# --- Prompt assembly --------------------------------------------------------

#: Shared preamble. Deliberately terse and arm-neutral: it states the situation
#: and nothing about how to approach it, because "does the agent reach for the
#: narrowing commands" is one of the things the probe is measuring, and telling
#: it to would be measuring our own instruction instead.
_PREAMBLE = (
    "You are reviewing a source-to-target data mapping specification for an "
    "insurance claims pipeline."
)

#: Appended for arm S+ only. It says the CLI exists and how to discover its
#: reference material — the shipped affordance — without recommending any
#: particular command, which is the behaviour under measurement.
_CLI_AVAILABILITY = (
    "The `satsuma` CLI is installed and on your PATH. Run `satsuma --help` for its "
    "commands, and `satsuma agent-reference --list` for the reference sections it can "
    "print on demand."
)


def build_prompt(arm: Arm, task: Task) -> str:
    """Assemble the user prompt for one episode.

    The only arm-varying parts are the artifact clause and the CLI-availability
    sentence; everything else is byte-identical across arms so that a token
    difference between arms is a property of the artifact, not the prompt.
    """
    parts = [_PREAMBLE, arm.artifact_description]
    if arm.satsuma_on_path:
        parts.append(_CLI_AVAILABILITY)
    parts.append(task.question)
    parts.append(task.answer_format)
    return "\n\n".join(parts) + "\n"
