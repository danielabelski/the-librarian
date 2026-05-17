#!/usr/bin/env bash
# integrations/pi/wrapper.sh
#
# Brackets a Pi-runtime invocation with The Librarian session lifecycle:
#   - starts a session before the runtime launches
#   - exposes LIBRARIAN_SESSION_ID to the child process
#   - pauses the session on exit
#
# Usage:
#   wrapper.sh [--project KEY] [--agent ID] [--title TITLE] [--device DEVICE_ID] -- pi-runtime [args...]
#
# Dependencies: bash, the-librarian CLI on PATH, jq.

set -euo pipefail

LIBRARIAN_BIN="${LIBRARIAN_BIN:-the-librarian}"
AGENT="${LIBRARIAN_AGENT:-pi}"
PROJECT="${LIBRARIAN_PROJECT:-}"
TITLE=""
HARNESS="pi"
DEVICE_ID="${PI_DEVICE_ID:-}"
CWD="$(pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --agent)   AGENT="$2"; shift 2 ;;
    --title)   TITLE="$2"; shift 2 ;;
    --device)  DEVICE_ID="$2"; shift 2 ;;
    --)        shift; break ;;
    *)         break ;;
  esac
done

# Source ref: prefer Pi device id when known, fall back to cwd.
if [[ -n "$DEVICE_ID" ]]; then
  SOURCE_REF="pi:device:${DEVICE_ID}"
else
  SOURCE_REF="cwd:${CWD}"
fi

START_ARGS=(sessions start --agent "$AGENT" --harness "$HARNESS" --cwd "$CWD" --source-ref "$SOURCE_REF" --capture-mode summary --json)
if [[ -n "$TITLE" ]];   then START_ARGS+=(--title "$TITLE"); fi
if [[ -n "$PROJECT" ]]; then START_ARGS+=(--project "$PROJECT"); fi

START_RESPONSE="$("$LIBRARIAN_BIN" "${START_ARGS[@]}")"
LIBRARIAN_SESSION_ID="$(printf '%s' "$START_RESPONSE" | jq -r '.session.id')"

if [[ -z "$LIBRARIAN_SESSION_ID" || "$LIBRARIAN_SESSION_ID" == "null" ]]; then
  echo "wrapper.sh: failed to parse session id from start response" >&2
  echo "$START_RESPONSE" >&2
  exit 1
fi

export LIBRARIAN_SESSION_ID
echo "Librarian session: $LIBRARIAN_SESSION_ID" >&2

pause_on_exit() {
  local exit_code=$?
  "$LIBRARIAN_BIN" sessions pause "$LIBRARIAN_SESSION_ID" \
    --agent "$AGENT" \
    --summary "Process exited (status $exit_code)" >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap pause_on_exit EXIT INT TERM

if [[ $# -gt 0 ]]; then
  "$@"
else
  echo "wrapper.sh: no command given to run; pass the Pi runtime after --" >&2
  exit 1
fi
