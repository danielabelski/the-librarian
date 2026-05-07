let state = { memories: [], events: [] };
let activeStatus = "active";
let toastTimer = null;
let eventState = { events: [], total: 0, limit: 25, offset: 0 };
const PROTECTED_CATEGORIES = new Set(["identity", "relationship"]);

const $ = (id) => document.getElementById(id);
const list = $("list");
const status = $("status");
const toast = $("toast");

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeStatus = button.dataset.status;
    $("eventControls").classList.toggle("hidden", activeStatus !== "events");
    if (activeStatus === "events") return runAction(() => loadEvents(0));
    render();
  });
});

$("refresh").addEventListener("click", () => runAction(load));
$("newMemory").addEventListener("click", () => $("newForm").classList.toggle("hidden"));
$("category").addEventListener("change", render);
$("visibility").addEventListener("change", render);
$("search").addEventListener("input", render);
$("recall").addEventListener("click", () => runAction(recall));
$("saveNew").addEventListener("click", () => runAction(saveNew));
$("eventApply").addEventListener("click", () => runAction(() => loadEvents(0)));
$("eventPrev").addEventListener("click", () => runAction(() => loadEvents(Math.max(eventState.offset - eventState.limit, 0))));
$("eventNext").addEventListener("click", () => {
  const nextOffset = eventState.offset + eventState.limit;
  if (nextOffset < eventState.total) runAction(() => loadEvents(nextOffset));
});

async function load() {
  status.textContent = "Loading";
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Could not load dashboard state.");
  state = await response.json();
  status.textContent = state.memories.length + " memories";
  if (activeStatus === "events") await loadEvents(eventState.offset);
  else render();
}

function render() {
  if (activeStatus === "events") return renderEvents();
  const query = $("search").value.toLowerCase();
  const category = $("category").value;
  const visibility = $("visibility").value;
  const memories = state.memories.filter((memory) => {
    if (memory.status !== activeStatus) return false;
    if (category && memory.category !== category) return false;
    if (visibility && memory.visibility !== visibility) return false;
    if (query && !(memory.title + " " + memory.body + " " + memory.tags.join(" ")).toLowerCase().includes(query)) return false;
    return true;
  });
  list.innerHTML = memories.map(renderMemory).join("") || '<p class="status">No memories in this view.</p>';
  bindActions();
}

function renderEvents() {
  $("eventControls").classList.remove("hidden");
  $("eventPrev").disabled = eventState.offset <= 0;
  $("eventNext").disabled = eventState.offset + eventState.limit >= eventState.total;
  const start = eventState.total ? eventState.offset + 1 : 0;
  const end = Math.min(eventState.offset + eventState.limit, eventState.total);
  $("eventPage").textContent = eventState.total ? `${start}-${end} of ${eventState.total}` : "0 logs";
  list.innerHTML = eventState.events.map(renderEvent).join("") || '<p class="status">No logs match these filters.</p>';
}

async function loadEvents(offset = eventState.offset) {
  const params = new URLSearchParams({
    limit: String(eventState.limit),
    offset: String(offset)
  });
  if ($("eventType").value) params.set("type", $("eventType").value);
  if ($("eventResult").value) params.set("result", $("eventResult").value);
  if ($("eventAgent").value.trim()) params.set("agent_id", $("eventAgent").value.trim());
  if ($("eventQuery").value.trim()) params.set("query", $("eventQuery").value.trim());
  const response = await fetch("/api/events?" + params.toString());
  if (!response.ok) throw new Error("Could not load logs.");
  eventState = await response.json();
  renderEvents();
}

function renderEvent(event) {
  const payload = event.payload || {};
  const summary = eventSummary(event, payload);
  const payloadText = JSON.stringify(payload, null, 2);
  return '<article class="memory">' +
    '<h2>' + escapeHtml(event.event_type) + '</h2>' +
    '<div class="meta">' +
      pill(event.created_at) + pill(event.agent_id || "no agent") + (event.memory_id ? pill(event.memory_id) : "") +
      (payload.result ? pill(payload.result) : "") + (payload.returned_count === 0 ? pill("no results") : "") +
    '</div>' +
    (summary ? '<p>' + escapeHtml(summary) + '</p>' : '') +
    (payloadText && payloadText !== "{}" ? '<pre class="event-payload">' + escapeHtml(payloadText) + '</pre>' : '') +
  '</article>';
}

function eventSummary(event, payload) {
  if (event.event_type === "memory.recall_empty") return 'Recall returned no memories for "' + (payload.query || "") + '".';
  if (event.event_type === "memory.recalled") return 'Recall returned memory for "' + (payload.query || "") + '".';
  if (event.event_type === "memory.verified") return 'Memory marked ' + (payload.result || "verified") + (payload.note ? ': ' + payload.note : ".");
  if (payload.memory?.title) return payload.memory.title;
  if (payload.patch?.title || payload.patch?.body) return [payload.patch.title, payload.patch.body].filter(Boolean).join(": ");
  if (payload.query) return payload.query;
  return event.memory_id || "";
}

function renderMemory(memory) {
  return '<article class="memory" data-id="' + memory.id + '">' +
      '<h2>' + escapeHtml(memory.title) + '</h2>' +
      '<p>' + escapeHtml(memory.body) + '</p>' +
      '<div class="meta">' +
      pill(memory.status) + pill(memory.category) + (PROTECTED_CATEGORIES.has(memory.category) ? pill("protected") : "") +
      pill(memory.visibility) + pill(memory.scope) + pill(memory.agent_id || "no agent") +
      (memory.project_key ? pill(memory.project_key) : '') + pill(memory.priority) + pill(memory.confidence) +
      (memory.tags || []).map(pill).join("") +
    '</div>' +
    '<div class="actions">' +
      (memory.status === "proposed" ? '<button class="primary approve">Approve</button><button class="warning reject">Reject</button>' : '') +
      '<button class="edit">Edit</button>' +
      (memory.status !== "deleted" ? '<button class="danger delete">Delete</button>' : '') +
    '</div>' +
    '<div class="editor hidden">' +
      '<label>Title <input class="editTitle" value="' + attr(memory.title) + '"></label>' +
      '<label>Body <textarea class="editBody">' + escapeHtml(memory.body) + '</textarea></label>' +
      '<div class="editor-grid">' +
        '<label>Agent <input class="editAgent" value="' + attr(memory.agent_id || "") + '"></label>' +
        '<label>Category <select class="editCategory">' + categoryOptions(memory.category) + '</select></label>' +
        '<label>Visibility <select class="editVisibility">' + options(["common","agent_private"], memory.visibility) + '</select></label>' +
        '<label>Scope <select class="editScope">' + options(["global","project","environment","tool","session"], memory.scope) + '</select></label>' +
        '<label>Project <input class="editProject" value="' + attr(memory.project_key || "") + '"></label>' +
        '<label>Tags <input class="editTags" value="' + attr((memory.tags || []).join(", ")) + '"></label>' +
        '<label>Priority <select class="editPriority">' + options(["low","normal","high","core"], memory.priority) + '</select></label>' +
        '<label>Confidence <select class="editConfidence">' + options(["tentative","working","strong"], memory.confidence) + '</select></label>' +
      '</div>' +
      '<button class="primary saveEdit">Save Edit</button>' +
    '</div>' +
  '</article>';
}

function bindActions() {
  document.querySelectorAll(".memory").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector(".edit")?.addEventListener("click", () => card.querySelector(".editor").classList.toggle("hidden"));
    card.querySelector(".saveEdit")?.addEventListener("click", () => runAction(() => updateMemory(id, {
      title: card.querySelector(".editTitle").value,
      body: card.querySelector(".editBody").value,
      agent_id: card.querySelector(".editAgent").value,
      category: card.querySelector(".editCategory").value,
      visibility: card.querySelector(".editVisibility").value,
      scope: card.querySelector(".editScope").value,
      project_key: card.querySelector(".editProject").value,
      tags: card.querySelector(".editTags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
      priority: card.querySelector(".editPriority").value,
      confidence: card.querySelector(".editConfidence").value
    })));
    card.querySelector(".delete")?.addEventListener("click", () => runAction(async () => {
      await post("/api/memories/" + id + "/delete", { agent_id: "dashboard" });
      showToast("Memory deleted.", "success");
      await load();
    }));
    card.querySelector(".approve")?.addEventListener("click", () => runAction(async () => {
      await post("/api/proposals/" + id + "/approve", { agent_id: "dashboard" });
      showToast("Proposal approved.", "success");
      await load();
    }));
    card.querySelector(".reject")?.addEventListener("click", () => runAction(async () => {
      await post("/api/proposals/" + id + "/reject", { agent_id: "dashboard" });
      showToast("Proposal rejected.", "success");
      await load();
    }));
  });
}

async function updateMemory(id, patch) {
  await post("/api/memories/" + id + "/update", { agent_id: "dashboard", patch });
  showToast("Memory updated.", "success");
  await load();
}

async function recall() {
  const response = await post("/api/recall", {
    agent_id: $("agent").value || "dashboard",
    query: $("search").value,
    project_key: $("project").value,
    limit: 20
  });
  state.memories = response.memories;
  status.textContent = response.memories.length + " recalled";
  showToast(response.memories.length + " memories recalled.", "success");
  activeStatus = "active";
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.status === "active"));
  render();
}

async function saveNew() {
  await post("/api/memories", {
    agent_id: $("agent").value || "dashboard",
    title: $("formTitle").value,
    body: $("formBody").value,
    category: $("formCategory").value,
    visibility: $("formVisibility").value,
    scope: $("formScope").value,
    project_key: $("project").value,
    tags: $("formTags").value.split(",").map((tag) => tag.trim()).filter(Boolean)
  });
  $("formTitle").value = "";
  $("formBody").value = "";
  $("formTags").value = "";
  showToast("Memory saved.", "success");
  await load();
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(json.error || "Request failed");
  return json;
}

function pill(text) { return '<span class="pill ' + escapeHtml(text) + '">' + escapeHtml(text || "") + '</span>'; }
function options(values, selected) { return values.map((value) => '<option value="' + attr(value) + '" ' + (value === selected ? "selected" : "") + '>' + escapeHtml(value) + '</option>').join(""); }
function categoryOptions(selected) {
  return ["identity","relationship","preferences","projects","environment","tools","lessons","people","open_threads"].map((value) => {
    const label = PROTECTED_CATEGORIES.has(value) ? value + " (protected)" : value;
    return '<option value="' + attr(value) + '" ' + (value === selected ? "selected" : "") + '>' + escapeHtml(label) + '</option>';
  }).join("");
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])); }
function attr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }
async function runAction(action) {
  try {
    await action();
  } catch (error) {
    showToast(error.message || "Something went wrong.", "error");
  }
}
function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = "toast " + type;
  toastTimer = setTimeout(() => {
    toast.className = "toast hidden";
  }, 4500);
}
runAction(load);
