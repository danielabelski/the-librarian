let state = { memories: [], events: [] };
let activeStatus = "active";

const $ = (id) => document.getElementById(id);
const list = $("list");
const status = $("status");

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeStatus = button.dataset.status;
    render();
  });
});

$("refresh").addEventListener("click", load);
$("newMemory").addEventListener("click", () => $("newForm").classList.toggle("hidden"));
$("category").addEventListener("change", render);
$("visibility").addEventListener("change", render);
$("search").addEventListener("input", render);
$("recall").addEventListener("click", recall);
$("saveNew").addEventListener("click", saveNew);

async function load() {
  status.textContent = "Loading";
  const response = await fetch("/api/state");
  state = await response.json();
  status.textContent = state.memories.length + " memories";
  render();
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
  list.innerHTML = state.events.map((event) => '<article class="memory"><h2>' + escapeHtml(event.event_type) + '</h2><div class="meta"><span class="pill">' + escapeHtml(event.created_at) + '</span><span class="pill">' + escapeHtml(event.agent_id || "") + '</span></div><p>' + escapeHtml(event.memory_id || "") + '</p></article>').join("") || '<p class="status">No logs yet.</p>';
}

function renderMemory(memory) {
  return '<article class="memory" data-id="' + memory.id + '">' +
    '<h2>' + escapeHtml(memory.title) + '</h2>' +
    '<p>' + escapeHtml(memory.body) + '</p>' +
    '<div class="meta">' +
      pill(memory.status) + pill(memory.category) + pill(memory.visibility) + pill(memory.scope) + pill(memory.agent_id || "no agent") +
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
        '<label>Category <select class="editCategory">' + options(["identity","relationship","preferences","projects","environment","tools","lessons","people","open_threads"], memory.category) + '</select></label>' +
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
    card.querySelector(".saveEdit")?.addEventListener("click", () => updateMemory(id, {
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
    }));
    card.querySelector(".delete")?.addEventListener("click", () => post("/api/memories/" + id + "/delete", { agent_id: "dashboard" }).then(load));
    card.querySelector(".approve")?.addEventListener("click", () => post("/api/proposals/" + id + "/approve", { agent_id: "dashboard" }).then(load));
    card.querySelector(".reject")?.addEventListener("click", () => post("/api/proposals/" + id + "/reject", { agent_id: "dashboard" }).then(load));
  });
}

async function updateMemory(id, patch) {
  await post("/api/memories/" + id + "/update", { agent_id: "dashboard", patch });
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
function options(values, selected) { return values.map((value) => '<option ' + (value === selected ? "selected" : "") + '>' + value + '</option>').join(""); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])); }
function attr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }
load();
