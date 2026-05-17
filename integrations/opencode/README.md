# OpenCode integration

Wires OpenCode into The Librarian's session layer.

## Install

1. **Add the MCP server to OpenCode.** Merge [`opencode.example.json`](./opencode.example.json) into your `opencode.json`. Set `LIBRARIAN_AGENT_TOKEN` in the environment.

2. **Register the `/lib:session` commands.** Merge [`commands.example.json`](./commands.example.json) into your OpenCode commands config. OpenCode supports native command registration, so the user gets autocompletion and structured args; the agent then routes the parsed remainder to the corresponding MCP tool.

3. **Drop [`AGENTS.md`](./AGENTS.md) into the project root** (or merge with an existing `AGENTS.md`). OpenCode reads it on session start and learns the `/lib:session` contract.

4. **Optionally use [`wrapper.sh`](./wrapper.sh)** to bracket `opencode` invocations:
   ```sh
   chmod +x integrations/opencode/wrapper.sh
   integrations/opencode/wrapper.sh --project the-librarian -- opencode
   ```
   The wrapper sets `LIBRARIAN_SESSION_ID` and records harness attachment so the session shows up correctly across `list_sessions` and `continue_session`.

5. **Run the healthcheck.** See [`healthcheck.md`](./healthcheck.md).

## Source ref shape

OpenCode is project-oriented. The wrapper records `source_ref` as `opencode:project:{absolute_path}`. If OpenCode exposes session metadata (e.g. an `OPENCODE_SESSION_ID` env var), the wrapper appends it.

## Handover format

`continue_session --format opencode` produces an OpenCode-friendly context pack suitable for pasting into the OpenCode prompt or consuming by another OpenCode session.

## See also

- Canonical slash command contract: [`docs/slash-commands.md`](../../docs/slash-commands.md)
- Full session spec: [`specs/session-layer-and-harness-packages.md`](../../specs/session-layer-and-harness-packages.md)
