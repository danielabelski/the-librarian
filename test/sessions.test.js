import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withStore } from "./helpers.js";

test("startSession creates an active common session with the supplied fields", async () => {
  await withStore((store) => {
    const result = store.startSession({
      agent_id: "bede",
      title: "Cross-harness recall design",
      project_key: "the-librarian",
      visibility: "common",
      harness: "hermes",
      source_ref: "discord:channel:1:thread:2",
      cwd: "/home/jim/the-librarian",
      capture_mode: "summary",
      start_summary: "Sketch the session layer.",
      tags: ["sessions", "librarian"]
    });

    const session = result.session;
    assert.ok(session.id.startsWith("ses_"), `unexpected id ${session.id}`);
    assert.equal(session.title, "Cross-harness recall design");
    assert.equal(session.project_key, "the-librarian");
    assert.equal(session.status, "active");
    assert.equal(session.prior_status, null);
    assert.equal(session.visibility, "common");
    assert.equal(session.created_by_agent_id, "bede");
    assert.equal(session.current_agent_id, "bede");
    assert.equal(session.created_in_harness, "hermes");
    assert.equal(session.current_harness, "hermes");
    assert.equal(session.source_ref, "discord:channel:1:thread:2");
    assert.equal(session.cwd, "/home/jim/the-librarian");
    assert.equal(session.capture_mode, "summary");
    assert.equal(session.start_summary, "Sketch the session layer.");
    assert.equal(session.rolling_summary, null);
    assert.equal(session.end_summary, null);
    assert.deepEqual(session.next_steps, []);
    assert.deepEqual(session.tags, ["sessions", "librarian"]);
    assert.ok(session.started_at);
    assert.equal(session.updated_at, session.started_at);
    assert.equal(session.last_activity_at, session.started_at);
    assert.equal(session.paused_at, null);
    assert.equal(session.ended_at, null);
    assert.equal(session.archived_at, null);
    assert.equal(session.deleted_at, null);
    assert.deepEqual(session.metadata, {});
  });
});

test("startSession generates a placeholder title when one is not supplied", async () => {
  await withStore((store) => {
    const fromProject = store.startSession({
      agent_id: "bede",
      project_key: "the-librarian",
      harness: "codex"
    });
    assert.match(fromProject.session.title, /^the-librarian session @ /);

    const fromHarness = store.startSession({
      agent_id: "bede",
      harness: "codex"
    });
    assert.match(fromHarness.session.title, /^codex session @ /);
  });
});

test("startSession defaults visibility to common and capture_mode to summary", async () => {
  await withStore((store) => {
    const result = store.startSession({ agent_id: "bede", title: "Defaults", harness: "hermes" });
    assert.equal(result.session.visibility, "common");
    assert.equal(result.session.capture_mode, "summary");
  });
});

test("startSession accepts an explicit agent_private visibility", async () => {
  await withStore((store) => {
    const result = store.startSession({
      agent_id: "bede",
      title: "Private spike",
      harness: "hermes",
      visibility: "agent_private"
    });
    assert.equal(result.session.visibility, "agent_private");
  });
});

test("startSession appends a session.started event to sessions.jsonl and inserts a row in the projection", async () => {
  await withStore((store, dataDir) => {
    const sessionsPath = path.join(dataDir, "sessions.jsonl");
    assert.ok(fs.existsSync(sessionsPath), "sessions.jsonl should be created on startup");

    const result = store.startSession({
      agent_id: "bede",
      title: "Event projection",
      harness: "hermes"
    });

    const lines = fs.readFileSync(sessionsPath, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.event_type, "session.started");
    assert.equal(event.session_id, result.session.id);
    assert.equal(event.agent_id, "bede");
    assert.ok(event.created_at);
    assert.ok(event.payload?.session?.id, "event payload should embed the session snapshot");

    const fetched = store.getSession(result.session.id);
    assert.equal(fetched.id, result.session.id);
    assert.equal(fetched.title, "Event projection");
  });
});

test("getSession returns null for an unknown id and does not throw", async () => {
  await withStore((store) => {
    assert.equal(store.getSession("ses_does_not_exist"), null);
  });
});

test("multiple active sessions can coexist", async () => {
  await withStore((store) => {
    const first = store.startSession({ agent_id: "bede", title: "First", harness: "hermes" });
    const second = store.startSession({ agent_id: "codex", title: "Second", harness: "codex" });
    assert.notEqual(first.session.id, second.session.id);
    assert.equal(store.getSession(first.session.id).status, "active");
    assert.equal(store.getSession(second.session.id).status, "active");
  });
});

test("memory writes do not touch the session projection (and vice versa)", async () => {
  await withStore((store, dataDir) => {
    store.createMemory({
      agent_id: "bede",
      title: "Memory still works",
      body: "Adding sessions must not regress memory writes.",
      category: "tools",
      visibility: "common",
      scope: "tool"
    });
    store.startSession({ agent_id: "bede", title: "Session still works", harness: "hermes" });

    const memEvents = fs.readFileSync(path.join(dataDir, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean);
    const sessEvents = fs.readFileSync(path.join(dataDir, "sessions.jsonl"), "utf8").trim().split("\n").filter(Boolean);
    assert.equal(memEvents.length, 1, "memory event ledger should only have one entry");
    assert.equal(sessEvents.length, 1, "session event ledger should only have one entry");
  });
});

test("listSessions returns multiple selectable sessions and never auto-selects", async () => {
  await withStore((store) => {
    const first = store.startSession({ agent_id: "bede", title: "First", harness: "hermes" });
    const second = store.startSession({ agent_id: "bede", title: "Second", harness: "hermes" });

    const result = store.listSessions({ agent_id: "bede" });

    assert.equal(result.sessions.length, 2);
    const ids = result.sessions.map((s) => s.id);
    assert.ok(ids.includes(first.session.id));
    assert.ok(ids.includes(second.session.id));
    assert.equal(result.selected, undefined);
    assert.equal(result.current, undefined);
  });
});

test("listSessions ranks sessions matching the caller project_key first", async () => {
  await withStore((store) => {
    const other = store.startSession({
      agent_id: "bede",
      title: "Other project",
      harness: "hermes",
      project_key: "other-repo"
    });
    const target = store.startSession({
      agent_id: "bede",
      title: "Target project",
      harness: "hermes",
      project_key: "the-librarian"
    });

    const result = store.listSessions({ agent_id: "bede", project_key: "the-librarian" });

    assert.equal(result.sessions[0].id, target.session.id);
    assert.equal(result.sessions[1].id, other.session.id);
  });
});

test("listSessions ranks source-matching sessions ahead of non-matching when project matches both", async () => {
  await withStore((store) => {
    const sameProjOtherSrc = store.startSession({
      agent_id: "bede",
      title: "Same proj, other cwd",
      harness: "hermes",
      project_key: "the-librarian",
      cwd: "/somewhere/else"
    });
    const sameProjSameSrc = store.startSession({
      agent_id: "bede",
      title: "Same proj, same cwd",
      harness: "hermes",
      project_key: "the-librarian",
      cwd: "/home/jim/the-librarian"
    });

    const result = store.listSessions({
      agent_id: "bede",
      project_key: "the-librarian",
      cwd: "/home/jim/the-librarian"
    });

    assert.equal(result.sessions[0].id, sameProjSameSrc.session.id);
    assert.equal(result.sessions[1].id, sameProjOtherSrc.session.id);
  });
});

test("listSessions matches by source_ref as well as cwd when ranking source", async () => {
  await withStore((store) => {
    const otherSrc = store.startSession({
      agent_id: "bede",
      title: "Different thread",
      harness: "hermes",
      source_ref: "discord:channel:1:thread:2"
    });
    const matchingSrc = store.startSession({
      agent_id: "bede",
      title: "Matching thread",
      harness: "hermes",
      source_ref: "discord:channel:9:thread:42"
    });

    const result = store.listSessions({
      agent_id: "bede",
      source_ref: "discord:channel:9:thread:42"
    });

    assert.equal(result.sessions[0].id, matchingSrc.session.id);
    assert.equal(result.sessions[1].id, otherSrc.session.id);
  });
});

test("listSessions hides agent_private sessions from other agents", async () => {
  await withStore((store) => {
    const shared = store.startSession({
      agent_id: "bede",
      title: "Shared",
      harness: "hermes",
      visibility: "common"
    });
    const bedePrivate = store.startSession({
      agent_id: "bede",
      title: "Bede private",
      harness: "hermes",
      visibility: "agent_private"
    });
    const codexPrivate = store.startSession({
      agent_id: "codex",
      title: "Codex private",
      harness: "codex",
      visibility: "agent_private"
    });

    const asBede = store.listSessions({ agent_id: "bede" }).sessions.map((s) => s.id);
    assert.ok(asBede.includes(shared.session.id));
    assert.ok(asBede.includes(bedePrivate.session.id));
    assert.ok(!asBede.includes(codexPrivate.session.id));

    const asCodex = store.listSessions({ agent_id: "codex" }).sessions.map((s) => s.id);
    assert.ok(asCodex.includes(shared.session.id));
    assert.ok(!asCodex.includes(bedePrivate.session.id));
    assert.ok(asCodex.includes(codexPrivate.session.id));
  });
});

test("listSessions admin override sees agent_private sessions from any agent", async () => {
  await withStore((store) => {
    const codexPrivate = store.startSession({
      agent_id: "codex",
      title: "Codex private",
      harness: "codex",
      visibility: "agent_private"
    });

    const asAdmin = store.listSessions({ agent_id: "bede", admin: true }).sessions.map((s) => s.id);
    assert.ok(asAdmin.includes(codexPrivate.session.id));
  });
});

test("listSessions honors limit", async () => {
  await withStore((store) => {
    for (let i = 0; i < 5; i += 1) {
      store.startSession({ agent_id: "bede", title: `Session ${i}`, harness: "hermes" });
    }
    const result = store.listSessions({ agent_id: "bede", limit: 3 });
    assert.equal(result.sessions.length, 3);
    assert.equal(result.total, 5);
    assert.equal(result.limit, 3);
  });
});

test("listSessions returns the most recently active session first when all ranking keys tie", async () => {
  await withStore(async (store) => {
    const first = store.startSession({ agent_id: "bede", title: "First", harness: "hermes" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = store.startSession({ agent_id: "bede", title: "Second", harness: "hermes" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const third = store.startSession({ agent_id: "bede", title: "Third", harness: "hermes" });

    const result = store.listSessions({ agent_id: "bede" });
    assert.deepEqual(
      result.sessions.map((s) => s.id),
      [third.session.id, second.session.id, first.session.id]
    );
  });
});

test("listSessions filters by harness when supplied", async () => {
  await withStore((store) => {
    const onHermes = store.startSession({ agent_id: "bede", title: "Hermes", harness: "hermes" });
    store.startSession({ agent_id: "bede", title: "Codex", harness: "codex" });

    const result = store.listSessions({ agent_id: "bede", harness: "hermes" });
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].id, onHermes.session.id);
  });
});
