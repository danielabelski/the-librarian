# OpenCode slash command wiring

The canonical `/lib:session` contract lives in [`docs/slash-commands.md`](../../docs/slash-commands.md). This file documents OpenCode-specific wiring on top of it.

## Native command registration

OpenCode supports native command registration. Register **one** command: `/lib:session`. OpenCode parses the remainder (`<subcommand> [args]`). See [`commands.example.json`](./commands.example.json) for the registration shape.

Do not register each verb separately — multi-word command registration is not portable across harnesses.

## Subcommand mapping

| User typed | MCP tool called | Notes |
|---|---|---|
| `/lib:session start [title] [--private]` | `start_session` | Build `start_summary` from current visible context. |
| `/lib:session list` | `list_sessions` | Scope by current project root + cwd. |
| `/lib:session resume <n|id>` | `continue_session` (default `attach:true`) | Pass `target_harness: "opencode"`, `target_cwd: <project root>`, and `target_source_ref: opencode:project:<path>`. |
| `/lib:session checkpoint` / `pause` / `end` | `checkpoint_session` / `pause_session` / `end_session` | |
| `/lib:session archive` / `restore` / `delete` | `archive_session` / `restore_session` / `delete_session` | |
| `/lib:session search <query>` | `search_sessions` | |
| `/lib:session status` | `get_session` for the currently attached session | |

## Numbered selection

Numbers from `/lib:session list` are agent-side scratch within the current OpenCode conversation. **Every tool call must take the canonical `session_id`.** Re-run list to refresh after compaction or a fresh window.

## Sensitivity confirmation

Before a `common` session is started (and `--private` was not supplied), check the surrounding context for sensitivity signals. If signals are present, confirm with the user before calling `start_session`.
