var __append = __append || function(a, ...b) { return a ? [...a, ...b] : b; };
var __s = __s || function(a) { return a || []; };

function Plural(n, word) {
  if (n === 1) {
    return String(n) + " " + word;
  }
  return String(n) + " " + word + "s";
}

function HasText(s) {
  return s.trim() !== "";
}

function Filter(items, pred) {
  let out = null;
  for (const [_$, item] of __s(items).entries()) {
    if (pred(item)) {
      out = __append(out, item);
    }
  }
  return out;
}

var __len = __len || function(a) { if (a && typeof a === 'object' && !Array.isArray(a)) return Object.keys(a).length; return a?.length ?? 0; };
var __append = __append || function(a, ...b) { return a ? [...a, ...b] : b; };
var __s = __s || function(a) { return a || []; };
var __sprintf = __sprintf || function(f,...a){let i=0;return f.replace(/%([#+\- 0]*)([0-9]*)\.?([0-9]*)[sdvftxXqobeEgGw%]/g,(m)=>{if(m==='%%')return'%';const fl=m.slice(1,-1),verb=m.slice(-1),v=a[i++];const pad=(s,w,z)=>{w=parseInt(w)||0;if(!w)return s;const p=(z?'0':' ').repeat(Math.max(0,w-s.length));return fl.includes('-')?s+p:p+s;};const [,flags,width,prec]=m.match(/^%([#+\- 0]*)([0-9]*)\.?([0-9]*)/)||[];const zero=flags?.includes('0')&&!flags?.includes('-');switch(verb){case's':return pad(String(v==null?'<nil>':v),width,false);case'd':return pad(String(Math.trunc(Number(v))),width,zero);case'v':{if(typeof v==='object'&&v!==null&&'re' in v&&'im' in v){const sign=v.im>=0?'+':'';return pad('('+v.re+sign+v.im+'i)',width,false);}return pad(String(v==null?'<nil>':v),width,false);}case'f':{const n=Number(v),p=prec!==''?parseInt(prec):6;return pad(n.toFixed(p),width,zero);}case't':return pad(String(!!v),width,false);case'x':return pad((Number(v)>>>0).toString(16),width,zero);case'X':return pad((Number(v)>>>0).toString(16).toUpperCase(),width,zero);case'o':return pad((Number(v)>>>0).toString(8),width,zero);case'b':return pad((Number(v)>>>0).toString(2),width,zero);case'q':return pad('"'+String(v==null?'':v).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"',width,false);case'e':case'E':{const n=Number(v),p=prec!==''?parseInt(prec):6;return pad(n.toExponential(p),width,zero);}case'g':case'G':{const n=Number(v);return pad(prec!==''?n.toPrecision(parseInt(prec)):String(n),width,zero);}case'w':return pad(String(v==null?'<nil>':typeof v==='object'&&v.Error?v.Error():v),width,false);default:return m;}});};
var __error = __error || function(msg, cause) { return { Error() { return msg; }, toString() { return msg; }, _msg: msg, _cause: cause ?? null }; };

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
    return __error("todo text cannot be empty");
  }
  if ([...(text)].length > maxTodoLen) {
    return __error("todo text too long");
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
      let rect = li.getBoundingClientRect();
      let after = e.clientY > rect.top + rect.height / 2;
      li.classList.remove("drag-over-top", "drag-over-bottom");
      if (after) {
        li.classList.add("drag-over-bottom");
      } else {
        li.classList.add("drag-over-top");
      }
    }
  });
  list.addEventListener("dragleave", function(e) {
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    if (!li.contains(e.relatedTarget)) {
      li.classList.remove("drag-over-top", "drag-over-bottom");
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
      let rect = li.getBoundingClientRect();
      let after = e.clientY > rect.top + rect.height / 2;
      moveTodo(dragSrcId, targetId, after);
      render();
      triggerSave();
    }
  });
  list.addEventListener("dragend", function(e) {
    let li = e.target.closest("li");
    if (li !== null) {
      li.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
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
  return "<li class=\"" + cls + "\" draggable=\"true\" data-id=\"" + id + "\">\n<input type=\"checkbox\" class=\"todo-cb\" data-action=\"toggle\" data-todo-id=\"" + id + "\"" + checked + " />\n<span class=\"todo-text\">" + t.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&#34;").replace(/'/g,"&#39;") + "</span>" + badge + "<button class=\"del-btn\" data-action=\"delete\" data-todo-id=\"" + id + "\">✕</button>\n</li>";
}

function renderFilterBar() {
  let filters = [FilterAll, FilterActive, FilterCompleted];
  let b = { _buf: "" };
  (b._buf += "<div class=\"filter-bar\">", ["<div class=\"filter-bar\">".length, null]);
  for (const [_$, f] of __s(filters).entries()) {
    let cls = "filter-btn";
    if (f === filter) {
      cls = "filter-btn active";
    }
    (b._buf += "<button class=\"" + cls + "\" data-action=\"filter\" data-filter=\"" + String(f) + "\">", ["<button class=\"" + cls + "\" data-action=\"filter\" data-filter=\"" + String(f) + "\">".length, null]);
    (b._buf += filterLabel(f), [filterLabel(f).length, null]);
    (b._buf += "</button>", ["</button>".length, null]);
  }
  (b._buf += "</div>", ["</div>".length, null]);
  return b._buf;
}

function render() {
  let list = document.querySelector(".todo-list");
  let visible = visibleTodos();
  if (__len(visible) === 0) {
    list.innerHTML = "<li class=\"empty\">Nothing here.</li>";
  } else {
    let b = { _buf: "" };
    for (const [_$, t] of __s(visible).entries()) {
      (b._buf += renderTodo(t), [renderTodo(t).length, null]);
    }
    list.innerHTML = b._buf;
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
    footer.innerHTML = "<span class=\"count\">" + countText.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&#34;").replace(/'/g,"&#39;") + "</span>" + renderFilterBar() + clearBtn;
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
          err = __error(__sprintf("%v", r));
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
    return __error(__sprintf("invalid stored todos: %w", parseErr), parseErr);
  }
  if (parsed === null) {
    return __error("failed to parse stored todos");
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
  todos = todos.filter((v) => !function(t) {
    return t.id === id;
  }(v));
}

function clearCompleted() {
  todos = todos.filter((v) => !function(t) {
    return t.done;
  }(v));
}

function setFilter(f) {
  filter = f;
}

function moveTodo(fromId, toId, after) {
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
    if (!after && t.id === toId) {
      result = __append(result, item);
      inserted = true;
    }
    result = __append(result, t);
    if (after && t.id === toId) {
      result = __append(result, item);
      inserted = true;
    }
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
      return Filter(todos, function(t) {
        return !t.done;
      });
    }
    case FilterCompleted:
    {
      return Filter(todos, function(t) {
        return t.done;
      });
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
  return __len(Filter(todos, function(t) {
    return t.isUrgent();
  }));
}

function injectStyles() {
  let style = document.createElement("style");
  style.textContent = "\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n\n:root {\n  --accent:      #a78bfc;\n  --accent-2:    #818cf8;\n  --accent-glow: rgba(167,139,250,.18);\n  --red:         #f87171;\n  --red-glow:    rgba(248,113,113,.15);\n  --green:       #6ee7b7;\n  --text:        #f8fafc;\n  --text-2:      #94a3b8;\n  --muted:       #3f4f63;\n  --surface:     rgba(15,23,42,.7);\n  --surface-2:   rgba(30,41,59,.6);\n  --surface-3:   rgba(51,65,85,.5);\n  --rim:         rgba(255,255,255,.07);\n  --radius:      20px;\n}\n\nbody {\n  font-family: \"Inter\", -apple-system, sans-serif;\n  min-height: 100vh;\n  display: flex;\n  align-items: flex-start;\n  justify-content: center;\n  padding: 72px 16px 96px;\n  background: #060912;\n  overflow-x: hidden;\n}\n\nbody::before {\n  content: '';\n  position: fixed;\n  inset: 0;\n  background:\n    radial-gradient(ellipse 60% 50% at 20% 10%, rgba(139,92,246,.22) 0%, transparent 60%),\n    radial-gradient(ellipse 50% 60% at 80% 80%, rgba(99,102,241,.18) 0%, transparent 60%),\n    radial-gradient(ellipse 40% 40% at 60% 30%, rgba(236,72,153,.1) 0%, transparent 50%);\n  pointer-events: none;\n  z-index: 0;\n}\n\n.card {\n  position: relative;\n  z-index: 1;\n  width: 100%;\n  max-width: 480px;\n  background: var(--surface);\n  backdrop-filter: blur(24px) saturate(1.6);\n  -webkit-backdrop-filter: blur(24px) saturate(1.6);\n  border-radius: var(--radius);\n  border: 1px solid var(--rim);\n  box-shadow:\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 2px 4px rgba(0,0,0,.4),\n    0 20px 60px rgba(0,0,0,.6),\n    0 0 120px rgba(139,92,246,.06);\n  overflow: hidden;\n}\n\n.header {\n  padding: 32px 28px 24px;\n  position: relative;\n}\n\n.header::after {\n  content: '';\n  position: absolute;\n  bottom: 0; left: 0; right: 0;\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n}\n\n.header-top {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin-bottom: 6px;\n}\n\n.header-icon {\n  width: 36px; height: 36px;\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  border-radius: 10px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 1rem;\n  box-shadow: 0 4px 14px rgba(124,58,237,.4);\n  flex-shrink: 0;\n}\n\nh1 {\n  font-size: 1.5rem;\n  font-weight: 700;\n  color: var(--text);\n  letter-spacing: -.04em;\n}\n\n.high-badge {\n  display: none;\n  font-size: .6rem;\n  font-weight: 700;\n  background: linear-gradient(135deg, #ef4444, #f87171);\n  color: #fff;\n  padding: 3px 9px;\n  border-radius: 99px;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  box-shadow: 0 2px 10px rgba(239,68,68,.5);\n  animation: pop .25s cubic-bezier(.34,1.56,.64,1);\n}\n\n@keyframes pop {\n  from { transform: scale(0.5) rotate(-8deg); opacity: 0; }\n  to   { transform: scale(1) rotate(0deg);    opacity: 1; }\n}\n\n.tagline {\n  font-size: .73rem;\n  color: var(--muted);\n  letter-spacing: .01em;\n  padding-left: 48px;\n}\n.tagline strong { color: var(--accent); font-weight: 500; }\n.tagline a { color: inherit; text-decoration: none; }\n.tagline a:hover { text-decoration: underline; }\n\n.input-row {\n  display: flex;\n  gap: 8px;\n  padding: 20px 20px 16px;\n}\n\n.todo-input {\n  flex: 1;\n  padding: 11px 16px;\n  border: 1px solid rgba(255,255,255,.08);\n  border-radius: 12px;\n  font-size: .9rem;\n  font-family: inherit;\n  outline: none;\n  background: var(--surface-2);\n  color: var(--text);\n  transition: border-color .2s, box-shadow .2s, background .2s;\n}\n.todo-input::placeholder { color: var(--muted); }\n.todo-input:focus {\n  border-color: rgba(167,139,250,.5);\n  background: var(--surface-3);\n  box-shadow: 0 0 0 3px var(--accent-glow), 0 1px 3px rgba(0,0,0,.3);\n}\n\n.add-btn {\n  padding: 11px 20px;\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  color: #fff;\n  border: none;\n  border-radius: 12px;\n  font-size: .9rem;\n  font-family: inherit;\n  font-weight: 600;\n  cursor: pointer;\n  transition: opacity .15s, box-shadow .2s, transform .1s;\n  white-space: nowrap;\n  box-shadow: 0 4px 14px rgba(124,58,237,.35);\n  letter-spacing: .01em;\n}\n.add-btn:hover  { opacity: .9; box-shadow: 0 6px 20px rgba(124,58,237,.5); }\n.add-btn:active { transform: scale(.96); opacity: 1; }\n\n.priority-btn {\n  padding: 11px 14px;\n  background: var(--surface-2);\n  color: var(--text-2);\n  border: 1px solid rgba(255,255,255,.08);\n  border-radius: 12px;\n  font-size: .82rem;\n  font-family: inherit;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all .2s;\n  white-space: nowrap;\n}\n.priority-btn:hover { border-color: rgba(255,255,255,.18); color: var(--text); }\n.priority-btn.on {\n  background: var(--red-glow);\n  color: var(--red);\n  border-color: rgba(248,113,113,.3);\n  box-shadow: 0 0 0 3px rgba(248,113,113,.07);\n}\n\n.list-divider {\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n  margin: 0 20px;\n}\n\n.todo-list {\n  list-style: none;\n  padding: 8px 0;\n  min-height: 60px;\n}\n\n.todo-item {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 12px 20px;\n  transition: background .15s;\n  cursor: default;\n  position: relative;\n}\n.todo-item::after {\n  content: '';\n  position: absolute;\n  bottom: 0; left: 20px; right: 20px;\n  height: 1px;\n  background: rgba(255,255,255,.04);\n}\n.todo-item:last-child::after { display: none; }\n.todo-item:hover { background: rgba(255,255,255,.03); }\n.todo-item[draggable=\"true\"] { cursor: grab; }\n.todo-item[draggable=\"true\"]:active { cursor: grabbing; }\n.todo-item.dragging { opacity: .35; }\n.todo-item.drag-over-top    { box-shadow: inset 0  2px 0 0 var(--accent); }\n.todo-item.drag-over-bottom { box-shadow: inset 0 -2px 0 0 var(--accent); }\n\n\n.todo-cb {\n  appearance: none;\n  -webkit-appearance: none;\n  width: 20px; height: 20px;\n  border: 1.5px solid rgba(255,255,255,.15);\n  border-radius: 7px;\n  cursor: pointer;\n  flex-shrink: 0;\n  position: relative;\n  transition: all .2s;\n  background: var(--surface-2);\n}\n.todo-cb:hover {\n  border-color: var(--accent);\n  box-shadow: 0 0 0 3px var(--accent-glow);\n}\n.todo-cb:checked {\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  border-color: transparent;\n  box-shadow: 0 2px 8px rgba(124,58,237,.4);\n}\n.todo-cb:checked::after {\n  content: '';\n  position: absolute;\n  left: 5px; top: 2px;\n  width: 6px; height: 10px;\n  border: 2px solid #fff;\n  border-top: none;\n  border-left: none;\n  transform: rotate(45deg);\n}\n\n.todo-text {\n  flex: 1;\n  font-size: .9rem;\n  color: var(--text);\n  line-height: 1.45;\n  transition: color .2s;\n  display: flex;\n  align-items: center;\n}\n.todo-item.done .todo-text {\n  text-decoration: line-through;\n  text-decoration-color: rgba(255,255,255,.2);\n  color: var(--muted);\n}\n\n.badge {\n  font-size: .58rem;\n  font-weight: 700;\n  background: linear-gradient(135deg, #ef4444, #f87171);\n  color: #fff;\n  padding: 2px 8px;\n  border-radius: 99px;\n  flex-shrink: 0;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  box-shadow: 0 2px 8px rgba(239,68,68,.35);\n}\n\n.del-btn {\n  background: none;\n  border: none;\n  color: transparent;\n  font-size: .8rem;\n  cursor: pointer;\n  padding: 5px 7px;\n  border-radius: 8px;\n  line-height: 1;\n  transition: color .15s, background .15s;\n  flex-shrink: 0;\n}\n.todo-item:hover .del-btn { color: var(--muted); }\n.del-btn:hover { color: var(--red); background: var(--red-glow); }\n\n.empty {\n  padding: 44px 24px;\n  color: var(--muted);\n  font-size: .85rem;\n  text-align: center;\n  list-style: none;\n  letter-spacing: .01em;\n}\n\n.footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 14px 20px;\n  position: relative;\n}\n\n.footer::before {\n  content: '';\n  position: absolute;\n  top: 0; left: 0; right: 0;\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n}\n\n.count {\n  font-size: .75rem;\n  color: var(--muted);\n  white-space: nowrap;\n  font-weight: 500;\n  letter-spacing: .01em;\n}\n\n.filter-bar { display: flex; gap: 2px; }\n\n.filter-btn {\n  padding: 5px 13px;\n  background: none;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  font-size: .75rem;\n  font-family: inherit;\n  font-weight: 500;\n  cursor: pointer;\n  color: var(--muted);\n  transition: all .15s;\n  letter-spacing: .01em;\n}\n.filter-btn:hover  { color: var(--text-2); background: var(--surface-2); }\n.filter-btn.active {\n  border-color: rgba(167,139,250,.3);\n  color: var(--accent);\n  font-weight: 600;\n  background: rgba(167,139,250,.08);\n}\n\n.clear-btn {\n  background: none;\n  border: none;\n  font-size: .75rem;\n  font-family: inherit;\n  color: var(--muted);\n  cursor: pointer;\n  padding: 5px 10px;\n  border-radius: 8px;\n  transition: color .15s, background .15s;\n  white-space: nowrap;\n  letter-spacing: .01em;\n}\n.clear-btn:hover { color: var(--red); background: var(--red-glow); }\n\n.sync-status {\n  font-size: .68rem;\n  font-weight: 600;\n  letter-spacing: .04em;\n  padding: 3px 10px;\n  border-radius: 99px;\n  opacity: 0;\n  transition: opacity .2s;\n}\n.sync-status.saving {\n  opacity: 1;\n  color: var(--text-2);\n  background: var(--surface-3);\n}\n.sync-status.saved {\n  opacity: 1;\n  color: var(--green);\n  background: rgba(110,231,183,.1);\n}\n.sync-status.error {\n  opacity: 1;\n  color: var(--red);\n  background: var(--red-glow);\n}\n";
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
(function(){var es=new EventSource('/_gofront/events');es.addEventListener('reload',function(){location.reload();});})();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tYWluLmdvIiwic3JjL3JlbmRlci5nbyIsInNyYy9zdG9yZS5nbyIsInNyYy9zdHlsZXMuZ28iLCJzcmMvdHlwZXMuZ28iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBNElBO0FBMERBO0FBQ0E7QUF2TEE7QUFpS0E7QUFTQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQWhEQTtBQXlCQTs7QUE3SEE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBdkNBO0FBRUE7QUFDQTs7QUFFQTtBQUNBOztBQUVBOzs7QUFHQTtBQUVBO0FBQ0E7QUFDQTs7O0FBR0E7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7O0FBR0E7Ozs7QUFFQTtBQUNBO0FBRUE7QUFDQTtBQUNBOztBQUdBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOzs7Ozs7Ozs7QUFFQTtBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7OztBQUtBO0FBRUE7QUFDQTs7O0FBb0JBO0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUVBO0FBSUE7QUFNQTtBQUtBO0FBUUE7QUFTQTtBQWNBO0FBUUE7QUFpQkE7QUFRQTtBQWNBOzs7QUFPQTtBQUVBO0FBQ0E7QUFDQTtBQUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBR0E7OztBQ3BOQTtBREVBO0FBQ0E7QUFDQTs7QUFFQTs7QUFHQTtBQUNBO0FBQ0E7O0FBR0E7QUFDQTtBQUNBOztBQUdBO0FBQ0E7OztBQ09BO0FERUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7OztBQ0VBO0FER0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBOztBQUlBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUdBOztBQUtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7OztBRS9FQTs7Ozs7O0FGRUE7QUFLQTtBQUNBOzs7Ozs7Ozs7O0FFRUE7QUZFQTtBQUNBOzs7QUVFQTtBRkVBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7OztBRUlBO0FGRUE7QUFDQTs7O0FFRUE7QUZFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7O0FBR0E7OztBRUVBO0FGRUE7OztBRUVBO0FGRUE7OztBRUVBO0FGRUE7OztBRUVBO0FGRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBOzs7QUFHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7OztBQUdBO0FBQ0E7O0FBRUE7OztBRUlBO0FGRUE7OztBQUVBOzs7O0FBRUE7Ozs7QUFFQTs7Ozs7QUVHQTs7O0FGRUE7QUFDQTtBQUNBOztBQUVBOzs7QUFHQTs7O0FFRUE7QUZFQTs7O0FHMUlBO0FIRUE7QUFDQTtBQW1aQTs7O0FJL1lBO0FKRUE7OztBQUVBOzs7O0FBRUE7Ozs7QUFFQTs7OztBQUVBIiwic291cmNlc0NvbnRlbnQiOlsicGFja2FnZSBtYWluXG5cbmltcG9ydCBcInVuaWNvZGUvdXRmOFwiXG5cbmNvbnN0IG1heFRvZG9MZW4gPSAxMjBcblxuZnVuYyB2YWxpZGF0ZVRvZG8odGV4dCBzdHJpbmcpIGVycm9yIHtcbiAgICBpZiAhdXRpbHMuSGFzVGV4dCh0ZXh0KSB7XG4gICAgICAgIHJldHVybiBlcnJvcnMuTmV3KFwidG9kbyB0ZXh0IGNhbm5vdCBiZSBlbXB0eVwiKVxuICAgIH1cbiAgICBpZiB1dGY4LlJ1bmVDb3VudEluU3RyaW5nKHRleHQpID4gbWF4VG9kb0xlbiB7XG4gICAgICAgIHJldHVybiBlcnJvcnMuTmV3KFwidG9kbyB0ZXh0IHRvbyBsb25nXCIpXG4gICAgfVxuICAgIHJldHVybiBuaWxcbn1cblxuLy8gc2V0U3luY1N0YXR1cyBicmllZmx5IHNob3dzIGEgc2F2ZSBzdGF0dXMgaW5kaWNhdG9yLlxuZnVuYyBzZXRTeW5jU3RhdHVzKG1zZyBzdHJpbmcsIGNscyBzdHJpbmcpIHtcbiAgICBlbCA6PSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiLnN5bmMtc3RhdHVzXCIpXG4gICAgZWwudGV4dENvbnRlbnQgPSBtc2dcbiAgICBlbC5jbGFzc05hbWUgPSBcInN5bmMtc3RhdHVzIFwiICsgY2xzXG59XG5cbi8vIHRyaWdnZXJTYXZlIHBlcnNpc3RzIHRvZG9zIGFuZCBicmllZmx5IHNob3dzIGEgc3RhdHVzIGluZGljYXRvci5cbmFzeW5jIGZ1bmMgdHJpZ2dlclNhdmUoKSB7XG4gICAgc2V0U3luY1N0YXR1cyhcIlNhdmluZ+KAplwiLCBcInNhdmluZ1wiKVxuICAgIGVyciA6PSBhd2FpdCBzYXZlVG9kb3MoKVxuICAgIGlmIGVyciAhPSBuaWwge1xuICAgICAgICBzZXRTeW5jU3RhdHVzKFwiU2F2ZSBmYWlsZWRcIiwgXCJlcnJvclwiKVxuICAgICAgICByZXR1cm5cbiAgICB9XG4gICAgc2V0U3luY1N0YXR1cyhcIlNhdmVkIOKck1wiLCBcInNhdmVkXCIpXG4gICAgYXdhaXQgc2xlZXAoMTUwMClcbiAgICBzZXRTeW5jU3RhdHVzKFwiXCIsIFwiXCIpXG59XG5cbi8vIHN1Ym1pdElucHV0IHZhbGlkYXRlcywgYWRkcywgYW5kIHNhdmVzIGEgbmV3IHRvZG8uXG5hc3luYyBmdW5jIHN1Ym1pdElucHV0KCkge1xuICAgIGlucHV0IDo9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIudG9kby1pbnB1dFwiKVxuICAgIGRlZmVyIGlucHV0LmZvY3VzKClcblxuICAgIGVyciA6PSB2YWxpZGF0ZVRvZG8oaW5wdXQudmFsdWUpXG4gICAgaWYgZXJyICE9IG5pbCB7XG4gICAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHByaW9yaXR5IDo9IFByaW9yaXR5Tm9ybWFsXG4gICAgaWYgaGlnaFByaW9yaXR5IHtcbiAgICAgICAgcHJpb3JpdHkgPSBQcmlvcml0eUhpZ2hcbiAgICB9XG4gICAgYWRkVG9kbyhpbnB1dC52YWx1ZSwgcHJpb3JpdHkpXG4gICAgaW5wdXQudmFsdWUgPSBcIlwiXG4gICAgaWYgaGlnaFByaW9yaXR5IHtcbiAgICAgICAgdG9nZ2xlUHJpb3JpdHlNb2RlKClcbiAgICB9XG4gICAgcmVuZGVyKClcbiAgICBhd2FpdCB0cmlnZ2VyU2F2ZSgpXG59XG5cbmZ1bmMgdG9nZ2xlUHJpb3JpdHlNb2RlKCkge1xuICAgIGhpZ2hQcmlvcml0eSA9ICFoaWdoUHJpb3JpdHlcbiAgICBidG4gOj0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi5wcmlvcml0eS1idG5cIilcbiAgICBpZiBoaWdoUHJpb3JpdHkge1xuICAgICAgICBidG4uY2xhc3NOYW1lICAgPSBcInByaW9yaXR5LWJ0biBvblwiXG4gICAgICAgIGJ0bi50ZXh0Q29udGVudCA9IFwi4pqhIEhpZ2hcIlxuICAgIH0gZWxzZSB7XG4gICAgICAgIGJ0bi5jbGFzc05hbWUgICA9IFwicHJpb3JpdHktYnRuXCJcbiAgICAgICAgYnRuLnRleHRDb250ZW50ID0gXCLimqEgTm9ybWFsXCJcbiAgICB9XG59XG5cbi8vIOKUgOKUgCBBcHAgc3RhcnR1cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZnVuYyBjcmVhdGVBcHAoKSB7XG4gICAgYXBwIDo9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiYXBwXCIpXG4gICAgYXBwLmlubmVySFRNTCA9IGA8ZGl2IGNsYXNzPVwiY2FyZFwiPlxuICA8aGVhZGVyIGNsYXNzPVwiaGVhZGVyXCI+XG4gICAgPGRpdiBjbGFzcz1cImhlYWRlci10b3BcIj5cbiAgICAgIDxkaXYgY2xhc3M9XCJoZWFkZXItaWNvblwiPuKckzwvZGl2PlxuICAgICAgPGgxPlRvZG9zIFNpbXBsZTwvaDE+XG4gICAgICA8c3BhbiBjbGFzcz1cImhpZ2gtYmFkZ2VcIj48L3NwYW4+XG4gICAgICA8c3BhbiBjbGFzcz1cInN5bmMtc3RhdHVzXCI+PC9zcGFuPlxuICAgIDwvZGl2PlxuICAgIDxwIGNsYXNzPVwidGFnbGluZVwiPkJ1aWx0IHdpdGggPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9zZXJpdmEvZ29mcm9udFwiIHRhcmdldD1cIl9ibGFua1wiPjxzdHJvbmc+R29Gcm9udDwvc3Ryb25nPjwvYT4g4oCUIEdvIGNvbXBpbGVkIHRvIEpTPC9wPlxuICA8L2hlYWRlcj5cbiAgPGRpdiBjbGFzcz1cImlucHV0LXJvd1wiPlxuICAgIDxpbnB1dCBjbGFzcz1cInRvZG8taW5wdXRcIiB0eXBlPVwidGV4dFwiIHBsYWNlaG9sZGVyPVwiV2hhdCBuZWVkcyB0byBiZSBkb25lP1wiIGF1dG9jb21wbGV0ZT1cIm9mZlwiIC8+XG4gICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJwcmlvcml0eS1idG5cIj7imqEgTm9ybWFsPC9idXR0b24+XG4gICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJhZGQtYnRuXCI+QWRkPC9idXR0b24+XG4gIDwvZGl2PlxuICA8ZGl2IGNsYXNzPVwibGlzdC1kaXZpZGVyXCI+PC9kaXY+XG4gIDx1bCBjbGFzcz1cInRvZG8tbGlzdFwiPjwvdWw+XG4gIDxmb290ZXIgY2xhc3M9XCJmb290ZXJcIj48L2Zvb3Rlcj5cbjwvZGl2PmBcbn1cblxuZnVuYyBzZXR1cEV2ZW50cygpIHtcbiAgICBhZGRCdG4gICAgICA6PSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiLmFkZC1idG5cIilcbiAgICBpbnB1dCAgICAgICA6PSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiLnRvZG8taW5wdXRcIilcbiAgICBwcmlvcml0eUJ0biA6PSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiLnByaW9yaXR5LWJ0blwiKVxuICAgIGxpc3QgICAgICAgIDo9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIudG9kby1saXN0XCIpXG4gICAgZm9vdGVyICAgICAgOj0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi5mb290ZXJcIilcblxuICAgIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgZnVuYygpIHtcbiAgICAgICAgc3VibWl0SW5wdXQoKVxuICAgIH0pXG5cbiAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBmdW5jKGUgYW55KSB7XG4gICAgICAgIGlmIGUua2V5ID09IFwiRW50ZXJcIiB7XG4gICAgICAgICAgICBzdWJtaXRJbnB1dCgpXG4gICAgICAgIH1cbiAgICB9KVxuXG4gICAgcHJpb3JpdHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGZ1bmMoKSB7XG4gICAgICAgIHRvZ2dsZVByaW9yaXR5TW9kZSgpXG4gICAgfSlcblxuICAgIC8vIEV2ZW50IGRlbGVnYXRpb246IHRvZ2dsZSAmIGRlbGV0ZVxuICAgIGxpc3QuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBmdW5jKGUgYW55KSB7XG4gICAgICAgIGlmIGUudGFyZ2V0LmdldEF0dHJpYnV0ZShcImRhdGEtYWN0aW9uXCIpID09IFwidG9nZ2xlXCIge1xuICAgICAgICAgICAgdG9nZ2xlVG9kbyhpbnQoZS50YXJnZXQuZ2V0QXR0cmlidXRlKFwiZGF0YS10b2RvLWlkXCIpKSlcbiAgICAgICAgICAgIHJlbmRlcigpXG4gICAgICAgICAgICB0cmlnZ2VyU2F2ZSgpXG4gICAgICAgIH1cbiAgICB9KVxuXG4gICAgbGlzdC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgZnVuYyhlIGFueSkge1xuICAgICAgICBpZiBlLnRhcmdldC5nZXRBdHRyaWJ1dGUoXCJkYXRhLWFjdGlvblwiKSA9PSBcImRlbGV0ZVwiIHtcbiAgICAgICAgICAgIHJlbW92ZVRvZG8oaW50KGUudGFyZ2V0LmdldEF0dHJpYnV0ZShcImRhdGEtdG9kby1pZFwiKSkpXG4gICAgICAgICAgICByZW5kZXIoKVxuICAgICAgICAgICAgdHJpZ2dlclNhdmUoKVxuICAgICAgICB9XG4gICAgfSlcblxuICAgIC8vIEV2ZW50IGRlbGVnYXRpb246IGZpbHRlciAmIGNsZWFyXG4gICAgZm9vdGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBmdW5jKGUgYW55KSB7XG4gICAgICAgIGFjdGlvbiA6PSBlLnRhcmdldC5nZXRBdHRyaWJ1dGUoXCJkYXRhLWFjdGlvblwiKVxuICAgICAgICBzd2l0Y2ggYWN0aW9uIHtcbiAgICAgICAgY2FzZSBcImZpbHRlclwiOlxuICAgICAgICAgICAgc2V0RmlsdGVyKGludChlLnRhcmdldC5nZXRBdHRyaWJ1dGUoXCJkYXRhLWZpbHRlclwiKSkpXG4gICAgICAgICAgICByZW5kZXIoKVxuICAgICAgICBjYXNlIFwiY2xlYXItY29tcGxldGVkXCI6XG4gICAgICAgICAgICBjbGVhckNvbXBsZXRlZCgpXG4gICAgICAgICAgICByZW5kZXIoKVxuICAgICAgICAgICAgdHJpZ2dlclNhdmUoKVxuICAgICAgICB9XG4gICAgfSlcblxuICAgIC8vIOKUgOKUgCBEcmFnLWFuZC1kcm9wIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGxpc3QuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCBmdW5jKGUgYW55KSB7XG4gICAgICAgIGxpIDo9IGUudGFyZ2V0LmNsb3Nlc3QoXCJsaVwiKVxuICAgICAgICBpZiBsaSA9PSBuaWwgeyByZXR1cm4gfVxuICAgICAgICBkcmFnU3JjSWQgPSBpbnQobGkuZ2V0QXR0cmlidXRlKFwiZGF0YS1pZFwiKSlcbiAgICAgICAgbGkuY2xhc3NMaXN0LmFkZChcImRyYWdnaW5nXCIpXG4gICAgICAgIGUuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIlxuICAgIH0pXG5cbiAgICBsaXN0LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCBmdW5jKGUgYW55KSB7XG4gICAgICAgIGxpIDo9IGUudGFyZ2V0LmNsb3Nlc3QoXCJsaVwiKVxuICAgICAgICBpZiBsaSA9PSBuaWwgeyByZXR1cm4gfVxuICAgICAgICB0YXJnZXRJZCA6PSBpbnQobGkuZ2V0QXR0cmlidXRlKFwiZGF0YS1pZFwiKSlcbiAgICAgICAgaWYgZHJhZ1NyY0lkICE9IHRhcmdldElkIHtcbiAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKVxuICAgICAgICAgICAgcmVjdCA6PSBsaS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKVxuICAgICAgICAgICAgYWZ0ZXIgOj0gZS5jbGllbnRZID4gcmVjdC50b3ArcmVjdC5oZWlnaHQvMlxuICAgICAgICAgICAgbGkuY2xhc3NMaXN0LnJlbW92ZShcImRyYWctb3Zlci10b3BcIiwgXCJkcmFnLW92ZXItYm90dG9tXCIpXG4gICAgICAgICAgICBpZiBhZnRlciB7XG4gICAgICAgICAgICAgICAgbGkuY2xhc3NMaXN0LmFkZChcImRyYWctb3Zlci1ib3R0b21cIilcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbGkuY2xhc3NMaXN0LmFkZChcImRyYWctb3Zlci10b3BcIilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pXG5cbiAgICBsaXN0LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgZnVuYyhlIGFueSkge1xuICAgICAgICBsaSA6PSBlLnRhcmdldC5jbG9zZXN0KFwibGlcIilcbiAgICAgICAgaWYgbGkgPT0gbmlsIHsgcmV0dXJuIH1cbiAgICAgICAgaWYgIWxpLmNvbnRhaW5zKGUucmVsYXRlZFRhcmdldCkge1xuICAgICAgICAgICAgbGkuY2xhc3NMaXN0LnJlbW92ZShcImRyYWctb3Zlci10b3BcIiwgXCJkcmFnLW92ZXItYm90dG9tXCIpXG4gICAgICAgIH1cbiAgICB9KVxuXG4gICAgbGlzdC5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBmdW5jKGUgYW55KSB7XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKVxuICAgICAgICBsaSA6PSBlLnRhcmdldC5jbG9zZXN0KFwibGlcIilcbiAgICAgICAgaWYgbGkgPT0gbmlsIHsgcmV0dXJuIH1cbiAgICAgICAgdGFyZ2V0SWQgOj0gaW50KGxpLmdldEF0dHJpYnV0ZShcImRhdGEtaWRcIikpXG4gICAgICAgIGlmIGRyYWdTcmNJZCAhPSB0YXJnZXRJZCB7XG4gICAgICAgICAgICByZWN0IDo9IGxpLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpXG4gICAgICAgICAgICBhZnRlciA6PSBlLmNsaWVudFkgPiByZWN0LnRvcCtyZWN0LmhlaWdodC8yXG4gICAgICAgICAgICBtb3ZlVG9kbyhkcmFnU3JjSWQsIHRhcmdldElkLCBhZnRlcilcbiAgICAgICAgICAgIHJlbmRlcigpXG4gICAgICAgICAgICB0cmlnZ2VyU2F2ZSgpXG4gICAgICAgIH1cbiAgICB9KVxuXG4gICAgbGlzdC5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCBmdW5jKGUgYW55KSB7XG4gICAgICAgIGxpIDo9IGUudGFyZ2V0LmNsb3Nlc3QoXCJsaVwiKVxuICAgICAgICBpZiBsaSAhPSBuaWwge1xuICAgICAgICAgICAgbGkuY2xhc3NMaXN0LnJlbW92ZShcImRyYWdnaW5nXCIsIFwiZHJhZy1vdmVyLXRvcFwiLCBcImRyYWctb3Zlci1ib3R0b21cIilcbiAgICAgICAgfVxuICAgIH0pXG59XG5cbmFzeW5jIGZ1bmMgbWFpbigpIHtcbiAgICBpbmplY3RTdHlsZXMoKVxuICAgIGNyZWF0ZUFwcCgpXG4gICAgc2V0dXBFdmVudHMoKVxuXG4gICAgLy8gUmVzdG9yZSBwZXJzaXN0ZWQgdG9kb3M7IHNlZWQgaWYgZW1wdHkuXG4gICAgbG9hZEVyciA6PSBhd2FpdCBsb2FkVG9kb3MoKVxuICAgIGlmIGxvYWRFcnIgIT0gbmlsIHx8IGxlbih0b2RvcykgPT0gMCB7XG4gICAgICAgIGFkZFRvZG8oXCJSZWFkIHRoZSBHb0Zyb250IGRvY3NcIiwgICAgICAgICAgIFByaW9yaXR5Tm9ybWFsKVxuICAgICAgICBhZGRUb2RvKFwiRml4IHRoZSBjcml0aWNhbCBwcm9kdWN0aW9uIGJ1Z1wiLCAgUHJpb3JpdHlIaWdoKVxuICAgICAgICBhZGRUb2RvKFwiV3JpdGUgdGVzdHNcIiwgICAgICAgICAgICAgICAgICAgICAgUHJpb3JpdHlOb3JtYWwpXG4gICAgICAgIGFkZFRvZG8oXCJEZXBsb3kgdG8gc3RhZ2luZ1wiLCAgICAgICAgICAgICAgICBQcmlvcml0eUhpZ2gpXG4gICAgICAgIGFkZFRvZG8oXCJTZW5kIHdlZWtseSB1cGRhdGUgZW1haWxcIiwgICAgICAgICBQcmlvcml0eU5vcm1hbClcbiAgICAgICAgdG9nZ2xlVG9kbygwKVxuICAgIH1cblxuICAgIHJlbmRlcigpXG59XG4iLCJwYWNrYWdlIG1haW5cblxuaW1wb3J0IFwiLi91dGlsc1wiXG5cbi8vIGRyYWdTcmNJZCBob2xkcyB0aGUgaWQgb2YgdGhlIHRvZG8gY3VycmVudGx5IGJlaW5nIGRyYWdnZWQuXG52YXIgZHJhZ1NyY0lkIGludFxuXG4vLyDilIDilIAgUmVuZGVyaW5nICh2YW5pbGxhIERPTSB2aWEgaW5uZXJIVE1MKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZnVuYyByZW5kZXJUb2RvKHQgVG9kbykgc3RyaW5nIHtcbiAgICBjbHMgOj0gXCJ0b2RvLWl0ZW1cIlxuICAgIGlmIHQuZG9uZSB7XG4gICAgICAgIGNscyA9IFwidG9kby1pdGVtIGRvbmVcIlxuICAgIH0gZWxzZSBpZiB0LmlzVXJnZW50KCkge1xuICAgICAgICBjbHMgPSBcInRvZG8taXRlbSBoaWdoXCJcbiAgICB9XG5cbiAgICBjaGVja2VkIDo9IFwiXCJcbiAgICBpZiB0LmRvbmUge1xuICAgICAgICBjaGVja2VkID0gXCIgY2hlY2tlZFwiXG4gICAgfVxuXG4gICAgYmFkZ2UgOj0gXCJcIlxuICAgIGlmIHQuaXNVcmdlbnQoKSB7XG4gICAgICAgIGJhZGdlID0gYDxzcGFuIGNsYXNzPVwiYmFkZ2VcIj51cmdlbnQ8L3NwYW4+YFxuICAgIH1cblxuICAgIGlkIDo9IFN0cmluZyh0LmlkKVxuICAgIHJldHVybiBgPGxpIGNsYXNzPVwiYCArIGNscyArIGBcIiBkcmFnZ2FibGU9XCJ0cnVlXCIgZGF0YS1pZD1cImAgKyBpZCArIGBcIj5cbjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cInRvZG8tY2JcIiBkYXRhLWFjdGlvbj1cInRvZ2dsZVwiIGRhdGEtdG9kby1pZD1cImAgKyBpZCArIGBcImAgKyBjaGVja2VkICsgYCAvPlxuPHNwYW4gY2xhc3M9XCJ0b2RvLXRleHRcIj5gICsgaHRtbC5Fc2NhcGVTdHJpbmcodC50ZXh0KSArIGA8L3NwYW4+YCArXG4gICAgICAgIGJhZGdlICtcbiAgICAgICAgYDxidXR0b24gY2xhc3M9XCJkZWwtYnRuXCIgZGF0YS1hY3Rpb249XCJkZWxldGVcIiBkYXRhLXRvZG8taWQ9XCJgICsgaWQgKyBgXCI+4pyVPC9idXR0b24+XG48L2xpPmBcbn1cblxuZnVuYyByZW5kZXJGaWx0ZXJCYXIoKSBzdHJpbmcge1xuICAgIGZpbHRlcnMgOj0gWy4uLl1pbnR7RmlsdGVyQWxsLCBGaWx0ZXJBY3RpdmUsIEZpbHRlckNvbXBsZXRlZH1cbiAgICB2YXIgYiBzdHJpbmdzLkJ1aWxkZXJcbiAgICBiLldyaXRlU3RyaW5nKGA8ZGl2IGNsYXNzPVwiZmlsdGVyLWJhclwiPmApXG4gICAgZm9yIF8sIGYgOj0gcmFuZ2UgZmlsdGVycyB7XG4gICAgICAgIGNscyA6PSBcImZpbHRlci1idG5cIlxuICAgICAgICBpZiBmID09IGZpbHRlciB7XG4gICAgICAgICAgICBjbHMgPSBcImZpbHRlci1idG4gYWN0aXZlXCJcbiAgICAgICAgfVxuICAgICAgICBiLldyaXRlU3RyaW5nKGA8YnV0dG9uIGNsYXNzPVwiYCArIGNscyArIGBcIiBkYXRhLWFjdGlvbj1cImZpbHRlclwiIGRhdGEtZmlsdGVyPVwiYCArIFN0cmluZyhmKSArIGBcIj5gKVxuICAgICAgICBiLldyaXRlU3RyaW5nKGZpbHRlckxhYmVsKGYpKVxuICAgICAgICBiLldyaXRlU3RyaW5nKGA8L2J1dHRvbj5gKVxuICAgIH1cbiAgICBiLldyaXRlU3RyaW5nKGA8L2Rpdj5gKVxuICAgIHJldHVybiBiLlN0cmluZygpXG59XG5cbmZ1bmMgcmVuZGVyKCkge1xuICAgIC8vIExpc3RcbiAgICBsaXN0IDo9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIudG9kby1saXN0XCIpXG4gICAgdmlzaWJsZSA6PSB2aXNpYmxlVG9kb3MoKVxuICAgIGlmIGxlbih2aXNpYmxlKSA9PSAwIHtcbiAgICAgICAgbGlzdC5pbm5lckhUTUwgPSBgPGxpIGNsYXNzPVwiZW1wdHlcIj5Ob3RoaW5nIGhlcmUuPC9saT5gXG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGIgc3RyaW5ncy5CdWlsZGVyXG4gICAgICAgIGZvciBfLCB0IDo9IHJhbmdlIHZpc2libGUge1xuICAgICAgICAgICAgYi5Xcml0ZVN0cmluZyhyZW5kZXJUb2RvKHQpKVxuICAgICAgICB9XG4gICAgICAgIGxpc3QuaW5uZXJIVE1MID0gYi5TdHJpbmcoKVxuICAgIH1cblxuICAgIC8vIEZvb3RlclxuICAgIGZvb3RlciA6PSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiLmZvb3RlclwiKVxuICAgIGlmIGxlbih0b2RvcykgPT0gMCB7XG4gICAgICAgIGZvb3Rlci5pbm5lckhUTUwgPSBcIlwiXG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmVtYWluaW5nLCBjb21wbGV0ZWQgOj0gc3RhdHMoKVxuICAgICAgICBjb3VudFRleHQgOj0gdXRpbHMuUGx1cmFsKHJlbWFpbmluZywgXCJ0YXNrXCIpICsgXCIgbGVmdFwiXG4gICAgICAgIGNsZWFyQnRuIDo9IFwiXCJcbiAgICAgICAgaWYgY29tcGxldGVkID4gMCB7XG4gICAgICAgICAgICBjbGVhckJ0biA9IGA8YnV0dG9uIGNsYXNzPVwiY2xlYXItYnRuXCIgZGF0YS1hY3Rpb249XCJjbGVhci1jb21wbGV0ZWRcIj5DbGVhciBjb21wbGV0ZWQgKGAgK1xuICAgICAgICAgICAgICAgIFN0cmluZyhjb21wbGV0ZWQpICsgYCk8L2J1dHRvbj5gXG4gICAgICAgIH1cbiAgICAgICAgZm9vdGVyLmlubmVySFRNTCA9IGA8c3BhbiBjbGFzcz1cImNvdW50XCI+YCArIGh0bWwuRXNjYXBlU3RyaW5nKGNvdW50VGV4dCkgKyBgPC9zcGFuPmAgK1xuICAgICAgICAgICAgcmVuZGVyRmlsdGVyQmFyKCkgKyBjbGVhckJ0blxuICAgIH1cblxuICAgIC8vIEJhZGdlXG4gICAgYmFkZ2UgOj0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi5oaWdoLWJhZGdlXCIpXG4gICAgaGMgOj0gaGlnaENvdW50KClcbiAgICBpZiBoYyA+IDAge1xuICAgICAgICBiYWRnZS5zdHlsZS5kaXNwbGF5ID0gXCJpbmxpbmUtYmxvY2tcIlxuICAgICAgICBiYWRnZS50ZXh0Q29udGVudCA9IFN0cmluZyhoYykgKyBcIiB1cmdlbnRcIlxuICAgIH0gZWxzZSB7XG4gICAgICAgIGJhZGdlLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIlxuICAgICAgICBiYWRnZS50ZXh0Q29udGVudCA9IFwiXCJcbiAgICB9XG59XG4iLCJwYWNrYWdlIG1haW5cblxuaW1wb3J0IFwianM6Li9icm93c2VyLmQudHNcIlxuXG4vLyDilIDilIAgQXBwbGljYXRpb24gc3RhdGUg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbnZhciB0b2RvcyAgICAgIFtdVG9kb1xudmFyIG5leHRJZCAgICAgaW50XG52YXIgZmlsdGVyICAgICBpbnRcbnZhciBoaWdoUHJpb3JpdHkgYm9vbFxuXG4vLyDilIDilIAgUGVyc2lzdGVuY2UgKGFzeW5jL2F3YWl0ICsgZGVmZXIvcmVjb3Zlcikg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmZ1bmMgc2FmZUpzb25QYXJzZShyYXcgc3RyaW5nKSAocmVzdWx0IGFueSwgZXJyIGVycm9yKSB7XG4gICAgZGVmZXIgZnVuYygpIHtcbiAgICAgICAgaWYgciA6PSByZWNvdmVyKCk7IHIgIT0gbmlsIHtcbiAgICAgICAgICAgIGVyciA9IGVycm9ycy5OZXcoZm10LlNwcmludGYoXCIldlwiLCByKSlcbiAgICAgICAgfVxuICAgIH0oKVxuICAgIHJlc3VsdCA9IEpTT04ucGFyc2UocmF3KVxuICAgIHJldHVybiByZXN1bHQsIG5pbFxufVxuXG5hc3luYyBmdW5jIHNhdmVUb2RvcygpIGVycm9yIHtcbiAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcInRvZG9zXCIsIEpTT04uc3RyaW5naWZ5KHRvZG9zKSlcbiAgICByZXR1cm4gbmlsXG59XG5cbmFzeW5jIGZ1bmMgbG9hZFRvZG9zKCkgZXJyb3Ige1xuICAgIHJhdyA6PSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShcInRvZG9zXCIpXG4gICAgaWYgcmF3ID09IG5pbCB7XG4gICAgICAgIHJldHVybiBuaWxcbiAgICB9XG4gICAgcGFyc2VkLCBwYXJzZUVyciA6PSBzYWZlSnNvblBhcnNlKHJhdylcbiAgICBpZiBwYXJzZUVyciAhPSBuaWwge1xuICAgICAgICByZXR1cm4gZm10LkVycm9yZihcImludmFsaWQgc3RvcmVkIHRvZG9zOiAld1wiLCBwYXJzZUVycilcbiAgICB9XG4gICAgaWYgcGFyc2VkID09IG5pbCB7XG4gICAgICAgIHJldHVybiBlcnJvcnMuTmV3KFwiZmFpbGVkIHRvIHBhcnNlIHN0b3JlZCB0b2Rvc1wiKVxuICAgIH1cbiAgICB2YXIgbG9hZGVkIFtdVG9kb1xuICAgIGZvciBfLCByYXcgOj0gcmFuZ2UgcGFyc2VkIHtcbiAgICAgICAgbG9hZGVkID0gYXBwZW5kKGxvYWRlZCwgVG9kb3tpZDogcmF3LmlkLCB0ZXh0OiByYXcudGV4dCwgZG9uZTogcmF3LmRvbmUsIHByaW9yaXR5OiByYXcucHJpb3JpdHl9KVxuICAgIH1cbiAgICBpZiBsZW4obG9hZGVkKSA+IDAge1xuICAgICAgICBsYXN0IDo9IGxvYWRlZFtsZW4obG9hZGVkKS0xXVxuICAgICAgICBuZXh0SWQgPSBsYXN0LmlkICsgMVxuICAgIH1cbiAgICB0b2RvcyA9IGxvYWRlZFxuICAgIHJldHVybiBuaWxcbn1cblxuLy8g4pSA4pSAIE11dGF0aW9ucyAoc2xpY2Ugb3BlcmF0aW9ucykg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmZ1bmMgYWRkVG9kbyh0ZXh0IHN0cmluZywgcHJpb3JpdHkgaW50KSB7XG4gICAgdG9kb3MgPSBhcHBlbmQodG9kb3MsIFRvZG97aWQ6IG5leHRJZCwgdGV4dDogdGV4dCwgZG9uZTogZmFsc2UsIHByaW9yaXR5OiBwcmlvcml0eX0pXG4gICAgbmV4dElkKytcbn1cblxuZnVuYyB0b2dnbGVUb2RvKGlkIGludCkge1xuICAgIHZhciBuZXh0IFtdVG9kb1xuICAgIGZvciBfLCB0IDo9IHJhbmdlIHRvZG9zIHtcbiAgICAgICAgaWYgdC5pZCA9PSBpZCB7XG4gICAgICAgICAgICBuZXh0ID0gYXBwZW5kKG5leHQsIHQud2l0aERvbmUoIXQuZG9uZSkpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBuZXh0ID0gYXBwZW5kKG5leHQsIHQpXG4gICAgICAgIH1cbiAgICB9XG4gICAgdG9kb3MgPSBuZXh0XG59XG5cbmZ1bmMgcmVtb3ZlVG9kbyhpZCBpbnQpIHtcbiAgICB0b2RvcyA9IHNsaWNlcy5EZWxldGVGdW5jKHRvZG9zLCBmdW5jKHQgVG9kbykgYm9vbCB7IHJldHVybiB0LmlkID09IGlkIH0pXG59XG5cbmZ1bmMgY2xlYXJDb21wbGV0ZWQoKSB7XG4gICAgdG9kb3MgPSBzbGljZXMuRGVsZXRlRnVuYyh0b2RvcywgZnVuYyh0IFRvZG8pIGJvb2wgeyByZXR1cm4gdC5kb25lIH0pXG59XG5cbmZ1bmMgc2V0RmlsdGVyKGYgaW50KSB7XG4gICAgZmlsdGVyID0gZlxufVxuXG5mdW5jIG1vdmVUb2RvKGZyb21JZCBpbnQsIHRvSWQgaW50LCBhZnRlciBib29sKSB7XG4gICAgaWYgZnJvbUlkID09IHRvSWQge1xuICAgICAgICByZXR1cm5cbiAgICB9XG4gICAgdmFyIGl0ZW0gVG9kb1xuICAgIHZhciByZXN0IFtdVG9kb1xuICAgIGZvciBfLCB0IDo9IHJhbmdlIHRvZG9zIHtcbiAgICAgICAgaWYgdC5pZCA9PSBmcm9tSWQge1xuICAgICAgICAgICAgaXRlbSA9IHRcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3QgPSBhcHBlbmQocmVzdCwgdClcbiAgICAgICAgfVxuICAgIH1cbiAgICB2YXIgcmVzdWx0IFtdVG9kb1xuICAgIGluc2VydGVkIDo9IGZhbHNlXG4gICAgZm9yIF8sIHQgOj0gcmFuZ2UgcmVzdCB7XG4gICAgICAgIGlmICFhZnRlciAmJiB0LmlkID09IHRvSWQge1xuICAgICAgICAgICAgcmVzdWx0ID0gYXBwZW5kKHJlc3VsdCwgaXRlbSlcbiAgICAgICAgICAgIGluc2VydGVkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIHJlc3VsdCA9IGFwcGVuZChyZXN1bHQsIHQpXG4gICAgICAgIGlmIGFmdGVyICYmIHQuaWQgPT0gdG9JZCB7XG4gICAgICAgICAgICByZXN1bHQgPSBhcHBlbmQocmVzdWx0LCBpdGVtKVxuICAgICAgICAgICAgaW5zZXJ0ZWQgPSB0cnVlXG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgIWluc2VydGVkIHtcbiAgICAgICAgcmVzdWx0ID0gYXBwZW5kKHJlc3VsdCwgaXRlbSlcbiAgICB9XG4gICAgdG9kb3MgPSByZXN1bHRcbn1cblxuLy8g4pSA4pSAIERlcml2ZWQgdmFsdWVzIChtdWx0aXBsZSByZXR1cm5zLCBmb3IgcmFuZ2UsIHN3aXRjaCkg4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmZ1bmMgdmlzaWJsZVRvZG9zKCkgW11Ub2RvIHtcbiAgICBzd2l0Y2ggZmlsdGVyIHtcbiAgICBjYXNlIEZpbHRlckFjdGl2ZTpcbiAgICAgICAgcmV0dXJuIHV0aWxzLkZpbHRlcih0b2RvcywgZnVuYyh0IFRvZG8pIGJvb2wgeyByZXR1cm4gIXQuZG9uZSB9KVxuICAgIGNhc2UgRmlsdGVyQ29tcGxldGVkOlxuICAgICAgICByZXR1cm4gdXRpbHMuRmlsdGVyKHRvZG9zLCBmdW5jKHQgVG9kbykgYm9vbCB7IHJldHVybiB0LmRvbmUgfSlcbiAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gYXBwZW5kKFtdVG9kb3t9LCB0b2Rvcy4uLilcbiAgICB9XG59XG5cbmZ1bmMgc3RhdHMoKSAocmVtYWluaW5nIGludCwgY29tcGxldGVkIGludCkge1xuICAgIGZvciBfLCB0IDo9IHJhbmdlIHRvZG9zIHtcbiAgICAgICAgaWYgdC5kb25lIHtcbiAgICAgICAgICAgIGNvbXBsZXRlZCsrXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZW1haW5pbmcrK1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVyblxufVxuXG5mdW5jIGhpZ2hDb3VudCgpIGludCB7XG4gICAgcmV0dXJuIGxlbih1dGlscy5GaWx0ZXIodG9kb3MsIGZ1bmModCBUb2RvKSBib29sIHsgcmV0dXJuIHQuaXNVcmdlbnQoKSB9KSlcbn1cbiIsInBhY2thZ2UgbWFpblxuXG4vLyBpbmplY3RTdHlsZXMgY3JlYXRlcyBhIDxzdHlsZT4gZWxlbWVudCB3aXRoIGFsbCBhcHAgQ1NTIGFuZCBhcHBlbmRzIGl0IHRvIDxoZWFkPi5cbmZ1bmMgaW5qZWN0U3R5bGVzKCkge1xuICAgIHN0eWxlIDo9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzdHlsZVwiKVxuICAgIHN0eWxlLnRleHRDb250ZW50ID0gYFxuKiwgKjo6YmVmb3JlLCAqOjphZnRlciB7IGJveC1zaXppbmc6IGJvcmRlci1ib3g7IG1hcmdpbjogMDsgcGFkZGluZzogMDsgfVxuXG46cm9vdCB7XG4gIC0tYWNjZW50OiAgICAgICNhNzhiZmM7XG4gIC0tYWNjZW50LTI6ICAgICM4MThjZjg7XG4gIC0tYWNjZW50LWdsb3c6IHJnYmEoMTY3LDEzOSwyNTAsLjE4KTtcbiAgLS1yZWQ6ICAgICAgICAgI2Y4NzE3MTtcbiAgLS1yZWQtZ2xvdzogICAgcmdiYSgyNDgsMTEzLDExMywuMTUpO1xuICAtLWdyZWVuOiAgICAgICAjNmVlN2I3O1xuICAtLXRleHQ6ICAgICAgICAjZjhmYWZjO1xuICAtLXRleHQtMjogICAgICAjOTRhM2I4O1xuICAtLW11dGVkOiAgICAgICAjM2Y0ZjYzO1xuICAtLXN1cmZhY2U6ICAgICByZ2JhKDE1LDIzLDQyLC43KTtcbiAgLS1zdXJmYWNlLTI6ICAgcmdiYSgzMCw0MSw1OSwuNik7XG4gIC0tc3VyZmFjZS0zOiAgIHJnYmEoNTEsNjUsODUsLjUpO1xuICAtLXJpbTogICAgICAgICByZ2JhKDI1NSwyNTUsMjU1LC4wNyk7XG4gIC0tcmFkaXVzOiAgICAgIDIwcHg7XG59XG5cbmJvZHkge1xuICBmb250LWZhbWlseTogXCJJbnRlclwiLCAtYXBwbGUtc3lzdGVtLCBzYW5zLXNlcmlmO1xuICBtaW4taGVpZ2h0OiAxMDB2aDtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGZsZXgtc3RhcnQ7XG4gIGp1c3RpZnktY29udGVudDogY2VudGVyO1xuICBwYWRkaW5nOiA3MnB4IDE2cHggOTZweDtcbiAgYmFja2dyb3VuZDogIzA2MDkxMjtcbiAgb3ZlcmZsb3cteDogaGlkZGVuO1xufVxuXG5ib2R5OjpiZWZvcmUge1xuICBjb250ZW50OiAnJztcbiAgcG9zaXRpb246IGZpeGVkO1xuICBpbnNldDogMDtcbiAgYmFja2dyb3VuZDpcbiAgICByYWRpYWwtZ3JhZGllbnQoZWxsaXBzZSA2MCUgNTAlIGF0IDIwJSAxMCUsIHJnYmEoMTM5LDkyLDI0NiwuMjIpIDAlLCB0cmFuc3BhcmVudCA2MCUpLFxuICAgIHJhZGlhbC1ncmFkaWVudChlbGxpcHNlIDUwJSA2MCUgYXQgODAlIDgwJSwgcmdiYSg5OSwxMDIsMjQxLC4xOCkgMCUsIHRyYW5zcGFyZW50IDYwJSksXG4gICAgcmFkaWFsLWdyYWRpZW50KGVsbGlwc2UgNDAlIDQwJSBhdCA2MCUgMzAlLCByZ2JhKDIzNiw3MiwxNTMsLjEpIDAlLCB0cmFuc3BhcmVudCA1MCUpO1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbiAgei1pbmRleDogMDtcbn1cblxuLmNhcmQge1xuICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gIHotaW5kZXg6IDE7XG4gIHdpZHRoOiAxMDAlO1xuICBtYXgtd2lkdGg6IDQ4MHB4O1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1zdXJmYWNlKTtcbiAgYmFja2Ryb3AtZmlsdGVyOiBibHVyKDI0cHgpIHNhdHVyYXRlKDEuNik7XG4gIC13ZWJraXQtYmFja2Ryb3AtZmlsdGVyOiBibHVyKDI0cHgpIHNhdHVyYXRlKDEuNik7XG4gIGJvcmRlci1yYWRpdXM6IHZhcigtLXJhZGl1cyk7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXJpbSk7XG4gIGJveC1zaGFkb3c6XG4gICAgMCAwIDAgMXB4IHJnYmEoMjU1LDI1NSwyNTUsLjA0KSBpbnNldCxcbiAgICAwIDJweCA0cHggcmdiYSgwLDAsMCwuNCksXG4gICAgMCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNiksXG4gICAgMCAwIDEyMHB4IHJnYmEoMTM5LDkyLDI0NiwuMDYpO1xuICBvdmVyZmxvdzogaGlkZGVuO1xufVxuXG4uaGVhZGVyIHtcbiAgcGFkZGluZzogMzJweCAyOHB4IDI0cHg7XG4gIHBvc2l0aW9uOiByZWxhdGl2ZTtcbn1cblxuLmhlYWRlcjo6YWZ0ZXIge1xuICBjb250ZW50OiAnJztcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBib3R0b206IDA7IGxlZnQ6IDA7IHJpZ2h0OiAwO1xuICBoZWlnaHQ6IDFweDtcbiAgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDkwZGVnLCB0cmFuc3BhcmVudCwgdmFyKC0tcmltKSAzMCUsIHZhcigtLXJpbSkgNzAlLCB0cmFuc3BhcmVudCk7XG59XG5cbi5oZWFkZXItdG9wIHtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiAxMnB4O1xuICBtYXJnaW4tYm90dG9tOiA2cHg7XG59XG5cbi5oZWFkZXItaWNvbiB7XG4gIHdpZHRoOiAzNnB4OyBoZWlnaHQ6IDM2cHg7XG4gIGJhY2tncm91bmQ6IGxpbmVhci1ncmFkaWVudCgxMzVkZWcsICM3YzNhZWQsICNhNzhiZmEpO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjtcbiAgZm9udC1zaXplOiAxcmVtO1xuICBib3gtc2hhZG93OiAwIDRweCAxNHB4IHJnYmEoMTI0LDU4LDIzNywuNCk7XG4gIGZsZXgtc2hyaW5rOiAwO1xufVxuXG5oMSB7XG4gIGZvbnQtc2l6ZTogMS41cmVtO1xuICBmb250LXdlaWdodDogNzAwO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG4gIGxldHRlci1zcGFjaW5nOiAtLjA0ZW07XG59XG5cbi5oaWdoLWJhZGdlIHtcbiAgZGlzcGxheTogbm9uZTtcbiAgZm9udC1zaXplOiAuNnJlbTtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDEzNWRlZywgI2VmNDQ0NCwgI2Y4NzE3MSk7XG4gIGNvbG9yOiAjZmZmO1xuICBwYWRkaW5nOiAzcHggOXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBsZXR0ZXItc3BhY2luZzogLjA4ZW07XG4gIHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7XG4gIGJveC1zaGFkb3c6IDAgMnB4IDEwcHggcmdiYSgyMzksNjgsNjgsLjUpO1xuICBhbmltYXRpb246IHBvcCAuMjVzIGN1YmljLWJlemllciguMzQsMS41NiwuNjQsMSk7XG59XG5cbkBrZXlmcmFtZXMgcG9wIHtcbiAgZnJvbSB7IHRyYW5zZm9ybTogc2NhbGUoMC41KSByb3RhdGUoLThkZWcpOyBvcGFjaXR5OiAwOyB9XG4gIHRvICAgeyB0cmFuc2Zvcm06IHNjYWxlKDEpIHJvdGF0ZSgwZGVnKTsgICAgb3BhY2l0eTogMTsgfVxufVxuXG4udGFnbGluZSB7XG4gIGZvbnQtc2l6ZTogLjczcmVtO1xuICBjb2xvcjogdmFyKC0tbXV0ZWQpO1xuICBsZXR0ZXItc3BhY2luZzogLjAxZW07XG4gIHBhZGRpbmctbGVmdDogNDhweDtcbn1cbi50YWdsaW5lIHN0cm9uZyB7IGNvbG9yOiB2YXIoLS1hY2NlbnQpOyBmb250LXdlaWdodDogNTAwOyB9XG4udGFnbGluZSBhIHsgY29sb3I6IGluaGVyaXQ7IHRleHQtZGVjb3JhdGlvbjogbm9uZTsgfVxuLnRhZ2xpbmUgYTpob3ZlciB7IHRleHQtZGVjb3JhdGlvbjogdW5kZXJsaW5lOyB9XG5cbi5pbnB1dC1yb3cge1xuICBkaXNwbGF5OiBmbGV4O1xuICBnYXA6IDhweDtcbiAgcGFkZGluZzogMjBweCAyMHB4IDE2cHg7XG59XG5cbi50b2RvLWlucHV0IHtcbiAgZmxleDogMTtcbiAgcGFkZGluZzogMTFweCAxNnB4O1xuICBib3JkZXI6IDFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4wOCk7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIGZvbnQtc2l6ZTogLjlyZW07XG4gIGZvbnQtZmFtaWx5OiBpbmhlcml0O1xuICBvdXRsaW5lOiBub25lO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1zdXJmYWNlLTIpO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG4gIHRyYW5zaXRpb246IGJvcmRlci1jb2xvciAuMnMsIGJveC1zaGFkb3cgLjJzLCBiYWNrZ3JvdW5kIC4ycztcbn1cbi50b2RvLWlucHV0OjpwbGFjZWhvbGRlciB7IGNvbG9yOiB2YXIoLS1tdXRlZCk7IH1cbi50b2RvLWlucHV0OmZvY3VzIHtcbiAgYm9yZGVyLWNvbG9yOiByZ2JhKDE2NywxMzksMjUwLC41KTtcbiAgYmFja2dyb3VuZDogdmFyKC0tc3VyZmFjZS0zKTtcbiAgYm94LXNoYWRvdzogMCAwIDAgM3B4IHZhcigtLWFjY2VudC1nbG93KSwgMCAxcHggM3B4IHJnYmEoMCwwLDAsLjMpO1xufVxuXG4uYWRkLWJ0biB7XG4gIHBhZGRpbmc6IDExcHggMjBweDtcbiAgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDEzNWRlZywgIzdjM2FlZCwgI2E3OGJmYSk7XG4gIGNvbG9yOiAjZmZmO1xuICBib3JkZXI6IG5vbmU7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIGZvbnQtc2l6ZTogLjlyZW07XG4gIGZvbnQtZmFtaWx5OiBpbmhlcml0O1xuICBmb250LXdlaWdodDogNjAwO1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIHRyYW5zaXRpb246IG9wYWNpdHkgLjE1cywgYm94LXNoYWRvdyAuMnMsIHRyYW5zZm9ybSAuMXM7XG4gIHdoaXRlLXNwYWNlOiBub3dyYXA7XG4gIGJveC1zaGFkb3c6IDAgNHB4IDE0cHggcmdiYSgxMjQsNTgsMjM3LC4zNSk7XG4gIGxldHRlci1zcGFjaW5nOiAuMDFlbTtcbn1cbi5hZGQtYnRuOmhvdmVyICB7IG9wYWNpdHk6IC45OyBib3gtc2hhZG93OiAwIDZweCAyMHB4IHJnYmEoMTI0LDU4LDIzNywuNSk7IH1cbi5hZGQtYnRuOmFjdGl2ZSB7IHRyYW5zZm9ybTogc2NhbGUoLjk2KTsgb3BhY2l0eTogMTsgfVxuXG4ucHJpb3JpdHktYnRuIHtcbiAgcGFkZGluZzogMTFweCAxNHB4O1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1zdXJmYWNlLTIpO1xuICBjb2xvcjogdmFyKC0tdGV4dC0yKTtcbiAgYm9yZGVyOiAxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMDgpO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBmb250LXNpemU6IC44MnJlbTtcbiAgZm9udC1mYW1pbHk6IGluaGVyaXQ7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgdHJhbnNpdGlvbjogYWxsIC4ycztcbiAgd2hpdGUtc3BhY2U6IG5vd3JhcDtcbn1cbi5wcmlvcml0eS1idG46aG92ZXIgeyBib3JkZXItY29sb3I6IHJnYmEoMjU1LDI1NSwyNTUsLjE4KTsgY29sb3I6IHZhcigtLXRleHQpOyB9XG4ucHJpb3JpdHktYnRuLm9uIHtcbiAgYmFja2dyb3VuZDogdmFyKC0tcmVkLWdsb3cpO1xuICBjb2xvcjogdmFyKC0tcmVkKTtcbiAgYm9yZGVyLWNvbG9yOiByZ2JhKDI0OCwxMTMsMTEzLC4zKTtcbiAgYm94LXNoYWRvdzogMCAwIDAgM3B4IHJnYmEoMjQ4LDExMywxMTMsLjA3KTtcbn1cblxuLmxpc3QtZGl2aWRlciB7XG4gIGhlaWdodDogMXB4O1xuICBiYWNrZ3JvdW5kOiBsaW5lYXItZ3JhZGllbnQoOTBkZWcsIHRyYW5zcGFyZW50LCB2YXIoLS1yaW0pIDMwJSwgdmFyKC0tcmltKSA3MCUsIHRyYW5zcGFyZW50KTtcbiAgbWFyZ2luOiAwIDIwcHg7XG59XG5cbi50b2RvLWxpc3Qge1xuICBsaXN0LXN0eWxlOiBub25lO1xuICBwYWRkaW5nOiA4cHggMDtcbiAgbWluLWhlaWdodDogNjBweDtcbn1cblxuLnRvZG8taXRlbSB7XG4gIGRpc3BsYXk6IGZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGdhcDogMTJweDtcbiAgcGFkZGluZzogMTJweCAyMHB4O1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kIC4xNXM7XG4gIGN1cnNvcjogZGVmYXVsdDtcbiAgcG9zaXRpb246IHJlbGF0aXZlO1xufVxuLnRvZG8taXRlbTo6YWZ0ZXIge1xuICBjb250ZW50OiAnJztcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBib3R0b206IDA7IGxlZnQ6IDIwcHg7IHJpZ2h0OiAyMHB4O1xuICBoZWlnaHQ6IDFweDtcbiAgYmFja2dyb3VuZDogcmdiYSgyNTUsMjU1LDI1NSwuMDQpO1xufVxuLnRvZG8taXRlbTpsYXN0LWNoaWxkOjphZnRlciB7IGRpc3BsYXk6IG5vbmU7IH1cbi50b2RvLWl0ZW06aG92ZXIgeyBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwyNTUsMjU1LC4wMyk7IH1cbi50b2RvLWl0ZW1bZHJhZ2dhYmxlPVwidHJ1ZVwiXSB7IGN1cnNvcjogZ3JhYjsgfVxuLnRvZG8taXRlbVtkcmFnZ2FibGU9XCJ0cnVlXCJdOmFjdGl2ZSB7IGN1cnNvcjogZ3JhYmJpbmc7IH1cbi50b2RvLWl0ZW0uZHJhZ2dpbmcgeyBvcGFjaXR5OiAuMzU7IH1cbi50b2RvLWl0ZW0uZHJhZy1vdmVyLXRvcCAgICB7IGJveC1zaGFkb3c6IGluc2V0IDAgIDJweCAwIDAgdmFyKC0tYWNjZW50KTsgfVxuLnRvZG8taXRlbS5kcmFnLW92ZXItYm90dG9tIHsgYm94LXNoYWRvdzogaW5zZXQgMCAtMnB4IDAgMCB2YXIoLS1hY2NlbnQpOyB9XG5cblxuLnRvZG8tY2Ige1xuICBhcHBlYXJhbmNlOiBub25lO1xuICAtd2Via2l0LWFwcGVhcmFuY2U6IG5vbmU7XG4gIHdpZHRoOiAyMHB4OyBoZWlnaHQ6IDIwcHg7XG4gIGJvcmRlcjogMS41cHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMTUpO1xuICBib3JkZXItcmFkaXVzOiA3cHg7XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgZmxleC1zaHJpbms6IDA7XG4gIHBvc2l0aW9uOiByZWxhdGl2ZTtcbiAgdHJhbnNpdGlvbjogYWxsIC4ycztcbiAgYmFja2dyb3VuZDogdmFyKC0tc3VyZmFjZS0yKTtcbn1cbi50b2RvLWNiOmhvdmVyIHtcbiAgYm9yZGVyLWNvbG9yOiB2YXIoLS1hY2NlbnQpO1xuICBib3gtc2hhZG93OiAwIDAgMCAzcHggdmFyKC0tYWNjZW50LWdsb3cpO1xufVxuLnRvZG8tY2I6Y2hlY2tlZCB7XG4gIGJhY2tncm91bmQ6IGxpbmVhci1ncmFkaWVudCgxMzVkZWcsICM3YzNhZWQsICNhNzhiZmEpO1xuICBib3JkZXItY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3gtc2hhZG93OiAwIDJweCA4cHggcmdiYSgxMjQsNTgsMjM3LC40KTtcbn1cbi50b2RvLWNiOmNoZWNrZWQ6OmFmdGVyIHtcbiAgY29udGVudDogJyc7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgbGVmdDogNXB4OyB0b3A6IDJweDtcbiAgd2lkdGg6IDZweDsgaGVpZ2h0OiAxMHB4O1xuICBib3JkZXI6IDJweCBzb2xpZCAjZmZmO1xuICBib3JkZXItdG9wOiBub25lO1xuICBib3JkZXItbGVmdDogbm9uZTtcbiAgdHJhbnNmb3JtOiByb3RhdGUoNDVkZWcpO1xufVxuXG4udG9kby10ZXh0IHtcbiAgZmxleDogMTtcbiAgZm9udC1zaXplOiAuOXJlbTtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBsaW5lLWhlaWdodDogMS40NTtcbiAgdHJhbnNpdGlvbjogY29sb3IgLjJzO1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xufVxuLnRvZG8taXRlbS5kb25lIC50b2RvLXRleHQge1xuICB0ZXh0LWRlY29yYXRpb246IGxpbmUtdGhyb3VnaDtcbiAgdGV4dC1kZWNvcmF0aW9uLWNvbG9yOiByZ2JhKDI1NSwyNTUsMjU1LC4yKTtcbiAgY29sb3I6IHZhcigtLW11dGVkKTtcbn1cblxuLmJhZGdlIHtcbiAgZm9udC1zaXplOiAuNThyZW07XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIGJhY2tncm91bmQ6IGxpbmVhci1ncmFkaWVudCgxMzVkZWcsICNlZjQ0NDQsICNmODcxNzEpO1xuICBjb2xvcjogI2ZmZjtcbiAgcGFkZGluZzogMnB4IDhweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgZmxleC1zaHJpbms6IDA7XG4gIGxldHRlci1zcGFjaW5nOiAuMDhlbTtcbiAgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTtcbiAgYm94LXNoYWRvdzogMCAycHggOHB4IHJnYmEoMjM5LDY4LDY4LC4zNSk7XG59XG5cbi5kZWwtYnRuIHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYm9yZGVyOiBub25lO1xuICBjb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGZvbnQtc2l6ZTogLjhyZW07XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgcGFkZGluZzogNXB4IDdweDtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBsaW5lLWhlaWdodDogMTtcbiAgdHJhbnNpdGlvbjogY29sb3IgLjE1cywgYmFja2dyb3VuZCAuMTVzO1xuICBmbGV4LXNocmluazogMDtcbn1cbi50b2RvLWl0ZW06aG92ZXIgLmRlbC1idG4geyBjb2xvcjogdmFyKC0tbXV0ZWQpOyB9XG4uZGVsLWJ0bjpob3ZlciB7IGNvbG9yOiB2YXIoLS1yZWQpOyBiYWNrZ3JvdW5kOiB2YXIoLS1yZWQtZ2xvdyk7IH1cblxuLmVtcHR5IHtcbiAgcGFkZGluZzogNDRweCAyNHB4O1xuICBjb2xvcjogdmFyKC0tbXV0ZWQpO1xuICBmb250LXNpemU6IC44NXJlbTtcbiAgdGV4dC1hbGlnbjogY2VudGVyO1xuICBsaXN0LXN0eWxlOiBub25lO1xuICBsZXR0ZXItc3BhY2luZzogLjAxZW07XG59XG5cbi5mb290ZXIge1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW47XG4gIGZsZXgtd3JhcDogd3JhcDtcbiAgZ2FwOiA4cHg7XG4gIHBhZGRpbmc6IDE0cHggMjBweDtcbiAgcG9zaXRpb246IHJlbGF0aXZlO1xufVxuXG4uZm9vdGVyOjpiZWZvcmUge1xuICBjb250ZW50OiAnJztcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICB0b3A6IDA7IGxlZnQ6IDA7IHJpZ2h0OiAwO1xuICBoZWlnaHQ6IDFweDtcbiAgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDkwZGVnLCB0cmFuc3BhcmVudCwgdmFyKC0tcmltKSAzMCUsIHZhcigtLXJpbSkgNzAlLCB0cmFuc3BhcmVudCk7XG59XG5cbi5jb3VudCB7XG4gIGZvbnQtc2l6ZTogLjc1cmVtO1xuICBjb2xvcjogdmFyKC0tbXV0ZWQpO1xuICB3aGl0ZS1zcGFjZTogbm93cmFwO1xuICBmb250LXdlaWdodDogNTAwO1xuICBsZXR0ZXItc3BhY2luZzogLjAxZW07XG59XG5cbi5maWx0ZXItYmFyIHsgZGlzcGxheTogZmxleDsgZ2FwOiAycHg7IH1cblxuLmZpbHRlci1idG4ge1xuICBwYWRkaW5nOiA1cHggMTNweDtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYm9yZGVyOiAxcHggc29saWQgdHJhbnNwYXJlbnQ7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgZm9udC1zaXplOiAuNzVyZW07XG4gIGZvbnQtZmFtaWx5OiBpbmhlcml0O1xuICBmb250LXdlaWdodDogNTAwO1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIGNvbG9yOiB2YXIoLS1tdXRlZCk7XG4gIHRyYW5zaXRpb246IGFsbCAuMTVzO1xuICBsZXR0ZXItc3BhY2luZzogLjAxZW07XG59XG4uZmlsdGVyLWJ0bjpob3ZlciAgeyBjb2xvcjogdmFyKC0tdGV4dC0yKTsgYmFja2dyb3VuZDogdmFyKC0tc3VyZmFjZS0yKTsgfVxuLmZpbHRlci1idG4uYWN0aXZlIHtcbiAgYm9yZGVyLWNvbG9yOiByZ2JhKDE2NywxMzksMjUwLC4zKTtcbiAgY29sb3I6IHZhcigtLWFjY2VudCk7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGJhY2tncm91bmQ6IHJnYmEoMTY3LDEzOSwyNTAsLjA4KTtcbn1cblxuLmNsZWFyLWJ0biB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJvcmRlcjogbm9uZTtcbiAgZm9udC1zaXplOiAuNzVyZW07XG4gIGZvbnQtZmFtaWx5OiBpbmhlcml0O1xuICBjb2xvcjogdmFyKC0tbXV0ZWQpO1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIHBhZGRpbmc6IDVweCAxMHB4O1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHRyYW5zaXRpb246IGNvbG9yIC4xNXMsIGJhY2tncm91bmQgLjE1cztcbiAgd2hpdGUtc3BhY2U6IG5vd3JhcDtcbiAgbGV0dGVyLXNwYWNpbmc6IC4wMWVtO1xufVxuLmNsZWFyLWJ0bjpob3ZlciB7IGNvbG9yOiB2YXIoLS1yZWQpOyBiYWNrZ3JvdW5kOiB2YXIoLS1yZWQtZ2xvdyk7IH1cblxuLnN5bmMtc3RhdHVzIHtcbiAgZm9udC1zaXplOiAuNjhyZW07XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGxldHRlci1zcGFjaW5nOiAuMDRlbTtcbiAgcGFkZGluZzogM3B4IDEwcHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG9wYWNpdHk6IDA7XG4gIHRyYW5zaXRpb246IG9wYWNpdHkgLjJzO1xufVxuLnN5bmMtc3RhdHVzLnNhdmluZyB7XG4gIG9wYWNpdHk6IDE7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LTIpO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1zdXJmYWNlLTMpO1xufVxuLnN5bmMtc3RhdHVzLnNhdmVkIHtcbiAgb3BhY2l0eTogMTtcbiAgY29sb3I6IHZhcigtLWdyZWVuKTtcbiAgYmFja2dyb3VuZDogcmdiYSgxMTAsMjMxLDE4MywuMSk7XG59XG4uc3luYy1zdGF0dXMuZXJyb3Ige1xuICBvcGFjaXR5OiAxO1xuICBjb2xvcjogdmFyKC0tcmVkKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tcmVkLWdsb3cpO1xufVxuYFxuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc3R5bGUpXG59XG4iLCJwYWNrYWdlIG1haW5cblxuLy8g4pSA4pSAIEZpbHRlciBtb2RlIChpb3RhIGNvbnN0YW50cykg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmNvbnN0IChcbiAgICBGaWx0ZXJBbGwgPSBpb3RhXG4gICAgRmlsdGVyQWN0aXZlXG4gICAgRmlsdGVyQ29tcGxldGVkXG4pXG5cbmZ1bmMgZmlsdGVyTGFiZWwoZiBpbnQpIHN0cmluZyB7XG4gICAgc3dpdGNoIGYge1xuICAgIGNhc2UgRmlsdGVyQWxsOlxuICAgICAgICByZXR1cm4gXCJBbGxcIlxuICAgIGNhc2UgRmlsdGVyQWN0aXZlOlxuICAgICAgICByZXR1cm4gXCJBY3RpdmVcIlxuICAgIGNhc2UgRmlsdGVyQ29tcGxldGVkOlxuICAgICAgICByZXR1cm4gXCJDb21wbGV0ZWRcIlxuICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBcIlwiXG4gICAgfVxufVxuXG4vLyDilIDilIAgUHJpb3JpdHkgKGlvdGEgY29uc3RhbnRzKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuY29uc3QgKFxuICAgIFByaW9yaXR5Tm9ybWFsID0gaW90YVxuICAgIFByaW9yaXR5SGlnaFxuKVxuXG4vLyDilIDilIAgVG9kbyBzdHJ1Y3Qg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbnR5cGUgVG9kbyBzdHJ1Y3Qge1xuICAgIGlkICAgICAgIGludFxuICAgIHRleHQgICAgIHN0cmluZ1xuICAgIGRvbmUgICAgIGJvb2xcbiAgICBwcmlvcml0eSBpbnRcbn1cblxuZnVuYyAodCBUb2RvKSBpc1VyZ2VudCgpIGJvb2wge1xuICAgIHJldHVybiB0LnByaW9yaXR5ID09IFByaW9yaXR5SGlnaCAmJiAhdC5kb25lXG59XG5cbmZ1bmMgKHQgVG9kbykgd2l0aERvbmUoZG9uZSBib29sKSBUb2RvIHtcbiAgICByZXR1cm4gVG9kb3t0LmlkLCB0LnRleHQsIGRvbmUsIHQucHJpb3JpdHl9XG59XG4iXX0=
