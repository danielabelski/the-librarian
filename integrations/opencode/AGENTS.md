# Librarian session layer (OpenCode)

Drop this file into the project root (or merge with an existing `AGENTS.md`).

## What you have access to

The Librarian's HTTP MCP server is connected. Available session tools include `start_session`, `list_sessions`, `continue_session`, `checkpoint_session`, `pause_session`, `end_session`, `archive_session`, `restore_session`, `delete_session`, `search_sessions`, `get_session`, `list_session_events`, `record_session_event`, `attach_session`, `promote_session_fact`, plus the full memory tool surface.

## The `/lib:session` surface

OpenCode supports native command registration, so `/lib:session` is wired as a real OpenCode command (see [`commands.example.json`](./commands.example.json)). The agent then routes the parsed subcommand + args to the corresponding MCP tool.

The canonical contract lives in [`docs/slash-commands.md`](../../docs/slash-commands.md). Highlights:

- `/lib:session start [title] [--private]` — bound the work.
- `/lib:session list` — show resumable sessions; never auto-select. Numbered entries are agent-side scratch; tool calls use canonical `session_id`.
- `/lib:session resume <number|session_id>` — fetch handover and attach.
- `/lib:session checkpoint` / `pause` / `end`.
- `/lib:session archive` / `restore` / `delete`.
- `/lib:session search <query>`.
- `/lib:session status`.

## `source_ref` for OpenCode

Use the project-oriented form:

- Preferred: `opencode:project:{absolute_path}` plus an OpenCode session id if available.
- Fallback: `cwd:{absolute_path}`.

The wrapper script in this package populates `LIBRARIAN_SESSION_ID` for child processes; respect it when recording events.

## Capture mode

Default to `summary`. Never enable raw `log` capture by default.

## Visibility (Principle 9)

Sessions default to `common`. Before starting a `common` session, scan the surrounding context for sensitivity signals (identity, secrets, personal context, sensitive debugging). If signals are present and `--private` was not supplied, **confirm with the user before starting**.

## Boundaries

- Session history is **evidence**, not durable memory. Promote selectively via `/lib:session end`'s candidates or `promote_session_fact`.
- Use `remember` / `propose_memory` for durable facts. Protected categories (identity, relationship) always route to proposals.
- Do not auto-promote anything from session content.
