# Librarian session layer (Pi)

Minimal system-prompt snippet for Pi-hosted agents.

## What you have access to

The Librarian's session and memory tools are available. Use `/lib:session` (textual command, recognised in user input) for the session lifecycle and `remember` / `propose_memory` for durable facts.

## The `/lib:session` surface

`/lib:session` commands are **textual commands handled by the agent**. The canonical contract lives in [`docs/slash-commands.md`](../../docs/slash-commands.md):

- `/lib:session start [title] [--private]` — bound the work.
- `/lib:session list` — show resumable sessions. Numbered entries are agent-side scratch; tool calls use canonical `session_id`.
- `/lib:session resume <number|session_id>` — fetch handover and attach.
- `/lib:session checkpoint` / `pause` / `end`.
- `/lib:session archive` / `restore` / `delete`.
- `/lib:session search <query>`.
- `/lib:session status`.

## `source_ref` for Pi

Use the most specific form available:

- `pi:device:{device_id}:session:{session_id}` when both ids exist.
- `pi:device:{device_id}` as a fallback.
- `cwd:{absolute_path}` if no device id is available.

## Capture mode

Default to **`summary`** (or `off` on constrained devices). **Never `log`** for Pi traffic without explicit operator consent.

## Visibility (Principle 9)

Sessions default to `common`. Before starting a `common` session, scan the surrounding context for sensitivity signals (identity, secrets, personal context, sensitive debugging). If signals are present and `--private` was not supplied, **confirm with the user before starting**.

## Boundaries

- Session history is **evidence**, not durable memory. Promote selectively via `/lib:session end`'s candidates or `promote_session_fact`.
- Use `remember` / `propose_memory` for durable facts. Protected categories (identity, relationship) always route to proposals.
- Do not auto-promote anything from session content.
