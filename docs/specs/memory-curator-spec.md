# Spec: Memory Curator

**Author:** Guybrush, with Jim
**Date:** 2026-05-23
**Status:** Draft — revised after stronger-model review

---

## 1. Purpose

Build an internal **Memory Curator** for The Librarian.

The curator periodically reviews stored memories and existing session evidence, then produces governed memory operations that improve the signal-to-noise ratio of the memory store.

The v1 outcome is simple: agents should receive cleaner, less duplicated, more current context from `start_context` and `recall` without Jim manually pruning memories.

---

## 2. Scope

### In scope for v1

- Deduplicate near-identical memories.
- Merge fragmented memories that belong together.
- Split memories that conflate unrelated facts.
- Archive stale, contradicted, duplicate, or low-signal memories.
- Surface durable facts from stored session summaries, decisions, and candidate memories.
- Run only from internal application code: scheduled jobs, threshold checks, or trusted maintenance paths.
- Store auditable curation-run and curation-operation records.
- Apply safe operations automatically; route risky/protected operations to proposals.

### Out of scope for v1

- Raw transcript capture.
- Changes to session storage shape.
- Agent-facing MCP tools for memory curation.
- Agent-facing slash commands for memory curation.
- Cross-project inference.
- Automatic session lifecycle management.
- Rebuilding a whole parallel memory store for review/adoption.

---

## 3. Non-negotiable privacy boundary

An off-record private conversation has **zero interaction with The Librarian**:

- no `start_context`;
- no `start_session`;
- no events;
- no memories;
- no MCP calls;
- no metadata in the store.

The curator therefore has nothing to filter for those conversations. They are absent from the database.

Do not confuse this with existing stored visibility values:

- `common` data may be curated in common slices;
- `agent_private` data may be curated only in that agent-private slice;
- off-record private data is not stored and is never an input.

The curator must never promote `agent_private` data into `common` output unless an explicit governed migration operation is added in a later spec.

---

## 4. Design principles

1. **Internal, not agent-facing.** The MCP tool registry must not include memory-curation management tools or equivalents.
2. **Operation-based, not rewrite-based.** The curator emits explicit memory operations against the existing store.
3. **Auditable.** Every run and operation is recorded, including skipped and failed operations.
4. **Conservative with destructive edits.** Confidence is useful, but not sufficient. Operation type and category determine whether auto-apply is allowed.
5. **Protected memory remains protected.** Identity and relationship changes always become proposals.
6. **Slice-local by default.** Do not merge across projects, agents, or visibility boundaries unless explicitly designed later.
7. **Idempotent.** Re-running on the same evidence should not produce duplicate memories or repeated archive/update churn.
8. **No session mutation.** The curator reads sessions as evidence; it does not alter session rows or session events.

---

## 5. Internal surfaces

The Memory Curator has no direct user or agent surface in v1. It is internal application behaviour inside The Librarian.

### Allowed internal surfaces

| Surface | Caller | Purpose |
|---|---|---|
| Scheduler tick | The Librarian process or worker | Check which slices are due and enqueue/run curation. |
| Threshold check | Memory/session write path or background worker | Notice enough new evidence has accumulated to justify a run. |
| Trusted maintenance path | Deployment/bootstrap/test code | Run bounded maintenance without creating a public command surface. |
| Existing memory/proposal store | Normal memory system | Receive created memories, archived duplicates, and review-required proposals. |

### Disallowed surfaces

| Surface | Reason |
|---|---|
| MCP memory-curation tools | Would expose internal maintenance to consumer agents. |
| Agent slash commands | Same problem; agents should not control curation runs. |
| User-facing CLI commands | Turns curation into an operator feature rather than background hygiene. |
| Dashboard run buttons or curation-control pages | Gives users a manual trigger for something that should be policy-driven code. |
| Prompt-triggered “please curate memories now” behaviour | Makes privacy and audit boundaries fuzzy. |

If Jim asks an agent to “clean up memories”, the agent should not call or point to a curation command. It can say that memory hygiene is handled internally by The Librarian, and then continue with the user’s actual task.

The only user-visible result should be better memory quality: cleaner `start_context`, better `recall`, and ordinary memory proposals when protected or risky changes need review.

---

## 6. Proposed implementation structure

All logic lives inside The Librarian repository and trust boundary. Names should say what the feature does: curate memory.

```text
packages/core/src/memory-curator/
  index.ts                 # Internal exports for The Librarian code only
  config.ts                # Config parsing/defaults
  slices.ts                # Select project/global/agent-private slices
  gather.ts                # Gather memories + session evidence
  prepass.ts               # Deterministic duplicate/staleness candidates
  prompt.ts                # LLM prompt builder
  parse-output.ts          # Zod validation and operation normalisation
  apply.ts                 # Apply/propose operations through store methods
  lock.ts                  # Run locking/idempotency helpers
  scheduler.ts             # Due-slice selection and enqueue policy
  worker.ts                # Executes queued/internal curation runs
  types.ts                 # Run, operation, evidence, config types

packages/mcp-server/src/internal-jobs/
  memory-curator.ts        # Starts scheduler/worker inside the trusted server boundary
```

Do not add Memory Curator files under any user/agent command surface:

- no `packages/mcp-server/src/mcp/tools/*` curation tools;
- no `/lib:*` slash commands;
- no `packages/cli/src/commands/*` curation commands;
- no dashboard route or button for triggering curation.

---

## 7. Configuration

The exact config source should follow The Librarian’s existing config/env conventions. The logical config shape is:

```yaml
memory_curator:
  enabled: true
  schedule: "0 3 * * *"          # Used by the internal scheduler
  min_sessions_since_run: 10
  max_days_since_run: 7
  max_sessions_per_run: 50
  max_memories_per_run: 200
  default_auto_apply: safe_only   # off | safe_only | high_confidence
  auto_apply_confidence: 0.90
  model:
    provider: deepseek
    model: deepseek-v4-pro
  slices:
    common_global: true
    common_project: true
    agent_private: false          # Curate only if explicitly enabled per agent
```

Recommended rollout: start with `default_auto_apply: off` or `safe_only` for the first production runs. Increase automation only after reviewing real output quality.

---

## 8. Data model

Use operation-level tables rather than a single opaque JSON blob. That makes audit, retry, idempotency, and internal filtering much easier.

### `memory_curation_runs`

```sql
CREATE TABLE memory_curation_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,              -- pending | running | completed | failed | cancelled
  trigger TEXT NOT NULL,             -- schedule | threshold | maintenance
  mode TEXT NOT NULL DEFAULT 'apply',-- apply | dry_run
  project_key TEXT,
  visibility TEXT NOT NULL,          -- common | agent_private
  agent_id TEXT,                     -- only for agent_private slices
  input_hash TEXT NOT NULL,
  input_memory_ids TEXT NOT NULL,    -- JSON array
  input_session_ids TEXT NOT NULL,   -- JSON array
  model_provider TEXT,
  model_name TEXT,
  usage_input_tokens INTEGER DEFAULT 0,
  usage_output_tokens INTEGER DEFAULT 0,
  summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
```

### `memory_curation_operations`

```sql
CREATE TABLE memory_curation_operations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,       -- noop | create | update | archive | merge | split
  status TEXT NOT NULL,               -- proposed | applied | skipped | failed | superseded
  confidence REAL NOT NULL,
  risk_level TEXT NOT NULL,           -- safe | normal | risky | protected
  source_memory_ids TEXT NOT NULL,    -- JSON array
  source_session_ids TEXT NOT NULL,   -- JSON array
  target_memory_ids TEXT NOT NULL,    -- JSON array of created/updated/proposed memory ids
  title TEXT,
  rationale TEXT NOT NULL,
  proposed_payload TEXT NOT NULL,     -- JSON operation payload
  applied_at TEXT,
  error TEXT,
  FOREIGN KEY (run_id) REFERENCES memory_curation_runs(id)
);
```

The existing memory/event store remains authoritative for memory state. These tables explain why a curator suggested or performed an operation.

---

## 9. Evidence gathering

A curation run gathers a bounded evidence bundle for one slice.

### Common project slice

- active `common` memories where `project_key = X`;
- proposed `common` memories where `project_key = X`;
- archived memory tombstones for `project_key = X` (id, title, category, archived date; body optional and capped);
- sessions with `project_key = X` and `visibility = common`;
- session summaries, decisions, candidate memories, files touched, commands run.

### Common global slice

- active/proposed/tombstone memories with global scope or null project;
- stored sessions only if explicitly global/null project and common visibility.

### Agent-private slice

- same shape as above, but only for the specific `agent_id` and `visibility = agent_private`;
- disabled by default for v1 unless Jim wants per-agent private cleanup.

### Evidence caps

Use deterministic ordering and caps:

- sessions: newest eligible first, max `max_sessions_per_run`;
- memories: active first, then proposed, then tombstones;
- session evidence: decisions and candidate memories before long summaries;
- proposed memories: include enough status/context to decide whether to approve, reject, supersede, or leave pending;
- large fields trimmed with explicit markers.

The prompt must know when evidence was truncated.

Before prompt construction, evidence gathering must redact or exclude secret-looking material from memory bodies, session summaries, commands run, file paths, and metadata. Do not wait until output validation to catch secrets; by then the sensitive value may already have been sent to an LLM.

---

## 10. Execution pipeline

```text
select due slice
  → acquire slice lock
  → gather evidence
  → compute input hash
  → skip if identical completed run exists
  → deterministic pre-pass
  → LLM operation proposal
  → validate and normalise operations
  → risk-classify operations
  → apply/propose/skip operations
  → record run summary and metrics
  → release lock
```

### 10.1 Locking

Only one run may execute for the same slice at a time. Use a database-backed lock or transaction guard. This protects against duplicate jobs when multiple scheduler/worker instances overlap.

Locks need stale-run recovery. Record a heartbeat/updated timestamp and a configurable TTL; a later worker may mark a run failed and reclaim the lock only after the TTL expires. A crashed worker must not block a slice forever.

### 10.2 Input hash

The input hash should include:

- slice identifiers;
- memory ids + updated timestamps + statuses;
- session ids + updated/last activity timestamps;
- candidate memory content hashes;
- curator prompt/version.

If a completed **apply-mode** run with the same hash exists, skip by default. Internal maintenance code may explicitly bypass the skip only when it records a distinct `maintenance` trigger and rationale.

Dry-runs must not satisfy idempotency for later real runs. Store `mode = dry_run` on dry-run records and ignore those rows when deciding whether an apply-mode run has already completed.

### 10.3 Deterministic pre-pass

Before calling an LLM, generate cheap candidates:

- exact title/body duplicates after normalisation;
- same title, near-identical body;
- obvious obsolete “considering/maybe” memories contradicted by later decisions;
- proposed memories matching active memories.

The LLM receives these candidates instead of discovering everything from scratch.

### 10.4 LLM pass

The LLM produces structured JSON only. No prose parsing.

Required properties per operation:

```ts
type CuratorOperation =
  | { type: "noop"; source_memory_ids: string[]; rationale: string; confidence: number }
  | { type: "archive"; source_memory_ids: string[]; source_session_ids?: string[]; rationale: string; confidence: number }
  | { type: "update"; source_memory_id: string; patch: MemoryPatch; rationale: string; confidence: number }
  | { type: "merge"; source_memory_ids: string[]; replacement: MemoryInput; rationale: string; confidence: number }
  | { type: "split"; source_memory_id: string; replacements: MemoryInput[]; rationale: string; confidence: number }
  | { type: "create"; source_session_ids: string[]; memory: MemoryInput; rationale: string; confidence: number };
```

`MemoryInput` must use the existing memory fields: title, body, category, visibility, scope, project_key, applies_to, priority, confidence, tags.

### 10.5 Validation

Reject, skip, or route to review when:

- referenced memory/session ids are not in the evidence bundle;
- replacement memory changes visibility, project, scope, owning agent, or other slice boundary unexpectedly;
- category is protected according to the store’s central protected-category list;
- confidence is outside `0..1`;
- operation has no rationale;
- operation would create an empty or duplicate memory;
- operation attempts to use secret-looking strings or raw credentials.

Boundary-changing operations are invalid/skipped in v1. Do not silently turn them into proposals; cross-boundary promotion needs its own future governed migration design.

Protected-category operations are never auto-applied. They become review items/proposals through the same protected-memory governance path used by normal memory writes.

Secret-looking values should cause the operation to be skipped and logged for review, not written to memory. Evidence gathering should already have redacted such values before the LLM pass.

---

## 11. Apply policy

| Condition | Default result |
|---|---|
| Protected category (`identity`, `relationship`, or central protected list) | Review/proposal only; never auto-apply. |
| Visibility/project/scope/agent boundary change | Invalid/skipped in v1. |
| `split` operation | Proposal only in v1. |
| `create` from session candidate memory with ordinary technical category and strong direct evidence | Auto-apply if confidence ≥ threshold, otherwise proposal. |
| Exact duplicate archive/merge in same category/scope/visibility/project/owner with compatible `applies_to` | Auto-apply if confidence ≥ threshold. |
| Semantic update of body/title | Proposal unless marked safe by deterministic pre-pass. |
| Low confidence | Proposal or skip, depending on quality. |
| Malformed/unsafe operation | Skip and record. |

Auto-applied operations must still use normal store methods:

- archive via existing memory archive/update pathway;
- create via existing memory creation/proposal pathway;
- update via existing memory update pathway;
- merge/split as create/update/archive sequences with operation ids recorded.

Do not bypass the store with raw SQL updates for memory mutations.

### 11.1 Review/proposal model

There is no dedicated curation review queue in v1. The apply policy has three outcomes:

- safe operations are applied automatically through normal store methods;
- review-worthy `create` operations become ordinary memory proposals, using the existing proposal lifecycle;
- operations that require a bespoke curation UI or manual approval workflow are skipped or recorded as internal audit records, not exposed as a new user-facing queue.

If a future design adds a review queue, it must be specified separately. Do not smuggle one in as a dedicated dashboard surface for v1.

Proposed memories included as evidence need their own lifecycle handling. A curator may suggest that an existing proposal is duplicate or stale, but it must not approve, reject, supersede, or merge an existing proposal unless the apply code explicitly supports that state transition through the normal proposal store methods.

Agent-private runs must enforce ownership from the run slice. `MemoryInput` does not carry ownership by itself; apply methods must pass the run’s `agent_id` and reject any operation that attempts to create/update another agent’s private memory.

---

## 12. Internal trigger contract

There is deliberately no Memory Curator CLI, slash command, MCP tool, or dashboard trigger.

Curation is started by internal code paths only. Suggested entrypoints:

```ts
scheduleMemoryCurationTick(now: Date): Promise<void>
enqueueDueMemoryCurationRuns(reason: "schedule" | "threshold" | "maintenance"): Promise<void>
runMemoryCurationWorker(): Promise<void>
```

These functions are imported by the trusted Librarian server/worker runtime and by tests. They are not wrapped as user-facing commands.

Allowed trigger values:

| Trigger | Source | Notes |
|---|---|---|
| `schedule` | Internal scheduler tick | Normal background hygiene. |
| `threshold` | Internal evidence-count check | Runs when enough stored sessions or memory writes have accumulated. |
| `maintenance` | Trusted deployment/bootstrap/test path | For bounded internal maintenance only; not exposed as a manual operator command. |

The implementation should keep all curation controls behind module boundaries and config, not behind public request handlers.

---

## 13. Review and observability

Do not build a dedicated Memory Curator dashboard in v1.

Curation should be observable internally through logs, database records, and tests. If a curation result needs human review, it should appear through existing memory proposal/review mechanisms as an ordinary proposal, not as a curation-control UI.

Minimum internal audit data:

- run status, slice, trigger, date;
- run summary and token usage;
- operations grouped by status/type/risk;
- memory ids created/updated/archived;
- skipped/failed operations with reasons.

Use internal tooling conventions if these records are later exposed in a read-only audit view. Do not include a “run now”, “force”, “replay”, or curation-control action in v1.

---

## 14. Scheduler/worker

Preferred v1 deployment:

- start a single internal scheduler/worker from The Librarian server process, or from a trusted worker process in the same deployment;
- scheduler decides which slices are due based on config and last completed runs;
- threshold checks enqueue due slices from inside normal memory/session write paths or a periodic background scan;
- worker executes queued runs behind database locks.

The scheduler must be safe if started in more than one process. Locking and input-hash idempotency are required.

---

## 15. Testing strategy

### Unit tests

- slice selection respects project, visibility, and agent boundaries;
- evidence gathering excludes off-slice data;
- evidence gathering redacts secret-looking values before prompt construction;
- archived tombstones are included only in capped metadata form;
- deterministic pre-pass detects exact duplicates;
- output parser rejects malformed operations;
- risk classifier routes protected categories to proposals;
- apply policy never crosses visibility/project boundaries;
- agent-private apply paths enforce the run owner `agent_id`;
- idempotency skips identical completed input hash;
- dry-runs do not cause later apply-mode runs to skip;
- lock prevents concurrent same-slice runs.
- stale lock TTL allows crash recovery.

### Integration tests

- seeded SQLite run deduplicates two ordinary project memories;
- session decision creates/proposes a new project memory;
- protected identity candidate becomes a proposal;
- exact duplicate archive is auto-applied under `safe_only`;
- low-confidence semantic update is proposed, not applied;
- dry-run records no memory mutations;
- existing proposed-memory duplicates can be rejected/superseded without treating them as active memories;
- no MCP curation-management tool appears in `tools/list`.

### Regression tests for earlier contradictions

- private/off-record data is not represented as a stored session in test fixtures;
- `agent_private` evidence never creates `common` output;
- no MCP tool, slash command, CLI command, dashboard trigger, or prompt-triggered path can start a curation run.

---

## 16. Success criteria

v1 is complete when:

- [ ] due curation runs automatically from internal scheduler/worker code;
- [ ] threshold-triggered curation can enqueue due slices without user or agent involvement;
- [ ] no user-facing or agent-facing control can start, force, replay, or inspect curation as a feature-specific command;
- [ ] every run and operation is auditable internally;
- [ ] duplicate memories can be safely merged/archived;
- [ ] conflated memories can be proposed as splits;
- [ ] durable facts from stored session evidence can become memory proposals or safe ordinary memories;
- [ ] protected categories always route to proposals;
- [ ] curation is slice-local by default;
- [ ] repeated runs on unchanged evidence are idempotent;
- [ ] no consumer-agent MCP or slash command surface exists for memory curation;
- [ ] No session storage changes are required.

---

## 17. Open questions before implementation

1. Should the first production run be dry-run/proposal-only by default?
2. Which model should be configured for v1?
3. Should `agent_private` slices be disabled entirely at first?
4. How much archived-memory tombstone detail is enough to prevent resurrection?
5. Which operation types can be represented as ordinary memory proposals, and which should remain internal audit-only until a later design?

---

## 18. Parking lot

- Transcript-backed curation.
- Cross-project pattern detection.
- Curator quality metrics from `verify_memory` outcomes.
- Automatic “memory budget” targets per category/project.
- Recommendations to improve session checkpoint quality.
- Session lifecycle automation. This has its own research/spec and should not be folded into this feature.
