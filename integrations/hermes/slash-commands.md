# Hermes slash command wiring

The canonical `/lib:session` contract lives in [`docs/slash-commands.md`](../../docs/slash-commands.md). This file documents Hermes-specific wiring on top of it.

## Native command registration

Register **one** Hermes slash command: `/lib:session`. Hermes parses the remainder (`<subcommand> [args]`). Do not register each verb separately — multi-word command registration is not portable.

Example (pseudocode, adapt to Hermes's actual command registration):

```yaml
commands:
  - name: /lib:session
    description: Manage Librarian sessions (start/list/resume/checkpoint/pause/end/archive/restore/delete/search/status)
    handler: librarianSessionHandler
    arg_schema: free-text  # parse the remainder
```

## Text fallback (skill / agent contexts)

In agent or skill contexts where Hermes only sees free-form user messages, the agent recognises `/lib:session ...` in chat text and routes to the same MCP tools. Both paths converge on the same MCP surface — there is no per-route divergence.

## Subcommand mapping

| User typed | MCP tool called | Notes |
|---|---|---|
| `/lib:session start [title] [--private]` | `start_session` | Build `start_summary` from current visible context. |
| `/lib:session list` | `list_sessions` | Scope by current project/source where possible. |
| `/lib:session resume <n|id>` | `continue_session` (default `attach:true`) | Map number → canonical `session_id` from the last list response. |
| `/lib:session checkpoint` | `checkpoint_session` | Pull summary from agent's pre-call deliberation. |
| `/lib:session pause` | `pause_session` | Same shape as checkpoint. |
| `/lib:session end` | `end_session` | Return candidate durable memories — do not auto-promote. |
| `/lib:session archive <n|id>` | `archive_session` | Hidden from default list. |
| `/lib:session restore <n|id>` | `restore_session` | Owner-or-admin. |
| `/lib:session delete <n|id>` | `delete_session` | Owner-or-admin. Confirm before sending. |
| `/lib:session search <query>` | `search_sessions` | Returns numbered matches. |
| `/lib:session status` | `get_session` for the currently attached session | Show recent checkpoints + next steps. |

## Numbered selection

Numbers from `/lib:session list` are agent-side scratch within the current conversation. **Every tool call must take the canonical `session_id`.** On compaction or a fresh window, re-run `/lib:session list` to refresh.

## Sensitivity confirmation

Before a `common` session is started (and no `--private` was supplied), the agent must check the surrounding Discord context for sensitivity signals (see `AGENTS.append.md` § Visibility). If signals are present, confirm with the user inline before calling `start_session`.
