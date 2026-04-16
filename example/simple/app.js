function Plural(n, word) {
  if (n === 1) {
    return String(n) + " " + word;
  }
  return String(n) + " " + word + "s";
}

function HasText(s) {
  for (const [_$, r] of Array.from(s, (__c, __i) => [__i, __c.codePointAt(0)])) {
    if (!/\s/.test(String.fromCodePoint(r))) {
      return true;
    }
  }
  return false;
}

function __len(a) { return a?.length ?? 0; }
function __append(a, ...b) { return a ? [...a, ...b] : b; }
function __s(a) { return a || []; }

class Todo {
  constructor({ id = 0, text = "", done = false, priority = 0 } = {}) {
    this.id = id;
    this.text = text;
    this.done = done;
    this.priority = priority;
  }

  isUrgent() {
    const t = this;
    return t.priority === PriorityHigh && !t.done;
  }

  withDone(done) {
    const t = this;
    return new Todo({ id: t.id, text: t.text, done: done, priority: t.priority });
  }
}

const maxTodoLen = 120;

let dragSrcId = 0;

let todos = null;

let nextId = 0;

let filter = 0;

let highPriority = false;

const FilterAll = 0;
const FilterActive = 1;
const FilterCompleted = 2;

const PriorityNormal = 0;
const PriorityHigh = 1;

function validateTodo(text) {
  if (!HasText(text)) {
    return "todo text cannot be empty";
  }
  if (__len(Array.from(text, __c => __c.codePointAt(0))) > maxTodoLen) {
    return "todo text too long";
  }
  return null;
}

function setSyncStatus(msg, cls) {
  let el = document.querySelector(".sync-status");
  el.textContent = msg;
  el.className = "sync-status " + cls;
}

async function triggerSave() {
  setSyncStatus("Saving…", "saving");
  let err = await saveTodos();
  if (err !== null) {
    setSyncStatus("Save failed", "error");
    return;
  }
  setSyncStatus("Saved ✓", "saved");
  await sleep(1500);
  setSyncStatus("", "");
}

async function submitInput() {
  const __defers = [];
  let __panic = null;
  try {
    let input = document.querySelector(".todo-input");
    __defers.push(() => { input.focus(); });
    let err = validateTodo(input.value);
    if (err !== null) {
      return;
    }
    let priority = PriorityNormal;
    if (highPriority) {
      priority = PriorityHigh;
    }
    addTodo(input.value, priority);
    input.value = "";
    if (highPriority) {
      togglePriorityMode();
    }
    render();
    await triggerSave();
  } catch (__err) {
    __panic = __err;
  } finally {
    for (let __i = __defers.length - 1; __i >= 0; __i--) __defers[__i]();
    if (__panic !== null) throw __panic;
  }
}

function togglePriorityMode() {
  highPriority = !highPriority;
  let btn = document.querySelector(".priority-btn");
  if (highPriority) {
    btn.className = "priority-btn on";
    btn.textContent = "⚡ High";
  } else {
    btn.className = "priority-btn";
    btn.textContent = "⚡ Normal";
  }
}

function createApp() {
  let app = document.getElementById("app");
  app.innerHTML = "<div class=\"card\">\n  <header class=\"header\">\n    <div class=\"header-top\">\n      <div class=\"header-icon\">✓</div>\n      <h1>Todos Simple</h1>\n      <span class=\"high-badge\"></span>\n      <span class=\"sync-status\"></span>\n    </div>\n    <p class=\"tagline\">Built with <a href=\"https://github.com/seriva/gofront\" target=\"_blank\"><strong>GoFront</strong></a> — Go compiled to JS</p>\n  </header>\n  <div class=\"input-row\">\n    <input class=\"todo-input\" type=\"text\" placeholder=\"What needs to be done?\" autocomplete=\"off\" />\n    <button type=\"button\" class=\"priority-btn\">⚡ Normal</button>\n    <button type=\"button\" class=\"add-btn\">Add</button>\n  </div>\n  <div class=\"list-divider\"></div>\n  <ul class=\"todo-list\"></ul>\n  <footer class=\"footer\"></footer>\n</div>";
}

function setupEvents() {
  let addBtn = document.querySelector(".add-btn");
  let input = document.querySelector(".todo-input");
  let priorityBtn = document.querySelector(".priority-btn");
  let list = document.querySelector(".todo-list");
  let footer = document.querySelector(".footer");
  addBtn.addEventListener("click", function() {
    submitInput();
  });
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      submitInput();
    }
  });
  priorityBtn.addEventListener("click", function() {
    togglePriorityMode();
  });
  list.addEventListener("change", function(e) {
    if (e.target.getAttribute("data-action") === "toggle") {
      toggleTodo(Math.trunc(Number(e.target.getAttribute("data-todo-id"))));
      render();
      triggerSave();
    }
  });
  list.addEventListener("click", function(e) {
    if (e.target.getAttribute("data-action") === "delete") {
      removeTodo(Math.trunc(Number(e.target.getAttribute("data-todo-id"))));
      render();
      triggerSave();
    }
  });
  footer.addEventListener("click", function(e) {
    let action = e.target.getAttribute("data-action");
    switch (action) {
      case "filter":
      {
        setFilter(Math.trunc(Number(e.target.getAttribute("data-filter"))));
        render();
        break;
      }
      case "clear-completed":
      {
        clearCompleted();
        render();
        triggerSave();
        break;
      }
    }
  });
  list.addEventListener("dragstart", function(e) {
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    dragSrcId = Math.trunc(Number(li.getAttribute("data-id")));
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  list.addEventListener("dragover", function(e) {
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    let targetId = Math.trunc(Number(li.getAttribute("data-id")));
    if (dragSrcId !== targetId) {
      e.preventDefault();
      li.classList.add("drag-over");
    }
  });
  list.addEventListener("dragleave", function(e) {
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    if (!li.contains(e.relatedTarget)) {
      li.classList.remove("drag-over");
    }
  });
  list.addEventListener("drop", function(e) {
    e.preventDefault();
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    let targetId = Math.trunc(Number(li.getAttribute("data-id")));
    if (dragSrcId !== targetId) {
      moveTodo(dragSrcId, targetId);
      render();
      triggerSave();
    }
  });
  list.addEventListener("dragend", function(e) {
    let li = e.target.closest("li");
    if (li !== null) {
      li.classList.remove("dragging");
    }
  });
}

async function main() {
  injectStyles();
  createApp();
  setupEvents();
  let loadErr = await loadTodos();
  if (loadErr !== null || __len(todos) === 0) {
    addTodo("Read the GoFront docs", PriorityNormal);
    addTodo("Fix the critical production bug", PriorityHigh);
    addTodo("Write tests", PriorityNormal);
    addTodo("Deploy to staging", PriorityHigh);
    addTodo("Send weekly update email", PriorityNormal);
    toggleTodo(0);
  }
  render();
}

function esc(s) {
  let out = "";
  for (const [_$, r] of Array.from(s, (__c, __i) => [__i, __c.codePointAt(0)])) {
    switch (r) {
      case 38:
      {
        out = out + "&amp;";
        break;
      }
      case 60:
      {
        out = out + "&lt;";
        break;
      }
      case 62:
      {
        out = out + "&gt;";
        break;
      }
      case 34:
      {
        out = out + "&quot;";
        break;
      }
      default:
      {
        out = out + String.fromCodePoint(r);
        break;
      }
    }
  }
  return out;
}

function renderTodo(t) {
  let cls = "todo-item";
  if (t.done) {
    cls = "todo-item done";
  } else if (t.isUrgent()) {
    cls = "todo-item high";
  }
  let checked = "";
  if (t.done) {
    checked = " checked";
  }
  let badge = "";
  if (t.isUrgent()) {
    badge = "<span class=\"badge\">urgent</span>";
  }
  let id = String(t.id);
  return "<li class=\"" + cls + "\" draggable=\"true\" data-id=\"" + id + "\">\n<input type=\"checkbox\" class=\"todo-cb\" data-action=\"toggle\" data-todo-id=\"" + id + "\"" + checked + " />\n<span class=\"todo-text\">" + esc(t.text) + "</span>" + badge + "<button class=\"del-btn\" data-action=\"delete\" data-todo-id=\"" + id + "\">✕</button>\n</li>";
}

function renderFilterBar() {
  let filters = [FilterAll, FilterActive, FilterCompleted];
  let out = "<div class=\"filter-bar\">";
  for (const [_$, f] of __s(filters).entries()) {
    let cls = "filter-btn";
    if (f === filter) {
      cls = "filter-btn active";
    }
    out = out + "<button class=\"" + cls + "\" data-action=\"filter\" data-filter=\"" + String(f) + "\">" + filterLabel(f) + "</button>";
  }
  return out + "</div>";
}

function render() {
  let list = document.querySelector(".todo-list");
  let visible = visibleTodos();
  if (__len(visible) === 0) {
    list.innerHTML = "<li class=\"empty\">Nothing here.</li>";
  } else {
    let html = "";
    for (const [_$, t] of __s(visible).entries()) {
      html = html + renderTodo(t);
    }
    list.innerHTML = html;
  }
  let footer = document.querySelector(".footer");
  if (__len(todos) === 0) {
    footer.innerHTML = "";
  } else {
    let [remaining, completed] = stats();
    let countText = Plural(remaining, "task") + " left";
    let clearBtn = "";
    if (completed > 0) {
      clearBtn = "<button class=\"clear-btn\" data-action=\"clear-completed\">Clear completed (" + String(completed) + ")</button>";
    }
    footer.innerHTML = "<span class=\"count\">" + esc(countText) + "</span>" + renderFilterBar() + clearBtn;
  }
  let badge = document.querySelector(".high-badge");
  let hc = highCount();
  if (hc > 0) {
    badge.style.display = "inline-block";
    badge.textContent = String(hc) + " urgent";
  } else {
    badge.style.display = "none";
    badge.textContent = "";
  }
}

function safeJsonParse(raw) {
  let result = null;
  let err = null;
  const __defers = [];
  let __panic = null;
  try {
    __defers.push(() => { (function() {
      {
        let r = (typeof __panic !== "undefined" && __panic !== null ? (() => { const __r = __panic.message ?? String(__panic); __panic = null; return __r; })() : null);
        if (r !== null) {
          err = r;
        }
      }
    })(); });
    result = JSON.parse(raw);
    return [result, null];
  } catch (__err) {
    __panic = __err;
  } finally {
    for (let __i = __defers.length - 1; __i >= 0; __i--) __defers[__i]();
    if (__panic !== null) throw __panic;
  }
  return [result, err];
}

async function saveTodos() {
  localStorage.setItem("todos", JSON.stringify(todos));
  return null;
}

async function loadTodos() {
  let raw = localStorage.getItem("todos");
  if (raw === null) {
    return null;
  }
  let [parsed, parseErr] = safeJsonParse(raw);
  if (parseErr !== null) {
    return parseErr;
  }
  if (parsed === null) {
    return "failed to parse stored todos";
  }
  let loaded = null;
  for (const [_$, raw] of __s(parsed).entries()) {
    loaded = __append(loaded, new Todo({ id: raw.id, text: raw.text, done: raw.done, priority: raw.priority }));
  }
  if (__len(loaded) > 0) {
    let last = loaded[__len(loaded) - 1];
    nextId = last.id + 1;
  }
  todos = loaded;
  return null;
}

function addTodo(text, priority) {
  todos = __append(todos, new Todo({ id: nextId, text: text, done: false, priority: priority }));
  nextId++;
}

function toggleTodo(id) {
  let next = null;
  for (const [_$, t] of __s(todos).entries()) {
    if (t.id === id) {
      next = __append(next, t.withDone(!t.done));
    } else {
      next = __append(next, t);
    }
  }
  todos = next;
}

function removeTodo(id) {
  let next = null;
  for (const [_$, t] of __s(todos).entries()) {
    if (t.id !== id) {
      next = __append(next, t);
    }
  }
  todos = next;
}

function clearCompleted() {
  let next = null;
  for (const [_$, t] of __s(todos).entries()) {
    if (!t.done) {
      next = __append(next, t);
    }
  }
  todos = next;
}

function setFilter(f) {
  filter = f;
}

function moveTodo(fromId, toId) {
  if (fromId === toId) {
    return;
  }
  let item = new Todo();
  let rest = null;
  for (const [_$, t] of __s(todos).entries()) {
    if (t.id === fromId) {
      item = t;
    } else {
      rest = __append(rest, t);
    }
  }
  let result = null;
  let inserted = false;
  for (const [_$, t] of __s(rest).entries()) {
    if (t.id === toId) {
      result = __append(result, item);
      inserted = true;
    }
    result = __append(result, t);
  }
  if (!inserted) {
    result = __append(result, item);
  }
  todos = result;
}

function visibleTodos() {
  switch (filter) {
    case FilterActive:
    {
      let out = null;
      for (const [_$, t] of __s(todos).entries()) {
        if (!t.done) {
          out = __append(out, t);
        }
      }
      return out;
    }
    case FilterCompleted:
    {
      let out = null;
      for (const [_$, t] of __s(todos).entries()) {
        if (t.done) {
          out = __append(out, t);
        }
      }
      return out;
    }
    default:
    {
      return __append([], ...todos);
    }
  }
}

function stats() {
  let remaining = 0;
  let completed = 0;
  for (const [_$, t] of __s(todos).entries()) {
    if (t.done) {
      completed++;
    } else {
      remaining++;
    }
  }
  return [remaining, completed];
}

function highCount() {
  let n = 0;
  for (const [_$, t] of __s(todos).entries()) {
    if (t.isUrgent()) {
      n++;
    }
  }
  return n;
}

function injectStyles() {
  let style = document.createElement("style");
  style.textContent = "\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n\n:root {\n  --accent:      #a78bfa;\n  --accent-2:    #818cf8;\n  --accent-glow: rgba(167,139,250,.18);\n  --red:         #f87171;\n  --red-glow:    rgba(248,113,113,.15);\n  --green:       #6ee7b7;\n  --text:        #f8fafc;\n  --text-2:      #94a3b8;\n  --muted:       #3f4f63;\n  --surface:     rgba(15,23,42,.7);\n  --surface-2:   rgba(30,41,59,.6);\n  --surface-3:   rgba(51,65,85,.5);\n  --rim:         rgba(255,255,255,.07);\n  --radius:      20px;\n}\n\nbody {\n  font-family: \"Inter\", -apple-system, sans-serif;\n  min-height: 100vh;\n  display: flex;\n  align-items: flex-start;\n  justify-content: center;\n  padding: 72px 16px 96px;\n  background: #060912;\n  overflow-x: hidden;\n}\n\nbody::before {\n  content: '';\n  position: fixed;\n  inset: 0;\n  background:\n    radial-gradient(ellipse 60% 50% at 20% 10%, rgba(139,92,246,.22) 0%, transparent 60%),\n    radial-gradient(ellipse 50% 60% at 80% 80%, rgba(99,102,241,.18) 0%, transparent 60%),\n    radial-gradient(ellipse 40% 40% at 60% 30%, rgba(236,72,153,.1) 0%, transparent 50%);\n  pointer-events: none;\n  z-index: 0;\n}\n\n.card {\n  position: relative;\n  z-index: 1;\n  width: 100%;\n  max-width: 480px;\n  background: var(--surface);\n  backdrop-filter: blur(24px) saturate(1.6);\n  -webkit-backdrop-filter: blur(24px) saturate(1.6);\n  border-radius: var(--radius);\n  border: 1px solid var(--rim);\n  box-shadow:\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 2px 4px rgba(0,0,0,.4),\n    0 20px 60px rgba(0,0,0,.6),\n    0 0 120px rgba(139,92,246,.06);\n  overflow: hidden;\n}\n\n.header {\n  padding: 32px 28px 24px;\n  position: relative;\n}\n\n.header::after {\n  content: '';\n  position: absolute;\n  bottom: 0; left: 0; right: 0;\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n}\n\n.header-top {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin-bottom: 6px;\n}\n\n.header-icon {\n  width: 36px; height: 36px;\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  border-radius: 10px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 1rem;\n  box-shadow: 0 4px 14px rgba(124,58,237,.4);\n  flex-shrink: 0;\n}\n\nh1 {\n  font-size: 1.5rem;\n  font-weight: 700;\n  color: var(--text);\n  letter-spacing: -.04em;\n}\n\n.high-badge {\n  display: none;\n  font-size: .6rem;\n  font-weight: 700;\n  background: linear-gradient(135deg, #ef4444, #f87171);\n  color: #fff;\n  padding: 3px 9px;\n  border-radius: 99px;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  box-shadow: 0 2px 10px rgba(239,68,68,.5);\n  animation: pop .25s cubic-bezier(.34,1.56,.64,1);\n}\n\n@keyframes pop {\n  from { transform: scale(0.5) rotate(-8deg); opacity: 0; }\n  to   { transform: scale(1) rotate(0deg);    opacity: 1; }\n}\n\n.tagline {\n  font-size: .73rem;\n  color: var(--muted);\n  letter-spacing: .01em;\n  padding-left: 48px;\n}\n.tagline strong { color: var(--accent); font-weight: 500; }\n.tagline a { color: inherit; text-decoration: none; }\n.tagline a:hover { text-decoration: underline; }\n\n.input-row {\n  display: flex;\n  gap: 8px;\n  padding: 20px 20px 16px;\n}\n\n.todo-input {\n  flex: 1;\n  padding: 11px 16px;\n  border: 1px solid rgba(255,255,255,.08);\n  border-radius: 12px;\n  font-size: .9rem;\n  font-family: inherit;\n  outline: none;\n  background: var(--surface-2);\n  color: var(--text);\n  transition: border-color .2s, box-shadow .2s, background .2s;\n}\n.todo-input::placeholder { color: var(--muted); }\n.todo-input:focus {\n  border-color: rgba(167,139,250,.5);\n  background: var(--surface-3);\n  box-shadow: 0 0 0 3px var(--accent-glow), 0 1px 3px rgba(0,0,0,.3);\n}\n\n.add-btn {\n  padding: 11px 20px;\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  color: #fff;\n  border: none;\n  border-radius: 12px;\n  font-size: .9rem;\n  font-family: inherit;\n  font-weight: 600;\n  cursor: pointer;\n  transition: opacity .15s, box-shadow .2s, transform .1s;\n  white-space: nowrap;\n  box-shadow: 0 4px 14px rgba(124,58,237,.35);\n  letter-spacing: .01em;\n}\n.add-btn:hover  { opacity: .9; box-shadow: 0 6px 20px rgba(124,58,237,.5); }\n.add-btn:active { transform: scale(.96); opacity: 1; }\n\n.priority-btn {\n  padding: 11px 14px;\n  background: var(--surface-2);\n  color: var(--text-2);\n  border: 1px solid rgba(255,255,255,.08);\n  border-radius: 12px;\n  font-size: .82rem;\n  font-family: inherit;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all .2s;\n  white-space: nowrap;\n}\n.priority-btn:hover { border-color: rgba(255,255,255,.18); color: var(--text); }\n.priority-btn.on {\n  background: var(--red-glow);\n  color: var(--red);\n  border-color: rgba(248,113,113,.3);\n  box-shadow: 0 0 0 3px rgba(248,113,113,.07);\n}\n\n.list-divider {\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n  margin: 0 20px;\n}\n\n.todo-list {\n  list-style: none;\n  padding: 8px 0;\n  min-height: 60px;\n}\n\n.todo-item {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 12px 20px;\n  transition: background .15s;\n  cursor: default;\n  position: relative;\n}\n.todo-item::after {\n  content: '';\n  position: absolute;\n  bottom: 0; left: 20px; right: 20px;\n  height: 1px;\n  background: rgba(255,255,255,.04);\n}\n.todo-item:last-child::after { display: none; }\n.todo-item:hover { background: rgba(255,255,255,.03); }\n.todo-item[draggable=\"true\"] { cursor: grab; }\n.todo-item[draggable=\"true\"]:active { cursor: grabbing; }\n.todo-item.dragging { opacity: .35; }\n.todo-item.drag-over {\n  box-shadow: inset 0 2px 0 0 var(--accent);\n}\n\n.todo-item.high .todo-text::before {\n  content: '';\n  display: inline-block;\n  width: 6px; height: 6px;\n  background: var(--red);\n  border-radius: 50%;\n  margin-right: 8px;\n  vertical-align: middle;\n  box-shadow: 0 0 6px var(--red);\n  flex-shrink: 0;\n}\n.todo-item.done .todo-text::before { display: none; }\n\n.todo-cb {\n  appearance: none;\n  -webkit-appearance: none;\n  width: 20px; height: 20px;\n  border: 1.5px solid rgba(255,255,255,.15);\n  border-radius: 7px;\n  cursor: pointer;\n  flex-shrink: 0;\n  position: relative;\n  transition: all .2s;\n  background: var(--surface-2);\n}\n.todo-cb:hover {\n  border-color: var(--accent);\n  box-shadow: 0 0 0 3px var(--accent-glow);\n}\n.todo-cb:checked {\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  border-color: transparent;\n  box-shadow: 0 2px 8px rgba(124,58,237,.4);\n}\n.todo-cb:checked::after {\n  content: '';\n  position: absolute;\n  left: 5px; top: 2px;\n  width: 6px; height: 10px;\n  border: 2px solid #fff;\n  border-top: none;\n  border-left: none;\n  transform: rotate(45deg);\n}\n\n.todo-text {\n  flex: 1;\n  font-size: .9rem;\n  color: var(--text);\n  line-height: 1.45;\n  transition: color .2s;\n  display: flex;\n  align-items: center;\n}\n.todo-item.done .todo-text {\n  text-decoration: line-through;\n  text-decoration-color: rgba(255,255,255,.2);\n  color: var(--muted);\n}\n\n.badge {\n  font-size: .58rem;\n  font-weight: 700;\n  background: linear-gradient(135deg, #ef4444, #f87171);\n  color: #fff;\n  padding: 2px 8px;\n  border-radius: 99px;\n  flex-shrink: 0;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  box-shadow: 0 2px 8px rgba(239,68,68,.35);\n}\n\n.del-btn {\n  background: none;\n  border: none;\n  color: transparent;\n  font-size: .8rem;\n  cursor: pointer;\n  padding: 5px 7px;\n  border-radius: 8px;\n  line-height: 1;\n  transition: color .15s, background .15s;\n  flex-shrink: 0;\n}\n.todo-item:hover .del-btn { color: var(--muted); }\n.del-btn:hover { color: var(--red); background: var(--red-glow); }\n\n.empty {\n  padding: 44px 24px;\n  color: var(--muted);\n  font-size: .85rem;\n  text-align: center;\n  list-style: none;\n  letter-spacing: .01em;\n}\n\n.footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 14px 20px;\n  position: relative;\n}\n\n.footer::before {\n  content: '';\n  position: absolute;\n  top: 0; left: 0; right: 0;\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n}\n\n.count {\n  font-size: .75rem;\n  color: var(--muted);\n  white-space: nowrap;\n  font-weight: 500;\n  letter-spacing: .01em;\n}\n\n.filter-bar { display: flex; gap: 2px; }\n\n.filter-btn {\n  padding: 5px 13px;\n  background: none;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  font-size: .75rem;\n  font-family: inherit;\n  font-weight: 500;\n  cursor: pointer;\n  color: var(--muted);\n  transition: all .15s;\n  letter-spacing: .01em;\n}\n.filter-btn:hover  { color: var(--text-2); background: var(--surface-2); }\n.filter-btn.active {\n  border-color: rgba(167,139,250,.3);\n  color: var(--accent);\n  font-weight: 600;\n  background: rgba(167,139,250,.08);\n}\n\n.clear-btn {\n  background: none;\n  border: none;\n  font-size: .75rem;\n  font-family: inherit;\n  color: var(--muted);\n  cursor: pointer;\n  padding: 5px 10px;\n  border-radius: 8px;\n  transition: color .15s, background .15s;\n  white-space: nowrap;\n  letter-spacing: .01em;\n}\n.clear-btn:hover { color: var(--red); background: var(--red-glow); }\n\n.sync-status {\n  font-size: .68rem;\n  font-weight: 600;\n  letter-spacing: .04em;\n  padding: 3px 10px;\n  border-radius: 99px;\n  opacity: 0;\n  transition: opacity .2s;\n}\n.sync-status.saving {\n  opacity: 1;\n  color: var(--text-2);\n  background: var(--surface-3);\n}\n.sync-status.saved {\n  opacity: 1;\n  color: var(--green);\n  background: rgba(110,231,183,.1);\n}\n.sync-status.error {\n  opacity: 1;\n  color: var(--red);\n  background: var(--red-glow);\n}\n";
  document.head.appendChild(style);
}

function filterLabel(f) {
  switch (f) {
    case FilterAll:
    {
      return "All";
    }
    case FilterActive:
    {
      return "Active";
    }
    case FilterCompleted:
    {
      return "Completed";
    }
    default:
    {
      return "";
    }
  }
}

main();
