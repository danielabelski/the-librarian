# Harness setup packages

This directory holds copyable setup packages that wire each supported harness into The Librarian's session layer. The packages are pragmatic: install steps, MCP config examples, slash-command contracts, wrapper scripts, and a healthcheck.

## Supported harnesses

| Harness | Path | Standalone file | Wrapper |
|---|---|---|---|
| Hermes | `hermes/` | `AGENTS.append.md` (concatenate onto host repo's existing `AGENTS.md`) | — |
| Claude Code | `claude-code/` | `CLAUDE.md` | `wrapper.sh` |
| Codex | `codex/` | `AGENTS.md` | `wrapper.sh` |
| OpenCode | `opencode/` | `AGENTS.md` | `wrapper.sh` |
| Pi | `pi/` | `AGENTS.md` | `wrapper.sh` |

## File conventions

- **`AGENTS.md` / `CLAUDE.md`** — standalone agent instructions for harnesses where the user typically does not have a pre-existing file of that name.
- **`AGENTS.append.md`** — a snippet meant to be **concatenated** onto an existing `AGENTS.md` (e.g. Hermes's own). The package README explains how to merge it.
- **`slash-commands.md`** — per-package reference for the `/lib:session` surface. Points at the canonical [`docs/slash-commands.md`](../docs/slash-commands.md) for the contract; documents any harness-specific wiring on top.
- **`mcp.example.json` / `config.example.yaml` / `opencode.example.json`** — example configuration to point the harness at The Librarian's HTTP MCP endpoint.
- **`wrapper.sh`** — an executable shim that brackets the harness binary with `the-librarian sessions start` (on launch) and `the-librarian sessions pause` (on exit), exposing the session id as `LIBRARIAN_SESSION_ID` for child processes.
- **`healthcheck.md`** — per-harness end-to-end smoke test you can run before relying on the setup.

## Conventions across packages

- All session commands route through the `/lib:session` surface documented at [`docs/slash-commands.md`](../docs/slash-commands.md).
- The canonical instance is a **single shared Librarian** reachable over HTTP MCP. See the spec for topology details — local-only installs are not supported for session continuity.
- Sessions default to `common` visibility. Agents must detect sensitivity signals (identity, secrets, personal context, sensitive debugging) and confirm before starting a `common` session whose content looks private. The store/MCP layer trusts the visibility the caller supplies.
- Session history is **evidence**, not durable memory. Promote facts via `/lib:session end`'s candidates or `promote_session_fact` — never auto-promote.
